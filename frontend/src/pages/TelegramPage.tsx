import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { errorBody, errorMessage } from "../api/client";
import { useAuth } from "../auth/useAuth";
import AuthCard from "../components/AuthCard";
import AuthSuccess from "../components/AuthSuccess";
import CodeStep from "../components/CodeStep";
import type { TelegramLoginStart } from "../types";
import { ui } from "../ui";

/** While the page is open the backend reads the bot's messages, so the bot can answer. */
const POLL_INTERVAL = 2000;

interface TelegramPageState {
  login?: TelegramLoginStart;
  /** The bot was already opened in a new tab by the "Continue with Telegram" button. */
  tabOpened?: boolean;
  from?: Location;
}

/**
 * /telegram - sign in with Telegram:
 *   open our bot -> press "Get sign-in code" (Start only the very first time) -> enter the code here.
 */
export default function TelegramPage() {
  const { user, startTelegramLogin, telegramLoginStatus, verifyTelegramLogin } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state as TelegramPageState | null) ?? {};
  const from = state.from;
  // Opened from the profile by a signed-in user: Telegram gets linked to their account.
  const [linking] = useState(Boolean(user));

  const [login, setLogin] = useState<TelegramLoginStart | null>(state.login ?? null);
  const [tabOpened] = useState(Boolean(state.tabOpened));
  const [step, setStep] = useState<"code" | "expired" | "done">("code");
  const [error, setError] = useState("");
  const started = useRef(false);

  const finish = useCallback(() => navigate(from?.pathname || "/", { replace: true }), [navigate, from]);

  const begin = useCallback(async () => {
    setError("");
    try {
      setLogin(await startTelegramLogin());
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [startTelegramLogin]);

  // Opened directly or after a reload: get a fresh sign-in session.
  useEffect(() => {
    if (!login && !started.current) {
      started.current = true;
      void begin();
    }
  }, [login, begin]);

  // Keep polling so the bot answers button presses; stop when the session expires.
  useEffect(() => {
    if (!login || step !== "code") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        await telegramLoginStatus(login.token);
        if (!stopped) setError("");
      } catch (err) {
        if (stopped) return;
        if (errorBody(err)?.code === "expired") setStep("expired");
        else setError(errorMessage(err));
      }
    }, POLL_INTERVAL);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [login, step, telegramLoginStatus]);

  if (step === "done") {
    return <AuthSuccess message={linking ? "Telegram account connected." : "Signed in with Telegram."} onContinue={finish} />;
  }

  if (step === "expired") {
    return (
      <AuthCard title="This page has expired" subtitle="Let's get a new sign-in code.">
        <div className={ui.form}>
          <button type="button" className={ui.telegram} onClick={begin}>
            Try again
          </button>
          <button type="button" className={ui.outline} onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </AuthCard>
    );
  }

  const bot = login ? `@${login.bot_username}` : "our bot";

  return (
    <AuthCard title="Sign in with Telegram" subtitle="Get a sign-in code from our bot">
      <div className={ui.form}>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 leading-normal">
          <li>
            {tabOpened ? "We opened " : "Open "}
            <strong>{bot}</strong> in Telegram.
          </li>
          <li>
            Press <strong>{login?.button_text ?? "Get sign-in code"}</strong> under the message box.
            <span className={ui.hint}> First time? Press Start once instead.</span>
          </li>
          <li>Copy the code and paste it below.</li>
        </ol>

        {login && (
          <a className={ui.telegram} href={login.bot_link} target="_blank" rel="noreferrer">
            {tabOpened ? `Open ${bot} again` : `Open ${bot}`}
          </a>
        )}

        {error && (
          <p className={ui.error} role="alert">
            {error}
          </p>
        )}

        {login ? (
          <CodeStep
            key={login.token}
            email={bot}
            message={false}
            codeLength={login.code_length}
            onVerify={async (value) => {
              await verifyTelegramLogin(login.token, value);
              setStep("done");
            }}
            onBack={() => navigate(-1)}
            backLabel="Cancel"
          />
        ) : (
          <p className="flex items-center justify-center gap-2.5 text-[0.9rem] text-muted" role="status" aria-live="polite">
            <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden="true" />
            Preparing…
          </p>
        )}
      </div>
    </AuthCard>
  );
}
