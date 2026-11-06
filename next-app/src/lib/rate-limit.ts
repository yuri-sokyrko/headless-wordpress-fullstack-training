// Per-IP rate limiting on Upstash Redis, used by every Server Action.
//
// NO `import 'server-only'` in this file, and the reason is the same one that
// keeps it off tags.ts and errors.ts (Lesson 12.2 §6): Module 12's runner
// executes in plain Node, where the `server-only` package throws, and this
// module has a unit test that must run there. It holds no endpoint and no
// credential of its own — UPSTASH_* are read from process.env and are not
// NEXT_PUBLIC_, so they are never inlined into a client bundle. Verification
// greps to prove no client component imports this file.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/** Five writes per ten minutes per IP. Tuned for a form a human fills in. */
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW = '10 m';

/** A verdict, not a boolean — the caller has to handle all three cases. */
export type LimitVerdict =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly reason: 'exceeded'; readonly retryAfterSeconds: number }
  | { readonly ok: false; readonly reason: 'unavailable' };

/**
 * The one method this module needs from a limiter. Declaring it ourselves is
 * what makes the unit test possible WITHOUT vi.mock — see rate-limit.test.ts.
 */
export interface RateLimitBackend {
  limit(key: string): Promise<{ success: boolean; remaining: number; reset: number }>;
}

/**
 * Wrap a backend in the fail-closed policy.
 *
 * `null` means "there is no backend", which happens when the environment
 * variables are absent. A misconfigured deployment must not get an unlimited
 * endpoint, so that case is `unavailable` too — exactly like
 * require_app_token()'s empty-token branch in Lesson 06.2.
 */
export function createRateLimiter(
  backend: RateLimitBackend | null
): (key: string) => Promise<LimitVerdict> {
  return async function limitWith(key: string): Promise<LimitVerdict> {
    if (backend === null) {
      return { ok: false, reason: 'unavailable' };
    }

    try {
      const result = await backend.limit(key);

      if (result.success) {
        return { ok: true, remaining: result.remaining };
      }

      // `reset` is an epoch in milliseconds. Never return 0 — a client that
      // retries immediately is a client that gets refused immediately.
      return {
        ok: false,
        reason: 'exceeded',
        retryAfterSeconds: Math.max(1, Math.ceil(result.reset - Date.now()) / 1000),
      };
    } catch {
      // ── FAIL CLOSED ──────────────────────────────────────────────────
      // Redis is unreachable, or timed out, or returned nonsense. The write
      // is REFUSED. A limiter that opens here is a limiter an attacker turns
      // off by attacking Redis (Lesson 16.2 §5). Nothing is logged: the
      // caller's key is derived from an IP address (Lesson 16.3 §7).
      return { ok: false, reason: 'unavailable' };
    }
  };
}

let resolved: RateLimitBackend | null | undefined;

/** The real backend, built once, lazily, and never at import time. */
function upstashBackend(): RateLimitBackend | null {
  if (resolved !== undefined) {
    return resolved;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    resolved = null;

    return resolved;
  }

  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    // A SLIDING window, not a fixed one: a fixed window lets a caller spend
    // the whole budget at 09:59:59 and the whole budget again at 10:00:01.
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW),
    prefix: 'btt:rl',
  });

  resolved = { limit: (key) => ratelimit.limit(key) };

  return resolved;
}

/** What every action calls. One key namespace per action, e.g. `incident:1.2.3.4`. */
export function limit(key: string): Promise<LimitVerdict> {
  return createRateLimiter(upstashBackend())(key);
}
