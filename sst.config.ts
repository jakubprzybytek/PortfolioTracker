/// <reference path="./.sst/platform/config.d.ts" />

// Infrastructure for the portfolio tracker (see Docs/README.md). Everything is serverless and
// costs nothing when idle: three DynamoDB tables, one S3 bucket, scheduled Lambdas, an HTTP API and a static site.

const WARSAW = "Europe/Warsaw";

// Login: a form in the app against the existing, shared Cognito user pool (AlbedoUserPool). Other apps use the
// same pool and anyone can sign up to it, so the API also requires a group, per stage (accessGroups;
// Docs/ui.md, "Access").
const COGNITO_POOL_ID = "eu-west-1_IVai0KEAA";
const TEST_USER = "portfolio-tracker-test@albedoonline.com";

// prod → portfoliotracker.albedoonline.com, any other stage → <stage>.portfoliotracker.albedoonline.com
const ROOT_DOMAIN = "portfoliotracker.albedoonline.com";
const stageDomain = (stage: string) => (stage === "prod" ? ROOT_DOMAIN : `${stage}.${ROOT_DOMAIN}`);

export default $config({
  app(input) {
    return {
      name: "portfolio-tracker",
      home: "aws",
      providers: { aws: { region: "eu-west-1" } },
      removal: input.stage === "prod" ? "retain" : "remove",
      protect: input.stage === "prod",
    };
  },
  async run() {
    const { accessGroups } = await import("./packages/jobs/src/lib/access.ts");

    // --- storage ---------------------------------------------------------------------------------
    // Three tables by lifecycle (Docs/data-storage.md): market data can be rebuilt, transactions can't,
    // holdings are computed by valuation.
    const keys = { PK: "string", SK: "string" } as const;
    const primaryIndex = { hashKey: "PK", rangeKey: "SK" };
    const byType = {
      fields: { ...keys, GSI1PK: "string", GSI1SK: "string" } as const,
      primaryIndex,
      globalIndexes: { GSI1: { hashKey: "GSI1PK", rangeKey: "GSI1SK" } },
    };
    const withPitr = {
      table: (args: aws.dynamodb.TableArgs) => {
        args.pointInTimeRecovery = { enabled: true };
      },
    };

    // On prod a table can't be deleted (by a deploy, the console or the API) until its deletion protection is turned off.
    const deletionProtection = $app.stage === "prod";
    const market = new sst.aws.Dynamo("Market", { ...byType, ttl: "ttl", deletionProtection, transform: withPitr });
    const transactions = new sst.aws.Dynamo("Transactions", { ...byType, deletionProtection, transform: withPitr });
    const holdings = new sst.aws.Dynamo("Holdings", { fields: keys, primaryIndex, deletionProtection });

    // raw/<source>/<yyyy>/<mm>/<dd>/… = originals of every download; imports/<kind>/… = files you upload; exports/… =
    // the monthly backup. Versioned: an overwritten or deleted file can be got back for 90 days.
    const files = new sst.aws.Bucket("Files", { versioning: true });
    new aws.s3.BucketLifecycleConfiguration("FilesLifecycle", {
      bucket: files.name,
      rules: [
        // Old originals are only read to re-run a parser: Glacier Instant Retrieval after 90 days (still read at once).
        // Only files of 128 KB or more: smaller ones are billed as 128 KB there, which costs more than keeping them.
        { id: "raw-to-glacier-ir", status: "Enabled", filter: { and: { prefix: "raw/", objectSizeGreaterThan: 128 * 1024 } }, transitions: [{ days: 90, storageClass: "GLACIER_IR" }] },
        { id: "old-versions", status: "Enabled", filter: {}, noncurrentVersionExpiration: { noncurrentDays: 90 }, expiration: { expiredObjectDeleteMarker: true }, abortIncompleteMultipartUpload: { daysAfterInitiation: 7 } },
      ],
    }, { dependsOn: [files] });
    // A second copy of the monthly backup, apart from the live files (an `aws s3 rm` of the files bucket doesn't take
    // it); versioned, old versions kept a year. Same account: a copy elsewhere is still by hand (data/README.md).
    const backups = new sst.aws.Bucket("Backups", { versioning: true });
    new aws.s3.BucketLifecycleConfiguration("BackupsLifecycle", {
      bucket: backups.name,
      rules: [{ id: "old-versions", status: "Enabled", filter: {}, noncurrentVersionExpiration: { noncurrentDays: 365 } }],
    }, { dependsOn: [backups] });

    // E-mail alerts (prod only): jobs publish when they start failing or work again (jobs/lib/alerts.ts), CloudWatch
    // alarms below when the valuation errors or times out and when the dead-letter queue holds a request. The address
    // is the `AlertEmail` secret (the repo is public); AWS e-mails it once to confirm the subscription.
    const alerts = $app.stage === "prod" ? new sst.aws.SnsTopic("Alerts") : undefined;
    if (alerts) new aws.sns.TopicSubscription("AlertsEmail", { topic: alerts.arn, protocol: "email", endpoint: new sst.Secret("AlertEmail").value });

    // Each function links only the tables it needs (Docs/data-storage.md, "Access per function"); every one may alert.
    const link = alerts ? [files, alerts] : [files];
    // arm64 (Graviton): all the code is plain JS, and it's ~20 % cheaper than x86_64. Logs as JSON (one object per line,
    // with the request id), so CloudWatch Logs Insights can filter on fields.
    const defaults = {
      link: [...link, market],
      timeout: "5 minutes" as const,
      memory: "512 MB" as const,
      architecture: "arm64" as const,
      logging: { format: "json" as const },
    };

    // IBKR Flex Web Service (mark prices of what's held at IBKR): the token is the `IbkrFlexToken` secret, on dev and
    // prod only (nothing at IBKR is tested on int); the query (Open Positions + Prior Period Positions, XML) isn't
    // secret without it. Docs/data-sources.md, "IBKR Flex Web Service".
    const ibkrFlex = ["dev", "prod"].includes($app.stage) ? new sst.Secret("IbkrFlexToken") : undefined;
    const ibkrEnv = { IBKR_FLEX_QUERY_ID: "1688199" };

    // --- jobs ----------------------------------------------------------------------------------
    // Revaluations requested by imports, backfills, FX and the monthly job go through a FIFO queue with one message group:
    // Lambda then runs them one at a time, in order. Overlapping runs could end with the older data written last
    // (SNAP#LATEST without the newest transactions). Reserved concurrency would do it too, but the account's limit
    // (50) doesn't allow reserving any.
    // A message that fails 3 times goes to the dead-letter queue (kept 14 days), so it can't hold up the ones behind it
    // for good; the failure shows on the Dashboard (job runs).
    const valuationDeadLetter = new sst.aws.Queue("ValuationDeadLetter", { fifo: true, transform: { queue: { messageRetentionSeconds: 14 * 24 * 3600 } } });
    const valuationQueue = new sst.aws.Queue("ValuationQueue", { fifo: true, visibilityTimeout: "16 minutes", dlq: { queue: valuationDeadLetter.arn, retry: 3 } });

    const valuation = new sst.aws.Function("Valuation", {
      ...defaults,
      handler: "packages/jobs/src/handlers/valuation.handler",
      timeout: "15 minutes",
      // CPU grows with memory: a full run on test (6,791 days, before the Ledger) took 77 s at 512 MB and 16 s at 2 GB, at
      // about the same cost (GB-seconds).
      memory: "2 GB",
      link: [...link, market, transactions, holdings, valuationQueue], // the queue link lets it receive and delete
    });
    // Up to 10 requests waiting together make one run (a FIFO queue allows 10; the handler merges their ranges).
    valuationQueue.subscribe(valuation.arn, { batch: { size: 10 } });

    // Three alarms (with WatchdogSilent below), within CloudWatch's 10 free ones (one per job function would be ~18):
    // what `runJob` can't report. Other jobs' timeouts are found by the watchdog (a run left "running").
    if (alerts) {
      const notify = { alarmActions: [alerts.arn], okActions: [alerts.arn], treatMissingData: "notBreaching", evaluationPeriods: 1, period: 300 };
      new aws.cloudwatch.MetricAlarm("ValuationErrors", {
        ...notify,
        alarmDescription: "The valuation Lambda failed or timed out (a timeout leaves no job run)",
        namespace: "AWS/Lambda",
        metricName: "Errors",
        dimensions: { FunctionName: valuation.name },
        statistic: "Sum",
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        threshold: 1,
      });
      new aws.cloudwatch.MetricAlarm("ValuationDeadLetterNotEmpty", {
        ...notify,
        alarmDescription: "A revaluation request failed 3 times and waits in the dead-letter queue (kept 14 days)",
        namespace: "AWS/SQS",
        metricName: "ApproximateNumberOfMessagesVisible",
        dimensions: { QueueName: valuationDeadLetter.nodes.queue.name },
        statistic: "Maximum",
        comparisonOperator: "GreaterThanThreshold",
        threshold: 0,
      });
    }

    const backfill = new sst.aws.Function("Backfill", {
      ...defaults,
      handler: "packages/jobs/src/handlers/backfill.handler",
      timeout: "15 minutes",
      link: [...link, market, valuationQueue, ...(ibkrFlex ? [ibkrFlex] : [])],
      environment: ibkrEnv,
    });

    // NBP exchange rates; also started by an import that brings a foreign-currency instrument.
    const fx = new sst.aws.Function("Fx", {
      ...defaults,
      handler: "packages/jobs/src/handlers/fx.handler",
      timeout: "10 minutes",
      link: [...link, market, transactions, valuationQueue],
    });

    const importer = new sst.aws.Function("Import", {
      ...defaults,
      handler: "packages/jobs/src/handlers/import.handler",
      timeout: "15 minutes",
      // Starts the backfill of new instruments directly (a stream on a new table misses early inserts).
      link: [...link, market, transactions, valuationQueue, backfill, fx],
    });
    // Live prices on demand ("Refresh prices" in the app): today's quotes, then a revaluation of today.
    const live = new sst.aws.Function("Live", {
      ...defaults,
      handler: "packages/jobs/src/handlers/live.handler",
      timeout: "3 minutes",
      link: [...link, market, valuationQueue],
    });
    files.notify({
      notifications: [{ name: "Imports", function: importer.arn, events: ["s3:ObjectCreated:*"], filterPrefix: "imports/" }],
    });

    // GPW publishes the day's archive file some time after 18:30 (not there at 18:30 on 2026-10-12, there by 23:27):
    // two evening runs before the 22:30 valuation; each fills any missing weekday of the look-back.
    for (const [name, at] of [["EodGpw", "30 20"], ["EodGpwLate", "0 22"]] as const) {
      new sst.aws.CronV2(name, {
        function: { ...defaults, handler: "packages/jobs/src/handlers/eodGpw.handler" },
        schedule: `cron(${at} ? * MON-FRI *)`,
        timezone: WARSAW,
        retries: 2,
      });
    }
    new sst.aws.CronV2("RecheckGpw", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodGpw.handler" },
      schedule: "cron(15 7 ? * TUE-SAT *)",
      timezone: WARSAW,
      event: { final: true },
      retries: 2,
    });
    // ETFs (Yahoo): after the Amsterdam/Xetra close, and a morning pass for anything missed.
    new sst.aws.CronV2("EodEtf", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodEtf.handler" },
      schedule: "cron(0 19 ? * MON-FRI *)",
      timezone: WARSAW,
      retries: 2,
    });
    new sst.aws.CronV2("RecheckEtf", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodEtf.handler" },
      schedule: "cron(0 7 ? * TUE-SAT *)",
      timezone: WARSAW,
      retries: 2,
    });
    // Catalyst corporate bonds (BiznesRadar): evening for today's quote, morning for yesterday's final session.
    new sst.aws.CronV2("EodCatalyst", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodCatalyst.handler" },
      schedule: "cron(30 19 ? * MON-FRI *)",
      timezone: WARSAW,
      retries: 2,
    });
    new sst.aws.CronV2("RecheckCatalyst", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodCatalyst.handler" },
      schedule: "cron(0 8 ? * TUE-SAT *)",
      timezone: WARSAW,
      retries: 2,
    });
    // Coupon periods of corporate bonds (obligacje.pl): new periods and the current rate where none is stored.
    new sst.aws.CronV2("Coupons", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/coupons.handler", link: [...link, market, valuationQueue] },
      schedule: "cron(0 9 ? * MON-FRI *)",
      timezone: WARSAW,
      retries: 2,
    });
    // Foreign government bonds at IBKR (onvista, Börse Stuttgart, open until 22:00): before the 22:30 valuation,
    // and a morning pass that turns today's quote into the final close.
    new sst.aws.CronV2("EodBonds", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodBonds.handler" },
      schedule: "cron(10 22 ? * MON-FRI *)",
      timezone: WARSAW,
      retries: 2,
    });
    new sst.aws.CronV2("RecheckBonds", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodBonds.handler" },
      schedule: "cron(10 7 ? * TUE-SAT *)",
      timezone: WARSAW,
      retries: 2,
    });
    // IBKR's mark prices (T-bills) and a check of the onvista closes against them: IBKR's statement for the last business
    // day, before the morning valuation. Not on int (no token).
    if (ibkrFlex)
      new sst.aws.CronV2("EodIbkr", {
        function: { ...defaults, handler: "packages/jobs/src/handlers/eodIbkr.handler", link: [...link, market, ibkrFlex], environment: ibkrEnv },
        schedule: "cron(5 7 ? * TUE-SAT *)",
        timezone: WARSAW,
        retries: 2,
      });
    // Benchmarks of the Performance view (WIG from GPW's archive, MSCI World from Yahoo): after GPW's evening file,
    // and a morning pass. Nothing is valued from them, so no valuation follows.
    new sst.aws.CronV2("Benchmarks", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/benchmarks.handler" },
      schedule: "cron(5 22 ? * MON-FRI *)",
      timezone: WARSAW,
      retries: 2,
    });
    new sst.aws.CronV2("RecheckBenchmarks", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/benchmarks.handler" },
      schedule: "cron(20 7 ? * TUE-SAT *)",
      timezone: WARSAW,
      retries: 2,
    });
    // Data quality (gaps, stale prices, jumps, bond prices out of range) of what's held, after the morning rechecks;
    // reads the latest snapshot for what's held.
    new sst.aws.CronV2("Quality", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/quality.handler", link: [...link, market, holdings] },
      schedule: "cron(30 8 ? * TUE-SAT *)",
      timezone: WARSAW,
      retries: 2,
    });
    // NBP table A is published around 12:00 on business days; the afternoon run catches a late table.
    new sst.aws.CronV2("FxNoon", { function: fx.arn, schedule: "cron(30 12 ? * MON-FRI *)", timezone: WARSAW, retries: 2 });
    new sst.aws.CronV2("FxAfternoon", { function: fx.arn, schedule: "cron(30 16 ? * MON-FRI *)", timezone: WARSAW, retries: 2 });
    new sst.aws.CronV2("Monthly", {
      // Revalues when the Ministry publishes new retail-bond rates.
      function: { ...defaults, handler: "packages/jobs/src/handlers/monthly.handler", link: [...link, market, valuationQueue] },
      schedule: "cron(0 10 16 * ? *)",
      timezone: WARSAW,
      retries: 2,
    });
    // Backup of accounts, instruments, hand-entered prices, transactions and notes (the data that exists nowhere else) to
    // exports/<date>/ in the bucket, in the import formats.
    new sst.aws.CronV2("Export", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/export.handler", link: [...link, market, transactions, backups] },
      schedule: "cron(0 4 1 * ? *)",
      timezone: WARSAW,
      retries: 2,
    });
    // Watchdog (jobs/lib/watchdog.ts): runs that timed out, jobs that stopped running, price jobs writing nothing.
    // Every day, after the morning runs; its problems are e-mailed by runJob, and the alarm below notices if it stops.
    const watchdog = new sst.aws.Function("Watchdog", { ...defaults, handler: "packages/jobs/src/handlers/watchdog.handler" });
    new sst.aws.CronV2("WatchdogDaily", { function: watchdog.arn, schedule: "cron(45 8 * * ? *)", timezone: WARSAW, retries: 2 });
    if (alerts)
      new aws.cloudwatch.MetricAlarm("WatchdogSilent", {
        // Named for the deploy role, which may only manage alarms named portfolio-tracker-* (or the older Valuation*).
        name: `portfolio-tracker-${$app.stage}-watchdog-silent`,
        alarmActions: [alerts.arn],
        okActions: [alerts.arn],
        alarmDescription: "The watchdog hasn't run for two days: the schedules may have stopped firing",
        namespace: "AWS/Lambda",
        metricName: "Invocations",
        dimensions: { FunctionName: watchdog.name },
        statistic: "Sum",
        period: 86_400,
        evaluationPeriods: 2,
        comparisonOperator: "LessThanThreshold",
        threshold: 1,
        // No data at all is the case this alarm is for.
        treatMissingData: "breaching",
      });

    new sst.aws.CronV2("ValuationEvening", { function: valuation.arn, schedule: "cron(30 22 ? * MON-FRI *)", timezone: WARSAW });
    // Mornings Tuesday to Sunday: the weekend's days get a point too (no Sunday run left 2026-10-25 without one, a dip to 0 in the position charts).
    new sst.aws.CronV2("ValuationMorning", { function: valuation.arn, schedule: "cron(30 7 ? * SUN,TUE-SAT *)", timezone: WARSAW });

    // --- auth ----------------------------------------------------------------------------------
    // One domain per stage: the site at "/", the API at "/api/*" (same origin, one certificate).
    const domain = stageDomain($app.stage);
    const pool = sst.aws.CognitoUserPool.get("Auth", COGNITO_POOL_ID);
    const clientName = (kind: string) => `portfolio-tracker-${$app.stage}-${kind}`;

    // One client per stage, no secret. The site's login form uses SRP (the password never leaves the browser);
    // no hosted login page, so no OAuth flows or callback URLs. Access token 1 h, refresh token 30 days.
    // On int/dev the tests also log in with a plain password (USER_PASSWORD_AUTH); never on prod.
    const testing = $app.stage !== "prod";
    const webClient = pool.addClient("WebClient", {
      transform: {
        client: (args) => {
          args.name = clientName("web");
          args.allowedOauthFlowsUserPoolClient = false;
          args.allowedOauthFlows = [];
          args.allowedOauthScopes = [];
          args.callbackUrls = [];
          args.supportedIdentityProviders = ["COGNITO"];
          args.explicitAuthFlows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", ...(testing ? ["ALLOW_USER_PASSWORD_AUTH"] : [])];
          args.preventUserExistenceErrors = "ENABLED";
          args.enableTokenRevocation = true;
          args.accessTokenValidity = 1;
          args.idTokenValidity = 1;
          args.refreshTokenValidity = 30;
          args.tokenValidityUnits = { accessToken: "hours", idToken: "hours", refreshToken: "days" };
        },
      },
    });

    // Read by the integration and E2E tests through `sst shell`: Resource.TestUser, Resource.TestUserPassword.
    if (testing) {
      new sst.Secret("TestUserPassword");
      new sst.Linkable("TestUser", { properties: { email: TEST_USER, clientId: webClient.id } });
    }

    // --- api + web -----------------------------------------------------------------------------
    // The site calls the API on its own origin (/api through the Router); only `sst dev` (localhost) and the E2E tests
    // against the local dev server call API Gateway cross-origin, never on prod.
    const api = new sst.aws.ApiGatewayV2("Api", {
      cors: { allowOrigins: [`https://${domain}`, ...(testing ? ["http://localhost:5173"] : [])], allowHeaders: ["authorization", "content-type", "x-if-none-match"], exposeHeaders: ["etag"] },
      // A ceiling per route (the account's default is 10,000 requests/s): bounds what a flood can cost, mainly on the
      // feed, the one route without a login. The app's own bursts (a view's few requests, the E2E tests) stay well below.
      transform: {
        stage: (args) => {
          args.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };
        },
      },
    });
    // API Gateway accepts only this pool's tokens issued to our clients; the Lambda checks the group.
    const authorizer = api.addAuthorizer({
      name: "Cognito",
      jwt: {
        issuer: `https://cognito-idp.eu-west-1.amazonaws.com/${COGNITO_POOL_ID}`,
        audiences: [webClient.id],
      },
    });
    const auth = { auth: { jwt: { authorizer: authorizer.id } } };
    const apiHandler = {
      ...defaults,
      handler: "packages/jobs/src/handlers/api.handler",
      timeout: "30 seconds" as const,
      // Writes (the "Add transaction" form) queue a revaluation; a new instrument starts its history backfill and FX rates.
      // The dead-letter queue: GET /status shows how many revaluations wait in it.
      link: [...link, market, transactions, holdings, valuationQueue, valuationDeadLetter, backfill, fx, live],
      environment: { ACCESS_GROUPS: accessGroups($app.stage).join(",") },
    };
    api.route("GET /holdings", apiHandler, auth);
    api.route("GET /portfolio/history", apiHandler, auth);
    api.route("GET /portfolio/years", apiHandler, auth);
    api.route("GET /instruments", apiHandler, auth);
    api.route("GET /hold-sell", apiHandler, auth);
    api.route("PUT /hold-sell/assumptions", apiHandler, auth);
    api.route("GET /targets", apiHandler, auth);
    api.route("GET /sales", apiHandler, auth);
    api.route("GET /cash-flows", apiHandler, auth);
    api.route("POST /feed-token", apiHandler, auth);
    api.route("DELETE /feed-token", apiHandler, auth);
    api.route("PUT /targets", apiHandler, auth);
    api.route("GET /instruments/{isin}/prices", apiHandler, auth);
    api.route("GET /instruments/{isin}/transactions", apiHandler, auth);
    api.route("POST /instruments/{isin}/prices", apiHandler, auth);
    api.route("DELETE /instruments/{isin}/prices/{date}", apiHandler, auth);
    api.route("PUT /instruments/{isin}/asset-class", apiHandler, auth);
    api.route("GET /instruments/{isin}/coupons", apiHandler, auth);
    api.route("POST /instruments/{isin}/coupons", apiHandler, auth);
    api.route("PUT /instruments/{isin}/coupons/{start}", apiHandler, auth);
    api.route("DELETE /instruments/{isin}/coupons/{start}", apiHandler, auth);
    api.route("GET /transactions", apiHandler, auth);
    api.route("GET /transactions/log", apiHandler, auth);
    api.route("POST /transactions", apiHandler, auth);
    api.route("PUT /transactions/{id}", apiHandler, auth);
    api.route("DELETE /transactions/{id}", apiHandler, auth);
    api.route("GET /instruments/lookup", apiHandler, auth);
    api.route("POST /instruments", apiHandler, auth);
    api.route("GET /prices", apiHandler, auth);
    api.route("POST /prices/refresh", apiHandler, auth);
    api.route("GET /accounts", apiHandler, auth);
    api.route("GET /indicators", apiHandler, auth);
    api.route("GET /indicators/{id}", apiHandler, auth);
    api.route("GET /holdings/history", apiHandler, auth);
    api.route("GET /status", apiHandler, auth);
    api.route("GET /quality", apiHandler, auth);
    api.route("GET /notes", apiHandler, auth);
    api.route("POST /notes", apiHandler, auth);
    api.route("PUT /notes/{id}", apiHandler, auth);
    api.route("DELETE /notes/{id}", apiHandler, auth);

    // The spreadsheet feed (IMPORTDATA can't log in): its own token instead of Cognito, checked by the function. Not
    // linked, since a link grants every action on a table: it reads the transactions (GSI1) and FX rates, and may only
    // write `lastUsedAt` into the token's own item (Docs/ui.md, "Cash flows"; nfr-analysis.md, "Security").
    const sameKey = (key: string) => [{ test: "ForAllValues:StringLike", variable: "dynamodb:LeadingKeys", values: [key] }];
    api.route("GET /feeds/cash-flows.csv", {
      ...defaults,
      handler: "packages/jobs/src/handlers/feed.handler",
      timeout: "30 seconds",
      link: [],
      environment: { MARKET_TABLE: market.name, TRANSACTIONS_TABLE: transactions.name },
      permissions: [
        { actions: ["dynamodb:Query"], resources: [$interpolate`${transactions.arn}/index/GSI1`] },
        { actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"], resources: [transactions.arn], conditions: sameKey("SETTING#feedToken") },
        { actions: ["dynamodb:Query"], resources: [market.arn], conditions: sameKey("FX#*") },
      ],
    });

    // Security headers on every response of the site and the API (Docs/ui.md, "Access"). The CSP allows only this
    // origin and Cognito (the login): no inline scripts, no other hosts, so one injected script can't send the tokens
    // (kept in localStorage) anywhere. Styles allow 'unsafe-inline' (attributes set by charts); scripts don't.
    const securityHeaders = new aws.cloudfront.ResponseHeadersPolicy("SecurityHeaders", {
      name: `portfolio-tracker-${$app.stage}-security-headers`,
      securityHeadersConfig: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self' https://cognito-idp.eu-west-1.amazonaws.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
        strictTransportSecurity: { override: true, accessControlMaxAgeSec: 31_536_000, includeSubdomains: true },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: "DENY" },
        referrerPolicy: { override: true, referrerPolicy: "no-referrer" },
      },
      customHeadersConfig: { items: [{ header: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()", override: true }] },
    });
    const router = new sst.aws.Router("Router", {
      domain,
      transform: {
        cdn: (args) => {
          args.defaultCacheBehavior = $resolve([args.defaultCacheBehavior, securityHeaders.id]).apply(([b, id]) => ({ ...b, responseHeadersPolicyId: id }));
          args.orderedCacheBehaviors = $resolve([args.orderedCacheBehaviors ?? [], securityHeaders.id]).apply(([bs, id]) => bs.map((b) => ({ ...b, responseHeadersPolicyId: id })));
        },
      },
    });
    router.route("/api", api.url, { rewrite: { regex: "^/api/(.*)$", to: "/$1" } });
    const publicApiUrl = $interpolate`https://${domain}/api`;

    const web = new sst.aws.StaticSite("Web", {
      path: "packages/web",
      build: { command: "npm run build", output: "dist" },
      router: { instance: router },
      environment: {
        // In `sst dev` the site runs on localhost, so it talks to API Gateway directly.
        VITE_API_URL: $dev ? api.url : publicApiUrl,
        VITE_APP_VERSION: process.env["APP_VERSION"] ?? `${$app.stage}-local`,
        VITE_AUTH_USER_POOL_ID: COGNITO_POOL_ID,
        VITE_AUTH_CLIENT_ID: webClient.id,
      },
      dev: { command: "npm run dev", title: "web" },
    });

    return {
      api: publicApiUrl,
      apiGateway: api.url,
      web: $interpolate`https://${domain}`,
      webUrl: web.url,
      market: market.name,
      transactions: transactions.name,
      holdings: holdings.name,
      files: files.name,
      backfillFunction: backfill.name,
      valuationFunction: valuation.name,
      authClientId: webClient.id,
      ...(testing ? { testUser: TEST_USER } : {}),
    };
  },
});
