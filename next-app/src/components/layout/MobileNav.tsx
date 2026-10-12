'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { NavItem } from './nav';

export function MobileNav({ items }: { readonly items: readonly NavItem[] }) {
  const [open, setOpen] = useState(false);

  {
    /* asChild so this renders ONE <button>, not a button inside a button. */
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon">
          <Menu aria-hidden="true" />
          {/* An icon-only button with no accessible name announces as "button".
            Lesson 11.4 turns this span into <VisuallyHidden>; `sr-only` is the
            same clip-rect rule. */}
          <span className="sr-only">Open main menu</span>
        </Button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          {/* Radix requires an accessible title on dialog content and warns in the
              console without one. Do not "fix" that warning by deleting the check. */}
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>

        <nav aria-label="Mobile" className="mt-4 px-2">
          <ul className="fkex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  // Key Concept 6: the layout persists, so the drawer would stay
                  // open across the navigation unless we close it here.
                  onClick={() => setOpen(false)}
                  {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="hover:bg-accent focus-visible:ring-ring block rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  {item.label}
                </Link>

                {item.children.length > 0 ? (
                  // A nested <ul> INSIDE the parent <li> — that is what makes it a
                  // sub-list rather than a sibling list. The same nesting a
                  // Walker_Nav_Menu emitted, without the walker.
                  <ul className="border-border ml-3 flex flex-col border-l pl-2">
                    {item.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={child.href}
                          onClick={() => setOpen(false)}
                          {...(child.external
                            ? { target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                          className="text-muted-foreground hover:bg-accent focus-visible:ring-ring block rounded-md px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
