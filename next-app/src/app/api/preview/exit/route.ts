// The way out. Idempotent, and it clears BOTH mechanisms: Next's draft-mode
// cookies and our own preview JWT.

import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { clearPreviewCookie } from '@/lib/auth/cookies';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** One locale today. Module 20 replaces the test with the real list. */
function safeLocale(raw: string | null): string {
  return raw !== null && /^[a-z]{2}$/.test(raw) ? raw : 'en';
}

export async function GET(request: NextRequest): Promise<Response> {
  const mode = await draftMode();

  // `draftMode().isEnabled` IS the authentication here: only a browser already
  // holding Next's bypass cookie can be in draft mode, and turning your own
  // preview off needs no further proof. Disabling something already disabled is
  // a no-op, so the endpoint is safe to hit from anywhere.
  if (mode.isEnabled) {
    mode.disable();
  }

  // Cleared unconditionally, even when draft mode was already off. The two
  // cookies have different lifetimes (Lesson 17.2 §2), so "off" and "no JWT" are
  // not the same state and both must end.
  await clearPreviewCookie();

  const locale = safeLocale(request.nextUrl.searchParams.get('locale'));

  // 307 to the locale home EITHER WAY. There is no failure branch to distinguish.
  return NextResponse.redirect(new URL(`/${locale}`, request.nextUrl.origin), {
    status: 307,
    headers: NO_STORE,
  });
}
