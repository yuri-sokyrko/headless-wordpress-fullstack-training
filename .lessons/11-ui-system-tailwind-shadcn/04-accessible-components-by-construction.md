---
title: 'Accessible Components by Construction'
module: 11
lesson: 4
teaches: [semantic-html, landmarks, heading-order, focus-management, keyboard-navigation, skip-link, focus-visible, reduced-motion, aria-last-resort]
produces: ['next-app/src/components/layout/SkipLink.tsx', 'next-app/src/components/ui/visually-hidden.tsx']
requires: [11.3]
---

# Lesson 11.4 — Accessible Components by Construction

## Quick Overview

Accessibility retrofitted is accessibility half-done. This is a full lesson, not a coda, and it
sits here — after the shell exists and before forty more components get written — because every
pattern you establish now is a pattern you will not have to fix in Module 22. The work is
concrete: correct semantic elements, one `<main>` and one `<h1>` per page, a heading order with
no skipped levels, a visible focus ring that survives a designer's opinion, keyboard operation
of every interactive control, focus moved deliberately when the UI changes underneath the user,
a skip link that actually works, and `prefers-reduced-motion` respected by every transition you
added in Lesson 11.1.

The rule that organises all of it: **semantics first, ARIA last.** A `<button>` is focusable,
activates on `Enter` and `Space`, announces itself as a button, and participates in forms — for
free, in every browser, forever. A `<div role="button" tabIndex={0}>` needs two key handlers, a
focus style, and a maintainer who remembers all of it. Every `aria-*` attribute in this codebase
must justify itself against "could a native element have done this?", and most cannot answer.
The other rule, and it is the one this lesson exists to teach: **client-side navigation breaks
focus, and only you can fix it.**

By the end of this lesson you will have:

- `next-app/src/components/layout/SkipLink.tsx` — visually hidden until focused, targeting a real `<main id>`
- `next-app/src/components/ui/visually-hidden.tsx` — the correct clip-rect technique, not `display: none`
- A `focus-visible` ring token applied through the `ui/` primitives, verified with the keyboard on every route
- Landmark and heading-order fixes across `Header`, `Footer`, `MobileNav` and every Module 09 route
- `prefers-reduced-motion` honoured by every transition, and a written list of every `aria-*` attribute in the codebase with its justification

## Classic WP Analogy

WordPress takes accessibility seriously and has trained you in more of this than you probably
credit yourself for:

| Classic WordPress | Here |
|---|---|
| The **accessibility-ready** theme requirements | the checklist this lesson works through |
| `.screen-reader-text` in every starter theme | `VisuallyHidden`, same clip-rect technique |
| The skip link Underscores ships in `header.php` | `SkipLink.tsx`, same idea, harder to keep working |
| `the_title_attribute()` and `esc_attr()` on labels | accessible names via visible text or `aria-label` |
| `wp.a11y.speak()` in wp-admin | an `aria-live` region, used sparingly |
| `add_theme_support('html5', ['search-form'])` | using `<form role="search">` and native inputs |
| Core's own `<nav>` / `<main>` landmark markup | your landmarks, which nothing adds for you |

The transferable instinct is real: if you have shipped an accessibility-ready theme you already
know that `.screen-reader-text` uses a clip rectangle rather than `display: none` because
screen readers skip hidden content, and you already know the skip link has to be the first
focusable element in the document. None of that changes.

Here is the break, and it is the single most important sentence in this lesson: **Classic
WordPress cannot break focus management, and a React app breaks it by default.** Every
navigation in a PHP theme is a full document load, so the browser resets focus to the top,
re-announces the page title, and returns the user to a known state — for free, on every link
click, without anyone thinking about it. Client-side navigation does none of that. The
`<Link>` you wrote in Lesson 09.4 swaps the page's DOM while leaving focus wherever it was, on
an element that may no longer exist, with no announcement that anything changed. A screen-reader
user hears silence; a keyboard user's next `Tab` starts from an unpredictable place. Nothing in
Next.js fixes this, no linter catches it, and it does not show up in a mouse-based click-through
of the site. It is the accessibility bug that Classic WordPress developers have never had to
think about, and it is now yours.

The second break is smaller and more insidious: the components from Lesson 11.2 *look*
accessible because Radix genuinely is, which makes it easy to assume the whole page is. Radix
gives you a correct dialog. It cannot give you a sensible heading order, a meaningful accessible
name on your icon-only button, or a `<main>` landmark you never added. Lesson 12.3's Playwright
locators are the enforcement mechanism — a test that finds a button by its accessible role and
name fails the moment the accessible name disappears, which turns accessibility into something
CI notices.

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
