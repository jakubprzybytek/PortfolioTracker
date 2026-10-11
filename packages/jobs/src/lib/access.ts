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
