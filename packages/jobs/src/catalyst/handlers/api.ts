// The Catalyst module's API (/api/catalyst/*, infra/catalyst.ts): the same login and groups as PT's API.

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { hasAnyGroup } from "../../lib/access.ts";
import { jobRuns } from "../../lib/context.ts";
import { JOB_NAMES, jobTable } from "../../lib/jobs.ts";
import { catalystRepo } from "../context.ts";

const ACCESS_GROUPS = (process.env["ACCESS_GROUPS"] ?? "portfolio-tracker").split(",");
const sqs = new SQSClient({});

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({ statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Requests that failed 3 times and wait in the dead-letter queue (null when it can't be read). */
async function deadLetterCount(): Promise<number | null> {
  try {
    const res = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: Resource.CatalystDeadLetter.url, AttributeNames: ["ApproximateNumberOfMessages"] }));
    return Number(res.Attributes?.["ApproximateNumberOfMessages"] ?? 0);
  } catch (err) {
    console.error(JSON.stringify({ event: "dead-letter count failed", error: String(err) }));
    return null;
  }
}

const ROUTES: Record<string, (event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<APIGatewayProxyResultV2>> = {
  "GET /catalyst/status": async () => {
    // How many bonds the module holds, the latest run of each of its jobs, and failed requests.
    const jobs = JOB_NAMES.filter((j) => jobTable(j) === "catalyst");
    const [bonds, runs, deadLetter] = await Promise.all([catalystRepo.countBonds(), Promise.all(jobs.map(async (j) => [j, (await jobRuns(j).latest(j)) ?? null] as const)), deadLetterCount()]);
    return json(200, { bonds, jobs: Object.fromEntries(runs), deadLetter });
  },
};

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  if (!hasAnyGroup(event.requestContext.authorizer?.jwt?.claims, ACCESS_GROUPS)) return json(403, { error: "This account has no access" });
  const handle = ROUTES[event.routeKey];
  if (!handle) return json(404, { error: `No route ${event.routeKey}` });
  try {
    return await handle(event);
  } catch (err) {
    const requestId = event.requestContext.requestId;
    console.error(`${event.routeKey} failed (request ${requestId}):`, err);
    return json(500, { error: `Something went wrong on the server (request ${requestId})` });
  }
}
