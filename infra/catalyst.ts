// The Catalyst module (Docs/catalyst.md, Docs/catalyst-phase1-plan.md): the whole Catalyst bond market, apart from the
// portfolio. Its own table, a FIFO queue for the work that doesn't come from a schedule (metrics, backfill), the worker
// that runs it, and the module's API routes on PT's API. Called from sst.config.ts with what it shares.

const WARSAW = "Europe/Warsaw";

export interface CatalystShared {
  /** PT's function settings (memory, architecture, logs, timeout), without its table links. */
  defaults: Pick<sst.aws.FunctionArgs, "timeout" | "memory" | "architecture" | "logging">;
  /** What every function may use: the files bucket and, on prod, the alerts topic. */
  link: unknown[];
  alerts?: sst.aws.SnsTopic;
}

/** The table, the queue and its worker; and what PT's watchdog and Status page need to read the Catalyst job runs. */
export function catalystModule({ defaults, link, alerts }: CatalystShared) {
  const prod = $app.stage === "prod";

  // --- storage ---------------------------------------------------------------------------------
  // One table, same key schema as PT's (Docs/catalyst.md, "Storage"); job runs expire by TTL.
  const table = new sst.aws.Dynamo("Catalyst", {
    fields: { PK: "string", SK: "string", GSI1PK: "string", GSI1SK: "string" },
    primaryIndex: { hashKey: "PK", rangeKey: "SK" },
    globalIndexes: { GSI1: { hashKey: "GSI1PK", rangeKey: "GSI1SK" } },
    ttl: "ttl",
    deletionProtection: prod,
    transform: {
      table: (args) => {
        args.pointInTimeRecovery = { enabled: true };
      },
    },
  });

  // --- queue and worker ------------------------------------------------------------------------
  // One message group: messages run one at a time, in order. Up to 10 waiting make one run (the worker merges the
  // metrics requests among them), so a burst of writes recomputes once. 3 failures → the dead-letter queue (14 days).
  const deadLetter = new sst.aws.Queue("CatalystDeadLetter", { fifo: true, transform: { queue: { messageRetentionSeconds: 14 * 24 * 3600 } } });
  const queue = new sst.aws.Queue("CatalystQueue", { fifo: true, visibilityTimeout: "16 minutes", dlq: { queue: deadLetter.arn, retry: 3 } });
  const worker = new sst.aws.Function("CatalystWorker", {
    ...defaults,
    handler: "packages/jobs/src/catalyst/handlers/worker.handler",
    timeout: "15 minutes",
    link: [...link, table, queue],
  });
  queue.subscribe(worker.arn, { batch: { size: 10 } });

  if (alerts)
    new aws.cloudwatch.MetricAlarm("CatalystDeadLetterNotEmpty", {
      // Named with the app's prefix: the deploy role may only create alarms named so (infra/github/README.md).
      name: `portfolio-tracker-${$app.stage}-catalyst-dead-letter`,
      alarmActions: [alerts.arn],
      okActions: [alerts.arn],
      treatMissingData: "notBreaching",
      evaluationPeriods: 1,
      period: 300,
      alarmDescription: "A Catalyst request (metrics or backfill) failed 3 times and waits in the dead-letter queue (kept 14 days)",
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensions: { QueueName: deadLetter.nodes.queue.name },
      statistic: "Maximum",
      comparisonOperator: "GreaterThanThreshold",
      threshold: 0,
    });

  // --- scheduled jobs (Docs/catalyst.md, "Jobs") -----------------------------------------------
  const job = (handler: string, timeout: "5 minutes" | "15 minutes" = "5 minutes") => ({ ...defaults, handler, timeout, link: [...link, table, queue] });
  // The daily file: after the session, and a morning recheck (a file published late, a day missed).
  new sst.aws.CronV2("CatalystDaily", { function: job("packages/jobs/src/catalyst/handlers/daily.handler"), schedule: "cron(30 18 ? * MON-FRI *)", timezone: WARSAW, retries: 2 });
  new sst.aws.CronV2("CatalystDailyRecheck", { function: job("packages/jobs/src/catalyst/handlers/daily.handler"), schedule: "cron(0 8 ? * TUE-SAT *)", timezone: WARSAW, event: { morning: true }, retries: 2 });

  // PT's watchdog and Status page list the Catalyst jobs too: they may read the job runs (JOB#…) of this table only.
  const jobRunsReader = {
    environment: { CATALYST_TABLE: table.name },
    permissions: [{ actions: ["dynamodb:Query"], resources: [table.arn], conditions: [{ test: "ForAllValues:StringLike", variable: "dynamodb:LeadingKeys", values: ["JOB#*"] }] }],
  };

  return { table, queue, deadLetter, worker, jobRunsReader };
}

/** The module's API routes on PT's API (same login and groups). */
export function catalystApi(
  { table, queue, deadLetter }: ReturnType<typeof catalystModule>,
  { defaults, link, api, auth, accessGroups }: CatalystShared & { api: sst.aws.ApiGatewayV2; auth: sst.aws.ApiGatewayV2RouteArgs; accessGroups: string },
) {
  const apiHandler = {
    ...defaults,
    handler: "packages/jobs/src/catalyst/handlers/api.handler",
    timeout: "30 seconds" as const,
    link: [...link, table, queue, deadLetter],
    environment: { ACCESS_GROUPS: accessGroups },
  };
  api.route("GET /catalyst/status", apiHandler, auth);
}
