import { NextResponse, type NextRequest } from 'next/server';

// From jwt.ts, NOT from session.ts: this file cannot import a module carrying
// `import 'server-only'`, because proxy is not a react-server context.
// Lesson 15.4 §6 and Lesson 15.5 §3.
import { AT_COOKIE, secondsUntilExpiry } from '@/lib/auth/jwt';

// One locale today (Lesson 09.1 §6). Module 20 adds 'uk' and 'de' here.
const LOCALES: readonly string[] = ['en'];
const DEFAULT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en';

/** Prefixes BELOW the locale segment that require a session. A UX gate only. */
const GUARDED: readonly string[] = ['/account', '/incidents/submit'];

/** Hand off to /api/auth/refresh with fewer than this many seconds left. */
const REFRESH_WINDOW_SECONDS = 60;

function isGuarded(pathname: string, locale: string): boolean {
  const rest = pathname.slice(locale.length + 1);

  return GUARDED.some((prefix) => rest === prefix || rest.startsWith(`${prefix}/`));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split('/')[1] ?? '';

  // ── 1. LOCALE NORMALISATION — unchanged from Lesson 09.5 ──────────
  if (!LOCALES.includes(firstSegment)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;

    return NextResponse.redirect(url);
  }

  const token = request.cookies.get(AT_COOKIE)?.value ?? '';

  // ── 2. NEAR-EXPIRY HAND-OFF ───────────────────────────────────────
  // On EVERY matched path, not only guarded ones, so a session renews while the
  // user reads public pages. exp ARITHMETIC ONLY — no signature check, because
  // Next holds no signing key. And no WordPress round trip: this is string
  // maths, which is what the module README means by "without a round trip per
  // request".
  if (token !== '' && secondsUntilExpiry(token) <= REFRESH_WINDOW_SECONDS) {
    const handoff = request.nextUrl.clone();
    handoff.pathname = '/api/auth/refresh';
    // Assign `search` rather than using searchParams.set(): URLSearchParams
    // form-urlencodes, which turns `/` into `%2F`.
    handoff.search = `?next=${pathname}`;

    return NextResponse.redirect(handoff);
  }

  // ── 3. THE GATE ───────────────────────────────────────────────────
  if (!isGuarded(pathname, firstSegment)) {
    return NextResponse.next();
  }

  if (token === '') {
    const login = request.nextUrl.clone();
    login.pathname = `/${firstSegment}/login`;
    // FROZEN SHAPE. Module 16's Starting State asserts
    // `307 http://localhost:3000/en/login?next=/en/account` — unescaped.
    login.search = `?next=${pathname}`;

    return NextResponse.redirect(login);
  }

  // ── 4. NO SHARED CACHE FOR AN AUTHENTICATED RESPONSE ──────────────
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');

  return response;
}

// UNCHANGED from Lesson 09.5, and that is the finding rather than an oversight.
// `/en/account` already reaches proxy: it is a page path with no dot and
// no `api` or `_next` prefix. Adding '/api/auth/:path*' would run proxy on
// the endpoint step 2 redirects TO, and the redirect would loop. Removing the
// `api` exclusion would send /api/health to /en/api/health. Lesson 15.5 §4.
export const config = {
  matcher: ['/((?!api|_next|favicon\\.ico|.*\\..*).*)'],
};
