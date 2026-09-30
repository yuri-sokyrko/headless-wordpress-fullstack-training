import { NextResponse, type NextRequest } from 'next/server';

// One locale today (Lesson 09.1 Key Concept 6). Module 20 adds 'uk' and 'de' here, plus
// Accept-Language negotiation and the NEXT_LOCALE cookie.
const LOCALES: readonly string[] = ['en'];

// One of the four legitimately public variables (appendix 04 §3.2). Publishing it is
// harmless: it is a two-letter language code that is already in the URL.
const DEFAULT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // '/en/incidents'.split('/') -> ['', 'en', 'incidents']. noUncheckedIndexedAccess
  // from Lesson 07.3 is why the ?? '' is not optional.
  const firstSegment = pathname.split('/')[1] ?? '';

  // Already localised — including RSC payload requests for client-side navigations,
  // which arrive on these same URLs with a query string.
  if (LOCALES.includes(firstSegment)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;

  // No status argument: redirect() defaults to 307, which preserves the method and the
  // body. Module 16 POSTs Server Actions through paths this proxy may touch, and a
  // 302 that turns a POST into a GET loses the submission silently. Key Concept 8.
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything EXCEPT:
  //   api          — /api/health must answer, unprefixed, to a monitor
  //   _next        — Next's own JS, CSS and image chunks
  //   favicon.ico  — named explicitly because it is requested constantly
  //   .*\..*       — anything with a dot: robots.txt, sitemap.xml, .png, .svg
  // This must be a static literal. Next reads it at build time and cannot evaluate
  // a matcher you computed at runtime.
  matcher: ['/((?!api|_next|favicon\\.ico|.*\\..*).*)'],
};
