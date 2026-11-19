import { useContext } from "react";
import { AuthContext, type IAuthContextValue } from "./context";

/** The signed-in user and auth actions; use inside <AuthProvider>. */
export function useAuth(): IAuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
