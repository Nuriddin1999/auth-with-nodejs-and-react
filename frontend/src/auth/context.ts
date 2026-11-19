import { createContext } from "react";
import type {
  AuthResponse,
  CodeSent,
  EmailPurpose,
  LoginPayload,
  MockCodeSent,
  Provider,
  SignUpConfirmed,
  SignUpData,
  TelegramLoginStart,
  TelegramLoginStatus,
  User,
} from "../types";

/** Everything auth-related the app needs: the user and the sign-in actions. */
export interface IAuthContextValue {
  user: User | null;
  loading: boolean;
  /** Social login. When already logged in, the backend links the provider to the current user. */
  loginWith: (provider: Provider, payload: LoginPayload) => Promise<AuthResponse>;
  /** Email + password sign in. */
  loginWithPassword: (email: string, password: string) => Promise<AuthResponse>;
  /** Sign up, step 1: sends a code to the email. The account is created after the code is confirmed. */
  signUp: (data: SignUpData) => Promise<CodeSent>;
  /** Sign up, step 2: confirm the code -> account created. Does not sign in: the user signs in afterwards. */
  confirmSignUp: (email: string, code: string) => Promise<SignUpConfirmed>;
  /** Forgot password, step 1: sends a code to the email. */
  requestPasswordReset: (email: string) => Promise<CodeSent>;
  /** Forgot password, step 2: confirm the code -> token for choosing a new password. */
  verifyPasswordReset: (email: string, code: string) => Promise<string>;
  /** Forgot password, step 3: set the new password -> signed in. */
  resetPassword: (token: string, password: string, passwordConfirm: string) => Promise<AuthResponse>;
  /** Send a new code for a pending sign up / password reset. */
  resendCode: (purpose: EmailPurpose, email: string) => Promise<CodeSent>;
  /** Telegram, step 1: a sign-in page session + the link that opens our bot. */
  startTelegramLogin: () => Promise<TelegramLoginStart>;
  /** Telegram (polled while the page is open): lets the bot answer; 410 when the session expired. */
  telegramLoginStatus: (token: string) => Promise<TelegramLoginStatus>;
  /** Telegram, step 3: the code from the bot -> signed in (or linked when already signed in). */
  verifyTelegramLogin: (token: string, code: string) => Promise<AuthResponse>;
  /** Test mode: "send" a code for a provider without keys (email or Telegram username). */
  startMockLogin: (provider: Provider, identity: string) => Promise<MockCodeSent>;
  /** Facebook stand-in (until the Facebook app is set up): email a code. */
  startFacebookEmailLogin: (email: string) => Promise<MockCodeSent>;
  disconnect: (provider: Provider) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<IAuthContextValue | null>(null);
