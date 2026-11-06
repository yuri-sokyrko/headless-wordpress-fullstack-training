// The fail-closed branch is the whole point of the module, and it is the branch
// you cannot reach by hand without breaking your own Redis.
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter, type RateLimitBackend } from './rate-limit';

/**
 * Dependency injection, deliberately, rather than vi.mock('@upstash/redis').
 *
 * A vi.mock couples this test to the SDK's module shape: an Upstash release
 * that renames a class or moves an export breaks the test without breaking the
 * code, which is the definition of a test that costs more than it earns. A
 * hand-written backend couples the test to OUR RateLimitBackend interface,
 * which is one method wide and ours to keep stable. It also needs no runner
 * magic, so the test reads as ordinary code.
 */
function backend(impl: RateLimitBackend['limit']): RateLimitBackend {
  return { limit: impl };
}

describe('createRateLimiter', () => {
  it('allows a request the backend allows', async () => {
    const limit = createRateLimiter(
      backend(() => Promise.resolve({ success: true, remaining: 4, reset: Date.now() + 60_000 }))
    );

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: true, remaining: 4 });
  });

  it('refuses with a retry-after when the bucket is empty', async () => {
    const limit = createRateLimiter(
      backend(() => Promise.resolve({ success: false, remaining: 0, reset: Date.now() + 30_000 }))
    );
    const verdict = await limit('incident:1.2.3.4');

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: 'exceeded' });
    expect(
      verdict.ok === false && verdict.reason === 'exceeded' ? verdict.retryAfterSeconds : 0
    ).toBeGreaterThan(25);
  });

  it('never returns a retry-after of zero, even for a reset in the past', async () => {
    const limit = createRateLimiter(
      backend(() => Promise.resolve({ success: false, remaining: 0, reset: Date.now() - 5_000 }))
    );
    const verdict = await limit('incident:1.2.3.4');

    expect(verdict).toEqual({ ok: false, reason: 'exceeded', retryAfterSeconds: 1 });
  });

  // ── THE ONE THAT MATTERS ────────────────────────────────────────────
  it('FAILS CLOSED when the backend rejects', async () => {
    const limit = createRateLimiter(backend(() => Promise.reject(new Error('fetch failed'))));

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('fails closed when the backend rejects with a network error', async () => {
    const limit = createRateLimiter(backend(async () => Promise.reject(new Error('ECONNREFUSED'))));

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('fails closed when there is NO backend, which is a missing env var', async () => {
    const limit = createRateLimiter(null);

    await expect(limit('incident:1.2.3.4')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('passes the key through unchanged, so one action cannot spend another action budget', async () => {
    const seen = vi.fn(() =>
      Promise.resolve({ success: true, remaining: 4, reset: Date.now() + 60_000 })
    );
    const limit = createRateLimiter(backend(seen));

    await limit('lead:1.2.3.4');

    expect(seen).toHaveBeenCalledWith('lead:1.2.3.4');
  });
});
