import { useCallback, useState } from "react";
import { Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import AuthCard from "../components/AuthCard";
import AuthSuccess from "../components/AuthSuccess";
import CodeStep from "../components/CodeStep";
import type { EmailPurpose } from "../types";
import type { ResetPasswordState } from "./ResetPasswordPage";

/** Router state passed from the sign up / forgot password forms. */
export interface VerifyState {
  purpose: EmailPurpose;
  email: string;
  name?: string;
  codeLength: number;
  expiresIn: number;
  from?: Location;
}

const COPY: Record<EmailPurpose, { subtitle: string; back: string }> = {
  signup: { subtitle: "One last step to create your account", back: "/signup" },
  reset: { subtitle: "Confirm it's you to reset your password", back: "/forgot-password" },
};

/**
 * /verify: enter the code sent by email.
 *   sign up -> account created -> "Authentication successful"
 *   reset   -> /reset-password to choose a new password
 */
export default function VerifyPage() {
  const { user, confirmSignUp, verifyPasswordReset, resendCode } = useAuth();
  const navigate = useNavigate();
  const state = useLocation().state as VerifyState | null;
  const [done, setDone] = useState(false);
  // Someone already signed in has nothing to sign up for (a password reset is still allowed).
  const [signedInOnArrival] = useState(Boolean(user));
  // After registration the user signs in on /login (email prefilled), then lands on the page they wanted.
  const goToSignIn = useCallback(
    () => navigate("/login", { replace: true, state: { email: state?.email, from: state?.from, registered: true } }),
    [navigate, state],
  );

  if (done) {
    return (
      <AuthSuccess
        title="Account created"
        message="Sign in with your email and password to continue."
        continueLabel="Go to sign in"
        onContinue={goToSignIn}
      />
    );
  }
  if (signedInOnArrival && state?.purpose !== "reset") return <Navigate to={state?.from?.pathname || "/"} replace />;
  // Opened directly or after a reload: there is no email to verify.
  if (!state?.email) return <Navigate to="/signup" replace />;

  const { purpose, email, name, codeLength, expiresIn, from } = state;
  const copy = COPY[purpose];

  const handleVerify = async (code: string) => {
    if (purpose === "signup") {
      await confirmSignUp(email, code);
      setDone(true);
      return;
    }
    const token = await verifyPasswordReset(email, code);
    const next: ResetPasswordState = { token, email, from };
    navigate("/reset-password", { replace: true, state: next });
  };

  return (
    <AuthCard title="Check your email" subtitle={copy.subtitle}>
      <CodeStep
        email={email}
        codeLength={codeLength}
        expiresIn={expiresIn}
        onVerify={handleVerify}
        onResend={() => resendCode(purpose, email)}
        onBack={() => navigate(copy.back, { state: { email, name, from } })}
      />
    </AuthCard>
  );
}
