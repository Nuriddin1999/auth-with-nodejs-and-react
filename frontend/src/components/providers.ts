import type { Provider } from "../types";

export const PROVIDERS: ReadonlyArray<{ id: Provider; name: string }> = [
  { id: "google", name: "Google" },
  { id: "facebook", name: "Facebook" },
  { id: "telegram", name: "Telegram" },
];
