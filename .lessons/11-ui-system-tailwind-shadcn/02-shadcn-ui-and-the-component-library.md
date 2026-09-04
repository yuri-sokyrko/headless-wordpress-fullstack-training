---
title: 'shadcn/ui & the Component Library'
module: 11
lesson: 2
teaches: [shadcn-ui, radix-primitives, cva, class-merging, components-json, rsc-flag]
produces: ['next-app/components.json', 'next-app/src/components/ui/button.tsx', 'next-app/src/components/ui/card.tsx', 'next-app/src/components/ui/badge.tsx', 'next-app/src/components/ui/input.tsx', 'next-app/src/components/ui/label.tsx', 'next-app/src/components/ui/select.tsx', 'next-app/src/components/ui/dialog.tsx', 'next-app/src/components/ui/skeleton.tsx']
requires: [11.1]
---

# Lesson 11.2 — shadcn/ui & the Component Library

## Quick Overview

shadcn/ui is not a dependency. That single fact is the whole lesson. You run a CLI, it writes
`.tsx` files into `src/components/ui/`, and those files are now ordinary source files in your
repository — you read them, you edit them, you review their diffs, and nothing in
`package.json` points at "shadcn". What you *do* install are the Radix primitives underneath
the ones that need real behaviour: focus trapping in a dialog, keyboard navigation in a select,
correct `aria-*` wiring on both.

You will initialise `components.json`, generate the nine components the app actually uses, and
then immediately edit two of them so the ownership is not theoretical. `Button` becomes a `cva`
variant API with Blame The Tech's severity variants; `Badge` gets the four severity terms as
named variants driven by the tokens from Lesson 11.1. One `components.json` setting deserves
attention before you generate anything: `"rsc": true`, which tells the CLI to add `'use client'`
only to components that genuinely need it. Get that wrong and every card and badge in the app
becomes a Client Component, quietly undoing Lesson 09.2.

By the end of this lesson you will have:

- `next-app/components.json` with `"rsc": true`, the `@/*` alias and the Tailwind entry point configured
- Nine components in `next-app/src/components/ui/` — button, card, badge, input, label, select, dialog, skeleton
- A `cn()` helper and a `Button` rewritten as a `cva` variant API with Blame The Tech variants
- `Badge` variants for the four `severity` terms from the closed set, styled with Lesson 11.1's tokens
- A check that `'use client'` appears only in the files that need it, and a note of which those are and why

## Classic WP Analogy

There is an exact analogue in the WordPress world, and it is the distinction between a **starter
theme** and a **parent theme**:

| | Parent theme (MUI, Chakra, Bootstrap) | Starter theme (shadcn/ui) |
|---|---|---|
| How you get it | install and depend on it | copy it into your project |
| How you change it | child theme, overrides, `!important`, prop escape hatches | edit the file |
| Upstream updates | `composer update` and hope | there are none; you own it |
| Who owns the markup | the vendor | you |
| Bundle cost | the whole library | only what you copied |
| Code review | invisible | a normal diff |

You have felt both sides of this. A parent theme is fast for the first week and then you spend
a month fighting a `<header>` you cannot restructure, hooking `wp_nav_menu` filters to change
one class name. Underscores hands you plain files, and by day three the code looks like yours.
shadcn/ui is Underscores for React components, and it is the right default for exactly the
reason Underscores was: this is an application with a specific design, not a prototype that
needs a stock look.

The comparison breaks on **maintenance**, and the cost should be stated plainly. A parent theme
ships accessibility fixes, browser-quirk workarounds and security patches, and you get them by
updating. Copied components get none of that. When Radix fixes a focus bug in a dialog you get
it, because Radix *is* a dependency — but when shadcn improves the styling wrapper or fixes an
`aria-describedby` wiring mistake in its `Select`, nothing tells you. That is the trade: total
control, total responsibility. It is why Lesson 11.4 is a full audit lesson rather than a
footnote, and why Module 22 runs axe over these components in CI.

There is a second, smaller break worth naming: `src/components/ui/` is generated code that you
*do* edit, which makes it the exact opposite of `src/gql/` from Lesson 10.2. Same repository,
two directories of tool-written files, opposite rules. Write that down somewhere your future
self will read it.

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
