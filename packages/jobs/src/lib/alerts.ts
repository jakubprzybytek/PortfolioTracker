// E-mail alerts on failed jobs (road map 16): `runJob` publishes to the stage's SNS topic `Alerts`, which only prod has
// (its e-mail subscription comes from the `AlertEmail` secret). One message when a job starts failing and one when it
// works again, not one per failed run: Lambda retries and the next scheduled runs of a job that keeps failing stay quiet.
// CloudWatch alarms on the same topic cover what `runJob` can't see (the valuation timing out, the dead-letter queue).

import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { Resource } from "sst";

const STATUS_URL = "https://portfoliotracker.albedoonline.com/#/status";

export interface Alert {
  subject: string;
  message: string;
}

/**
 * What to send after a run of `job` ended with `status`, given its previous run: a failure after a success (or the first
 * run ever), and a success after a failure. Nothing otherwise.
 */
export function alertFor(job: string, status: "ok" | "failed", previous: { status: "ok" | "failed"; finishedAt?: string } | undefined, note?: string): Alert | undefined {
  if (status === "failed" && previous?.status !== "failed") {
    return {
      subject: `PortfolioTracker: ${job} failed`,
      message: [`The job "${job}" failed.`, "", `Error: ${note ?? "(no message)"}`, "", `Its later failures won't be e-mailed until it works again. Job runs: ${STATUS_URL}`].join("\n"),
    };
  }
  if (status === "ok" && previous?.status === "failed") {
    return {
      subject: `PortfolioTracker: ${job} works again`,
      message: [`The job "${job}" ran fine again${previous.finishedAt ? ` (it failed last at ${previous.finishedAt})` : ""}.`, note ? `\nNote: ${note}` : "", "", `Job runs: ${STATUS_URL}`].join("\n"),
    };
  }
  return undefined;
}

/** The topic's ARN, or undefined on a stage without alerts (Resource throws for a resource that isn't linked). */
function topicArn(): string | undefined {
  try {
    return (Resource as unknown as { Alerts?: { arn: string } }).Alerts?.arn;
  } catch {
    return undefined;
  }
}

const sns = new SNSClient({});

/** Publishes an alert; never throws (an alert that can't be sent mustn't change the job's outcome). */
export async function sendAlert(alert: Alert): Promise<void> {
  const arn = topicArn();
  if (!arn) return;
  try {
    await sns.send(new PublishCommand({ TopicArn: arn, Subject: alert.subject.slice(0, 100), Message: alert.message }));
  } catch (err) {
    console.error("alert not sent", err);
  }
}
