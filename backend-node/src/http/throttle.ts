/**
 * Per-endpoint rate limits for anonymous requests, counted per IP in the cache
 * (same sliding-window algorithm as DRF's AnonRateThrottle). Rates: settings.THROTTLE_RATES.
 *
 * Each group has its own scope so, for example, the Telegram page polling every 2 s
 * can't use up the budget for password sign-in.
 */

import type { Request } from 'express';
import { settings, type ThrottleScope } from '../config.ts';
import { cache } from '../lib/cache.ts';

function parseRate(rate: string): { limit: number; duration: number } {
  const [num, period] = rate.split('/');
  const duration = { s: 1, m: 60, h: 3600, d: 86400 }[period[0] as 's' | 'm' | 'h' | 'd'];
  return { limit: Number(num), duration };
}

/** Like DRF without NUM_PROXIES: the whole X-Forwarded-For if present, else the socket address. */
export function clientIdent(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.replace(/\s+/g, '');
  return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

/** null if allowed, else the recommended wait in seconds. */
export async function throttle(scope: ThrottleScope, req: Request): Promise<number | null> {
  const { limit, duration } = parseRate(settings.THROTTLE_RATES[scope]);
  const key = `throttle_${scope}_${clientIdent(req)}`;
  const history = (await cache.get<number[]>(key)) ?? [];
  const now = Date.now() / 1000;

  // Drop requests that are older than the window.
  while (history.length && history[history.length - 1] <= now - duration) history.pop();

  if (history.length >= limit) {
    const remaining = history.length ? duration - (now - history[history.length - 1]) : duration;
    const available = limit - history.length + 1;
    return available <= 0 ? remaining : remaining / available;
  }
  history.unshift(now);
  await cache.set(key, history, duration);
  return null;
}
