// Minimal typings for the third-party SDKs loaded via <script>.

interface FacebookAuthResponse {
  accessToken: string;
  userID: string;
  expiresIn: number;
}

interface FacebookLoginResponse {
  status: "connected" | "not_authorized" | "unknown";
  authResponse: FacebookAuthResponse | null;
}

interface FacebookSdk {
  init(options: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options?: { scope?: string }): void;
  logout(callback?: () => void): void;
}

interface Window {
  FB?: FacebookSdk;
  fbAsyncInit?: () => void;
  /** Dynamic callbacks for the Telegram Login Widget (`data-onauth`). */
  [key: `__onTelegramAuth${number}`]: ((user: import("./types").TelegramUser) => void) | undefined;
}
