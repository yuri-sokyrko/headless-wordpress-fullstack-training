// The token exchange. Modelled on /api/auth/refresh (Lesson 15.4): a route
// handler, force-dynamic, one no-store constant, and an open-redirect defence on
// every attacker-reachable path parameter.
//
// NOTHING here is cookie-authenticated, so CSRF against this endpoint is not
// blocked — it is STRUCTURALLY IMPOSSIBLE. There is no ambient credential for
// another site's page to borrow. Lesson 15.5 §8, layer three.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { draftMode } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { setPreviewCookie } from '@/lib/auth/cookies';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * OPEN REDIRECT DEFENCE, the same rule as `safeNextPath` in
 * src/app/api/auth/refresh/route.ts. `?next=` arrives from WordPress, and
 * WordPress is not a trusted client — the mirror image of the discipline
 * Lesson 06.2 §3 applies in the other direction.
 *
 * A leading `//` or `/\` is an absolute URL with a host as far as a browser is
 * concerned, which is why the negative lookahead is not optional.
 */
function isSafeNextPath(raw: string | null): raw is string {
  return raw !== null && /^\/(?![/\\])[\w\-./?=&%]*$/.test(raw);
}

/**
 * The LOCAL pre-check. Not the authority — the single-use transient in WordPress
 * is. This exists so an unauthenticated caller cannot force one WordPress round
 * trip per request, and so garbage never reaches WordPress's access log.
 * Lesson 17.2 §6.
 */
function signatureMatches(token: string): boolean {
  const secret = process.env.PREVIEW_SHARED_SECRET;

  // Fail CLOSED. An unset secret authenticates nobody.
  if (secret === undefined || secret === '') {
    return false;
  }

  const dot = token.indexOf('.');

  if (dot <= 0) {
    return false;
  }

  const expected = Buffer.from(
    createHmac('sha256', secret).update(token.slice(0, dot)).digest('hex'),
    'utf8'
  );
  const presented = Buffer.from(token.slice(dot + 1), 'utf8');

  // timingSafeEqual THROWS on unequal lengths, so compare them first. The length
  // of a hex SHA-256 digest is public, so this leaks nothing.
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/** Redeem the token at WordPress. Returns the JWT, or null for every failure. */
async function redeem(token: string): Promise<string | null> {
  const base = process.env.WP_REST_BASE;

  // The SECOND place in this application that reads WP_APP_TOKEN — Lesson 15.2
  // said `credentialHeaders()` was the only one, and this makes it two. The cost
  // of exchanging over REST instead of GraphQL, paid deliberately: the verify
  // endpoint deletes a transient and mints a JWT, neither of which belongs in a
  // public schema.
  const appToken = process.env.WP_APP_TOKEN;

  if (base === undefined || base === '' || appToken === undefined || appToken === '') {
    console.error('[btt] preview: WP_REST_BAE or WP_APP_TOKEN is not set');

    return null;
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/btt/v1/preview/verify`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-BTT-App-Token': appToken,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();
    const jwt = (data as { previewJwt?: unknown }).previewJwt;

    return typeof jwt === 'string' && jwt !== '' ? jwt : null;
  } catch (error) {
    console.error('[btt] preview: WordPress refused or was unreachable', error);

    return null;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const nextPath = params.get('next');
  const token = params.get('token') ?? '';

  // 1. The DESTINATION first, before any credential work. A tampered `next=`
  //    means the link was rewritten, and there is nothing friendly to do — unlike
  //    /api/auth/refresh, which falls back to /en because it is reached mid-session
  //    by a real browser. 400 also means this branch does not burn a token.
  if (!isSafeNextPath(nextPath)) {
    return new NextResponse(null, { status: 400, headers: NO_STORE });
  }

  // 2. The local pre-check. No network.
  if (token === '' || !signatureMatches(token)) {
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }

  // 3. The authority. Server-to-server, app-token authenticated, single use.
  const previewJwt = await redeem(token);

  if (previewJwt === null) {
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }

  // 4. draftMode() is ASYNC in Next 16. So is cookies(). Getting this wrong is
  //    the single most common stale-knowledge error in the ecosystem.
  (await draftMode()).enable();
  await setPreviewCookie(previewJwt);

  return NextResponse.redirect(new URL(nextPath, request.nextUrl.origin), {
    status: 307,
    headers: NO_STORE,
  });
}
