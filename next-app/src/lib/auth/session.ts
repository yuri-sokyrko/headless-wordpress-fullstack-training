// Reads the access cookie, presents it to WordPress, and returns a plain
// serialisable object. There is NO session React context anywhere in this app
// (Lesson 15.4 §8) — client components receive this shape as a prop.
import 'server-only';

import { cache } from 'react';

import { ViewerDocument } from '@/gql/graphql';
import { fetchGraphQLAuthed } from '@/lib/graphql/client';

import { readAccessToken } from './cookies';
import { decodeExpiry } from './jwt';

// Re-exported so `@/lib/auth/session` exposes the surface Lesson 15.5's
// proxy and Module 16 were promised. The implementation is in jwt.ts,
// which has no server-only guard and is therefore importable from proxy.
export { decodeExpiry };

/**
 * A discriminated union, so `session.displayName` does not type-check until
 * `session.isLoggedIn` has been narrowed. The logged-out member carries NO
 * fields at all — there is no `displayName: ''` to render by accident.
 */
export type Session =
  | { readonly isLoggedIn: true; readonly displayName: string; readonly roles: readonly string[] }
  | { readonly isLoggedIn: false };

const ANONYMOUS: Session = { isLoggedIn: false };

/**
 * Memoized per request pass with React's cache().
 *
 * Request memoization (Lesson 10.3) applies to `fetch`, and GraphQL calls are
 * POSTs, so Next does NOT dedupe them for us. Without this, the layout, the
 * guard and the account page would each cost a WordPress round trip on the same
 * render. cache() keys on the argument, so a token change is a new entry.
 */
const loadViewer = cache(async (jwt: string) =>
  fetchGraphQLAuthed(ViewerDocument, {}, { kind: 'user', jwt })
);

/**
 * Who is this request from?
 *
 * Every branch that is not a confirmed WordPress `viewer` returns ANONYMOUS.
 * A missing cookie, an expired token, a malformed token, a revoked user and an
 * unreachable WordPress all produce the same answer, and that is correct: the
 * only safe interpretation of "I could not confirm who you are" is "nobody".
 */
export async function getSession(): Promise<Session> {
  const token = await readAccessToken();

  if (token === null) {
    return ANONYMOUS;
  }

  try {
    const data = await loadViewer(token);
    const viewer = data.viewer;

    if (viewer === null || viewer === undefined) {
      // WordPress verified the signature and the expiry and said "nobody".
      // That null IS the authentication check (Lesson 15.2 §1).
      return ANONYMOUS;
    }

    // WPGraphQL gates User.roles behind list_users, so a reporter asking for
    // its OWN roles can legitimately get an empty connection. Display data.
    // Nothing in this app branches on it — Lesson 15.4 §8.
    const roles = (viewer.roles?.nodes ?? [])
      .map((node) => node?.name)
      .filter((name): name is string => typeof name === 'string' && name !== '');

    return {
      isLoggedIn: true,
      displayName: viewer.name ?? 'Signed in',
      roles,
    };
  } catch (error) {
    // fetchGraphQLAuthed throws on a transport failure and on a GraphQL
    // `errors` array — which is what an expired token produces. Detail to the
    // log, nothing to the caller: the policy Lesson 10.4 wrote into
    // docs/api-contract.md.
    console.error('[btt] getSession: could not confirm the session', error);
  }

  return ANONYMOUS;
}
