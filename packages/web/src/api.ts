// Absolute (sst dev: API Gateway URL) or relative ("/api" behind the Router on the custom domain).
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? "/api").replace(/\/$/, "");
export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";

export async function api<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const url = new URL(API_URL + path, window.location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}
