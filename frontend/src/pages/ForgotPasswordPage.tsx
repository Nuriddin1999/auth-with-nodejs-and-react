import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useAuthRedirect } from "../auth/useAuthRedirect";
import AuthCard from "../components/AuthCard";
import { authErrorMessage } from "../components/authErrors";
import { isEmail } from "../validation";
import type { VerifyState } from "./VerifyPage";
import { ui } from "../ui";

/** /forgot-password: email -> code on /verify -> /reset-password. */
export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const { from, prefillEmail } = useAuthRedirect();
  const navigate = useNavigate();
  const [email, setEmail] = useState(prefillEmail);
  const [error, setError] = useState<ReactNode>("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const sent = await requestPasswordReset(email.trim());
      const state: VerifyState = {
        purpose: "reset",
        email: email.trim(),
        codeLength: sent.code_length,
        expiresIn: sent.expires_in,
        from,
      };
      navigate("/verify", { state });
    } catch (err) {
      setError(authErrorMessage(err, email.trim()));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a code to reset it"
      footer={
        <>
          Remembered it?{" "}
          <Link className={ui.link} to="/login" state={{ email: email.trim(), from }}>
            Back to sign in
          </Link>
        </>
      }
    >
      <form className={ui.form} onSubmit={handleSubmit}>
        <label className={ui.field}>
          <span>Email</span>
          <input
            className={ui.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            maxLength={254}
            required
            autoFocus
          />
        </label>

        {error && (
          <p className={ui.error} role="alert">
            {error}
          </p>
        )}

        <button className={ui.primary} type="submit" disabled={busy || !isEmail(email)}>
          {busy ? "Sending code…" : "Send code"}
        </button>
      </form>
    </AuthCard>
  );
}
