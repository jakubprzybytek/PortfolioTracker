import { useState, type FormEvent, type ReactNode } from "react";
import { confirmResetPassword, confirmSignIn, resetPassword, signIn } from "aws-amplify/auth";

type Step = "signIn" | "newPassword" | "forgot" | "resetCode";

/** Cognito error → a sentence for the form. With "prevent user existence errors" on, a wrong email and a wrong password look the same. */
function message(err: unknown): string {
  const e = err as { name?: string; message?: string };
  switch (e.name) {
    case "NotAuthorizedException":
      return e.message?.includes("attempts") ? "Too many attempts. Wait a moment and try again." : "Incorrect email or password.";
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "CodeMismatchException":
      return "That code is wrong.";
    case "ExpiredCodeException":
      return "That code has expired. Request a new one.";
    case "InvalidPasswordException":
      return e.message?.replace(/^Password does not conform to policy: /, "Password: ") ?? "That password isn't allowed.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return e.message ?? "Something went wrong.";
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Sign in, set a new password when Cognito requires one, or reset a forgotten password with an emailed code. */
export function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const go = (next: Step, note = "") => {
    setStep(next);
    setError("");
    setInfo(note);
    setPassword("");
    setCode("");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === "signIn") {
        const { nextStep } = await signIn({ username: email.trim(), password });
        if (nextStep.signInStep === "DONE") onSignedIn();
        else if (nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") go("newPassword", "Choose a new password for your account.");
        else if (nextStep.signInStep === "RESET_PASSWORD") go("forgot", "Your password has to be reset.");
        else setError(`This sign-in step isn't supported here (${nextStep.signInStep}).`);
      } else if (step === "newPassword") {
        const { nextStep } = await confirmSignIn({ challengeResponse: password });
        if (nextStep.signInStep === "DONE") onSignedIn();
        else setError(`This sign-in step isn't supported here (${nextStep.signInStep}).`);
      } else if (step === "forgot") {
        await resetPassword({ username: email.trim() });
        go("resetCode", "If the account exists, a code is on its way to that email.");
      } else {
        await confirmResetPassword({ username: email.trim(), confirmationCode: code.trim(), newPassword: password });
        go("signIn", "Password changed. Sign in with the new one.");
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const title = { signIn: "Sign in", newPassword: "New password", forgot: "Reset password", resetCode: "Reset password" }[step];
  const button = { signIn: "Sign in", newPassword: "Set password", forgot: "Send code", resetCode: "Change password" }[step];

  return (
    <div className="gate">
      <h1>Portfolio Tracker</h1>
      <form className="login" onSubmit={submit} data-testid="login-form" aria-label={title}>
        <h2>{title}</h2>
        {info && <p className="muted" data-testid="login-info">{info}</p>}
        {(step === "signIn" || step === "forgot") && (
          <Field label="Email">
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" autoFocus />
          </Field>
        )}
        {step === "resetCode" && (
          <Field label="Code from the email">
            <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} data-testid="login-code" autoFocus />
          </Field>
        )}
        {step !== "forgot" && (
          <Field label={step === "signIn" ? "Password" : "New password"}>
            <input
              type="password"
              autoComplete={step === "signIn" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
            />
          </Field>
        )}
        {error && (
          <p className="error" role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} data-testid="login-submit">
          {busy ? "…" : button}
        </button>
        {step === "signIn" ? (
          <button type="button" className="link" onClick={() => go("forgot")} data-testid="login-forgot">
            Forgot password?
          </button>
        ) : (
          <button type="button" className="link" onClick={() => go("signIn")} data-testid="login-back">
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
