'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A <Link> that knows whether it points at the current page.
 *
 * This file exists because `usePathname` is a hook: the layout that renders the nav
 * stays a Server Component, and only this component crosses into the browser.
 * Module 11's Header takes this over — the hook call moves, the pattern does not.
 */
export function NavLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  // `startsWith(href + '/')` so /en/incidents/dns marks "Incidents" active too.
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      // The accessibility half of "active". A colour change announces nothing;
      // aria-current="page" is what a screen reader reports. Lesson 11.4 audits
      // every aria-* in the codebase and this one earns its place.
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'hover:text-foreground focus-visible:ring-ring rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none',
        isActive ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      {children}
    </Link>
  );
}
