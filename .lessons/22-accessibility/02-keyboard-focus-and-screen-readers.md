---
title: 'Keyboard, Focus & Screen Readers'
module: 22
lesson: 2
teaches: [keyboard-navigation, focus-order, focus-trap, focus-restoration, skip-link, aria-live, reduced-motion, screen-reader-testing]
produces: ['next-app/src/components/layout/SkipLink.tsx', 'next-app/src/components/hobt/GetDemoDialog.tsx', 'next-app/src/components/incidents/IncidentFilters.tsx']
requires: [22.1, 16.3]
---

# Lesson 22.2 — Keyboard, Focus & Screen Readers

## Quick Overview

Put your mouse out of reach and use the site. That instruction is the lesson: `Tab` forward,
`Shift+Tab` back, `Enter` and `Space` to activate, `Escape` to dismiss, arrow keys inside
composite widgets. You will find things a scan cannot find — a focus ring hidden behind the
sticky header, a card whose entire body is clickable but only the title is focusable, a dialog
that opens while focus stays on the page behind it, a filter that replaces forty results and
tells nobody.

Four disciplines fix almost all of it. **Focus order** must follow visual order, which means DOM
order must follow visual order, which means `order-*` and absolute positioning in Tailwind are
accessibility decisions. **Focus must be visible** — and the `:focus-visible` ring that survives
a design review is a negotiation you should have now rather than after launch. **Focus must be
managed across state changes**: a dialog moves focus in, traps it, returns it to the trigger on
close; a route change moves focus to the heading; a submitted form with errors moves focus to
the error summary. **Changes the user did not initiate must be announced**, which is what
`aria-live` is for — the incident filter's result count is the canonical example, and getting it
right means a polite region that exists before the update, not one created by the update. Then
`prefers-reduced-motion`, and finally an actual screen reader: VoiceOver on macOS, NVDA on
Windows, twenty minutes, once. Reading about screen readers is not a substitute for the moment
you hear your own site say "link, link, link, link".

By the end of this lesson you will have:

- `SkipLink.tsx` — visually hidden until focused, first in the DOM, moving focus into `<main>` —
  plus a focus-visible style that is consistent and not obscured by the sticky header
- A DOM order that matches visual order on every route, with any `order-*` overrides justified
- `GetDemoDialog.tsx` trapping focus, closing on `Escape`, restoring focus to its trigger, and
  marked `aria-modal` with a labelled dialog
- `IncidentFilters.tsx` with a polite `aria-live` region announcing the result count and the
  empty state
- Route-change focus handling so a client-side navigation does not strand focus, and
  `prefers-reduced-motion` honoured by every transition and the ticker block
- A written VoiceOver/NVDA smoke script and the findings from running it once

## Classic WP Analogy

Classic WordPress gave you keyboard accessibility largely by accident, and it is worth being
honest about why: **full page loads reset everything.** Click a link, the browser navigates,
focus goes to the top of a fresh document. There is no stale focus, no trapped focus, no
announcement problem, because there is no state to change — the page either exists or is being
replaced. The one place Classic WordPress did make you manage focus was a jQuery modal or an
accordion, and that is exactly where Classic themes had their accessibility bugs.

| Classic WordPress | React |
|---|---|
| Skip link in `header.php` + `.screen-reader-text:focus` | `SkipLink.tsx`, identical technique |
| Full page load resets focus | Client navigation preserves focus — usually in the wrong place |
| `wp_die()` / a fresh page for form errors | Errors render in place; you move focus to them |
| jQuery UI dialog, focus usually not trapped | Radix `Dialog` traps focus — verify it, don't assume it |
| `aria-live` on an admin notice, if you were thorough | `aria-live` on any async result region, mandatory |
| No animation to speak of | `prefers-reduced-motion` on every transition |

Where the analogy breaks is the direction of the difficulty, and it breaks against you. A single
page application removes the browser's free reset and hands you the responsibility. Every
interaction that changes content without a navigation — filtering, opening a dialog, submitting
a form, changing locale — is a moment where you must decide where focus goes and what gets
announced. Nobody decides that for you, and if you decide nothing, focus stays where it was or
falls to `<body>`, which for a screen reader user means the page silently reverts to the top.

There is one compensation, and it is real: **Radix**, which the design system in Module 11
already uses, implements the WAI-ARIA authoring patterns properly. The dialog trap, the roving
tabindex, the correct `aria-*` wiring — that is done, tested, and better than what you would
write. Your job is not to reimplement it; it is to verify it survived your styling, and to
handle the three things Radix cannot know about: route-change focus, live regions for your own
async data, and reduced motion.

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
