---
title: 'Building the App Shell'
module: 11
lesson: 3
teaches: [app-shell, layout-composition, client-islands, wp-menus-in-graphql, active-link-state]
produces: ['next-app/src/components/layout/Header.tsx', 'next-app/src/components/layout/Footer.tsx', 'next-app/src/components/layout/MobileNav.tsx', 'next-app/src/graphql/menu.graphql', 'next-app/src/components/layout/nav.ts']
requires: [11.2, 10.5]
---

# Lesson 11.3 — Building the App Shell

## Quick Overview

The nav has been a hard-coded `<Link>` list inside `layout.tsx` since Lesson 09.4. This lesson
extracts it into a real app shell: a `Header` that fetches the primary menu from WordPress, a
`Footer` driven by the `siteSettings` field group, and a `MobileNav` drawer built on the
`Dialog` primitive from Lesson 11.2. Editors get their menu back — add an item in
**Appearance → Menus** and it appears on the site — which is the first moment in the course
where the headless front end stops being less editable than the Classic theme it replaced.

The interesting engineering is the boundary. `Header` is a Server Component: it fetches the
menu, so it must be. `MobileNav` holds open/closed state, so it must be a Client Component. The
correct shape is a server `Header` that renders a client `MobileNav` and **passes the fetched
menu items in as props** — not a client `Header` that fetches. Getting that inversion right
here is what keeps the layout out of the client bundle, and it is the pattern every remaining
module reuses. Navigation lives in core WordPress menus, queried with
`menuItems(where: { location: PRIMARY })`, deliberately not in the `siteSettings` field group —
see [the content model contract](../appendix/03-content-model-reference.md#45-site-settings-options-page).

By the end of this lesson you will have:

- `next-app/src/graphql/menu.graphql` — the primary menu query, cache-tagged with the Lesson 10.3 builders
- `next-app/src/components/layout/Header.tsx` — a Server Component rendering the WordPress menu
- `next-app/src/components/layout/Footer.tsx` — driven by `siteSettings`, fetched once in the layout and memoized
- `next-app/src/components/layout/MobileNav.tsx` — a `'use client'` drawer receiving menu items as props
- Active-link styling that works on every route, with the `usePathname()` call isolated to the smallest possible component

## Classic WP Analogy

You are rebuilding `header.php` and `footer.php`, with the same ingredients:

| Classic WordPress | This app shell |
|---|---|
| `header.php` + `get_header()` | `Header.tsx` rendered by `layout.tsx` |
| `wp_nav_menu(['theme_location' => 'primary'])` | `menuItems(where: { location: PRIMARY })` |
| `register_nav_menus()` in `functions.php` | the same call, still in the theme (Lesson 02.4) — locations are theme-scoped, so this is the one thing the plugin cannot take over |
| `Walker_Nav_Menu` subclass to change markup | a `.map()` over the items |
| `current-menu-item` class added by WordPress | `usePathname()` compared to the item URL |
| `get_option('btt_footer_blurb')` | the `siteSettings` SCF options page |
| A hamburger toggled by a jQuery click handler | `MobileNav` state and the Radix `Dialog` |

The best part of this comparison is the `Walker`. If you have ever written a
`Walker_Nav_Menu` subclass to add one utility class to one `<li>`, you know it means
implementing four methods with reference parameters and a depth counter, all to influence
markup you do not control. Here the menu arrives as an array and you write the markup. This
is the single clearest "the headless version is simply better" moment in Phase 2, and it is
worth noticing because most of the others involve trade-offs.

The analogy breaks on **persistence**, and the break is a feature with a sharp edge.
`get_header()` re-runs on every request, so the header is stateless by construction — the
hamburger is closed on every page load because there is no other possibility. A Next layout
persists across client-side navigation: the `Header` component instance survives, and so does
`MobileNav`'s state. Tap a link in the open drawer and, unless you handle it, you navigate to
a new page with the drawer still open on top of it. That is not a bug in Next, it is the
behaviour that makes the app feel like an app, and it means navigation-related UI state is
now yours to manage. Lesson 11.4 makes it worse before making it better, because the same
persistence is why focus does not reset on navigation the way a browser resets it on a full
page load.

The second break is a cost: the menu is now a network call in the render path of every page.
In Classic WordPress `wp_nav_menu()` is a couple of cached queries in the same process. Here
it is HTTP to another container. Request memoization from Lesson 10.3 means it happens once per
render rather than once per component, and a long `revalidate` with a `menu` cache tag means it
usually does not happen at all — but the layout is now coupled to WordPress being reachable,
and Lesson 10.4's boundaries are what stop that turning into a blank page.

---

## Key Concepts

### 1. What belongs in a layout, and what belongs in a page

The App Router gives you one nesting rule and the whole shell follows from it: a `layout.tsx`
wraps every `page.tsx` beneath it, and it **does not re-render on navigation between its
children**. That is the difference from `get_header()`, and it decides what may live there.

| Put it in the layout | Put it in the page |
|---|---|
| Site chrome that is identical on every route | anything the route's own data decides |
| The primary menu | the page's `<h1>` |
| The footer | pagination, filters, breadcrumbs |
| `<html lang>`, `<body>`, the stylesheet import | `generateMetadata`'s per-route output (Module 19) |
| State that must survive navigation | state that must reset on navigation |

The last row is the trap and it cuts both ways. An open mobile drawer in the layout survives a
navigation, which is why Key Concept 6 exists. A search box in the layout would keep its text
across pages, which sounds like a feature until a user navigates from `/incidents` to `/blog`
and the box still says `dns`.

```
src/app/[locale]/layout.tsx        renders once, persists across navigation
   ├── <Header locale>             ← Server Component, fetches the menu
   │     ├── <NavLink> × n         ← 'use client', reads usePathname()
   │     └── <MobileNav items>     ← 'use client', owns open/closed
   ├── {children}                  ← swapped out on every navigation
   └── <Footer>                    ← Server Component, fetches siteSettings
```

### 2. Navigation comes from core WordPress menus, not from an SCF field

This is a modelling decision recorded in the contract, and it is worth understanding rather
than accepting. `Site Settings` in
[appendix 03 §4.5](../appendix/03-content-model-reference.md#45-site-settings-options-page)
holds the tagline, the footer blurb, the CTA labels and the social links — and deliberately
**no navigation**. The nav lives in core menus and is read with
`menuItems(where: { location: PRIMARY })`.

| | Core WordPress menus | An SCF repeater called `nav_items` |
|---|---|---|
| Editor UI | Appearance → Menus, drag to reorder and nest | a flat repeater, reorder by dragging rows |
| Nesting | native, any depth | a `parent` select you build, or none |
| Links to content | pick a post; the URI follows a slug change | a URL string that rots when the slug changes |
| Multiple locations | native (`primary`, `footer`, …) | one repeater per location |
| Multilingual | Polylang translates menus (Module 20) | you build it |
| Verdict | **✅ use the thing WordPress already does well** | ❌ reinventing it badly |

Two preconditions, both silent when missing, both named in Lesson 05.4 §7:
`MenuLocationEnum`'s `PRIMARY` value only exists because `register_nav_menus()` ran on the
WordPress side, and an unassigned menu returns an **empty connection with no error**. Step 8 of
the Task checks both before blaming your React.

> ⚠️ **An unassigned menu is the worst failure in this lesson, because it is not a failure.**
> `menuItems(where: { location: PRIMARY })` on a location with no menu assigned returns
> `{ "data": { "menuItems": { "nodes": [] } } }` — HTTP 200, no `errors` array, a
> perfectly-typed empty list. Your header renders, correctly, with nothing in it. Every
> instinct says the bug is in `toNavTree` or in the Header's JSX, and forty minutes later it
> is in wp-admin. Check the WordPress side first, with the two commands in Step 8.

### 3. `menuItems` is flat, and building the tree is the whole `Walker_Nav_Menu` story

`wp_nav_menu()` handed you markup and a `Walker_Nav_Menu` you could subclass when the markup
was wrong. `menuItems` hands you records with `parentId` and `order`, and you write the markup.
Comparing the two honestly means comparing the work, not the concept:

| | `Walker_Nav_Menu` subclass | `toNavTree()` |
|---|---|---|
| Methods to implement | `start_lvl`, `end_lvl`, `start_el`, `end_el` | one function |
| Parameters | `&$output` by reference, `$depth`, `$args`, `$id` | a list and a locale |
| Depth handling | a counter you maintain, and indentation you emit | recursion, or one `Map` pass |
| Testable | in principle, with a WordPress bootstrap | a pure function, unit-tested in Module 12 |
| To change one class name | subclass, register, re-read the parent implementation | edit the JSX |

The flat-to-nested transform is a two-pass `Map` and it is genuinely boring:

```
FLAT (what WordPress returns)              TREE (what you render)
id=9   parentId=null  order=1  Incidents   Incidents
id=12  parentId=null  order=2  Blog        Blog
id=15  parentId=12    order=1  Archive       └─ Archive
id=18  parentId=null  order=3  HOBT        HOBT

pass 1: every item into a Map, keyed by id, with an empty children array
pass 2: for each item, push it into its parent's children — or into roots
then:   sort every level by `order`
```

The one thing to get right is that `order` is per level, not global, so you sort each `children`
array rather than the flat list.

### 4. The boundary inversion: a server component that fetches, a client component that receives

This is the shape every remaining module reuses, so it is worth drawing both versions.

```
✅ CORRECT — the fetch stays on the server
   Header  (Server Component)
     │  await fetchGraphQL(PrimaryMenuDocument, …)     ← runs on the server
     │  toNavTree(...)                                  ← runs on the server
     ├──▶ <NavLink href label>        'use client'  ~1 kB of component code
     └──▶ <MobileNav items={items}>   'use client'  items arrive as SERIALISED PROPS

❌ WRONG — a client component that fetches
   Header  'use client'
     │  useEffect(() => fetch('/api/menu'))            ← now you need that route
     │                                                    and it is public
     ├──▶ the GraphQL document is in the browser bundle
     ├──▶ the menu renders after hydration: a visible pop-in
     └──▶ every child is a Client Component, because the parent is
```

Three consequences of getting it backwards, in ascending order of how long they take to notice:

1. **Bundle.** `'use client'` on `Header` makes everything it renders client-side too. The
   nav markup, the tree builder and the GraphQL document all ship.
2. **A route you did not want.** A browser cannot reach WordPress directly — appendix 03 §8
   records that WPGraphQL CORS is deliberately not installed — so a client fetch needs a Next
   route handler in front of it, which is a new public endpoint to secure for no reason.
3. **Layout shift.** Server-rendered nav is in the HTML. Client-fetched nav appears after
   hydration, moving everything below it, and Module 21 measures that as CLS.

The rule, stated as a rule: **fetch as high as possible, make components client as low as
possible.** `MobileNav` needs `useState`, so it is a Client Component — and it receives the
menu it renders, rather than going and getting it.

### 5. `usePathname()` belongs in the smallest component that needs it

Active-link styling needs the current path, `usePathname()` is a client hook, and a hook forces
`'use client'` on the file that calls it. If you call it in `Header`, the whole header is a
Client Component and Key Concept 4's ✅ becomes its ❌.

So the hook goes in `NavLink` — a file whose entire job is one link and its active state.
Lesson 09.4 already created it for exactly this reason and said the hook call would move to
Module 11's `Header` while the pattern stayed; this lesson only gives it the classes. The
reason it is its own file is a one-line difference in the bundle report: a `'use client'`
boundary is drawn around the *file*, so the smaller the file, the smaller the boundary.

| Where `usePathname()` lives | What becomes client-side |
|---|---|
| `layout.tsx` | the entire application shell |
| `Header.tsx` | the header, its nav, its markup, and the tree builder it imports |
| **`NavLink.tsx`** | **one link component** |

`NavLink` also owns the accessibility half of "active": `aria-current="page"`, which is what
WordPress's `current-menu-item` class never gave you. A colour change alone announces nothing.

### 6. Layouts persist, and `get_header()` does not — so drawer state is now yours

In a PHP theme the hamburger is closed on every page load because there is no other
possibility: the document is new, the DOM is new, no state survived. `get_header()` cannot
carry state across a navigation even if you wanted it to.

A Next layout persists. Tap a link inside an open `MobileNav` and, unless you handle it, the
navigation completes and the drawer is still open on top of the new page:

```
CLASSIC THEME                          THIS APP
tap link                               tap link
  ▼                                      ▼
full document load                     client-side navigation
  ▼                                      ▼
new DOM, drawer gone                   same DOM, SAME MobileNav instance,
  (for free)                           `open` still true — drawer still open
```

The fix is one line — close the drawer in the link's `onClick` — and the point is that you had
to know to write it. This is not a Next bug; it is the same persistence that makes the app feel
like an app. It also has a sibling that Lesson 11.4 spends a whole subsection on: focus does
not reset on navigation either, for exactly the same reason.

> **A closing detail worth stealing:** closing on `onClick` misses the browser back button,
> which changes the route without clicking anything. The robust version watches `usePathname()`
> and closes on change. This lesson uses `onClick` because it is the honest minimum and it
> keeps `MobileNav` free of effects; Lesson 11.4's discussion of route changes is where the
> effect-based version belongs.

### 7. The `uri` WordPress returns is not the path Next needs

WordPress gives a menu item a `uri` like `/about/` or `/incidents/dns-ate-the-deploy/`. Next
needs `/en/about` and `/en/incidents/dns-ate-the-deploy`. Two differences, both mechanical, and
one of them is the bill for a decision made in Lesson 09.1:

| WordPress `uri` | Next route | Transform |
|---|---|---|
| `/about/` | `/en/about` | prepend the locale, drop the trailing slash |
| `/` | `/en` | the home case, which needs its own branch |
| `/incidents/dns/` | `/en/incidents/dns` | same as the first |
| `https://status.example.com` | unchanged | absolute URL: leave it alone, it is external |

**This is where the `[locale]` segment costs something.** It is the cheapest insurance in the
course — Module 20 adds `uk` and `de` without touching a route file — and the price is that
every WordPress-supplied path has to pass through a mapper before it is a link. There is no way
to have the first without the second, and a mapper you can unit-test is a much better place for
the rule than thirty template strings.

One honest caveat: this mapper assumes every WordPress URI corresponds to a Next route. A menu
item pointing at `/category/outages/` will produce `/en/category/outages`, which nothing serves,
and the learner gets a 404 rather than an error. That is the right failure — Lesson 10.4's
`not-found.tsx` renders it — and the mapper is the one place to add an exception if you ever
need one.

### 8. `SiteChrome` split into two documents, and what the menu now costs

Lesson 05.4's scratch `SiteChrome` selected `generalSettings`, `siteSettings` **and**
`menuItems` in one request. Lesson 10.5 split it, keeping `SiteChrome` for settings only; this
lesson writes the other half, `PrimaryMenu`, into `src/graphql/menu.graphql`.

The reason is cache granularity, and it only pays off in Module 18:

| | One combined document | Two documents |
|---|---|---|
| Cache entries | one | two |
| Tags | one, covering both | `site-settings` and `menu:primary` |
| An editor reorders the menu | the footer blurb's cache entry dies too | only the menu's |
| An editor edits the footer blurb | the menu's cache entry dies too | only the footer's |
| Runtime cost of the split | — | **none** — see below |

The split costs nothing at runtime because of request memoization (Lesson 10.3): two `fetch`
calls with identical inputs inside one render pass hit WordPress once. So `Header` asking for
the menu and `Footer` asking for site settings is two WordPress requests per *uncached* render,
which is what it was before the split, and zero on a cached one.

The real cost is elsewhere, and it is structural: **the menu is now a network call in the render
path of every page.** `wp_nav_menu()` was a couple of queries inside the same PHP process.
This is HTTP to another container. The mitigations are all already in place — a long
`revalidate`, the `menu:primary` tag so Module 18 can invalidate precisely, and Lesson 10.4's
error boundary so an unreachable WordPress renders a visible failure instead of a blank page —
but the layout is now coupled to WordPress being reachable in a way a monolith never was. Name
that in a code review before someone else does.

---

## Task

### Step 1: Write the primary menu document and regenerate

```graphql
# next-app/src/graphql/menu.graphql
# The other half of Lesson 05.4's SiteChrome query. Lesson 10.5 kept
# generalSettings + siteSettings in siteSettings.graphql under the `site-settings`
# tag; the menu lives here under `menu:primary` so Module 18 can invalidate a menu
# reorder without expiring the footer.
#
# `first: 50` is a deliberate ceiling, not pagination. A primary menu with more
# than fifty items is a content problem, and an unbounded connection in a layout
# is how one bad menu takes down every page.
query PrimaryMenu {
  menuItems(where: { location: PRIMARY }, first: 50) {
    nodes {
      id
      parentId # null for a top-level item — you build the tree
      order # per level, not global
      label
      uri # WordPress's path: /about/ — Key Concept 7 maps it
      target # "_blank" or null
    }
  }
}
```

```bash
cd next-app
npm run codegen
# Expected: src/gql/ regenerated. `PrimaryMenuDocument`, `PrimaryMenuQuery` and
#           `PrimaryMenuQueryVariables` are now exported from src/gql/graphql.ts.
```

While you are here, fill in the row Lesson 10.3 left annotated "arrives in Lesson 11.3" in the
cache-policy table in `docs/api-contract.md`. `PrimaryMenu`, `revalidate: 3600`,
tag `menu:primary`, owner `layout/Header.tsx`. Do not add a second row — Module 18 reads that
table and one operation must appear once.

**Verify §1:**

- [ ] `grep -c 'PrimaryMenuDocument' src/gql/graphql.ts` returns `1` or more.
- [ ] If codegen fails on `MenuLocationEnum` having no `PRIMARY` value, stop: the WordPress side
      never called `register_nav_menus()`. Step 8 diagnoses it.

### Step 2: Write the mapper and the tree builder

Two pure functions and one type. Both are unit-tested in Module 12, which is why they are in
their own file rather than inside `Header`.

```ts
// next-app/src/components/layout/nav.ts
export type NavItem = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
  readonly children: readonly NavItem[];
};

// Typed STRUCTURALLY rather than by importing a generated type. That keeps these
// two functions testable in Module 12 without a codegen run, and it means a schema
// refresh that adds a field to MenuItem does not touch this file.
type RawMenuItem = {
  readonly id: string;
  readonly parentId?: string | null;
  readonly order?: number | null;
  readonly label?: string | null;
  readonly uri?: string | null;
  readonly target?: string | null;
};

/**
 * WordPress `uri` → Next path. Key Concept 7.
 *   '/about/'  + 'en' → '/en/about'
 *   '/'        + 'en' → '/en'
 *   'https://…'       → unchanged (a custom link pointing off-site)
 */
export function toLocalePath(uri: string | null | undefined, locale: string): string {
  if (uri === null || uri === undefined || uri === '') return `/${locale}`;
  if (/^https?:\/\//i.test(uri)) return uri;
  const trimmed = uri.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? `/${locale}` : `/${locale}/${trimmed}`;
}

/** Flat menuItems → a sorted tree. Key Concept 3. */
export function toNavTree(items: readonly RawMenuItem[], locale: string): readonly NavItem[] {
  // A mutable twin of NavItem, plus the sort key. `Node[]` is assignable to
  // `readonly NavItem[]` on the way out, so the readonly contract survives.
  type Node = {
    id: string;
    label: string;
    href: string;
    external: boolean;
    children: Node[];
    order: number;
  };

  // Pass 1 — every item becomes a node, with an empty children array.
  const byId = new Map<string, Node>();
  for (const item of items) {
    const uri = item.uri ?? null;
    byId.set(item.id, {
      id: item.id,
      label: item.label ?? '',
      href: toLocalePath(uri, locale),
      // A custom link pointing off-site, or an item an editor set to open in a
      // new tab. Both need rel="noopener" on the anchor.
      external: item.target === '_blank' || (uri !== null && /^https?:\/\//i.test(uri)),
      children: [],
      order: item.order ?? 0,
    });
  }

  // Pass 2 — attach each node to its parent, or collect it as a root.
  const roots: Node[] = [];
  for (const item of items) {
    const node = byId.get(item.id);
    if (node === undefined) continue;
    const parent = item.parentId != null ? byId.get(item.parentId) : undefined;
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  // `order` is per level, so sort each level independently.
  const sortLevel = (level: Node[]): Node[] => {
    level.sort((a, b) => a.order - b.order);
    for (const node of level) sortLevel(node.children);
    return level;
  };

  return sortLevel(roots);
}
```

### Step 3: Style `NavLink` — the smallest possible client island

Lesson 09.4 wrote this file unstyled, with the `aria-current` already in place. It gains a
class string and nothing else: no new hook, no new prop, no change to its public surface.

```tsx
// next-app/src/components/layout/NavLink.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

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
        'rounded-md px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      {children}
    </Link>
  );
}
```

> **The path comment sits above `'use client'` on purpose.** A comment is not code, so the
> directive is still the first *statement* in the file, which is what React requires. Every
> `'use client'` file in this course is written this way so the destination is always the first
> thing you read.

### Step 4: Write `MobileNav` on the `Sheet` primitive

`Sheet` is `dialog.tsx`'s primitive with a slide-in position, so everything Radix gives a
dialog — focus trap, `Escape`, focus returned to the trigger, scroll lock, `aria-modal` — you
get here for free. What you own is the open/closed state and closing on navigation.

```tsx
// next-app/src/components/layout/MobileNav.tsx
'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { NavItem } from './nav';

export function MobileNav({ items }: { readonly items: readonly NavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {/* asChild so this renders ONE <button>, not a button inside a button. */}
        <Button variant="ghost" size="icon">
          <Menu aria-hidden="true" />
          {/* An icon-only button with no accessible name announces as "button".
              Lesson 11.4 turns this span into <VisuallyHidden>; `sr-only` is the
              same clip-rect rule. */}
          <span className="sr-only">Open main menu</span>
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-72">
        <SheetHeader>
          {/* Radix requires an accessible title on dialog content and warns in the
              console without one. Do not "fix" that warning by deleting the check. */}
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>

        {/* Two <nav> landmarks in one document need distinguishing names — the
            header's is "Primary". Lesson 11.4 Key Concept 2 covers why. */}
        <nav aria-label="Mobile" className="mt-4 px-2">
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  // Key Concept 6: the layout persists, so the drawer would stay
                  // open across the navigation unless we close it here.
                  onClick={() => setOpen(false)}
                  {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </Link>
                {item.children.length > 0 ? (
                  // A nested <ul> INSIDE the parent <li> — that is what makes it a
                  // sub-list rather than a sibling list. The same nesting a
                  // Walker_Nav_Menu emitted, without the walker.
                  <ul className="ml-3 flex flex-col border-l border-border pl-2">
                    {item.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={child.href}
                          onClick={() => setOpen(false)}
                          className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
```

### Step 5: Write `Header` as a Server Component

```tsx
// next-app/src/components/layout/Header.tsx
import Link from 'next/link';

import { PrimaryMenuDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { menuTag } from '@/lib/graphql/tags';

import { MobileNav } from './MobileNav';
import { NavLink } from './NavLink';
import { toNavTree } from './nav';

// NO 'use client' in this file. It fetches, so it must be a Server Component —
// and because it is, NavLink and MobileNav are the only client code in the shell.
export async function Header({
  locale,
  siteTitle,
}: {
  readonly locale: string;
  // Passed down from the layout, which already fetches `SiteChrome` (Lesson 10.5
  // Step 4). The header does not re-fetch it: one owner per document per render.
  readonly siteTitle: string;
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
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
        <Link
          href={`/${locale}`}
          className="font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        <div className="ml-auto md:hidden">
          <MobileNav items={items} />
        </div>
      </div>
    </header>
  );
}
```

**Verify §5:**

- [ ] `grep -c "'use client'" src/components/layout/Header.tsx` returns `0`.
- [ ] The desktop nav and the drawer render **the same `items` array**. If they diverge, you
      have two sources of truth for the menu.

### Step 6: Write `Footer` from `siteSettings`

`Footer` fetches the same `SiteChrome` document the layout already fetched — deliberately, and
this is the concrete demonstration of request memoization from Lesson 10.3. Two `fetchGraphQL`
calls with identical inputs in one render pass produce **one** WordPress request, so a component
that needs site settings may simply ask for them rather than having them threaded down through
three levels of props. `Header`'s `siteTitle` prop is the other choice, kept for contrast: pass
it down when it is one string, fetch it again when it is a whole field group.

```tsx
// next-app/src/components/layout/Footer.tsx
import { SiteChromeDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { siteTag } from '@/lib/graphql/tags';

export async function Footer() {
  const data = await fetchGraphQL(
    SiteChromeDocument,
    {},
    { revalidate: 3600, tags: [siteTag()] }
  );

  const settings = data.siteSettings;
  // `social_links` is an SCF repeater, so every row AND every sub-field is
  // independently nullable — appendix 03 §4.5. An editor who adds a row and
  // saves before typing produces exactly this shape.
  const social = settings?.socialLinks ?? [];

  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">
        {settings?.footerBlurb != null && settings.footerBlurb !== '' ? (
          <p className="max-w-prose">{settings.footerBlurb}</p>
        ) : null}

        {social.length > 0 ? (
          <nav aria-label="Social" className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            {social.map((link) =>
              link?.url != null && link.url !== '' ? (
                <a
                  key={link.url}
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* Fall back to the URL rather than rendering an empty link,
                      which would be a control with no accessible name. */}
                  {link.network ?? link.url}
                </a>
              ) : null
            )}
          </nav>
        ) : null}

        <p className="mt-6">{data.generalSettings?.title ?? 'Blame The Tech'}</p>
      </div>
    </footer>
  );
}
```

### Step 7: Wire the shell into the layout and delete the inline nav

Lesson 09.4 left a hard-coded `<Link>` list in `layout.tsx`. Delete it — all of it — and render
the two components instead.

```tsx
// next-app/src/app/[locale]/layout.tsx
// DELETE the hard-coded <nav>, its <ul> of five <NavLink>s, and the NavLink
// import, all from Lesson 09.4. `Header` owns the nav now, and the debt named
// in the Module 09 README is paid.
//
// KEEP the SiteChrome fetch Lesson 10.5 added here. The layout stays the one
// owner of that document and hands the title down as a prop.
import type { ReactNode } from 'react';

import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { SiteChromeDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { siteTag } from '@/lib/graphql/tags';

import './globals.css';

export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  // Next 16: params is a Promise and must be awaited.
  const { locale } = await params;

  const chrome = await fetchGraphQL(SiteChromeDocument, undefined, {
    revalidate: 3600,
    tags: [siteTag()],
  });

  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-background text-foreground">
        <Header locale={locale} siteTitle={chrome.generalSettings?.title ?? 'Blame The Tech'} />
        {/* There is no <main> landmark yet, and no skip link. Lesson 11.4 adds
            both — the skip link needs a real <main id> to target, so they land
            together rather than one lesson early. */}
        <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
```

**Verify §7:**

- [ ] `grep -c 'usePathname' 'src/app/[locale]/layout.tsx'` returns `0`. If it does not, the
      active-link logic leaked upward and the whole shell is now client-side.
- [ ] `grep -c 'NavLink' 'src/app/[locale]/layout.tsx'` returns `0`. The hard-coded nav and its
      import are gone; `Header` renders `NavLink` now.

### Step 8: Prove the editor payoff

Check the preconditions first, then add a menu item from the command line and watch it appear.

```bash
cd ../wordpress-headless

# Precondition 1: the location exists (register_nav_menus ran)
docker compose run --rm wpcli wp menu location list
# Expected: a row for `primary`. If the table is EMPTY, register_nav_menus() has
#           not run on the WordPress side — Lesson 05.4 §7 names both
#           preconditions. Fix that before touching React.

# Precondition 2: a menu is ASSIGNED to that location. An unassigned menu returns
# an empty connection with no error, which looks exactly like a broken query.
docker compose run --rm wpcli wp menu list --fields=term_id,name,slug,locations
# Expected: one menu with `primary` in its locations column.
#           If none, create and assign one:
#             docker compose run --rm wpcli wp menu create "Primary"
#             docker compose run --rm wpcli wp menu location assign primary primary

# Now the payoff: add an item the way an editor would, from Appearance → Menus
docker compose run --rm wpcli wp menu item add-custom primary "About" /about
docker compose run --rm wpcli wp menu item list primary --fields=db_id,title,link
# Expected: the About row, with its db_id
```

The item is in WordPress. It is not on the site yet, because the menu fetch has a one-hour
`revalidate` and no webhook exists until Module 18. Force a fresh render:

```bash
cd ../next-app
rm -rf .next && npm run dev
# Reload http://localhost:3000/en — "About" is in the header.
```

**Verify §8:**

- [ ] "About" appears in the desktop nav and in the drawer.
- [ ] Its `href` is `/en/about`, not `/about`. If it is `/about`, `toLocalePath` is not being
      called.
- [ ] Clicking it 404s unless a WordPress page with that slug exists — that is correct
      behaviour, not a bug in the mapper. Key Concept 7's caveat.

Clean up so the seeded menu stays deterministic for Module 12:

```bash
cd ../wordpress-headless
# Take the db_id from the `wp menu item list` output in Step 8, then:
docker compose run --rm wpcli wp menu item delete <db_id>
```

---

## Verification

```bash
cd next-app

# 1. Types and lint
npm run type-check
# Expected: no errors
npm run lint
# Expected: no errors

# 2. The generated document exists
grep -c 'PrimaryMenuDocument' src/gql/graphql.ts
# Expected: 1 or more

# 3. The shell renders server-side. The HTML holds the header's "Primary" nav and
#    the footer's "Social" nav. The DRAWER's nav is not there — Radix does not
#    render sheet content until it opens, which is why the count is 2 and not 3.
#    React's SSR output is not pretty-printed, so `grep -c` — which counts LINES
#    — would report 1 however many navs there are. Count OCCURRENCES instead.
curl -s http://localhost:3000/en | grep -o '<nav' | wc -l
# Expected: 2. If your Site Settings has no social links the footer nav does not
#           render and you will see 1 — that is Step 6's empty-state branch
#           working, not a failure.

# 4. Both landmarks carry distinguishing accessible names
curl -s http://localhost:3000/en | grep -o 'aria-label="[A-Za-z]*"' | sort -u
# Expected: aria-label="Primary" and aria-label="Social"

# 5. The menu came from WordPress, not from a hard-coded list. Every nav href is
#    locale-prefixed by toLocalePath.
curl -s http://localhost:3000/en | grep -o 'href="/en/[a-z-]*"' | sort -u | head
# Expected: /en/blog, /en/incidents, /en/reviews … whatever the WP menu holds

# 6. Active-link state is announced, not just coloured
curl -s http://localhost:3000/en/incidents | grep -o 'aria-current="page"' | wc -l
# Expected: 1

# 7. NEGATIVE — Header is a Server Component
grep -c "'use client'" src/components/layout/Header.tsx
# Expected: 0

# 8. NEGATIVE — and so is Footer, and so is the nav helper
grep -l "'use client'" src/components/layout/Footer.tsx src/components/layout/nav.ts
# Expected: no output

# 9. NEGATIVE — the client hook never leaked into the layout
grep -rn 'usePathname' 'src/app/[locale]/layout.tsx'
# Expected: no output

# 10. NEGATIVE — the hard-coded nav from Lesson 09.4 is gone from the layout
grep -c 'NavLink\|<nav' 'src/app/[locale]/layout.tsx'
# Expected: 0

# 11. Only the two islands are client code in the shell
grep -rl "'use client'" src/components/layout/ | sort
# Expected: src/components/layout/MobileNav.tsx
#           src/components/layout/NavLink.tsx

# 12. NEGATIVE — the shell did not blow up the bundle. Compare First Load JS for
#     /[locale] against the number you recorded in Lesson 09.2. Next 16 prints no
#     size columns, so this is the Lesson 09.2 §9 command again.
npm run build >/dev/null 2>&1
node -e '
const { gzipSync } = require("node:zlib");
const { readFileSync } = require("node:fs");
const read = (p) => JSON.parse(readFileSync(".next/" + p, "utf8"));
const shared = read("build-manifest.json").rootMainFiles;
const kb = (f) => gzipSync(readFileSync(".next/" + f), { level: 9 }).length / 1024;
for (const [route, chunks] of Object.entries(read("app-build-manifest.json").pages)) {
  const files = [...new Set([...shared, ...chunks])].filter((f) => f.endsWith(".js"));
  console.log(route.padEnd(40), files.reduce((s, f) => s + kb(f), 0).toFixed(1) + " kB");
}'
# Expected: /[locale]/page within a few kB of the Lesson 09.2 figure. A jump of
#           tens of kilobytes means 'use client' ended up on Header or on the
#           layout, and every child came with it.

# 13. Keyboard operation. Do this by hand, in the browser, at a narrow width.
#     Radix supplies the last two; you supplied the first and the fourth.
#     - Tab reaches every desktop nav link, in visual order
#     - Enter on the hamburger opens the drawer and moves focus into it
#     - Escape closes the drawer and focus RETURNS to the hamburger
#     - Tapping a link inside the open drawer navigates AND closes it
```

## Control Questions

1. `Header` fetches the menu and passes it to `MobileNav` as a prop. Describe what would have
   to change if `MobileNav` fetched the menu itself, and name the new public surface that would
   appear as a result.
2. `usePathname()` is called in `NavLink.tsx` rather than in `Header.tsx`. Explain the bundle
   consequence of moving it up one level, and say which check in `## Verification` would catch
   it.
3. `curl` on `/en` finds two `<nav>` elements, not three, even though the page renders a
   desktop nav, a mobile drawer and a footer nav. Explain where the third one is, and why that
   is the correct behaviour rather than a rendering bug.
4. The menu and the site settings are two documents with two cache tags. State the concrete
   editorial scenario in which this beats one combined document, and explain why splitting them
   costs nothing per render.
5. A menu item pointing at `/about/` becomes `/en/about`, and one pointing at
   `/category/outages/` becomes `/en/category/outages`, which nothing serves. Argue that
   `toLocalePath` is behaving correctly, and say where you would put the exception if the
   product needed one.

## Learn More

- [Next.js: layouts and pages](https://nextjs.org/docs/app/building-your-application/routing/layouts-and-templates)
  — the persistence guarantee Key Concept 6 depends on, in Next's own words
- [Next.js: Server and Client Components](https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns)
  — the "pass server data down as props" pattern Key Concept 4 draws
- [Next.js: `usePathname`](https://nextjs.org/docs/app/api-reference/functions/use-pathname) —
  why it is a client hook and what it returns during a navigation
- [WPGraphQL: menus](https://www.wpgraphql.com/docs/menus) — `menuItems`, `MenuLocationEnum`,
  and the two silent preconditions Step 8 checks
- [WP-CLI `wp menu`](https://developer.wordpress.org/cli/commands/menu/) — `location list`,
  `location assign`, `item add-custom` and `item delete`, every flag used in Step 8
- [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) — the focus trap,
  `Escape` handling and focus return that `Sheet` inherits, plus why the title is required
- [WAI-ARIA: `aria-current`](https://www.w3.org/TR/wai-aria-1.2/#aria-current) — the exact
  semantics of `aria-current="page"` that `NavLink` sets
- [MDN: the `<nav>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/nav) —
  when multiple `<nav>` landmarks need accessible names, which is why checks 3 and 4 exist
