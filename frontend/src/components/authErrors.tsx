import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { errorCode, errorMessage } from "../api/client";
import { ui } from "../ui";

/** Error text for auth forms, with a link to the right page for "wrong page" errors. */
export function authErrorMessage(error: unknown, email: string): ReactNode {
  switch (errorCode(error)) {
    case "account_not_found":
      return (
        <>
          No account with this email.{" "}
          <Link className={ui.link} to="/signup" state={{ email }}>
            Sign up
          </Link>
        </>
      );
    case "account_exists":
      return (
        <>
          An account with this email already exists.{" "}
          <Link className={ui.link} to="/login" state={{ email }}>
            Sign in
          </Link>
        </>
      );
    default:
      return errorMessage(error);
  }
}
