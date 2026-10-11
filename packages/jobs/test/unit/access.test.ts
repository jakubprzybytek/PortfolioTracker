import { describe, expect, it } from "vitest";
import { accessGroups, groupsOf, hasAnyGroup, hasGroup } from "../../src/lib/access.ts";

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

describe("access groups per stage", () => {
  it("prod accepts only real users; int and dev also the test user's group", () => {
    expect(accessGroups("prod")).toEqual(["portfolio-tracker"]);
    expect(accessGroups("int")).toEqual(["portfolio-tracker", "portfolio-tracker-test"]);
    expect(accessGroups("dev")).toEqual(["portfolio-tracker", "portfolio-tracker-test"]);
  });

  it("the test user's token is refused on prod and accepted elsewhere", () => {
    const testUser = { "cognito:groups": "[portfolio-tracker-test]" };
    const you = { "cognito:groups": "[portfolio-tracker]" };
    expect(hasAnyGroup(testUser, accessGroups("prod"))).toBe(false);
    expect(hasAnyGroup(testUser, accessGroups("int"))).toBe(true);
    expect(hasAnyGroup(you, accessGroups("prod"))).toBe(true);
    expect(hasAnyGroup({ "cognito:groups": "[astro]" }, accessGroups("dev"))).toBe(false);
  });
});
