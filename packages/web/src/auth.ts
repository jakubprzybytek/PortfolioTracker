// Login against the shared Cognito user pool with the app's own form (LoginForm.tsx): SRP, so the password
// never leaves the browser. Amplify keeps the tokens in localStorage and renews them with the refresh token
// (30 days). Docs/ui.md, "Access".

import { Amplify } from "aws-amplify";
import { fetchAuthSession, signOut } from "aws-amplify/auth";

const env = import.meta.env as Record<string, string | undefined>;

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: env["VITE_AUTH_USER_POOL_ID"] ?? "",
      userPoolClientId: env["VITE_AUTH_CLIENT_ID"] ?? "",
      loginWith: { email: true },
    },
  },
});

export interface Session {
  email: string;
}

/** The logged-in user, or null. Renews the tokens when needed. */
export async function currentSession(): Promise<Session | null> {
  try {
    const { tokens } = await fetchAuthSession();
    if (!tokens?.accessToken) return null;
    return { email: String(tokens.idToken?.payload["email"] ?? "") };
  } catch {
    return null;
  }
}

export async function accessToken(): Promise<string | undefined> {
  try {
    return (await fetchAuthSession()).tokens?.accessToken?.toString();
  } catch {
    return undefined;
  }
}

/** Logs out here (local tokens); the app shows the login form again. */
export const logout = () => signOut();
