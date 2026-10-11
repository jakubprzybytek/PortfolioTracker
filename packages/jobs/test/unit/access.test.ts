import { describe, expect, it } from "vitest";
import { groupsOf, hasGroup } from "../../src/lib/access.ts";

describe("groupsOf", () => {
  it("reads the flattened, JSON and array forms of cognito:groups", () => {
    expect(groupsOf({ "cognito:groups": "[portfolio-tracker admins]" })).toEqual(["portfolio-tracker", "admins"]);
    expect(groupsOf({ "cognito:groups": "[portfolio-tracker]" })).toEqual(["portfolio-tracker"]);
    expect(groupsOf({ "cognito:groups": '["portfolio-tracker","admins"]' })).toEqual(["portfolio-tracker", "admins"]);
    expect(groupsOf({ "cognito:groups": ["portfolio-tracker"] })).toEqual(["portfolio-tracker"]);
    expect(groupsOf({ "cognito:groups": "portfolio-tracker" })).toEqual(["portfolio-tracker"]);
  });

  it("is empty without the claim", () => {
    expect(groupsOf(undefined)).toEqual([]);
    expect(groupsOf({ sub: "x" })).toEqual([]);
    expect(groupsOf({ "cognito:groups": "" })).toEqual([]);
  });
});

describe("hasGroup", () => {
  it("matches whole group names only", () => {
    expect(hasGroup({ "cognito:groups": "[portfolio-tracker]" }, "portfolio-tracker")).toBe(true);
    expect(hasGroup({ "cognito:groups": "[portfolio-tracker-old]" }, "portfolio-tracker")).toBe(false);
    expect(hasGroup({ "cognito:groups": "[astro]" }, "portfolio-tracker")).toBe(false);
  });
});
