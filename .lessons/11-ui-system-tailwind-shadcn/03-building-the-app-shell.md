---
title: 'Building the App Shell'
module: 11
lesson: 3
teaches: [app-shell, layout-composition, client-islands, wp-menus-in-graphql, active-link-state]
produces: ['next-app/src/components/layout/Header.tsx', 'next-app/src/components/layout/Footer.tsx', 'next-app/src/components/layout/MobileNav.tsx', 'next-app/src/graphql/menu.graphql']
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
| `register_nav_menus()` in `functions.php` | the same registration, still in the plugin |
| `Walker_Nav_Menu` subclass to change markup | a `.map()` over the items |
| `current-menu-item` class added by WordPress | `usePathname()` compared to the item URL |
| `get_option('btt_footer_blurb')` | the `siteSettings` ACF options page |
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

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
