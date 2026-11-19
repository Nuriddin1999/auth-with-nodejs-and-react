import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, type Location } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import type { VerifyState } from "../pages/VerifyPage";
import { authErrorMessage } from "./authErrors";
import PasswordInput from "./PasswordInput";
import { MIN_PASSWORD_LENGTH, isEmail, isFilled, isNewPasswordValid, passwordLengthHint } from "../validation";
import { ui } from "../ui";

interface Props {
  prefillEmail?: string;
  prefillName?: string;
  from?: Location;
}

/** Sign up: name, email, password, confirm password -> code on /verify -> account created. */
export default function SignUpForm({ prefillEmail = "", prefillName = "", from }: Props) {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(prefillName);
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ReactNode>("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const lengthHint = passwordLengthHint(password);
  const canSubmit = isFilled(name) && isEmail(email) && isNewPasswordValid(password, confirm);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (password !== confirm) return setError("Passwords do not match");

    setBusy(true);
    try {
      const sent = await signUp({ name: name.trim(), email: email.trim(), password, password_confirm: confirm });
      const state: VerifyState = {
        purpose: "signup",
        email: email.trim(),
        name: name.trim(),
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
    <form className={ui.form} onSubmit={handleSubmit}>
      <label className={ui.field}>
        <span>Name</span>
        <input
          className={ui.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="Your name"
          maxLength={150}
          required
        />
      </label>
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
      <PasswordInput
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        placeholder="At least 8 characters"
        hint="Use 8+ characters. Avoid common words and your name or email."
        aria-invalid={Boolean(lengthHint)}
        required
      />
      {lengthHint && <p className={ui.fieldError}>{lengthHint}</p>}
      <PasswordInput
        label="Confirm password"
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
          {error}
        </p>
      )}

      <button className={ui.primary} type="submit" disabled={busy || !canSubmit}>
        {busy ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
