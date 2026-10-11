/// <reference path="./.sst/platform/config.d.ts" />

// Infrastructure for the portfolio tracker (see Docs/README.md). Everything is serverless and
// costs nothing when idle: three DynamoDB tables, one S3 bucket, scheduled Lambdas, an HTTP API and a static site.

const WARSAW = "Europe/Warsaw";

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

    // The former single table, kept in prod (linked to nothing) until its data is checked and it is
    // dropped on purpose (README open items). Removing this block leaves the table in AWS (removal: retain).
    if ($app.stage === "prod") {
      new sst.aws.Dynamo("Table", {
        ...byType,
        stream: "new-and-old-images",
        ttl: "ttl",
        transform: withPitr,
      });
    }

    // raw/<source>/<yyyy>/<mm>/<dd>/… = originals of every download; imports/<kind>/… = files you upload.
    const files = new sst.aws.Bucket("Files");

    const gusApiKey = new sst.Secret("GusApiKey", "not-set");

    // Each function links only the tables it needs (Docs/data-storage.md, "Access per function").
    const link = [files, gusApiKey];
    const defaults = { link: [...link, market], timeout: "5 minutes" as const, memory: "512 MB" as const };

    // --- jobs ----------------------------------------------------------------------------------
    const valuation = new sst.aws.Function("Valuation", {
      ...defaults,
      handler: "packages/jobs/src/handlers/valuation.handler",
      timeout: "15 minutes",
      link: [...link, market, transactions, holdings],
    });

    const backfill = new sst.aws.Function("Backfill", {
      ...defaults,
      handler: "packages/jobs/src/handlers/backfill.handler",
      timeout: "15 minutes",
      link: [...link, market, valuation],
    });

    const importer = new sst.aws.Function("Import", {
      ...defaults,
      handler: "packages/jobs/src/handlers/import.handler",
      timeout: "15 minutes",
      // Starts the backfill of new instruments directly (a stream on a new table misses early inserts).
      link: [...link, market, transactions, valuation, backfill],
    });
    files.notify({
      notifications: [{ name: "Imports", function: importer.arn, events: ["s3:ObjectCreated:*"], filterPrefix: "imports/" }],
    });

    new sst.aws.CronV2("EodGpw", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodGpw.handler" },
      schedule: "cron(30 18 ? * MON-FRI *)",
      timezone: WARSAW,
      retries: 2,
    });
    new sst.aws.CronV2("RecheckGpw", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/eodGpw.handler" },
      schedule: "cron(15 7 ? * TUE-SAT *)",
      timezone: WARSAW,
      event: { final: true },
      retries: 2,
    });
    new sst.aws.CronV2("Monthly", {
      function: { ...defaults, handler: "packages/jobs/src/handlers/monthly.handler" },
      schedule: "cron(0 10 16 * ? *)",
      timezone: WARSAW,
      retries: 2,
    });
    new sst.aws.CronV2("ValuationEvening", { function: valuation.arn, schedule: "cron(30 22 ? * MON-FRI *)", timezone: WARSAW });
    new sst.aws.CronV2("ValuationMorning", { function: valuation.arn, schedule: "cron(30 7 ? * TUE-SAT *)", timezone: WARSAW });

    // --- api + web -----------------------------------------------------------------------------
    const api = new sst.aws.ApiGatewayV2("Api", { cors: true });
    const apiHandler = {
      ...defaults,
      handler: "packages/jobs/src/handlers/api.handler",
      timeout: "30 seconds" as const,
      link: [...link, market, transactions, holdings],
    };
    api.route("GET /holdings", apiHandler);
    api.route("GET /portfolio/history", apiHandler);
    api.route("GET /instruments", apiHandler);
    api.route("GET /instruments/{isin}/prices", apiHandler);
    api.route("GET /instruments/{isin}/transactions", apiHandler);
    api.route("GET /status", apiHandler);

    // One domain per stage: the site at "/", the API at "/api/*" (same origin, one certificate).
    const domain = stageDomain($app.stage);
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
    };
  },
});
