import type { ReactNode } from "react";
import { useOpenAuthPage } from "../auth/useOpenAuthPage";
import { config } from "../config";
import type { Provider, ProviderButtonProps } from "../types";

interface Props extends Pick<ProviderButtonProps, "onError"> {
  provider: Provider;
  name: string;
  env: string;
  className: string;
  icon: ReactNode;
}

/**
 * Button for a provider whose keys are missing.
 * Test mode, or Facebook with the email stand-in: opens /connect/<provider>, which asks for
 * an email (or Telegram username) and a code. Otherwise: explains what to configure.
 */
export default function UnconfiguredButton({ provider, name, env, onError, className, icon }: Props) {
  const openAuthPage = useOpenAuthPage();

  const handleClick = () => {
    const emailFallback = provider === "facebook" && config.facebookEmailFallback;
    if (!config.mockAuth && !emailFallback) {
      onError(`${name} is not configured: set ${env} in frontend/.env and restart "npm run dev"`);
      return;
    }
    openAuthPage(`/connect/${provider}`);
  };

  return (
    <button type="button" className={className} onClick={handleClick}>
      {icon}
      Continue with {name}
    </button>
  );
}
