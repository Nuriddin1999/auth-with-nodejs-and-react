import type { ComponentType } from "react";
import type { Provider, ProviderButtonProps } from "../types";
import FacebookButton from "./FacebookButton";
import GoogleButton from "./GoogleButton";
import TelegramButton from "./TelegramButton";

const BUTTONS: Record<Provider, ComponentType<ProviderButtonProps>> = {
  google: GoogleButton,
  facebook: FacebookButton,
  telegram: TelegramButton,
};

export default function ProviderButton({ provider, ...props }: ProviderButtonProps & { provider: Provider }) {
  const Button = BUTTONS[provider];
  return <Button {...props} />;
}
