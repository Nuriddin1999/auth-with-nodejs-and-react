import { useCallback, useState } from "react";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/useAuth";
import type { LoginPayload, Provider } from "../types";
import ProviderButton from "./ProviderButton";
import { PROVIDERS } from "./providers";
import { cx } from "../ui";

interface Props {
  /** Called after a successful sign in / sign up. */
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * "Continue with Google / Facebook / Telegram".
 * Social login signs up on the first visit and signs in afterwards, so the same
 * buttons are used on both pages (like Notion, Figma, Slack).
 */
export default function SocialButtons({ onDone, onError }: Props) {
  const { loginWith } = useAuth();
  const [busy, setBusy] = useState(false);

  const handle = useCallback(
    (provider: Provider) => async (payload: LoginPayload) => {
      onError("");
      setBusy(true);
      try {
        await loginWith(provider, payload);
        onDone();
      } catch (e) {
        onError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [loginWith, onDone, onError],
  );

  return (
    <div className={cx("flex flex-col items-center gap-3 *:w-[280px]", busy && "pointer-events-none opacity-60")}>
      {PROVIDERS.map((p) => (
        <ProviderButton key={p.id} provider={p.id} onSuccess={handle(p.id)} onError={onError} text="continue_with" />
      ))}
    </div>
  );
}
