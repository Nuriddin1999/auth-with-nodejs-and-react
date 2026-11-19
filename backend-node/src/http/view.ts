/**
 * A small equivalent of DRF's APIView. Every request goes through, in this order:
 *   1. authentication (JWT "Authorization: Bearer <access>"), if enabled for the view;
 *   2. permission (signed-in users only), if required;
 *   3. rate limit (anonymous requests only, like AnonRateThrottle);
 *   4. the handler for the HTTP method (405 if there is none).
 *
 * Errors become the same JSON responses DRF produced:
 *   ValidationError -> 400 {"field": ["message"]}
 *   EmailCodeError  -> <status> {"detail", "code", ...extra} (+ Retry-After)
 *   HttpError       -> its exact status, body and headers
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ThrottleScope } from '../config.ts';
import type { UserRow } from '../db.ts';
import { EmailCodeError, HttpError } from '../errors.ts';
import { decode, TokenError } from '../lib/jwt.ts';
import { ValidationError } from '../lib/validation.ts';
import { getUserById, isActive } from '../users.ts';
import { throttle } from './throttle.ts';

export interface Ctx {
  req: Request;
  res: Response;
  /** The signed-in user, or null (always null when the view has no authentication). */
  user: UserRow | null;
  /** The parsed request body ({} when empty). */
  body: unknown;
}

type Handler = (ctx: Ctx) => Promise<void> | void;
type Method = 'get' | 'post' | 'patch' | 'delete';

interface ViewOptions {
  /** JWT authentication (DRF default). false = the Authorization header is ignored. */
  auth?: boolean;
  /** Only signed-in users (IsAuthenticated). */
  requireUser?: boolean;
  throttle?: ThrottleScope;
  handlers: Partial<Record<Method, Handler>>;
}

const WWW_AUTHENTICATE = 'Bearer realm="api"';

function authFailed(detail: string, code: string, extra: Record<string, unknown> = {}): HttpError {
  return new HttpError(401, { detail, code, ...extra }, { 'WWW-Authenticate': WWW_AUTHENTICATE });
}

/** simplejwt's JWTAuthentication. */
function authenticate(req: Request): UserRow | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts[0] !== 'Bearer') return null;
  if (parts.length !== 2) {
    throw authFailed('Authorization header must contain two space-delimited values', 'bad_authorization_header');
  }
  let payload;
  try {
    payload = decode(parts[1], 'access');
  } catch (error) {
    if (!(error instanceof TokenError)) throw error;
    throw authFailed('Given token not valid for any token type', 'token_not_valid', {
      messages: [{ token_class: 'AccessToken', token_type: 'access', message: error.message }],
    });
  }
  if (payload.user_id === undefined) throw authFailed('Token contained no recognizable user identification', 'token_not_valid');
  const user = getUserById(payload.user_id);
  if (!user) throw authFailed('User not found', 'user_not_found');
  if (!isActive(user)) throw authFailed('User is inactive', 'user_inactive');
  return user;
}

export function sendError(res: Response, error: unknown): boolean {
  if (error instanceof HttpError) {
    res.set(error.headers).status(error.status);
    if (error.body === null) res.end();
    else res.json(error.body);
    return true;
  }
  if (error instanceof ValidationError) {
    res.status(400).json(error.errors);
    return true;
  }
  if (error instanceof EmailCodeError) {
    if ('retry_after' in error.extra) res.set('Retry-After', String(error.extra.retry_after));
    res.status(error.status).json({ detail: error.message, code: error.code, ...error.extra });
    return true;
  }
  return false;
}

export function view({ auth = true, requireUser = false, throttle: scope, handlers }: ViewOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = auth ? authenticate(req) : null;
      if (requireUser && !user) {
        throw new HttpError(401, { detail: 'Authentication credentials were not provided.' }, { 'WWW-Authenticate': WWW_AUTHENTICATE });
      }
      if (scope && !user) {
        const wait = await throttle(scope, req);
        if (wait !== null) {
          const seconds = Math.ceil(wait);
          throw new HttpError(
            429,
            { detail: `Request was throttled. Expected available in ${seconds} second${seconds === 1 ? '' : 's'}.` },
            { 'Retry-After': String(seconds) },
          );
        }
      }
      const method = (req.method === 'HEAD' ? 'get' : req.method.toLowerCase()) as Method;
      const handler = handlers[method];
      if (!handler) {
        res.set('Allow', Object.keys(handlers).map((m) => m.toUpperCase()).join(', '));
        throw new HttpError(405, { detail: `Method "${req.method}" not allowed.` });
      }
      await handler({ req, res, user, body: req.body ?? {} });
    } catch (error) {
      if (!sendError(res, error)) next(error);
    }
  };
}
