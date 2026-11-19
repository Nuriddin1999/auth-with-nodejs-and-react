import { useCallback, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useParams, type Location } from "react-router-dom";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/useAuth";
import AuthCard from "../components/AuthCard";
import AuthSuccess from "../components/AuthSuccess";
import CodeStep from "../components/CodeStep";
import { PROVIDERS } from "../components/providers";
import { config } from "../config";
import type { MockCodeSent } from "../types";
import { isEmail } from "../validation";
import { cx, ui } from "../ui";

const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/**
 * /connect/:provider - sign in for a provider without real keys.
 *   Facebook stand-in (FACEBOOK_EMAIL_FALLBACK): email -> real emailed code -> authenticated
 *   Test mode, Google / Facebook: email -> code -> authenticated
 *   Test mode, Telegram: @username -> "we sent you a message in Telegram" -> code -> authenticated
 * In test mode nothing is really sent; the backend accepts SOCIAL_AUTH_MOCK_CODE (12345).
 */
export default function ConnectPage() {
  const { provider: param } = useParams();
  const provider = PROVIDERS.find((p) => p.id === param);
  const from = (useLocation().state as { from?: Location } | null)?.from;
  const navigate = useNavigate();
  const { user, startMockLogin, startFacebookEmailLogin, loginWith } = useAuth();
  // Opened from the profile page by a signed-in user: the provider gets linked to them.
  const [linking] = useState(Boolean(user));

  const [identity, setIdentity] = useState("");
  const [sent, setSent] = useState<MockCodeSent | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = useCallback(() => navigate(from?.pathname || "/", { replace: true }), [navigate, from]);

  // Facebook with the email stand-in sends a real code; it wins over test mode.
  const emailFallback = provider?.id === "facebook" && config.facebookEmailFallback && !config.facebookAppId;
  if (!provider || !(config.mockAuth || emailFallback)) return <Navigate to="/login" replace />;
  const sendCode = (value: string) => (emailFallback ? startFacebookEmailLogin(value) : startMockLogin(provider.id, value));
  if (done) {
    const message = linking ? `${provider.name} account connected.` : `Signed in with ${provider.name}.`;
    return <AuthSuccess message={message} onContinue={finish} />;
  }

  const isTelegram = provider.id === "telegram";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setSent(await sendCode(identity));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    const shown = isTelegram ? `@${sent.identity}` : sent.identity;
    return (
      <AuthCard
        title={isTelegram ? "Check Telegram" : "Check your email"}
        subtitle={isTelegram ? "Confirm your sign in" : `Confirm your ${provider.name} account`}
      >
        <CodeStep
          email={shown}
          codeLength={sent.code_length}
          expiresIn={sent.expires_in}
          message={
            isTelegram ? (
              <>
                We sent you a message with a code in Telegram (<strong className="text-fg">{shown}</strong>). Please confirm by entering the
                code below.
              </>
            ) : undefined
          }
          onVerify={async (code) => {
            const payload = emailFallback ? { email: sent.identity, code } : { mock: true as const, identity: sent.identity, code };
            await loginWith(provider.id, payload);
            setDone(true);
          }}
          onResend={() => sendCode(sent.identity)}
          onBack={() => setSent(null)}
          backLabel={isTelegram ? "Use a different username" : "Use a different email"}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Continue with ${provider.name}`}
      subtitle={isTelegram ? "Enter your Telegram username" : `Enter the email of your ${provider.name} account`}
    >
      <form className={ui.form} onSubmit={handleSubmit}>
        <label className={ui.field}>
          <span>{isTelegram ? "Telegram username" : "Email"}</span>
          {isTelegram ? (
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3 text-muted" aria-hidden="true">
                @
              </span>
              <input
                className={cx(ui.input, "pl-7")}
                value={identity}
                onChange={(e) => setIdentity(e.target.value.replace(/^@+/, ""))}
                placeholder="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={33}
                required
                autoFocus
              />
            </div>
          ) : (
            <input
              className={ui.input}
              type="email"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              maxLength={254}
              required
              autoFocus
            />
          )}
        </label>

        {error && (
          <p className={ui.error} role="alert">
            {error}
          </p>
        )}

        <button
          className={ui.primary}
          type="submit"
          disabled={busy || !(isTelegram ? TELEGRAM_USERNAME.test(identity) : isEmail(identity))}
        >
          {busy ? "Sending code…" : "Send code"}
        </button>
        <button type="button" className={ui.outline} onClick={() => navigate(-1)}>
          Back
        </button>
      </form>
    </AuthCard>
  );
}
