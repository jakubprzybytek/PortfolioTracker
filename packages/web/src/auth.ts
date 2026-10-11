// Login through the Cognito hosted page: authorization code + PKCE (oidc-client-ts). Tokens are kept in
// localStorage, so you stay logged in across tabs and reloads; the refresh token (30 days) renews them.

import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

const env = import.meta.env as Record<string, string | undefined>;
const AUTHORITY = env["VITE_AUTH_AUTHORITY"] ?? "";
const CLIENT_ID = env["VITE_AUTH_CLIENT_ID"] ?? "";
const LOGIN_DOMAIN = (env["VITE_AUTH_LOGIN_DOMAIN"] ?? "").replace(/\/$/, "");
const SITE = `${window.location.origin}/`;

export const userManager = new UserManager({
  authority: AUTHORITY,
  client_id: CLIENT_ID,
  redirect_uri: SITE,
  post_logout_redirect_uri: SITE,
  response_type: "code",
  scope: "openid email profile",
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
});

let loggingOut = false;

/** Starts the login, remembering the current view (hash route) to come back to. */
export async function login() {
  if (loggingOut) return; // the page is about to leave for the Cognito logout
  await userManager.signinRedirect({ state: window.location.hash });
}

/** After the redirect back: drop ?code=… from the URL and restore the view. */
export function onSigninCallback(user: User | void) {
  const hash = typeof user?.state === "string" ? user.state : window.location.hash;
  window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
}

/** Cognito has no OIDC end-session endpoint: clear the local tokens, then end the hosted-page session. */
export async function logout() {
  loggingOut = true; // removing the user re-renders the app as logged out: don't start a new login meanwhile
  await userManager.removeUser();
  window.location.href = `${LOGIN_DOMAIN}/logout?client_id=${encodeURIComponent(CLIENT_ID)}&logout_uri=${encodeURIComponent(SITE)}`;
}

export async function accessToken(): Promise<string | undefined> {
  const user = await userManager.getUser();
  return user && !user.expired ? user.access_token : undefined;
}
