import { useCallback, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, type Location } from "react-router-dom";
import { errorCode, errorMessage } from "../api/client";
import { useAuth } from "../auth/useAuth";
import AuthCard from "../components/AuthCard";
import AuthSuccess from "../components/AuthSuccess";
import PasswordInput from "../components/PasswordInput";
import { MIN_PASSWORD_LENGTH, isNewPasswordValid, passwordLengthHint } from "../validation";
import { ui } from "../ui";

export interface ResetPasswordState {
  token: string;
  email: string;
  from?: Location;
}

/** /reset-password: choose a new password after confirming the email code. */
export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const state = useLocation().state as ResetPasswordState | null;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const finish = useCallback(() => navigate(state?.from?.pathname || "/", { replace: true }), [navigate, state]);

  if (done) return <AuthSuccess message="Your password has been changed." onContinue={finish} />;
  // Opened directly or after a reload: there is no confirmed code.
  if (!state?.token) return <Navigate to="/forgot-password" replace />;

  const mismatch = confirm.length > 0 && confirm !== password;
  const lengthHint = passwordLengthHint(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (password !== confirm) return setError("Passwords do not match");

    setBusy(true);
    try {
      await resetPassword(state.token, password, confirm);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
      setExpired(errorCode(err) === "invalid_token");
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Set a new password" subtitle={`For ${state.email}`}>
      <form className={ui.form} onSubmit={handleSubmit}>
        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          hint="Use 8+ characters. Avoid common words and your name or email."
          required
          autoFocus
          aria-invalid={Boolean(lengthHint)}
        />
        {lengthHint && <p className={ui.fieldError}>{lengthHint}</p>}
        <PasswordInput
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          placeholder="Repeat the password"
          aria-invalid={mismatch}
          required
        />
        {mismatch && <p className={ui.fieldError}>Passwords do not match</p>}

        {error && (
          <p className={ui.error} role="alert">
            {error}{" "}
            {expired && (
              <Link className={ui.link} to="/forgot-password" state={{ email: state.email, from: state.from }}>
                Request a new code
              </Link>
            )}
          </p>
        )}

        <button className={ui.primary} type="submit" disabled={busy || !isNewPasswordValid(password, confirm)}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </AuthCard>
  );
}
