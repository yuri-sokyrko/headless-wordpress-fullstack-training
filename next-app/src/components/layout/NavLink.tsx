'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

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
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} aria-current={isActive ? 'page' : undefined}>
      {children}
    </Link>
  );
}
