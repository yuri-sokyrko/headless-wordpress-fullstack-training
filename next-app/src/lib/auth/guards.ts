// UX REDIRECTS. NOT security boundaries.
//
// If this file were deleted, the worst outcome is an ugly empty account page:
// the mutations behind these routes still refuse, in PHP, because
// create_incidents is checked where the write happens (Lesson 06.2 §2) and the
// map_meta_cap filter denies it for an unverified reporter (Lesson 15.3 §4).
// Read that sentence again before you are tempted to put a real check here.
import 'server-only';

import { redirect } from 'next/navigation';

import { getSession, type Session } from './session';

/** The narrowed member, so a caller gets `displayName` without re-checking. */
type LoggedIn = Extract<Session, { readonly isLoggedIn: true }>;

/**
 * Render, or send the browser to the login page with a way back.
 *
 * `nextPath` comes from the CALLING PAGE — a literal like `/en/account` — and
 * never from the request, so it needs no open-redirect check here. The one that
 * DOES arrive from a query string is handled by `safeNextPath()` in
 * src/actions/auth.ts and in the refresh route.
 *
 * The target shape `/{locale}/login?next={pathname}` is frozen: Module 16's
 * Starting State asserts `307 http://localhost:3000/en/login?next=/en/account`
 * exactly, unescaped. So this is a template string, not URLSearchParams, which
 * would percent-encode the slashes.
 */
export async function requireSession(locale: string, nextPath: string): Promise<LoggedIn> {
  const session = await getSession();

  if (!session.isLoggedIn) {
    // redirect() throws NEXT_REDIRECT and is typed `never`, so TypeScript knows
    // the narrowed return below is reachable only for a real session.
    redirect(`/${locale}/login?next=${nextPath}`);
  }

  return session;
}

/**
 * An ADVISORY role check, for choosing which page to render. Read the failure
 * mode below before using it anywhere that matters.
 *
 * WPGraphQL gates `User.roles` behind `list_users` (Lesson 15.2 §1), so an
 * `incident_reporter` asking for its OWN roles can legitimately get an empty
 * array. This function therefore FAILS OPEN on empty roles: it renders the page
 * and lets WordPress refuse the write.
 *
 * That asymmetry is the whole lesson. A SECURITY check that cannot see its data
 * must fail closed. An ADVISORY check that cannot see its data must fail open,
 * because failing closed would hide a page from a user WordPress would have
 * allowed — and the mutation behind the page is guarded either way.
 */
export async function requireCapability(
  locale: string,
  nextPath: string,
  role: string
): Promise<LoggedIn> {
  const session = await requireSession(locale, nextPath);

  if (session.roles.length === 0) {
    // We could not see the roles. Not the same as "does not have the role".
    console.warn(`[btt] requireCapability(${role}): roles unavailable, rendering anyway`);

    return session;
  }

  if (!session.roles.includes(role)) {
    redirect(`/${locale}/account/?denied=${role}`);
  }

  return session;
}
