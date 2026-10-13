import { accessToken, logout } from "./auth.ts";

// Absolute (sst dev: API Gateway URL) or relative ("/api" behind the Router on the custom domain).
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? "/api").replace(/\/$/, "");
export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";

export function api<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  return request<T>("GET", path, params);
}

/** A write (the "Add transaction" form): JSON body, the API's error message on failure. */
export function apiSend<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown, params: Record<string, string | undefined> = {}): Promise<T> {
  return request<T>(method, path, params, body);
}

async function request<T>(method: string, path: string, params: Record<string, string | undefined>, body?: unknown): Promise<T> {
  const url = new URL(API_URL + path, window.location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const token = await accessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (res.status === 401) {
    // Token missing, expired or revoked: back to the login form (the view stays in the URL).
    await logout();
    throw new Error("Session expired. Sign in again.");
  }
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
