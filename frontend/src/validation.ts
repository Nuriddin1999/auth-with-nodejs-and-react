/** Client-side checks that only decide whether a form can be submitted. The backend validates everything again. */

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

export function isFilled(...values: string[]): boolean {
  return values.every((v) => v.trim().length > 0);
}

/** New password + confirmation: long enough and equal. */
export function isNewPasswordValid(password: string, confirm: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password === confirm;
}

/** Inline hint for a new-password field, or "" when there is nothing to say yet. */
export function passwordLengthHint(password: string): string {
  return password.length > 0 && password.length < MIN_PASSWORD_LENGTH
    ? `At least ${MIN_PASSWORD_LENGTH} characters (${MIN_PASSWORD_LENGTH - password.length} more)`
    : "";
}

/** Find the code in pasted text: a run of exactly `length` digits, else all digits if that's the right count. */
export function extractCode(text: string, length: number): string {
  const run = (text.match(/\d+/g) ?? []).find((digits) => digits.length === length);
  if (run) return run;
  const digits = text.replace(/\D/g, "");
  return digits.length === length ? digits : "";
}
