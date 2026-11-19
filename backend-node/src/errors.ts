/** Error types shared by the services and the views. */

/** Any error that should become this exact HTTP response. */
export class HttpError extends Error {
  status: number;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;

  constructor(status: number, body: Record<string, unknown> | null, headers: Record<string, string> = {}) {
    super(typeof body?.detail === 'string' ? body.detail : `HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

// --- Social providers -------------------------------------------------------------

/** The provider rejected the credentials (or a code was wrong). */
export class ProviderError extends Error {}

/** The provider's keys are not configured on the server. */
export class ProviderNotConfigured extends ProviderError {}

/** The identity is linked to another user, or the user already has this provider. */
export class AccountConflict extends ProviderError {}

/** Telegram API is unreachable or rejected the call. */
export class TelegramError extends ProviderError {}

/** The Telegram sign-in page session has expired. */
export class LoginExpired extends ProviderError {}

/** A new code was requested too early. */
export class CodeCooldown extends ProviderError {
  retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

// --- Email codes / passwords ------------------------------------------------------

/** Becomes {detail, code, ...extra} with `status`. */
export class EmailCodeError extends Error {
  status = 400;
  code: string;
  extra: Record<string, unknown>;

  constructor(message: string, code = 'invalid', extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

export class AccountExists extends EmailCodeError {
  override status = 409;
}

export class AccountNotFound extends EmailCodeError {
  override status = 404;
}

export class TooManyRequests extends EmailCodeError {
  override status = 429;
}

export class EmailNotSent extends EmailCodeError {
  override status = 503;
}

export class InvalidCredentials extends EmailCodeError {
  override status = 401;
}
