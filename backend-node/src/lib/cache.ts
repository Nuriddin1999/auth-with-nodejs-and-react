/**
 * Key-value cache with TTLs for login codes, Telegram sign-in sessions and rate limits.
 *
 * Without REDIS_URL: an in-process memory cache (fine for one server process and tests).
 * With REDIS_URL: Redis, shared by every server process (required with several processes).
 * Values must be JSON-serializable. TTLs are in seconds; null = no expiry.
 */

import { settings } from '../config.ts';

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number | null): Promise<void>;
  /** Set only if the key is missing; true if it was set. */
  add(key: string, value: unknown, ttl?: number | null): Promise<boolean>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

class MemoryCache implements Cache {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private alive(key: string) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.alive(key);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async set(key: string, value: unknown, ttl: number | null = null): Promise<void> {
    if (ttl !== null && ttl <= 0) {
      this.store.delete(key);
      return;
    }
    this.store.set(key, {
      value: JSON.stringify(value),
      expiresAt: ttl === null ? null : Date.now() + ttl * 1000,
    });
  }

  async add(key: string, value: unknown, ttl: number | null = null): Promise<boolean> {
    if (this.alive(key)) return false;
    await this.set(key, value, ttl);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

type RedisClient = import('redis').RedisClientType;

class RedisCache implements Cache {
  private client: Promise<RedisClient> | null = null;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  private connect(): Promise<RedisClient> {
    this.client ??= import('redis').then(async ({ createClient }) => {
      const client = createClient({ url: this.url }) as RedisClient;
      client.on('error', (error: Error) => console.error('Redis error:', error.message));
      await client.connect();
      return client;
    });
    return this.client;
  }

  private static px(ttl: number) {
    return Math.max(1, Math.round(ttl * 1000));
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await (await this.connect()).get(key);
    return raw === null ? null : (JSON.parse(String(raw)) as T);
  }

  async set(key: string, value: unknown, ttl: number | null = null): Promise<void> {
    const client = await this.connect();
    if (ttl !== null && ttl <= 0) {
      await client.del(key);
      return;
    }
    const json = JSON.stringify(value);
    if (ttl === null) await client.set(key, json);
    else await client.set(key, json, { PX: RedisCache.px(ttl) });
  }

  async add(key: string, value: unknown, ttl: number | null = null): Promise<boolean> {
    const client = await this.connect();
    const json = JSON.stringify(value);
    const result =
      ttl === null ? await client.set(key, json, { NX: true }) : await client.set(key, json, { NX: true, PX: RedisCache.px(ttl) });
    return result === 'OK';
  }

  async delete(key: string): Promise<void> {
    await (await this.connect()).del(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length) await (await this.connect()).del(keys);
  }

  async clear(): Promise<void> {
    await (await this.connect()).flushDb();
  }
}

export const cache: Cache = settings.REDIS_URL ? new RedisCache(settings.REDIS_URL) : new MemoryCache();
