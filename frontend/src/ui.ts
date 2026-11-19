/**
 * Shared Tailwind class sets, so every form, button and input looks the same.
 * Colors come from the theme in index.css (bg-accent, text-muted, border-line, ...).
 */

/** Join class names, skipping falsy ones: cx("a", busy && "b"). */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const btn =
  "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-transparent px-4 font-medium no-underline disabled:cursor-not-allowed disabled:opacity-60";

export const ui = {
  card: "w-full max-w-[420px] rounded-2xl border border-line bg-card p-8",
  title: "mb-1 text-2xl font-bold",
  subtitle: "text-muted",
  heading: "mt-7 mb-3 text-base font-bold",

  form: "flex flex-col gap-4",
  field: "flex flex-col gap-1.5 text-[0.9rem] font-medium",
  input:
    "min-h-[42px] w-full rounded-lg border border-line bg-field px-3 font-normal text-fg outline-none focus:border-transparent focus:outline-2 focus:-outline-offset-1 focus:outline-accent aria-[invalid=true]:border-error disabled:opacity-60",
  /** Wrapper for an input with a small button inside it (Show / Paste). */
  inputWithAction: "relative flex",
  inputAction:
    "absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded-md px-2 py-1 text-[0.85rem] font-medium text-accent hover:bg-line disabled:cursor-default disabled:bg-transparent disabled:text-muted",
  hint: "text-[0.8rem] font-normal text-muted",

  error: "text-error",
  /** Error right under a field: pulled closer to it. */
  fieldError: "-mt-2.5 text-[0.85rem] text-error",
  success: "text-success",
  notice: "mb-4 rounded-lg bg-success/12 px-3 py-2.5 text-[0.9rem] text-success",

  btn,
  primary: `${btn} w-full bg-accent text-white`,
  outline: `${btn} w-full border-line bg-transparent text-fg`,
  google: `${btn} border-[#dadce0] bg-white text-[#3c4043]`,
  facebook: `${btn} bg-facebook text-white`,
  telegram: `${btn} bg-telegram text-white`,
  /** Text-only button / link look. */
  linkButton:
    "cursor-pointer text-[0.9rem] font-medium text-accent hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline",
  link: "font-medium text-accent no-underline hover:underline",

  badge: "rounded-full bg-success/12 px-2 py-0.5 text-[0.8rem] text-success",
  badgeMuted: "rounded-full bg-line px-2 py-0.5 text-[0.8rem] text-muted",
} as const;
