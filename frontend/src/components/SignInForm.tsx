import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { authErrorMessage } from "./authErrors";
import PasswordInput from "./PasswordInput";
import { isEmail, isFilled } from "../validation";
import { ui } from "../ui";

interface Props {
  prefillEmail?: string;
  /** Put the cursor in the password field (email already known, e.g. right after sign up). */
  focusPassword?: boolean;
  onDone: () => void;
}

/** Email + password sign in, with a "Forgot password?" link. */
export default function SignInForm({ prefillEmail = "", focusPassword = false, onDone }: Props) {
  const { loginWithPassword } = useAuth();
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ReactNode>("");
  const [busy, setBusy] = useState(false);
  const canSubmit = isEmail(email) && isFilled(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await loginWithPassword(email.trim(), password);
      onDone();
    } catch (err) {
      setError(authErrorMessage(err, email.trim()));
      setPassword("");
      setBusy(false);
    }
  };

  return (
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
        />
      </label>
      <div>
        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="Enter your password"
          autoComplete="current-password"
          autoFocus={focusPassword}
          required
        />
        <div className="mt-1.5 text-right text-[0.9rem]">
          <Link className={ui.link} to="/forgot-password" state={{ email: email.trim() }}>
            Forgot password?
          </Link>
        </div>
      </div>

      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}

      <button className={ui.primary} type="submit" disabled={busy || !canSubmit}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
