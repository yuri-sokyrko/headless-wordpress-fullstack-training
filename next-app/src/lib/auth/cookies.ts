// The ONE module that names a session cookie's attributes. Every other file
// calls into it, so the attributes cannot drift between call sites.
//
// The contract is appendix 04 §4. It is not restated here — one home per
// contract — but every attribute below is argued in Lesson 15.4 §2.
import 'server-only';

import { cookies } from 'next/headers';

import { AT_COOKIE, RT_COOKIE } from './jwt';

// Re-exported so the frozen surface `@/lib/auth/cookies` promises holds, while
// the literals themselves live in the runtime-agnostic half (Lesson 15.4 §6).

/** 300 s. The expiry IS the revocation window — Lesson 15.1 §3. */
const AT_MAX_AGE = 300;

/** 30 days. The BROWSER's limit; WordPress's own refresh expiry is longer (15.2 §2). */
const RT_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * `Secure` in production, which is what appendix 04 §4 requires. Not in
 * development, because curl's cookie engine honours the flag strictly and will
 * not send a Secure cookie over http://localhost — and half of this lesson's
 * Verification block is curl. Browsers are more forgiving; curl is the honest
 * arbiter. One line, one place to read it.
 */
const SECURE = process.env.NODE_ENV === 'production';

/** Broad and short-lived. `Lax` so a link from an email does not land logged out (§4). */
const AT_ATTRS = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'lax',
  path: '/',
  maxAge: AT_MAX_AGE,
} as const;

/** Narrow and long-lived. One path, `Strict`, and absent from every other request (§3). */
const RT_ATTRS = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: RT_MAX_AGE,
} as const;

/** Called by `login` after WordPress issues the pair. */
export async function setSessionCookies(authToken: string, refreshToken: string): Promise<void> {
  const jar = await cookies();

  jar.set(AT_COOKIE, authToken, AT_ATTRS);
  jar.set(RT_COOKIE, refreshToken, RT_ATTRS);
}

/** Called by /api/auth/refresh. The refresh token is NOT reissued — §7. */
export async function setAccessCookie(authToken: string): Promise<void> {
  (await cookies()).set(AT_COOKIE, authToken, AT_ATTRS);
}

/**
 * Delete both cookies WITH THE ATTRIBUTES THEY WERE SET WITH.
 *
 * A cookie's identity is name + path + domain. `cookies().delete(RT_COOKIE)`
 * writes a deletion for Path=/ , which does not match the Path=/api/auth cookie
 * the browser is holding — so the refresh token survives and you have a logout
 * that does not log out. This is the most commonly shipped bug in path-scoped
 * cookies and it is invisible in review. Lesson 15.4 §3.
 */
export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();

  jar.set(AT_COOKIE, '', { ...AT_ATTRS, maxAge: 0 });
  jar.set(RT_COOKIE, '', { ...RT_ATTRS, maxAge: 0 });
}

/** `null` when the cookie is absent or empty. Callers treat both the same way. */
export async function readAccessToken(): Promise<string | null> {
  const value = (await cookies()).get(AT_COOKIE)?.value;

  return value === undefined || value === '' ? null : value;
}

/** Only ever non-null inside /api/auth/*, because of the cookie's Path. */
export async function readRefreshToken(): Promise<string | null> {
  const value = (await cookies()).get(RT_COOKIE)?.value;

  return value === undefined || value === '' ? null : value;
}

/**
 * The preview JWT, for the editor currently in draft mode. Appendix 04 §4.
 *
 * `Lax`, `Path=/`, 300 s — the same shape as `btt_at`, because it holds the same
 * class of credential: a normal user JWT for one WordPress user. It is NOT
 * `Strict`: the editor arrives from a 307 issued by /api/preview, and a Strict
 * cookie set on that response would not be sent on the redirected navigation.
 */
export const PREVIEW_COOKIE = 'btt_preview_jwt';

const PREVIEW_MAX_AGE = 300;

const PREVIEW_ATTRS = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'lax',
  path: '/',
  maxAge: PREVIEW_MAX_AGE,
} as const;

/** Called by /api/preview after WordPress redeems the token. */
export async function setPreviewCookie(jwt: string): Promise<void> {
  (await cookies()).set(PREVIEW_COOKIE, jwt, PREVIEW_ATTRS);
}

/** Called by /api/preview/exit. Full attribute set, or the deletion misses (§15.4). */
export async function clearPreviewCookie(): Promise<void> {
  (await cookies()).set(PREVIEW_COOKIE, '', { ...PREVIEW_ATTRS, maxAge: 0 });
}

/** `null` when absent or empty. The preview branch treats both the same way. */
export async function readPreviewToken(): Promise<string | null> {
  const value = (await cookies()).get(PREVIEW_COOKIE)?.value;

  return value === undefined || value === '' ? null : value;
}
