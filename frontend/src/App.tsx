import type { ReactNode } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/useAuth";
import { config } from "./config";
import ProfilePage from "./pages/ProfilePage";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import VerifyPage from "./pages/VerifyPage";
import ConnectPage from "./pages/ConnectPage";
import TelegramPage from "./pages/TelegramPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import { cx, ui } from "./ui";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className={cx(ui.card, "text-muted")}>Loading…</main>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function GoogleWrapper({ children }: { children: ReactNode }) {
  if (!config.googleClientId) return children;
  return (
    <GoogleOAuthProvider clientId={config.googleClientId} locale="en">
      {children}
    </GoogleOAuthProvider>
  );
}

export default function App() {
  return (
    <GoogleWrapper>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<SignInPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/connect/:provider" element={<ConnectPage />} />
            <Route path="/telegram" element={<TelegramPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </GoogleWrapper>
  );
}
