// The runtime-agnostic half of the auth library. Importable from a Server
// Component, a Server Action, a Route Handler, src/proxy.ts and a Vitest
// test in plain Node.
//
// DELIBERATELY NO `import 'server-only'`: the package throws outside the
// react-server condition, and src/proxy.ts is not a react-server context.
// Same reasoning as src/lib/graphql/tags.ts and errors.ts (Lesson 10.3).
// Nothing in this file touches a credential store, so there is nothing to guard.

/** The user JWT. Appendix 04 §4. Re-exported by cookies.ts. */
export const AT_COOKIE = 'btt_at';

/** The refresh token, scoped to Path=/api/auth. Appendix 04 §4. */
export const RT_COOKIE = 'btt_rt';

/**
 * Read the `exp` claim. VERIFIES NOTHING.
 *
 * Not the signature, not `nbf`, not the issuer, not `data.user.id`. It answers
 * exactly one question — "is it worth asking for a new token?" — and it is
 * named for what it reads so that nobody is tempted to trust it with more.
 *
 * A forged `exp` in the far future costs this application ONE wasted request:
 * it skips a refresh it did not need, presents the token to WordPress, and
 * WordPress rejects it. That bounded worst case is why hand-writing this is
 * safe and why `jose` is not a dependency (Lesson 15.4 §5).
 *
 * @returns Unix seconds, or `null` for anything malformed. Never throws.
 */
export function decodeExpiry(jwt: string): number | null {
  const segments = jwt.split('.');

  if (segments.length !== 3) {
    return null;
  }

  const payload = segments[1];

  // noUncheckedIndexedAccess from Lesson 07.3 is why this check is not optional.
  if (payload === undefined || payload === '') {
    return null;
  }

  try {
    // base64url → base64: swap the alphabet, then restore the '=' padding.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64.length % 4)) % 4;
    const claims: unknown = JSON.parse(atob(base64 + '-'.repeat(padding)));

    if (typeof claims !== 'object' || claims === null) {
      return null;
    }

    const exp = (claims as { readonly exp?: unknown }).exp;

    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    // Malformed base64, malformed JSON, a payload that is not an object.
    // "Assume expired" is the only safe interpretation and every caller
    // treats null that way.
    return null;
  }
}

/** Seconds until `exp`, or `0` for a token that is unreadable or already dead. */
export function secondsUntilExpiry(jwt: string, now: number = Date.now()): number {
  const exp = decodeExpiry(jwt);

  if (exp === null) {
    return 0;
  }

  return Math.max(0, exp - Math.floor(now / 1000));
}
