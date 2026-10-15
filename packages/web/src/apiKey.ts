/** useApi's cache key: the path and the given params (sorted, undefined left out) as the request's query string. */
export function apiKey(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(
    Object.entries(params)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ).toString();
  return query ? `${path}?${query}` : path;
}

/** The path and params back from a key. */
export function parseApiKey(key: string): { path: string; params: Record<string, string> } {
  const i = key.indexOf("?");
  return i < 0 ? { path: key, params: {} } : { path: key.slice(0, i), params: Object.fromEntries(new URLSearchParams(key.slice(i + 1))) };
}
