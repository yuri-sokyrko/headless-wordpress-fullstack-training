# Module 08 — React Fundamentals for WordPress Developers

## Prerequisites

Before starting this module you should have completed:

- **Module 07** — Node 22, ESM, strict TypeScript, ESLint and Prettier, plus `scripts/blame.mjs` printing live incidents
- **Module 05** — every read query the front end needs is answerable in GraphiQL
- **Module 04** — `wp blame seed` has populated the site, so this module's fixtures mirror real content

> ⚠️ **Do not install Next.js in this module.** React and Next.js are two different things,
> and conflating them is the single most common reason a WordPress developer stalls here. This
> module is React only, rendered by a throwaway Vite harness. Next.js arrives in Lesson 09.1 —
> installed into this same project by hand, because `create-next-app` cannot run in a directory
> that already has your toolchain in it.

## Starting State

```bash
# 1. You are on Node 22 and the toolchain is green
cd next-app && nvm use && npm run lint && npm run type-check
# Expected: v22.x.x, then no ESLint errors, then no TypeScript errors

# 2. The Module 07 script still talks to WordPress
node scripts/blame.mjs
# Expected: a list of seeded incident titles from http://localhost:8080/graphql
```

```
next-app/
├── package.json  tsconfig.json          (strict: true)
├── eslint.config.mjs  .prettierrc
├── scripts/blame.mjs
└── src/types/                            hand-written content-model types (M07)
```

`src/app/`, `src/components/` and `next.config.ts` do not exist yet. That is correct.

## What You'll Learn

- **React 19** — what a component actually is, and why a function returning markup replaces a `get_template_part()` call
- **JSX** — an expression syntax that compiles to function calls, not a template language
- **Props** — one-way data flow, and why there is no `global $post`
- **Lists and keys** — rendering an array, and what React does when the key is the array index
- **State and events** — `useState`, and why you never write to the DOM directly again
- **Effects and refs** — `useEffect`, cleanup, `useRef`, and the fact that most effects you are tempted to write are wrong
- **Context** — `createContext` / `useContext` as the escape hatch from prop drilling
- **Thinking in React** — deriving state instead of storing it, colocating state, lifting it only when forced

## What You'll Build

The incident components the rest of the course renders: `IncidentCard`, `IncidentList`,
a search input, and a working client-side filter over the four `severity` terms and the ten
`scapegoat` terms. Everything runs against typed fixtures in `src/components/incidents/`,
shaped exactly like the WPGraphQL responses from Module 05, so Module 09 can swap fixtures for
live data without touching a component.

After this module you can build an interactive UI in React from scratch, and you have the
components that Lesson 09.2 turns into the first page you can visit.

> **Three things this module deliberately does not cover.** There is no data fetching — the
> components take props and nothing else, because fetching in React is a Module 09 concern and
> doing it here would teach you the pattern the App Router replaces. There is no styling beyond
> browser defaults, because Module 11 owns that and pretty components are harder to reason
> about. And there is no `useMemo`, `useCallback` or `React.memo`, because optimising a list of
> six fixtures teaches you to reach for them reflexively, which is the opposite of the habit
> you want.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [Components & JSX](01-components-and-jsx.md) | React 19, JSX, `react-dom/client`, a Vite harness | `IncidentCard` rendering hard-coded markup |
| 02 | [Props, Lists & Conditional Rendering](02-props-lists-and-conditional-rendering.md) | Props, `.map()`, `key`, typed component contracts | `IncidentList` over typed fixtures |
| 03 | [State & Events](03-state-and-events.md) | `useState`, event handlers, controlled inputs | `IncidentFilters` — severity and scapegoat filtering |
| 04 | [Effects, Refs & the Lifecycle](04-effects-refs-and-the-lifecycle.md) | `useEffect`, cleanup, `useRef`, custom hooks | `IncidentSearch` with a debounced query |
| 05 | [Context & Thinking in React](05-context-and-thinking-in-react.md) | `createContext`, `useContext`, derived state | `IncidentFilterProvider` and a refactor that deletes state |

## The vocabulary map

You already have a mental model for every row on the left. The right-hand column is the same
idea with different ergonomics — read this table before Lesson 08.1 and again after 08.5.

| Classic WordPress | React | Where it stops matching |
|---|---|---|
| `get_template_part('card', 'incident')` | `<IncidentCard />` | A component returns a value; a template part echoes output |
| `$args` passed to `get_template_part()` | props | Props are typed and checked at build time |
| `global $post` inside the loop | nothing — you pass it explicitly | There is no ambient current post, ever |
| `the_title()` / `esc_html()` | `{incident.title}` | JSX escapes by default; you opt *out* deliberately |
| `while (have_posts())` | `items.map(...)` | Every item needs a stable `key`, and the index is not one |
| jQuery `.on('click')` mutating the DOM | `onClick` setting state | You describe the next UI, you do not patch the current one |
| `wp_localize_script()` | props and context | Data flows down through the tree, not through a global |
| `wp_enqueue_script()` in `functions.php` | an `import` statement | The bundler owns the dependency graph |
| `esc_attr()` on every attribute value | `title={incident.title}` | Attributes are escaped too; you never call an escaper |
| A `$args` typo failing silently at runtime | a props typo failing at build time | The compiler reads the component's signature |

## How to Work

1. **Read the module README** — confirm your repo matches Starting State. If `npm run type-check` is not green, finish Module 07 first.
2. **Work the lessons in order.** 08.1 through 08.5 build one component set incrementally, and 08.5 deletes code that 08.3 wrote. That is the lesson.
3. **Type the code, do not paste it.** JSX and hooks are new syntax. This module is where muscle memory is cheapest to buy.
4. **Run `## Verification` before moving on**, then commit: `git commit -m "feat(next): incident list with client-side filtering"`.
