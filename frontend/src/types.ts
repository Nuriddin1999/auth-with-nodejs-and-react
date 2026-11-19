export type Provider = "google" | "facebook" | "telegram";

export interface SocialAccount {
  provider: Provider;
  uid: string;
  avatar_url: string;
  created_at: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string;
  /** False for accounts created via social login until a password is set. */
  has_password: boolean;
  social_accounts: SocialAccount[];
  date_joined: string;
}

/** The refresh token is never in a response body - only in an httpOnly cookie. */
export interface AccessToken {
  access: string;
}

export interface AuthResponse extends AccessToken {
  user: User;
  created: boolean;
}

/** Data returned by the Telegram Login Widget. */
export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/** Test mode, step 2: the email / Telegram username entered on /connect plus the code. */
export type MockPayload = { mock: true; identity: string; code: string };

/** Facebook stand-in until the Facebook app is set up: email + emailed code. */
export type EmailCodePayload = { email: string; code: string };

export type LoginPayload = { credential: string } | { access_token: string } | TelegramUser | MockPayload | EmailCodePayload;

export interface ProviderButtonProps {
  onSuccess: (payload: LoginPayload) => void;
  onError: (message: string) => void;
  /** Google button text variant. */
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  /** Facebook button label. */
  label?: string;
}

/** What an email code confirms. */
export type EmailPurpose = "signup" | "reset";

export interface SignUpData {
  name: string;
  email: string;
  password: string;
  password_confirm: string;
}

/** Error body returned by the API. */
export interface ApiErrorBody {
  detail?: string;
  /** Machine-readable reason, e.g. "account_exists", "account_not_found", "cooldown". */
  code?: string;
  retry_after?: number;
  /** DRF field validation errors: { field: ["message"] }. */
  [field: string]: unknown;
}

/** Response of /auth/email/signup/ and /auth/email/signin/. */
export interface CodeSent {
  detail: string;
  /** Seconds the code stays valid. */
  expires_in: number;
  code_length: number;
}

/** Test mode, step 1: response after entering an email / Telegram username on /connect. */
export interface MockCodeSent {
  channel: "email" | "telegram";
  identity: string;
  expires_in: number;
  code_length: number;
}

/** Response of /auth/email/verify/: the account exists now, but nobody is signed in. */
export interface SignUpConfirmed {
  detail: string;
  email: string;
  created: boolean;
}

/** Response of /auth/telegram/login/start/: open bot_link, press button_text there, enter the code. */
export interface TelegramLoginStart {
  token: string;
  bot_username: string;
  bot_link: string;
  /** The bot's "Get sign-in code" button. */
  button_text: string;
  /** Seconds the sign-in page session stays usable. */
  expires_in: number;
  code_length: number;
}

/** Response of /auth/telegram/login/status/ (polled while the page is open). */
export interface TelegramLoginStatus {
  status: "active";
  expires_in: number;
}
