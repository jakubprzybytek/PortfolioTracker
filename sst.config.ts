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

    const market = new sst.aws.Dynamo("Market", { ...byType, ttl: "ttl", transform: withPitr });
    const transactions = new sst.aws.Dynamo("Transactions", { ...byType, transform: withPitr });
    const holdings = new sst.aws.Dynamo("Holdings", { fields: keys, primaryIndex });

    // raw/<source>/<yyyy>/<mm>/<dd>/… = originals of every download; imports/<kind>/… = files you upload.
    const files = new sst.aws.Bucket("Files");

    // Each function links only the tables it needs (Docs/data-storage.md, "Access per function").
    const link = [files];
    const defaults = { link: [...link, market], timeout: "5 minutes" as const, memory: "512 MB" as const };

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
      link: [...link, market, transactions, holdings, valuationQueue], // the queue link lets it receive and delete
    });
    valuationQueue.subscribe(valuation.arn, { batch: { size: 1 } });

    const backfill = new sst.aws.Function("Backfill", {
      ...defaults,
      handler: "packages/jobs/src/handlers/backfill.handler",
      timeout: "15 minutes",
      link: [...link, market, valuationQueue],
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
    // Backup of accounts, instruments, hand-entered prices and transactions (the data that exists nowhere else) to
    // exports/<date>/ in the bucket, in the import formats.
    new sst.aws.CronV2("Export", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/export.handler", link: [...link, market, transactions] },
      schedule: "cron(0 4 1 * ? *)",
      timezone: WARSAW,
      retries: 2,
    });
    new sst.aws.CronV2("ValuationEvening", { function: valuation.arn, schedule: "cron(30 22 ? * MON-FRI *)", timezone: WARSAW });
    new sst.aws.CronV2("ValuationMorning", { function: valuation.arn, schedule: "cron(30 7 ? * TUE-SAT *)", timezone: WARSAW });

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
    const api = new sst.aws.ApiGatewayV2("Api", { cors: true });
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
      link: [...link, market, transactions, holdings, valuationQueue, backfill, fx],
      environment: { ACCESS_GROUPS: accessGroups($app.stage).join(",") },
    };
    api.route("GET /holdings", apiHandler, auth);
    api.route("GET /portfolio/history", apiHandler, auth);
    api.route("GET /instruments", apiHandler, auth);
    api.route("GET /instruments/{isin}/prices", apiHandler, auth);
    api.route("GET /instruments/{isin}/transactions", apiHandler, auth);
    api.route("POST /instruments/{isin}/prices", apiHandler, auth);
    api.route("DELETE /instruments/{isin}/prices/{date}", apiHandler, auth);
    api.route("GET /transactions", apiHandler, auth);
    api.route("POST /transactions", apiHandler, auth);
    api.route("PUT /transactions/{id}", apiHandler, auth);
    api.route("DELETE /transactions/{id}", apiHandler, auth);
    api.route("GET /instruments/lookup", apiHandler, auth);
    api.route("POST /instruments", apiHandler, auth);
    api.route("GET /prices", apiHandler, auth);
    api.route("GET /accounts", apiHandler, auth);
    api.route("GET /indicators", apiHandler, auth);
    api.route("GET /indicators/{id}", apiHandler, auth);
    api.route("GET /holdings/history", apiHandler, auth);
    api.route("GET /status", apiHandler, auth);

    const router = new sst.aws.Router("Router", { domain });
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
