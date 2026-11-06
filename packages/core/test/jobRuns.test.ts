import { describe, expect, it } from "vitest";
import type { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { JobRunStore, type DocumentSender } from "../src/db/jobRuns.ts";

/** A fake client: records the commands and answers queries from a list of pages. */
function fake(pages: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }[] = []) {
  const sent: (PutCommand | QueryCommand)[] = [];
  const doc: DocumentSender = {
    send: async (command) => {
      sent.push(command);
      return pages.shift() ?? {};
    },
  };
  return { doc, sent };
}

describe("JobRunStore", () => {
  it("writes a run to its table with the keys and a 90-day TTL", async () => {
    const { doc, sent } = fake();
    await new JobRunStore(doc, () => "catalyst-table").put({ job: "catalyst-daily", startedAt: "2026-11-06T17:30:00.000Z", status: "running" }, Date.UTC(2026, 10, 6));
    expect(sent[0]!.input).toEqual({
      TableName: "catalyst-table",
      Item: { PK: "JOB#catalyst-daily", SK: "RUN#2026-11-06T17:30:00.000Z", job: "catalyst-daily", startedAt: "2026-11-06T17:30:00.000Z", status: "running", ttl: Date.UTC(2026, 10, 6) / 1000 + 90 * 86_400 },
    });
  });

  it("reads the recent runs of a job across pages, newest first", async () => {
    const { doc, sent } = fake([{ Items: [{ job: "a", startedAt: "2" }], LastEvaluatedKey: { PK: "x" } }, { Items: [{ job: "a", startedAt: "1" }] }]);
    const runs = await new JobRunStore(doc, () => "t").recent("a", "2026-11-01");
    expect(runs.map((r) => r.startedAt)).toEqual(["2", "1"]);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.input).toMatchObject({ TableName: "t", ScanIndexForward: false, ExpressionAttributeValues: { ":pk": "JOB#a", ":from": "RUN#2026-11-01", ":to": "RUN#~" } });
    expect(sent[1]!.input).toMatchObject({ ExclusiveStartKey: { PK: "x" } });
  });

  it("reads only the latest run", async () => {
    const { doc, sent } = fake([{ Items: [{ job: "a", startedAt: "9" }] }]);
    expect((await new JobRunStore(doc, () => "t").latest("a"))?.startedAt).toBe("9");
    expect(sent[0]!.input).toMatchObject({ Limit: 1, ScanIndexForward: false });
  });
});
