# Module 11 — UI System: Tailwind & shadcn/ui

## Prerequisites

Before starting this module you should have completed:

- **Module 10** — every read goes through `fetchGraphQL`, types come from `src/gql/`, `schema.graphql` and `src/gql/` are committed, and every route has loading and error boundaries
- **Module 09** — the App Router route inventory renders and navigates
- **Module 08** — you are comfortable with props and with which components are Client Components

> ⚠️ **This is not a CSS course.** You already know the box model, flexbox and grid. What is
> new is where the styles live and why utility classes stop being ugly once a component is the
> unit of reuse. If you find yourself writing a `.btn-primary` class, stop and re-read
> Lesson 11.1 §4.

## Starting State

```bash
# 1. Codegen is in sync with the committed schema
cd next-app && npm run codegen:check
# Expected: no changes — src/gql/ matches schema.graphql

# 2. Every route renders, unstyled
npm run dev
open http://localhost:3000/en/incidents
# Expected: real incident titles, browser default styling, a working filter
```

```
next-app/
├── codegen.ts                                      (M10) reads ../wordpress-headless/schema.graphql
└── src/
    ├── lib/graphql/{client,errors,tags}.ts         (M10)
    ├── graphql/                                    (M10) documents + fragments
    ├── gql/                                        (M10) generated, committed
    ├── app/[locale]/{layout,page,loading,error,not-found}.tsx
    └── components/incidents/                       (M08/M09) unstyled
```

There is no `tailwind.config.ts`, no `components.json` and no `src/components/ui/`.

## What You'll Learn

- **Tailwind 4** — utility-first CSS, the CSS-first `@theme` configuration, and design tokens as CSS custom properties
- **Why utilities beat a stylesheet here** — no dead CSS, no naming debates, and a diff that shows what changed visually
- **shadcn/ui** — a component *generator*, not a dependency: the code is copied into your repo and you edit it
- **Radix primitives** — unstyled, accessible behaviour underneath the styling you own
- **`cva` and `cn`** — variant APIs and class merging without string concatenation
- **The app shell** — `Header`, `Footer`, a mobile nav island, and where the `'use client'` boundary belongs in a layout
- **Accessibility by construction** — semantic landmarks, heading order, focus management, keyboard navigation, `focus-visible`, reduced motion, and `aria-*` only where semantics run out
- **Page composition** — the `/hobt` landing shell assembled from ACF `hobtPromo` fields, with every CTA deliberately inert

## What You'll Build

A design system in `tailwind.config.ts` and the global stylesheet; the shadcn components the
app actually uses, copied into `src/components/ui/`; an accessible app shell in
`src/components/layout/`; a skip link and a focus-visible ring that survive Module 22's audit;
and `/en/hobt` composed from the `hobtPromo` field group.

After this module Blame The Tech looks like a product and is keyboard-navigable end to end.
The HOBT CTAs render but do nothing — Module 16 wires them to Server Actions, and Module 14
replaces the hard-coded HOBT sections with editor-composed blocks.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [Tailwind Fundamentals](01-tailwind-fundamentals.md) | Tailwind 4, `@theme`, PostCSS | Design tokens, and `IncidentCard` restyled |
| 02 | [shadcn/ui & the Component Library](02-shadcn-ui-and-the-component-library.md) | shadcn CLI, Radix, `cva`, `cn` | `components.json` with `"rsc": true`, and `src/components/ui/` |
| 03 | [Building the App Shell](03-building-the-app-shell.md) | Layout composition, client islands | `Header`, `Footer`, `MobileNav` |
| 04 | [Accessible Components by Construction](04-accessible-components-by-construction.md) | Landmarks, focus management, `focus-visible` | `SkipLink`, `VisuallyHidden`, audited `ui/` primitives |
| 05 | [Page Composition & the HOBT Shell](05-page-composition-and-the-hobt-shell.md) | Composition patterns, ACF-driven sections | `/en/hobt` from `hobtPromo`, CTAs inert |

## What lands in `src/components/ui/`

Copied in, not installed. Every file is yours to edit, and the diff belongs to you.

| Component | Radix primitive | Used by |
|---|---|---|
| `button.tsx` | — (`cva` variants only) | Everywhere; the HOBT CTAs in Lesson 11.5 |
| `card.tsx` | — | `IncidentCard`, review cards, HOBT modules |
| `badge.tsx` | — | Severity and resolution status |
| `input.tsx` / `label.tsx` | — | `IncidentSearch`, the Module 16 forms |
| `dialog.tsx` | `@radix-ui/react-dialog` | Mobile nav, the Module 16 "Get Demo" dialog |
| `select.tsx` | `@radix-ui/react-select` | Severity and scapegoat filters |
| `sheet.tsx` | `@radix-ui/react-dialog` | `MobileNav` |
| `skeleton.tsx` | — | The `loading.tsx` boundaries from Lesson 10.4 |

The field names driving `/hobt` are fixed by
[the content model contract](../appendix/03-content-model-reference.md#44-hobt-promo).

> **shadcn/ui is not in `package.json`, and that is the point.** The CLI copies `.tsx` files
> into your repository and leaves. What you install are the Radix primitives underneath — those
> are real dependencies, because focus trapping and keyboard navigation are not code you want
> to own. Everything else is yours, exactly the way a starter theme is yours the moment you
> copy it. The cost, stated plainly: nobody upstream will ever ship you a fix for those files.

## How to Work

1. **Read the module README** and confirm Starting State, especially that `npm run codegen:check` is clean.
2. **Work the lessons in order.** 11.4 audits what 11.2 and 11.3 built, so doing it last is the point — but it is a full lesson, not a coda.
3. **Keep the keyboard in play.** From Lesson 11.3 onward, navigate every page you build with `Tab` and `Shift+Tab` before you look at it with a mouse.
4. **Run `## Verification` before moving on**, then commit: `git commit -m "feat(next): tailwind design system and accessible app shell"`.
