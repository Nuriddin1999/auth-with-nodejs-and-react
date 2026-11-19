import { useCallback } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

/**
 * Opens an auth page (e.g. /telegram, /connect/google) and remembers where to come back:
 * the page the user originally wanted (from sign in / sign up) or the current page (profile).
 */
export function useOpenAuthPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (path: string, extraState: object = {}) => {
      const onAuthPage = ["/login", "/signup"].includes(location.pathname);
      const from = onAuthPage ? (location.state as { from?: Location } | null)?.from : location;
      navigate(path, { state: { ...extraState, from } });
    },
    [navigate, location],
  );
}
