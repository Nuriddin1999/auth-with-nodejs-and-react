/** Email sign up, password sign in, password reset. */

import { char, choice, email, type FieldErrors, regex, validate } from '../lib/validation.ts';
import { validatePassword, type PasswordUserAttributes } from '../lib/passwords.ts';
import { view } from '../http/view.ts';
import * as emailCodes from '../services/emailCodes.ts';
import * as passwordAuth from '../services/passwordAuth.ts';
import { loginResponse } from './common.ts';

const emailField = () => email({ maxLength: 254 });
const passwordField = () => char({ maxLength: 128, trim: false });
// 6 digits normally; the development EMAIL_TEST_CODE may have another length.
const codeField = () => regex(/^\s*\d{4,8}\s*$/, { message: 'Enter the code from the email' });

/** password == password_confirm, and it passes the password validators. */
function checkPasswords(data: { password: string; password_confirm: string }, user: PasswordUserAttributes | null = null): FieldErrors | null {
  if (data.password !== data.password_confirm) return { password_confirm: ['Passwords do not match'] };
  const problems = validatePassword(data.password, user);
  return problems.length ? { password: problems } : null;
}

/** Sign up, step 1: {name, email, password, password_confirm} -> code sent to the email. */
export const emailSignUp = view({
  auth: false,
  throttle: 'email_code',
  handlers: {
    async post({ body, res }) {
      const data = validate(
        body,
        { name: char({ maxLength: 150 }), email: emailField(), password: passwordField(), password_confirm: passwordField() },
        // The user's name and email: the validators reject passwords similar to them.
        (d) => checkPasswords(d, { email: d.email, first_name: d.name }),
      );
      const sent = await emailCodes.requestCode({ purpose: 'signup', email: data.email, name: data.name, password: data.password });
      res.json({ detail: 'Code sent', ...sent });
    },
  },
});

/**
 * Sign up, step 2: {email, code} -> account created.
 *
 * Deliberately does NOT sign the user in: after registration they sign in with their
 * email and password (no tokens, no refresh cookie here).
 */
export const emailVerify = view({
  auth: false,
  throttle: 'email_code',
  handlers: {
    async post({ body, res }) {
      const data = validate(body, { email: emailField(), code: codeField() });
      const { user, created } = emailCodes.verifySignup(data);
      res.status(created ? 201 : 200).json({ detail: 'Account created', email: user.email, created });
    },
  },
});

/** {email, purpose} -> a new code for a pending sign up or password reset. */
export const emailResend = view({
  auth: false,
  throttle: 'email_code',
  handlers: {
    async post({ body, res }) {
      const data = validate(body, { email: emailField(), purpose: choice(emailCodes.PURPOSES) });
      res.json({ detail: 'Code sent', ...(await emailCodes.resendCode(data)) });
    },
  },
});

/** {email, password} -> {access, user, created} + refresh cookie. */
export const passwordLogin = view({
  auth: false,
  throttle: 'password_login',
  handlers: {
    async post({ body, res }) {
      const data = validate(body, { email: emailField(), password: passwordField() });
      loginResponse(res, await passwordAuth.authenticate(data), false);
    },
  },
});

/** Forgot password, step 1: {email} -> code sent to the email. */
export const passwordResetRequest = view({
  auth: false,
  throttle: 'email_code',
  handlers: {
    async post({ body, res }) {
      const data = validate(body, { email: emailField() });
      res.json({ detail: 'Code sent', ...(await emailCodes.requestCode({ purpose: 'reset', email: data.email })) });
    },
  },
});

/** Forgot password, step 2: {email, code} -> {reset_token}. */
export const passwordResetVerify = view({
  auth: false,
  throttle: 'email_code',
  handlers: {
    post({ body, res }) {
      const data = validate(body, { email: emailField(), code: codeField() });
      res.json({ reset_token: passwordAuth.verifyResetCode(data) });
    },
  },
});

/** Forgot password, step 3: {token, password, password_confirm} -> signed in. */
export const passwordResetConfirm = view({
  auth: false,
  throttle: 'email_code',
  handlers: {
    async post({ body, res }) {
      const data = validate(
        body,
        { token: char({ maxLength: 500 }), password: passwordField(), password_confirm: passwordField() },
        (d) => checkPasswords(d),
      );
      loginResponse(res, await passwordAuth.resetPassword(data), false);
    },
  },
});
