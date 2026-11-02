// The ONLY path the browser sends btt_rt to, because of the cookie's
// Path=/api/auth. That has a consequence Lesson 15.5 leans on: proxy
// running on /en/account never sees the refresh token and therefore CANNOT
// refresh. This route is the only place in the application that can.
import { NextResponse, type NextRequest } from 'next/server';

import { RefreshTokenDocument } from '@/gql/graphql';
import { clearSessionCookies, readRefreshToken, setAccessCookie } from '@/lib/auth/cookies';
import { fetchGraphQL } from '@/lib/graphql/client';

// A refresh is never a cached answer. Next 16 does not cache GET handlers by
// default; this states the intent so no future default can change it.
export const dynamic = 'force-dynamic';

/** Belt and braces on top of `dynamic`: no proxy or CDN may hold this response. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** One locale today. Module 20 replaces the test with the real list. */
function localeOf(pathname: string): string {
  const first = pathname.split('/')[1] ?? '';

  return /^[a-z]{2}$/.test(first) ? first : 'en';
}

/**
 * OPEN REDIRECT DEFENCE, the same rule as `safeNextPath` in src/actions/auth.ts.
 * `?next=` is attacker-chosen. A leading `//` or `/\` is an absolute URL with a
 * host as far as a browser is concerned.
 */
function safeNextPath(raw: string | null): string {
  if (raw == null || !/^\/(?![/\\])[\w\-./?=&%]*$/.test(raw)) {
    return '/en';
  }

  return raw;
}

/**
 * Trade the refresh cookie for a fresh access cookie.
 *
 * `fetchGraphQL`, not `fetchGraphQLAuthed`: the refresh token travels in the
 * mutation VARIABLES, not in a header, so there is no `Credential` to
 * discriminate. No `options`, so nothing is cached.
 */
async function rotateAccessToken(): Promise<'ok' | 'refused' | 'unavailable'> {
  const refreshToken = await readRefreshToken();

  // No cookie at all: nothing was refused, there was simply nothing to present.
  if (refreshToken === null) {
    return 'unavailable';
  }

  try {
    const data = await fetchGraphQL(RefreshTokenDocument, { refreshToken });
    const authToken = data.refreshJwtAuthToken?.authToken;

    // WordPress answered and declined. The refresh token is spent or revoked.
    if (authToken === null || authToken === undefined || authToken === '') {
      return 'refused';
    }

    await setAccessCookie(authToken);

    return 'ok';
  } catch (error) {
    console.error('[btt] refresh: WordPress refused or was unreachable', error);

    // THREE states, not two, and this is the branch that needs the third.
    // A transport failure is not a refusal: WordPress being briefly
    // unreachable must not delete a refresh token that is still perfectly
    // valid. `POST` clears on any failure because a programmatic caller has
    // nowhere to put the distinction; `GET` clears only on 'refused', so a
    // network blip costs the editor a redirect rather than their session.
    return 'unavailable';
  }
}

/**
 * The PROGRAMMATIC contract. 401 on any failure, 204 on success. Module 16's
 * Starting State asserts the anonymous 401.
 *
 * No response body in any branch. A refresh endpoint has nothing to say that
 * the status code does not already say, and a body is a place for detail to
 * leak into.
 */
export async function POST(): Promise<Response> {
  if ((await rotateAccessToken()) !== 'ok') {
    // Clear BOTH cookies on ANY failure, whatever the cause. Two reasons, and
    // the second is the one that matters. The browser should stop presenting a
    // credential nothing will accept — and Lesson 15.5's proxy hands off
    // to this route whenever `btt_at` is near expiry, so a failed refresh that
    // left `btt_at` in place would be handed off again on the very next
    // request. That is an infinite redirect loop, and deleting the cookie is
    // what terminates it.
    await clearSessionCookies();

    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }

  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

/**
 * The BROWSER hand-off. Lesson 15.5's proxy redirects a navigation here
 * when the access cookie on a guarded route is missing or nearly expired.
 *
 * A GET that changes state is normally wrong, so here is the argument. What it
 * changes is issuing the caller a fresh copy of a credential they already hold;
 * it is idempotent; it requires a cookie the browser only sends to this exact
 * path, with SameSite=Strict, so it cannot be triggered from another site at
 * all; and the alternative is shipping JavaScript to the browser whose only job
 * is to POST here. The cost, stated plainly: a link previewer that follows this
 * URL with the user's cookies would consume a refresh. Nothing breaks — the
 * refresh token is not rotated — but it is a real, if harmless, side effect.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const nextPath = safeNextPath(request.nextUrl.searchParams.get('next'));
  const result = await rotateAccessToken();

  if (result === 'ok') {
    return NextResponse.redirect(new URL(nextPath, request.nextUrl.origin), {
      status: 307,
      headers: NO_STORE,
    });
  }

  if (result === 'refused') {
    await clearSessionCookies();
  }

  // A browser NAVIGATING gets a page, not a JSON 401. Same 307 target shape the
  // guards and the proxy use: /{locale}/login?next={pathname}.
  //
  // `search =` rather than `searchParams.set()`, and this is not a style choice.
  // URLSearchParams serialises with form-urlencoding, which percent-encodes `/`
  // — you would get `?next=%2Fen%2Faccount`. Assigning `search` runs the URL
  // parser's query-encode set instead, which leaves `/` alone. Module 16's
  // Starting State asserts the UNENCODED form.
  const login = new URL(`/${localeOf(nextPath)}/login`, request.nextUrl.origin);
  login.search = `?next=${nextPath}`;

  return NextResponse.redirect(login, { status: 307, headers: NO_STORE });
}
