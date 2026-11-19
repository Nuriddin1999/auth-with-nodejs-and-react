import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshAccessToken, setOnAuthLost } from "../api/client";
import type { AuthResponse, CodeSent, MockCodeSent, SignUpConfirmed, TelegramLoginStart, TelegramLoginStatus, User } from "../types";
import { tokens } from "./tokens";
import { AuthContext, type IAuthContextValue } from "./context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session after a page reload: refresh cookie -> access token -> profile.
  useEffect(() => {
    setOnAuthLost(() => setUser(null));
    refreshAccessToken()
      .then(() => api.get<User>("/auth/me/"))
      .then(({ data }) => setUser(data))
      .catch(() => tokens.clear()) // no cookie / expired session: just show the login page
      .finally(() => setLoading(false));
  }, []);

  const startSession = useCallback((data: AuthResponse) => {
    tokens.access = data.access;
    setUser(data.user);
    return data;
  }, []);

  /** POST that returns a session. */
  const postSession = useCallback(
    async (url: string, body: object) => startSession((await api.post<AuthResponse>(url, body)).data),
    [startSession],
  );

  const value = useMemo<IAuthContextValue>(() => {
    const post = async <T,>(url: string, body: object) => (await api.post<T>(url, body)).data;
    return {
      user,
      loading,
      loginWith: (provider, payload) => postSession(`/auth/${provider}/`, payload),
      loginWithPassword: (email, password) => postSession("/auth/login/", { email, password }),
      signUp: (data) => post<CodeSent>("/auth/email/signup/", data),
      confirmSignUp: (email, code) => post<SignUpConfirmed>("/auth/email/verify/", { email, code }),
      requestPasswordReset: (email) => post<CodeSent>("/auth/password/reset/", { email }),
      verifyPasswordReset: async (email, code) =>
        (await post<{ reset_token: string }>("/auth/password/reset/verify/", { email, code })).reset_token,
      resetPassword: (token, password, passwordConfirm) =>
        postSession("/auth/password/reset/confirm/", { token, password, password_confirm: passwordConfirm }),
      startTelegramLogin: () => post<TelegramLoginStart>("/auth/telegram/login/start/", {}),
      telegramLoginStatus: (token) => post<TelegramLoginStatus>("/auth/telegram/login/status/", { token }),
      verifyTelegramLogin: (token, code) => postSession("/auth/telegram/login/verify/", { token, code }),
      resendCode: (purpose, email) => post<CodeSent>("/auth/email/resend/", { purpose, email }),
      startMockLogin: (provider, identity) => post<MockCodeSent>(`/auth/${provider}/`, { mock: true, identity }),
      startFacebookEmailLogin: (email) => post<MockCodeSent>("/auth/facebook/", { email }),
      disconnect: async (provider) => setUser((await api.delete<User>(`/auth/social/${provider}/`)).data),
      logout: async () => {
        await api.post("/auth/logout/").catch(() => {}); // blacklists the token and clears the cookie
        tokens.clear();
        setUser(null);
        window.FB?.logout?.();
      },
    };
  }, [user, loading, postSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
