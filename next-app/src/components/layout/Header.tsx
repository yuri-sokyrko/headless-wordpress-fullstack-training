import Link from 'next/link';

import { PrimaryMenuDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { menuTag } from '@/lib/graphql/tags';
import { logout } from '@/actions/auth';
import type { Session } from '@/lib/auth/session';

import { MobileNav } from './MobileNav';
import { NavLink } from './NavLink';
import { toNavTree } from './nav';
import { Button } from '@/components/ui/button';

// NO 'use client' in this file. It fetches, so it must be a Server Component —
// and because it is, NavLink and MobileNav are the only client code in the shell.
export async function Header({
  locale,
  siteTitle,
  session,
}: {
  readonly locale: string;
  // Passed down from the layout, which already fetches `SiteChrome` (Lesson 10.5
  // Step 4). The header does not re-fetch it: one owner per document per render.
  readonly siteTitle: string;
  /**
   * A plain serialisable object: `{ isLoggedIn, displayName, roles }` and no
   * token. Header is a Server Component, so nothing here reaches the client
   * bundle — but the shape is deliberately safe to serialise anyway, because
   * MobileNav is a Client Component and props travel through the RSC payload.
   */
  readonly session: Session;
}) {
  const data = await fetchGraphQL(
    PrimaryMenuDocument,
    // `PrimaryMenu` takes no variables, so `undefined` is passed positionally to
    // reach the options argument — the same idiom Lesson 10.5 used for SiteChrome.
    undefined,
    // The cache policy from Lesson 10.3's table. A menu changes when an editor
    // changes it, which the `menu:primary` tag handles on demand in Module 18 —
    // the hour is the fallback for when the webhook does not fire.
    { revalidate: 3600, tags: [menuTag('primary')] }
  );

  const items = toNavTree(data.menuItems?.nodes ?? [], locale);

  return (
    <header className="border-border bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center px-4">
        <Link
          href={`/${locale}`}
          className="focus-visible:ring-ring font-semibold tracking-tight focus-visible:ring-2 focus-visible:outline-none"
        >
          {siteTitle}
        </Link>

        {/* A <ul> because a nav IS a list of destinations, and a screen reader
            announcing "list, 5 items" is genuinely useful. Lesson 09.4's
            hard-coded version had the same shape; only the source changed. */}
        <nav aria-label="Primary" className="hidden md:ml-auto md:block">
          <ul className="flex items-center gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-4">
          <span className="text-muted-foreground mr-4 hidden md:block">|</span>
          {session.isLoggedIn ? (
            <>
              <span className="text-muted-foreground hidden text-sm sm:inline">
                {session.displayName}
              </span>
              {/* A plain form posting to a Server Action. No 'use client', no
                  onClick, no fetch — it works with JavaScript disabled, and
                  there is nothing here that COULD read an httpOnly cookie. */}
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

        <div className="ml-auto md:hidden">
          <MobileNav items={items} />
        </div>
      </div>
    </header>
  );
}
