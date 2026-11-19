import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useAuthRedirect } from "../auth/useAuthRedirect";
import AuthCard from "../components/AuthCard";
import AuthSuccess from "../components/AuthSuccess";
import SignInForm from "../components/SignInForm";
import SocialButtons from "../components/SocialButtons";
import { cx, ui } from "../ui";

export default function SignInPage() {
  const { user } = useAuth();
  const { next, finish, from, prefillEmail, justRegistered } = useAuthRedirect();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  // Redirect only users who were signed in before; a fresh sign in shows the success screen.
  const [signedInOnArrival] = useState(Boolean(user));

  if (done) return <AuthSuccess message="You're signed in." onContinue={finish} />;
  if (signedInOnArrival) return <Navigate to={next} replace />;

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back! Choose how you want to sign in"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link className={ui.link} to="/signup" state={{ from }}>
            Sign up
          </Link>
        </>
      }
    >
      {justRegistered && (
        <p className={ui.notice} role="status">
          Account created. Sign in to continue.
        </p>
      )}
      <SignInForm prefillEmail={prefillEmail} focusPassword={justRegistered} onDone={() => setDone(true)} />
      <div className="my-6 flex items-center gap-3 text-[0.85rem] tracking-wider text-muted uppercase before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
        or
      </div>
      <SocialButtons onDone={finish} onError={setError} />
      {error && (
        <p className={cx(ui.error, "mt-4")} role="alert">
          {error}
        </p>
      )}
    </AuthCard>
  );
}
