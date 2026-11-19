import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { errorBody, errorMessage } from "../api/client";
import { cx, ui } from "../ui";
import { extractCode } from "../validation";

const RESEND_COOLDOWN = 60;

interface Props {
  email: string;
  /** Text above the input; defaults to "We sent a N-digit code to <email>"; false hides it. */
  message?: ReactNode;
  codeLength: number;
  /** Seconds the current code stays valid; omit when unknown (no countdown). */
  expiresIn?: number;
  onVerify: (code: string) => Promise<unknown>;
  /** Omit to hide "Resend code" (e.g. Telegram: a new code comes from the bot's button). */
  onResend?: () => Promise<{ expires_in: number; code_length: number }>;
  onBack: () => void;
  backLabel?: string;
}

/** Second step of email auth: enter the code sent to the email before it expires. */
export default function CodeStep({
  email,
  message,
  codeLength,
  expiresIn,
  onVerify,
  onResend,
  onBack,
  backLabel = "Use a different email",
}: Props) {
  const [length, setLength] = useState(codeLength);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState(() => (expiresIn === undefined ? Infinity : Date.now() + expiresIn * 1000));
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_COOLDOWN * 1000);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  // One ticking clock drives both countdowns.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expired = secondsLeft === 0;

  const verify = async (value: string) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await onVerify(value);
    } catch (e) {
      setError(errorMessage(e));
      setCode("");
      setBusy(false);
      setTimeout(() => input.current?.focus());
    }
  };

  const handleChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, length);
    setCode(digits);
    if (digits.length === length && !busy && !expired) void verify(digits); // auto-submit, incl. paste
  };

  // Ctrl+V / long-press paste: accept "123 456", "123-456" or the whole bot message.
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = extractCode(e.clipboardData.getData("text"), length);
    if (!pasted) return; // nothing code-like: let the browser paste as usual
    e.preventDefault();
    handleChange(pasted);
  };

  const canReadClipboard = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);

  // "Paste" button: reads the code copied in Telegram (or from the email) in one click.
  const pasteFromClipboard = async () => {
    setError("");
    try {
      const pasted = extractCode(await navigator.clipboard.readText(), length);
      if (pasted) handleChange(pasted);
      else setError(`The clipboard has no ${length}-digit code. Copy the code and try again.`);
    } catch {
      setError("Couldn't read the clipboard. Click the field and press Ctrl+V.");
    }
    input.current?.focus();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === length && !expired) void verify(code);
  };

  const resend = async () => {
    if (!onResend) return;
    setError("");
    setNotice("");
    try {
      const sent = await onResend();
      setLength(sent.code_length);
      setCode("");
      setExpiresAt(Date.now() + sent.expires_in * 1000);
      setResendAt(Date.now() + RESEND_COOLDOWN * 1000);
      setNotice("A new code has been sent");
      setTimeout(() => input.current?.focus());
    } catch (e) {
      setError(errorMessage(e));
      const retryAfter = errorBody(e)?.retry_after;
      if (retryAfter) setResendAt(Date.now() + retryAfter * 1000);
    }
  };

  return (
    <form className={ui.form} onSubmit={handleSubmit}>
      {message !== false && (
        <p className="text-muted">
          {message ?? (
            <>
              We sent a {length}-digit code to <strong className="text-fg">{email}</strong>. Enter it below to continue.
            </>
          )}
        </p>
      )}

      <label className={ui.field}>
        <span>Verification code</span>
        <div className={ui.inputWithAction}>
          <input
            ref={input}
            className={cx(ui.input, "px-16 text-center text-2xl tracking-[0.5em] tabular-nums")}
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            onPaste={handlePaste}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={"0".repeat(length)}
            autoFocus
            disabled={busy || expired}
            aria-invalid={Boolean(error)}
          />
          {canReadClipboard && (
            <button type="button" className={ui.inputAction} onClick={pasteFromClipboard} disabled={busy || expired}>
              Paste
            </button>
          )}
        </div>
      </label>

      {Number.isFinite(secondsLeft) && (
        <p
          className={cx("-mt-1 text-[0.9rem] tabular-nums", expired ? "text-error" : secondsLeft <= 10 ? "text-amber-600" : "text-muted")}
          aria-live="polite"
        >
          {expired ? "The code has expired. Request a new one." : `Code expires in ${formatTime(secondsLeft)}`}
        </p>
      )}

      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
      {notice && <p className={ui.success}>{notice}</p>}

      <button className={ui.primary} type="submit" disabled={busy || expired || code.length !== length}>
        {busy ? "Checking…" : "Continue"}
      </button>

      <div className="flex flex-wrap justify-between gap-3">
        <button type="button" className={ui.linkButton} onClick={onBack}>
          {backLabel}
        </button>
        {onResend && (
          <button type="button" className={ui.linkButton} onClick={resend} disabled={resendIn > 0}>
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>
        )}
      </div>
    </form>
  );
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
