import { useEffect } from "react";
import AuthCard from "./AuthCard";
import { cx, ui } from "../ui";

const REDIRECT_DELAY = 1500;

interface Props {
  title?: string;
  message?: string;
  continueLabel?: string;
  onContinue: () => void;
}

/** Success screen (e.g. "Authentication successful") that redirects after a short delay. */
export default function AuthSuccess({
  title = "Authentication successful",
  message = "You're all set.",
  continueLabel = "Continue",
  onContinue,
}: Props) {
  useEffect(() => {
    const timer = setTimeout(onContinue, REDIRECT_DELAY);
    return () => clearTimeout(timer);
  }, [onContinue]);

  return (
    <AuthCard title={title}>
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <svg
          className="size-16 fill-none stroke-success stroke-3 [stroke-linecap:round] [stroke-linejoin:round]"
          viewBox="0 0 52 52"
          aria-hidden="true"
        >
          <circle className="[stroke-opacity:0.3]" cx="26" cy="26" r="24" />
          <path
            className="animate-draw-check [stroke-dasharray:40] [stroke-dashoffset:40] motion-reduce:animate-none motion-reduce:[stroke-dashoffset:0]"
            d="M15 27l7 7 15-15"
          />
        </svg>
        <p>{message}</p>
        <p className="text-muted">Redirecting…</p>
        <button type="button" className={cx(ui.primary, "mt-2")} onClick={onContinue}>
          {continueLabel}
        </button>
      </div>
    </AuthCard>
  );
}
