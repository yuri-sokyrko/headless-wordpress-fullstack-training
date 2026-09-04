---
title: 'Accessibility Foundations for Components'
module: 22
lesson: 1
teaches: [wcag-2-2-aa, semantic-html, landmarks, accessible-name, form-labeling, color-contrast, target-size]
produces: ['next-app/src/app/[locale]/layout.tsx', 'next-app/src/components/layout/Footer.tsx', 'next-app/tailwind.config.ts']
requires: [11.4, 20.3]
---

# Lesson 22.1 — Accessibility Foundations for Components

## Quick Overview

Assistive technology does not read your JSX. It reads the **accessibility tree** — a parallel
structure the browser derives from your DOM, where every node has a role, an accessible name, a
value and a set of states. `<div onClick>` produces a node with role `generic`, no name and no
state, which is why it is invisible to a screen reader and unreachable by keyboard even though
it looks and behaves like a button to you. `<button>` produces role `button`, a name taken from
its content, and focusability for free. Almost all of accessibility is choosing elements whose
default tree node already says the right thing, and reaching for ARIA only when no element does.

This lesson works through the site with WCAG 2.2 AA as the checklist: landmarks so a screen
reader user can jump to `<main>` instead of tabbing through the nav; a heading outline that
reads like a table of contents rather than a list of font sizes; an accessible name on every
icon-only control (the locale switcher, the mobile menu toggle, the sort control); form fields
associated with real `<label>` elements and error messages wired with `aria-describedby` and
`aria-invalid`; the satirical palette measured against 4.5:1 for text and 3:1 for UI components,
with the severity badges being the likely casualty; and the WCAG 2.2 additions that are easy to
miss — 24×24 CSS pixel target sizes, and focus indicators that are not obscured by a sticky header.

By the end of this lesson you will have:

- A landmark structure with exactly one `<main>`, a labelled `<nav>` per navigation region, and a
  `<footer>` that is a real `contentinfo`
- A heading outline per route with no skipped levels, including a documented rule for editor
  content rendered by `RichText`
- An accessible name on every interactive element, verified in the browser's accessibility panel
  rather than assumed from the JSX
- Form fields with associated labels, `aria-describedby` help text, `aria-invalid` on error, and
  a `role="alert"` error summary
- A contrast audit of the palette with the failures listed and `tailwind.config.ts` tokens corrected
- Target sizes and focus visibility checked against WCAG 2.2 AA, with the sticky-header
  obscuring case fixed

## Classic WP Analogy

You have met most of this before, from the other side of the fence. WordPress has a genuinely
serious accessibility culture — the core Accessibility Coding Standards require WCAG 2.1 AA,
themes in the directory can carry an `accessibility-ready` tag with a real review behind it, and
you have almost certainly used `screen-reader-text` as a utility class or written
`esc_attr__( 'Search for:', 'domain' )` for a label you then visually hid.

| Classic WordPress | React / Next.js |
|---|---|
| `.screen-reader-text` in the theme's CSS | `sr-only` in Tailwind — the same technique, same trap |
| `<label for="s">` in `searchform.php` | `<label htmlFor>` or a shadcn `<FormLabel>` bound by `id` |
| `wp_nav_menu( ['container_aria_label' => …] )` | `aria-label` on `<nav>`, written by you |
| Theme Review's `accessibility-ready` checklist | WCAG 2.2 AA, run by axe and by hand |
| `the_content()` output, heading order out of your hands | `RichText` output, heading order still out of your hands |
| `bloginfo('language')` on `<html lang>` | `params.locale` on `<html lang>` and `dir` |

The knowledge transfers almost completely, and that is genuinely good news. Where it breaks is
**dynamic state**, and it breaks because Classic WordPress barely had any. A PHP-rendered page is
a static document: the accessibility tree is built once from the HTML you printed and never
changes. Almost every accessibility bug you could ship was a markup bug, and markup bugs are the
kind axe catches.

React re-renders. A filter changes the list underneath the user, a dialog appears above
everything else, an inline error replaces a field's help text, a route transition swaps the page
without a page load. Every one of those is a state change the accessibility tree reflects but
**nothing announces** — a screen reader user gets silence, and a keyboard user may find their
focus has been destroyed along with the element it was on. There is no Classic analogue for
"focus was on a button that no longer exists", because in Classic WordPress the page would have
reloaded and focus would have gone to the top of the document by definition. That entire class of
problem is Lesson 22.2, and it is where a React site is genuinely harder to get right than a PHP one.

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
