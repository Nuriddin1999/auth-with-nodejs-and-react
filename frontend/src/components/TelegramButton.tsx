import { useState } from "react";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useOpenAuthPage } from "../auth/useOpenAuthPage";
import { config } from "../config";
import type { ProviderButtonProps } from "../types";
import UnconfiguredButton from "./UnconfiguredButton";
import { ui } from "../ui";

/**
 * "Continue with Telegram": opens our bot in Telegram (t.me/<bot>) and the /telegram page,
 * where the user enters the code the bot sends. No username needed.
 * Without a bot configured, falls back to test mode.
 */
export default function TelegramButton({ onError }: ProviderButtonProps) {
  const { startTelegramLogin } = useAuth();
  const openAuthPage = useOpenAuthPage();
  const [busy, setBusy] = useState(false);

  if (!config.telegramBotName) {
    return (
      <UnconfiguredButton
        provider="telegram"
        name="Telegram"
        env="VITE_TELEGRAM_BOT_NAME"
        onError={onError}
        className={ui.telegram}
        icon={<TelegramIcon />}
      />
    );
  }

  const handleClick = async () => {
    // Open the tab right away, inside the click: tabs opened later are blocked as popups.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const login = await startTelegramLogin();
      if (tab) tab.location.href = login.bot_link;
      openAuthPage("/telegram", { login, tabOpened: Boolean(tab) });
    } catch (err) {
      tab?.close();
      onError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <button type="button" className={ui.telegram} onClick={handleClick} disabled={busy}>
      <TelegramIcon />
      {busy ? "Opening Telegram…" : "Continue with Telegram"}
    </button>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.06-1.99 1.93c-.23.23-.42.42-.83.42z"
      />
    </svg>
  );
}
