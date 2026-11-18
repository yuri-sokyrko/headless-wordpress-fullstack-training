'use client';

// The only personalised region of the page, and now the only part of it that
// is not static. Fetches on mount, reserves its own width, and NEVER logs:
// Lesson 12.3's smoke suite fails a spec on any console.error, on all nine
// routes, and a header that logs when the network hiccups would fail all nine.
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { logout } from '@/actions/auth';
import { Button } from '@/components/ui/button';

/**
 * Declared here rather than imported from `@/lib/auth/session`.
 *
 * That module carries `import 'server-only'`, and while `import type` is erased
 * by `verbatimModuleSyntax` (Lesson 07.3), relying on erasure at a client
 * boundary means one dropped `type` keyword ships a server-only module to the
 * browser. The route handler above is the contract; this is its client half,
 * and it is deliberately narrower — no `roles`, and no token, because there is
 * no token in `Session` to begin with.
 */
type SessionView =
  { readonly isLoggedIn: true; readonly displayName: string } | { readonly isLoggedIn: false };

const ANONYMOUS: SessionView = { isLoggedIn: false };

/** `unknown` in, a usable union out. The response is JSON from our own server, and it is still parsed defensively. */
function asSessionView(value: unknown): SessionView {
  if (typeof value !== 'object' || value === null) {
    return ANONYMOUS;
  }

  const record = value as Record<string, unknown>;

  if (record.isLoggedIn !== true || typeof record.displayName !== 'string') {
    return ANONYMOUS;
  }

  return { isLoggedIn: true, displayName: record.displayName };
}

export function SessionMenu({ locale }: { readonly locale: string }) {
  // `null` means "not answered yet" and is a THIRD state, distinct from
  // logged out. Collapsing them shows a Sign in link to a signed-in user on
  // every page load, which is worse than showing nothing for 80 ms.
  const [session, setSession] = useState<SessionView | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/auth/session', { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then((payload) => setSession(asSessionView(payload)))
      .catch(() => {
        // Deliberately silent. An aborted fetch during navigation is normal,
        // and a failed one degrades to the anonymous affordance — which is the
        // safe direction, because the server is still the authority on every
        // guarded route.
        if (!controller.signal.aborted) {
          setSession(ANONYMOUS);
        }
      });

    return () => controller.abort();
  }, []);

  return (
    // min-w RESERVES the space. Without it the header reflows when the fetch
    // lands, which Module 21 measures as CLS and Module 22 audits.
    <div className="ml-4 flex min-w-36 items-center justify-end gap-2">
      {session === null ? (
        <span aria-hidden="true" className="h-8 w-full" />
      ) : session.isLoggedIn ? (
        <>
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {session.displayName}
          </span>
          {/* Still a plain <form> posting to the Server Action from Lesson
              15.4. A Server Action works from a client component and from a
              statically rendered page — which is the property that makes this
              whole extraction possible. */}
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </>
      ) : (
        <Link href={`/${locale}/login`} className="text-sm underline">
          Sign in
        </Link>
      )}
    </div>
  );
}
