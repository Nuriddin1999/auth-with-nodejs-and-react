import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useAuthRedirect } from "../auth/useAuthRedirect";
import AuthCard from "../components/AuthCard";
import SignUpForm from "../components/SignUpForm";
import SocialButtons from "../components/SocialButtons";
import { cx, ui } from "../ui";

export default function SignUpPage() {
  const { user } = useAuth();
  const { next, finish, from, prefillEmail, prefillName } = useAuthRedirect();
  const [error, setError] = useState("");

  if (user) return <Navigate to={next} replace />;

  return (
    <AuthCard
      title="Create an account"
      subtitle="Sign up with your email or a social account"
      footer={
        <>
          Already have an account?{" "}
          <Link className={ui.link} to="/login" state={{ from }}>
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm prefillEmail={prefillEmail} prefillName={prefillName} from={from} />
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
