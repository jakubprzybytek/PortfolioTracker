// Access check for the API. API Gateway has already verified the Cognito token (signature, expiry, our
// client); the pool is shared, so the user must also be in the access group (Docs/ui.md, "Access").

type Claims = Record<string, string | number | boolean | string[]> | undefined;

/** `cognito:groups` as a list. HTTP API passes array claims flattened to a string, e.g. "[a b]". */
export function groupsOf(claims: Claims): string[] {
  const raw = claims?.["cognito:groups"];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const s = raw.trim();
  if (s.startsWith("[\"")) {
    try {
      return JSON.parse(s) as string[];
    } catch {
      /* fall through */
    }
  }
  return s.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
}

export const hasGroup = (claims: Claims, group: string): boolean => groupsOf(claims).includes(group);

/** True when the user is in at least one of `groups`. */
export const hasAnyGroup = (claims: Claims, groups: string[]): boolean => groupsOf(claims).some((g) => groups.includes(g));

/**
 * Groups each stage's API accepts. prod: only real users. int/dev also accept the test user's group, whose
 * password is stored in those stages' secrets; the test user therefore gets 403 on prod.
 */
export function accessGroups(stage: string): string[] {
  return stage === "prod" ? ["portfolio-tracker"] : ["portfolio-tracker", "portfolio-tracker-test"];
}
