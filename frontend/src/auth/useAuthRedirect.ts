import { useCallback } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

interface AuthLocationState {
  /** Page the user tried to open before being sent to sign in. */
  from?: Location;
  /** Values to prefill when switching between sign in, sign up and back from /verify. */
  email?: string;
  name?: string;
  /** Just finished signing up: show "Account created, please sign in". */
  registered?: boolean;
}

/** Where to go after authentication, and a callback that goes there. */
export function useAuthRedirect() {
  const navigate = useNavigate();
  const state = (useLocation().state as AuthLocationState | null) ?? {};
  const next = state.from?.pathname || "/";

  const finish = useCallback(() => navigate(next, { replace: true }), [navigate, next]);

  return {
    next,
    finish,
    from: state.from,
    prefillEmail: state.email ?? "",
    prefillName: state.name ?? "",
    justRegistered: Boolean(state.registered),
  };
}
