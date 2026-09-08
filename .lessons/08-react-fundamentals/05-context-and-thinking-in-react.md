---
title: 'Context & Thinking in React'
module: 8
lesson: 5
teaches: [react-context, react-use-context, prop-drilling, derived-state, state-colocation, composition]
produces: ['next-app/src/components/incidents/IncidentFilterProvider.tsx', 'next-app/src/components/incidents/IncidentList.tsx']
requires: [8.4]
---

# Lesson 08.5 — Context & Thinking in React

## Quick Overview

By the end of Lesson 08.4 the filter state lives in one component and three descendants need
it, so you are threading `severity`, `setSeverity`, `scapegoat`, `setScapegoat` and `query`
through components that do not use them. That is prop drilling, and React's answer is
**context**: a value published at one point in the tree and read anywhere below it, without
the components in between knowing it exists. This lesson introduces `createContext` and
`useContext`, then immediately draws the line — context is for values that genuinely span a
subtree, not a global variable store, and reaching for it too early is how React apps become
untestable.

The second half of the lesson is the one that changes how you design components. You will walk
the "thinking in React" process on the incident UI: list every value on screen, decide which
are state and which are derived, push each piece of state to the lowest component that needs
it, and lift it only when two siblings must agree. Applied honestly, that process **deletes**
state that Lesson 08.3 wrote. Finishing this module with fewer lines than you started the
lesson with is the intended outcome.

By the end of this lesson you will have:

- `next-app/src/components/incidents/IncidentFilterProvider.tsx` — a typed context with a custom `useIncidentFilters()` consumer hook
- A consumer hook that throws a named error when used outside its provider, rather than returning `undefined`
- `IncidentList` refactored to read filters from context, with no filter props in its signature
- At least one piece of state deleted and replaced with a value derived during render
- A written state inventory for the incident UI: every value, marked state, derived, or prop

## Classic WP Analogy

Context is the closest React gets to a WordPress global, and the comparison is useful right up
to the point where it becomes dangerous:

| Classic WordPress | React |
|---|---|
| `global $post` — ambient, whole request | context value — ambient, one subtree |
| `wp_localize_script('app','BTT',$data)` | `<Provider value={data}>` |
| `get_option('btt_settings')` anywhere | `useContext(SettingsContext)` anywhere below the provider |
| `setup_postdata()` / `wp_reset_postdata()` | nesting a second provider to shadow the value |

The mechanical similarity is real: both let deep code read a value nobody passed it. The
difference is scope and lifetime. A WordPress global is process-wide and any plugin can
overwrite it, which is why `wp_reset_postdata()` exists and why "some plugin clobbered
`$post`" is a support category. A context value is scoped to the subtree under its provider,
is typed, cannot be written to by consumers, and re-renders exactly the components that read
it. You can mount the same component twice on one page with two different providers and both
work — try that with `global $post`.

Here is where the analogy breaks and why it matters for the rest of the course. **Context is
not state management, and it is not a performance tool.** Every component that calls
`useContext` re-renders when the provider's value changes, so putting a rapidly-changing value
in a context that half the tree consumes is slower than prop drilling, not faster. And there
is a headless-specific trap waiting in Module 09: this provider is a Client Component, and the
moment you wrap a layout in it, everything inside that provider ships to the browser too. The
WordPress instinct — "put shared data in a global so anything can reach it" — is precisely the
instinct that turns a Server Component tree into a client bundle. Lesson 09.2 shows the fix,
which is to push providers as far down the tree as they will go.

---

## Key Concepts

### 1. Prop drilling, as you actually built it

This is the tree at the end of Lesson 08.4. The annotations are the honest ones.

```
App                                      4 useState · 4 handlers · the debounce
 │
 ├── FilterBar                            receives 7 props · USES 0
 │    ├── IncidentSearch                  uses value, onChange
 │    └── IncidentFilters                 uses severity, scapegoat, and 3 callbacks
 │
 ├── {isFiltered ? … : null}              reads 1 of App's 4 state values
 │
 └── IncidentList                         receives incidents + 3 filter props
      └── IncidentCard × 12               uses none of them
```

`FilterBar` is the problem in miniature. Seven props, zero uses, nine lines of type declaration
and fourteen lines of JSX whose only job is to move values from one place to another. It is not
badly written; there is nothing to write better. It is postage.

Prop drilling gets worse in three directions at once, and all three are about to happen:

| It gets worse when | Concretely, in this project |
|---|---|
| the tree gets deeper | Lesson 09.2 puts a page and a layout above all of this |
| there are more values | a date range, an environment selector, a sort order |
| an intermediate component is not yours | Module 11's `Card` and `Dialog` are copied-in components you do not want to add filter props to |

It is worth saying clearly that prop drilling is **not always wrong**. One value, one level, is
better as a prop than as a context: props are explicit, greppable, and visible in the component's
signature. The threshold is roughly "more than two levels, or more than three values, or an
intermediate that has no business knowing". This tree crosses all three.

### 2. `createContext` and `useContext`

Two functions, and a third thing you render.

```
const Ctx = createContext<T | undefined>(undefined);   1. make the channel

<Ctx value={someValue}>                                2. publish, for a subtree
  …anything…
</Ctx>

const value = useContext(Ctx);                         3. read, anywhere below
```

The value is looked up by walking **up** the rendered tree from the consumer until a provider
for that exact context object is found. Not by name, not by string key — by object identity. Two
`createContext()` calls produce two unrelated channels even if they hold the same type.

> **React 19 lets you render the context object itself as the provider.** `<Ctx value={v}>` and
> `<Ctx.Provider value={v}>` do the same thing; the shorthand is new, the long form still works,
> and every tutorial written before 2025 shows the long form. This lesson uses `.Provider`,
> because it is the spelling you will meet in other people's code and the one that makes it
> obvious which of the three roles the component is playing.

Three properties that matter for the rest of the course:

- **A consumer re-renders when the provider's `value` changes** — by `Object.is`, so a new object
  literal every render means every consumer re-renders every time. Key Concept 5.
- **Consumers cannot write to the context.** If they need to change something, the value has to
  include a function that does it. That is why `IncidentFilterValue` carries setters.
- **A component that calls `useContext` is coupled to having a provider above it.** It can no
  longer be rendered standalone in a test or a story without one. That is a real cost and it is
  why this lesson does not put `IncidentCard` on the context.

### 3. The default value argument, and why `undefined` is the right one

`createContext(defaultValue)` takes an argument that is used **only when there is no matching
provider above the consumer**. In every other case it is dead code.

The temptation is to supply something plausible:

```
❌  createContext<IncidentFilterValue>({          ✅  createContext<
      severity: 'all',                                 IncidentFilterValue | undefined
      scapegoat: 'all',                              >(undefined);
      query: '',
      setSeverity: () => {},   ← a no-op
      clear: () => {},         ← another no-op
    });
```

Read what the left-hand version does when someone renders `IncidentList` outside the provider —
which will happen, in Lesson 09.2, the first time a component is moved between two files. The
list renders. The filters render. The selects respond to clicks. And nothing filters, because
`setSeverity` is a function that does nothing, forever, silently. There is no error, no warning,
and no failing test unless somebody wrote one for this exact scenario.

| | Plausible default | `undefined` + a throwing hook |
|---|---|---|
| Missing provider produces | a working-looking UI that does nothing | an error naming the hook and the provider |
| Found by | a user, in production | you, on the first render, in development |
| Type of the context | `IncidentFilterValue` | `IncidentFilterValue \| undefined` |
| Every consumer must | nothing | go through the hook — which is what you wanted anyway |

**Verdict: `undefined`, always, for any context whose value cannot sensibly be defaulted.** A
plausible default converts a structural mistake into a silent behavioural one, and this course
has a name for that trade: it is the same reason `${VAR:?message}` appears in Lesson 02.2's
Compose file rather than a silent empty string.

There are contexts where a default is right — a theme that legitimately falls back to `light`, a
locale that falls back to `en`. The test is whether the fallback is a **correct answer** or a
**shrug**.

### 4. The consumer hook that throws

Never export the context object. Export a hook.

```tsx
// — (illustration)
export function useIncidentFilters(): IncidentFilterValue {
  const value = useContext(IncidentFilterContext);

  if (value === undefined) {
    throw new Error('useIncidentFilters must be used inside <IncidentFilterProvider>');
  }

  return value;
}
```

Four things that one function buys:

1. **The narrowing.** Every consumer gets `IncidentFilterValue`, not
   `IncidentFilterValue | undefined`, so nobody writes `filters?.severity` and nobody writes a
   fallback that hides the bug.
2. **The error message names both ends.** "must be used inside `<IncidentFilterProvider>`" is
   a fix, not a symptom. Compare "Cannot read properties of undefined (reading 'severity')".
3. **The context object stays private,** so no consumer can `useContext(Ctx)` directly, and the
   provider is free to change how it computes the value.
4. **It is the only place the invariant lives.** One check, not one per consumer.

⚠️ The throw happens **during render**, which means it is a render-phase error, which means in
Lesson 10.4 it will be caught by an `error.tsx` boundary and shown as a generic error page in
production. That is correct — a missing provider is a programming error and should be as loud as
possible in development — but it does mean the error message reaches your console, not your
user's screen. Read the console.

### 5. Context is not state management, and it is not a performance tool

The two most common misuses, both of them things a WordPress developer's instincts encourage.

**"Context is our state management."** No: `useState` is the state management, and context is a
delivery mechanism for it. Context has no reducers, no selectors, no middleware, no persistence,
and — critically — **no way for a consumer to subscribe to part of a value**. A consumer reads
the whole value or nothing.

**"Context is faster than passing props."** It is the opposite, in the case people reach for it.

```
provider value changes
        │
        ├──▶ EVERY component that calls useContext(Ctx) re-renders
        │    …whether or not it uses the field that changed
        │
        └──▶ components in between do NOT re-render (they got no new props)
```

So a rapidly-changing value in a context that half the tree consumes is **slower** than drilling
props to the two components that need it, because prop changes only reach the components that
actually receive them. A mouse position in a context is the canonical disaster.

This provider is a reasonable use because the value changes on a filter change — a handful of
times a minute at most — and its consumers are exactly the components that care. If the search
box put every keystroke into the context and `IncidentCard` were a consumer, the whole list
would re-render forty times per word. It does not, because the debounced value lives in the
provider and `IncidentCard` takes props.

The honest cost of this refactor, stated plainly: `IncidentList` can no longer be rendered
without a provider, and every future consumer inherits that constraint. Module 23's component
tests will have to wrap the component under test, which is one line per test and a real thing
you have signed up for. Module 12 sidesteps it by testing `matchesFilters` directly — which is
why that function is exported and sits outside the component.

### 6. Nesting providers to shadow a value

A consumer walks up the tree and stops at the **first** matching provider. So a second provider
nested inside the first shadows it for everything below.

```
<IncidentFilterProvider>            severity = 'all'
  <FilterBar />                     reads the outer provider
  <IncidentList incidents={all} />  reads the outer provider

  <IncidentFilterProvider>          a SECOND, independent set of filter state
    <FilterBar />                   reads the inner provider
    <IncidentList incidents={k8s}/> reads the inner provider
  </IncidentFilterProvider>
</IncidentFilterProvider>
```

Two boards on one page, each filtering independently, with no coordination and no prefixed
variable names. This is the thing `global $post` cannot do. `setup_postdata()` mutates a global
and `wp_reset_postdata()` puts it back, and the reason "some plugin clobbered `$post`" is a
support category is that there is exactly one of it, process-wide, and any code can write to it.
Nesting a WordPress global is not a thing; you can only save it, overwrite it, and hope.

The scoping is why context is safe to use here and why the same instinct applied to a WordPress
global is not.

### 7. Thinking in React, as a procedure

The four steps below are not a philosophy, they are a checklist to run whenever a screen has
more than two moving parts. React's own documentation calls it "Thinking in React"; the useful
part is that it is mechanical.

```
1. LIST every value on screen.        Not components. VALUES. One row each.

2. MARK each one:
     state     — a user chose it, or it arrived from outside, and nothing
                 in the app can recompute it
     derived   — it can be computed from state and props during render
     prop      — it was handed in from above

3. PUSH each piece of state DOWN to the lowest component that needs it.

4. LIFT it only when two SIBLINGS must agree about it — and lift it exactly
   to their nearest common ancestor, no higher.
```

Two tests make step 2 mechanical rather than a judgement call:

- **Could it ever disagree with something else on screen?** If yes, it is derived and storing it
  is a scheduling bug waiting to happen.
- **Would a page reload have to preserve it?** If no, and it can be recomputed, it is derived.

Step 4 is where most designs go wrong in the *other* direction. Lifting state higher than the
nearest common ancestor is what produces a component holding six values, four of which it does
not use — which is exactly the `App` you have.

### 8. State colocation

The corollary of step 3, stated as a rule: **state belongs as close as possible to the thing
that uses it.**

| State | Lowest component that needs it | Where it should live |
|---|---|---|
| the search input's text | `IncidentSearch` and the filter predicate | above both — the provider |
| whether `Clear search` is disabled | `IncidentSearch` only | derived, in `IncidentSearch` |
| the input's DOM focus | `IncidentSearch` only | a ref, in `IncidentSearch` |
| the selected severity | `IncidentFilters` and `IncidentList` | above both — the provider |

Colocation is not a style preference. State held higher than necessary re-renders more of the
tree than necessary, is visible to more components than necessary, and — in Lesson 09.2 — drags
more of your application into the browser bundle than necessary. That last consequence is the
one this module is really preparing you for.

### 9. Composition first, context second

Before reaching for context, check whether the intermediate component could just be handed the
finished element.

```
BEFORE — a prop passes through            AFTER — composition
──────────────────────────────────        ──────────────────────────────────
<Page severity={severity} />              <Page filters={<FilterBar />} />
  └── <Layout severity={severity}>          └── <Layout>{filters}</Layout>
        └── <FilterBar severity={…} />

Layout has to know about severity.        Layout knows about `children`.
```

Passing elements as props — `children`, or a named prop holding JSX — removes an entire class of
drilling without introducing an implicit dependency. The element is created **where its data
lives**, and the intermediate component only positions it.

**The order to try things in, in this project:**

| Try | When |
|---|---|
| 1. a prop | one or two levels, one or two values |
| 2. composition (`children`, or an element as a prop) | the intermediate is a layout and does not need the data at all |
| 3. context | several values, several levels, and multiple consumers that are genuinely a subtree |
| 4. a state library | not in this course. Twenty-four modules and the answer never becomes Redux or Zustand. |

Module 11 uses composition heavily for the app shell, and this is the only context the finished
application has outside `next-intl`'s in Module 20. One context in twenty-four modules is the
right number.

### 10. The state inventory for the incident UI

Run the procedure from Key Concept 7 over everything on screen. This is the table, filled in,
and it is what Step 6 asks you to write down in your own words.

| Value on screen | Kind | Lives in |
|---|---|---|
| selected severity | **state** | `IncidentFilterProvider` |
| selected scapegoat | **state** | `IncidentFilterProvider` |
| search text | **state** | `IncidentFilterProvider` |
| debounced search text | **state** | inside `useDebouncedValue`, called by `IncidentList` |
| whether any filter is active | derived | one line in `FilterBar` |
| the filtered incident array | derived | `IncidentList`, during render |
| "12 of 40 incidents" | derived | `IncidentList`, during render |
| whether the empty state shows | derived | `IncidentList`, during render |
| the forty incidents | prop | `App` → `IncidentList` |
| an incident's severity label | derived | `IncidentCard` |
| "Nobody yet" for an unblamed incident | derived | `IncidentCard` |
| whether the stack-trace block appears | derived | `IncidentCard` |
| whether `Clear search` is disabled | derived | `IncidentSearch` |
| the input's focus | neither — the DOM's, reached by a ref | `IncidentSearch` |

**Fourteen values on screen. Four of them are state, and one of those four is hidden inside a
hook.** Eight are derived, one is a prop, and one is not React's business at all.

That ratio is the point of the whole module. Lesson 08.3 wrote one of those derived values as
state (`isFiltered`, kept in four handlers), Lesson 08.4 wrote two more as state and removed
them, and this lesson removes the last one. What is left is the smallest set of facts the screen
cannot compute — which is the correct definition of state, and the only one that scales past
three interactions.

---

## Task

### Step 1: Write the provider and the throwing consumer hook

One new file. It owns three pieces of state and one handler, publishes exactly seven members,
and exports exactly two names. Everything else on the screen is derived by whoever shows it.

```tsx
// next-app/src/components/incidents/IncidentFilterProvider.tsx
// The incident board's filter state, published to a subtree.
//
// Lesson 09.2 adds 'use client' to the top of this file and mounts it as far
// down the page as it will go — a provider at the top of a layout drags
// everything inside it into the browser bundle.
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

import type { ScapegoatFilter, SeverityFilter } from './IncidentFilters';

// SEVEN members and not one more. Everything a consumer can DERIVE, a consumer
// derives: `isFiltered` is one line in whoever displays it, and the debounced
// query is one hook call in whoever pays for the filtering. A context value is
// an interface, and the smallest one that works is the one to publish.
export type IncidentFilterValue = {
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  /** What the search input displays. Updates on every keystroke. */
  readonly query: string;
  readonly setSeverity: (next: SeverityFilter) => void;
  readonly setScapegoat: (next: ScapegoatFilter) => void;
  readonly setQuery: (next: string) => void;
  /** Resets all three. Not `reset`, not `clearFilters` — consumers destructure it by name. */
  readonly clear: () => void;
};

// `undefined`, deliberately. A plausible default — 'all' plus no-op setters —
// would turn "there is no provider above me" into a UI that renders, responds
// to clicks and filters nothing, forever, silently. See Key Concept 3.
const IncidentFilterContext = createContext<IncidentFilterValue | undefined>(undefined);

export function IncidentFilterProvider({ children }: { readonly children: ReactNode }) {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [scapegoat, setScapegoat] = useState<ScapegoatFilter>('all');
  const [query, setQuery] = useState('');

  function clear(): void {
    setSeverity('all');
    setScapegoat('all');
    setQuery('');
  }

  const value: IncidentFilterValue = {
    severity,
    scapegoat,
    query,
    // The raw setters, narrowed to "set a value". Consumers do not need the
    // updater form (Lesson 08.3 Key Concept 3) and giving it to them would be
    // one more thing they could get wrong.
    setSeverity,
    setScapegoat,
    setQuery,
    clear,
  };

  return (
    <IncidentFilterContext.Provider value={value}>{children}</IncidentFilterContext.Provider>
  );
}

/**
 * The ONLY way to read this context. The context object itself is not exported.
 *
 * Throws rather than returning `undefined`, so a missing provider is an error
 * with a fix in it instead of a component that silently does nothing.
 */
export function useIncidentFilters(): IncidentFilterValue {
  const value = useContext(IncidentFilterContext);

  if (value === undefined) {
    throw new Error('useIncidentFilters must be used inside <IncidentFilterProvider>');
  }

  return value;
}
```

**Verify §1:**

- [ ] `npm run type-check` is silent.
- [ ] `grep -c 'export const IncidentFilterContext' src/components/incidents/IncidentFilterProvider.tsx`
      prints `0`. The context object is private; the hook is the interface.
- [ ] The error string names both the hook and the provider. If yours says "context is
      undefined", rewrite it — the message is the whole reason for the throw.
- [ ] `IncidentFilterValue` has exactly seven members. If you were tempted to add
      `isFiltered` or the debounced query, that is the temptation Key Concept 10 exists to
      resist: both are derived, and a derived value published on a context is a derived value
      that every consumer now re-renders for.

### Step 2: Refactor `IncidentList` to ask for what it needs

Three props out, one hook call in.

```tsx
// next-app/src/components/incidents/IncidentList.tsx
// Reads its filters from context instead of being handed them by two ancestors.
// The `incidents` prop stays: the DATA is genuinely the caller's business, and
// Lesson 09.3 swaps that one prop from fixtures to a live WPGraphQL query.
import type { Incident } from '@/types/content';

import { IncidentCard } from './IncidentCard';
import { useIncidentFilters } from './IncidentFilterProvider';
import type { ScapegoatFilter, SeverityFilter } from './IncidentFilters';
import { useDebouncedValue } from './useDebouncedValue';

type IncidentListProps = {
  readonly incidents: readonly Incident[];
};

/** Pure, exported for Module 12, and outside the component because it closes over nothing. */
export function matchesFilters(
  incident: Incident,
  severity: SeverityFilter,
  scapegoat: ScapegoatFilter,
  query: string
): boolean {
  const bySeverity =
    severity === 'all' || incident.severities.nodes.some((term) => term.slug === severity);
  const byScapegoat =
    scapegoat === 'all' || incident.scapegoats.nodes.some((term) => term.slug === scapegoat);
  const needle = query.trim().toLowerCase();
  const byQuery = needle === '' || incident.title.toLowerCase().includes(needle);

  return bySeverity && byScapegoat && byQuery;
}

export function IncidentList({ incidents }: IncidentListProps) {
  const { severity, scapegoat, query } = useIncidentFilters();

  // The debounce lives HERE, in the component that pays for the work, rather
  // than in the provider. State colocation applied to a derived value: the
  // input's job is to feel instant, and re-filtering is this component's cost
  // to manage. Lesson 08.4 had it in the harness because there was nowhere
  // better; there is now.
  const debouncedQuery = useDebouncedValue(query, 250);

  const visible = incidents.filter((incident) =>
    matchesFilters(incident, severity, scapegoat, debouncedQuery)
  );

  if (visible.length === 0) {
    return <p>No incidents match these filters. Somebody, somewhere, is relieved.</p>;
  }

  return (
    <>
      <p>{`${visible.length} of ${incidents.length} incidents`}</p>
      <ul className="incident-list">
        {visible.map((incident) => (
          <li key={incident.slug}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </>
  );
}
```

> **`incidents` stays a prop and the debounce moved in, and neither is an inconsistency.** The
> filters are UI state that a subtree shares; the incidents are data that one caller owns.
> Putting the data on the context too would mean the provider had to know how to get incidents,
> which is precisely the coupling that makes Lesson 09.3's swap from fixtures to a live query a
> one-line change instead of a rewrite. Context for shared UI state, props for data.
>
> The debounce follows the same logic from the other direction. It is not a shared fact, it is
> one consumer's strategy for not doing expensive work too often — so it belongs to that
> consumer. If Module 11 adds a second view of the same filters that is cheap to re-render, it
> reads `query` directly and never pays for a timer.

### Step 3: Refactor the harness, and delete a whole props type

`FilterBar` loses all seven props. `App` loses all four pieces of state, all four handlers and
the debounce call.

```tsx
// next-app/scratch/App.tsx
import {
  IncidentFilterProvider,
  useIncidentFilters,
} from '@/components/incidents/IncidentFilterProvider';
import { IncidentFilters } from '@/components/incidents/IncidentFilters';
import { IncidentList } from '@/components/incidents/IncidentList';
import { IncidentSearch } from '@/components/incidents/IncidentSearch';
import { INCIDENTS } from '@/components/incidents/fixtures';

/**
 * The one adapter. It reads the context and hands the two leaf components their
 * props, so IncidentSearch and IncidentFilters stay fully CONTROLLED and remain
 * testable in Module 23 with two plain functions and no provider.
 *
 * Every consumer you add is a component that can no longer be rendered on its
 * own. Keeping that number at two, by choice, is the point of this shape.
 */
function FilterBar() {
  const { severity, scapegoat, query, setSeverity, setScapegoat, setQuery, clear } =
    useIncidentFilters();

  // ONE LINE, in the component that displays it. It replaces four
  // setIsFiltered calls that every future filter would have had to remember,
  // and it cannot disagree with its inputs because it is recomputed from them.
  const isFiltered = severity !== 'all' || scapegoat !== 'all' || query !== '';

  return (
    <>
      <IncidentSearch value={query} onChange={setQuery} />
      <IncidentFilters
        severity={severity}
        scapegoat={scapegoat}
        onSeverityChange={setSeverity}
        onScapegoatChange={setScapegoat}
        onClear={clear}
      />
      {isFiltered ? <p>Showing a filtered subset.</p> : null}
    </>
  );
}

export function App() {
  return (
    <main>
      {/* OUTSIDE the provider, on purpose. Nothing here reads a filter, so
          nothing here re-renders when one changes — and in Lesson 09.2 nothing
          here has to ship to the browser. */}
      <h1>Blame The Tech — incident board</h1>

      <IncidentFilterProvider>
        <FilterBar />
        <IncidentList incidents={INCIDENTS} />
      </IncidentFilterProvider>
    </main>
  );
}
```

Nine lines of `FilterBarProps`, fourteen lines of prop threading, four `useState` calls, four
handlers and a `useDebouncedValue` call: all gone from the harness. The provider that replaced
them is about fifty-five lines, so the arithmetic across the three files is a net reduction — and
the number that actually matters is that `IncidentList`'s props went from four to one.

Note where the two derived values landed. `isFiltered` is one line in `FilterBar`, the component
that shows it. `useDebouncedValue` is one line in `IncidentList`, the component that pays for
re-filtering. Neither is on the context, because neither is a **fact** — they are conclusions,
and a conclusion published on a context is a conclusion every consumer re-renders for.

**Verify §3:**

- [ ] Every behaviour is identical. Filter, search, clear, empty state, the count.
- [ ] `grep -c '] = useState' scratch/App.tsx` prints `0`. It was `4`.
- [ ] `grep -c 'Props' scratch/App.tsx` prints `0`. The whole type is gone.
- [ ] `npm run type-check && npm run lint` are clean. `react-hooks/rules-of-hooks` is watching
      `useIncidentFilters`, because the name begins with `use`.

### Step 4: Delete the state that was never state

The `isFiltered` state from Lesson 08.3 is already gone from the harness, because Step 3 deleted
it along with everything else. Look at what it cost and what replaced it, side by side, because
this is the payoff the whole module was building to.

```diff
- // scratch/App.tsx — Lesson 08.3, extended in Lesson 08.4
- const [isFiltered, setIsFiltered] = useState(false);
-
- function changeSeverity(next: SeverityFilter): void {
-   setSeverity(next);
-   setIsFiltered(next !== 'all' || scapegoat !== 'all' || query !== '');
- }
-
- function changeScapegoat(next: ScapegoatFilter): void {
-   setScapegoat(next);
-   setIsFiltered(severity !== 'all' || next !== 'all' || query !== '');
- }
-
- function changeQuery(next: string): void {
-   setQuery(next);
-   setIsFiltered(severity !== 'all' || scapegoat !== 'all' || next !== '');
- }
-
- function clearFilters(): void {
-   setSeverity('all');
-   setScapegoat('all');
-   setQuery('');
-   setIsFiltered(false);
- }

+ // scratch/App.tsx, inside FilterBar — Lesson 08.5
+ const isFiltered = severity !== 'all' || scapegoat !== 'all' || query !== '';
```

Twenty-four lines to one. Four places that had to stay in agreement to zero. And the three
`change*` wrappers existed **only** to keep `isFiltered` updated — with it gone, `setSeverity`,
`setScapegoat` and `setQuery` go straight onto the context and the wrappers disappear too.

Apply the rule from Key Concept 7 to the thing you just deleted: `isFiltered` could always
disagree with the three values it summarised, and a page reload never needed to preserve it. It
was derived from the first line it was written.

**Verify §4:**

- [ ] `grep -rc 'isFiltered' src/components/incidents/ scratch/ | grep -v ':0$'` names exactly
      one file, `scratch/App.tsx`, which both derives it and reads it, three lines apart. It is
      not on the context and no component outside `FilterBar` has heard of it.
- [ ] `grep -rn 'setIsFiltered' src/ scratch/` returns nothing.
- [ ] Set a filter, clear it, set another. The sentence appears and disappears correctly, with
      no handler anywhere responsible for making that true.

### Step 5: Prove the boundary, in both directions

Two experiments, five minutes, and they are what make the design decisions in Key Concepts 3
and 6 concrete instead of asserted.

First, the missing provider. Temporarily move `<IncidentList>` **outside** the provider:

```tsx
// next-app/scratch/App.tsx — TEMPORARY. Reverted below.
      <IncidentFilterProvider>
        <FilterBar />
      </IncidentFilterProvider>
      <IncidentList incidents={INCIDENTS} />
```

**Verify §5a:**

- [ ] The page shows Vite's error overlay with the message
      `useIncidentFilters must be used inside <IncidentFilterProvider>`, and a component stack
      that names `IncidentList`.
- [ ] `npm run type-check` is **silent**. The types cannot express "this component requires an
      ancestor", so the throw is doing work no compiler can do for you. That is why it is a
      `throw` and not a comment.
- [ ] Now imagine the plausible-default version from Key Concept 3 instead: the list would have
      rendered all forty incidents, the selects would have moved, and nothing would have
      filtered. Put `<IncidentList>` back inside the provider.

Second, the shadowing. Temporarily mount a second, nested board:

```tsx
// next-app/scratch/App.tsx — TEMPORARY. Reverted below.
      <IncidentFilterProvider>
        <FilterBar />
        <IncidentList incidents={INCIDENTS} />

        <h2>A second, independent board</h2>
        <IncidentFilterProvider>
          <FilterBar />
          <IncidentList incidents={INCIDENTS} />
        </IncidentFilterProvider>
      </IncidentFilterProvider>
```

**Verify §5b:**

- [ ] Two boards. Filter the inner one to `S1 — Catastrophic`; the outer one does not move.
- [ ] Filter the outer one; the inner one does not move. Two independent sets of state, from one
      component, with no prefixes and no coordination.
- [ ] There is no `global $post` arrangement that does this. Note the duplicated input `id`
      attributes in the DOM while you are here — two `id="incident-search"` values on one page is
      invalid HTML, and Lesson 22.2 is where that gets solved properly with `useId`.
- [ ] Remove the nested provider and its two children.

### Step 6: Write the state inventory down

The table from Key Concept 10, in your own words, in the architecture document. Module 09 reads
it when deciding what becomes a Client Component, and Module 12 reads it when deciding what to
test.

```markdown
<!-- docs/architecture.md — append -->
## State inventory: the incident UI (Lesson 08.5)

Fourteen values on screen. Four are state. Eight are derived during render, one is a
prop, and one belongs to the DOM.

| Value | Kind | Lives in |
|---|---|---|
| selected severity | state | `IncidentFilterProvider` |
| selected scapegoat | state | `IncidentFilterProvider` |
| search text | state | `IncidentFilterProvider` |
| debounced search text | state | inside `useDebouncedValue`, called by `IncidentList` |
| whether any filter is active | derived | one line in `FilterBar` |
| the filtered incident array | derived | `IncidentList` |
| "N of 40 incidents" | derived | `IncidentList` |
| whether the empty state shows | derived | `IncidentList` |
| the forty incidents | prop | `App` to `IncidentList` |
| an incident's severity label | derived | `IncidentCard` |
| "Nobody yet" for an unblamed incident | derived | `IncidentCard` |
| whether the stack-trace block appears | derived | `IncidentCard` |
| whether "Clear search" is disabled | derived | `IncidentSearch` |
| the input's focus | the DOM's, via a ref | `IncidentSearch` |

Rules I am applying from here on:

1. If two values on screen could ever disagree, one of them is derived. Compute it.
2. State goes to the lowest component that needs it, and is lifted only when two
   siblings must agree.
3. Context is for shared UI state, props are for data. `incidents` is a prop precisely
   so that Lesson 09.3 can swap fixtures for a live query without touching a component.
4. A context with no sensible default gets `undefined` and a consumer hook that throws.
5. A context publishes facts, not conclusions. `IncidentFilterValue` has seven members:
   three values, three setters and `clear`. Anything derivable is derived by whichever
   component shows it or pays for it.

Known debt, taken on deliberately: the search filters client-side over an array that is
already in memory. That is correct for 40 fixtures and wrong for 4,000 incidents —
Module 10 moves the work behind a cached query and Lesson 18.1 moves the filter state into
`searchParams` so the server does the filtering.
```

```bash
cd ..    # repo root
git add docs/architecture.md
git commit -m "docs: state inventory for the incident UI"
```

**Verify §6:**

- [ ] The document still reads as one architecture document rather than a stack of appendices.
      Edit the joins until it does.
- [ ] Every row's "Lives in" column names a file that exists.

### Step 7: Commit, and read the warning for Lesson 09.2

```bash
cd next-app && npm run verify && cd ..
# Expected: type-check, lint and format:check all pass

git add next-app/src/components/incidents/
git commit -m "feat(next): incident list with client-side filtering"
```

That commit message is the one the module has been building towards, and this is the end of the
module's code.

> **Where you mounted the provider is a decision you will be graded on in Lesson 09.2.** In
> Lesson 09.1 this project gains Next.js, `scratch/` is deleted, and `IncidentFilterProvider.tsx`
> gains `'use client'` at the top of the file. From that moment, **everything rendered inside
> the provider is a Client Component**, shipped to the browser, hydrated, and counted against
> your JavaScript budget in Module 21. `App.tsx` put the `<h1>` outside the provider for
> exactly this reason: a provider wrapped around a whole layout turns an entire page into a
> client bundle, which is the single most common way an App Router application ends up slower
> than the WordPress site it replaced. Lesson 09.2 mounts this provider around the filter bar
> and the list, and nothing else.

> **The harness dies in Lesson 09.1, and every component you wrote survives.** `next-app/scratch/`
> is deleted, the `scratch` npm script is removed, `vite` and `@vitejs/plugin-react` are
> uninstalled, and the `scratch/**` block comes out of `eslint.config.mjs`. Not one file in
> `src/components/incidents/` changes, because the harness only ever mounted them. That is what
> the separation in Lesson 08.1 was for, and it is why React and Next.js were learned as the two
> different technologies they are.

---

## Verification

```bash
cd next-app

# 1. The whole toolchain agrees
npm run verify
# Expected: type-check, lint and format:check all pass, in that order

# 2. IncidentList's props are down to ONE
sed -n '/^type IncidentListProps/,/^};/p' src/components/incidents/IncidentList.tsx
# Expected: exactly three lines — the type, `readonly incidents: readonly Incident[];`
#           and `};`. At the start of this lesson it also carried severity,
#           scapegoat and query.

# 3. NEGATIVE — not one filter prop survives in that signature
sed -n '/^type IncidentListProps/,/^};/p' src/components/incidents/IncidentList.tsx \
  | grep -cE 'severity|scapegoat|query'
# Expected: 0

# 4. The harness holds no state at all
grep -c '] = useState' scratch/App.tsx
# Expected: 0 — it was 4 at the end of Lesson 08.4
grep -c 'Props' scratch/App.tsx
# Expected: 0 — FilterBarProps and its seven fields are gone

# 5. The redundant state is gone, and the derived line replaced it
grep -rn 'setIsFiltered' src/ scratch/
# Expected: no output
grep -c 'const isFiltered =' scratch/App.tsx
# Expected: 1 — derived, in the one component that displays it

# 6. The context publishes exactly the seven pinned members and nothing derived
sed -n '/^export type IncidentFilterValue/,/^};/p' \
  src/components/incidents/IncidentFilterProvider.tsx | grep -c 'readonly'
# Expected: 7 — severity, scapegoat, query, three setters, clear
sed -n '/^export type IncidentFilterValue/,/^};/p' \
  src/components/incidents/IncidentFilterProvider.tsx | grep -cE 'isFiltered|debounced'
# Expected: 0 — a derived value on a context is a re-render for every consumer

# 7. The context object is private; the hook is the only door
grep -cE '^export (const|type) IncidentFilterContext' \
  src/components/incidents/IncidentFilterProvider.tsx
# Expected: 0
grep -c 'export function useIncidentFilters' \
  src/components/incidents/IncidentFilterProvider.tsx
# Expected: 1

# 8. NEGATIVE — the consumer hook THROWS a named error outside its provider
cat > src/components/incidents/_no-provider.tsx <<'TSX'
import { renderToStaticMarkup } from 'react-dom/server';

import { useIncidentFilters } from './IncidentFilterProvider';

function Consumer() {
  const filters = useIncidentFilters();
  return <p>{filters.severity}</p>;
}

try {
  console.log(renderToStaticMarkup(<Consumer />));
  console.log('NO THROW — a plausible default would have hidden this bug');
} catch (error) {
  console.log(error instanceof Error ? error.message : String(error));
}
TSX
npx tsx src/components/incidents/_no-provider.tsx 2>&1 | tail -1
# Expected: useIncidentFilters must be used inside <IncidentFilterProvider>
#           NOT "NO THROW", and NOT "Cannot read properties of undefined".
rm src/components/incidents/_no-provider.tsx

# 9. NEGATIVE — the compiler cannot express "needs an ancestor"
cat > src/components/incidents/_orphan.tsx <<'TSX'
import { IncidentList } from './IncidentList';

export function Orphan() {
  return <IncidentList incidents={[]} />;
}
TSX
npm run type-check; echo "exit=$?"
# Expected: exit=0 — CLEAN. Nothing in the type system says IncidentList needs a
#           provider above it, which is exactly why check 8's throw exists.
rm src/components/incidents/_orphan.tsx

# 10. NEGATIVE — no memoisation, and no data fetching, in the finished module
grep -rnE 'useMemo|useCallback|React\.memo|\bfetch\(' src/components/incidents/ scratch/
# Expected: no output. One context, three pieces of state, one effect, zero
#           memoisation — and Module 21 will measure before adding any.

# 11. Exactly one useEffect in the whole incident UI, still the timer
grep -rc 'useEffect(' src/components/incidents/ scratch/ | grep -v ':0$'
# Expected: exactly one line — src/components/incidents/useDebouncedValue.ts:1

# 12. The module ended SMALLER than it started this lesson
wc -l src/components/incidents/*.ts src/components/incidents/*.tsx scratch/App.tsx | tail -1
# Expected: fewer lines than the total you wrote down in Lesson 08.4 check 12,
#           despite a whole new file. Twenty-four lines of isFiltered plumbing,
#           nine lines of FilterBarProps and fourteen lines of prop threading
#           came out; a fifty-five-line provider went in.

# 13. The finished component set
ls src/components/incidents/
# Expected: IncidentCard.tsx  IncidentFilterProvider.tsx  IncidentFilters.tsx
#           IncidentList.tsx  IncidentSearch.tsx  fixtures.ts
#           useDebouncedValue.ts

# 14. Everything is committed, and the harness never was
cd ..
git status --short
# Expected: clean
git log --oneline -1
# Expected: feat(next): incident list with client-side filtering
git show --stat HEAD | grep -c scratch
# Expected: 0 — not one harness file has ever entered a commit
```

Checks 8 and 9 are the pair that matters. Together they say: the type system cannot enforce
this invariant, so the code has to, and the error message is the interface. Check 12 is the one
to show somebody who thinks a refactor means more code.

## Control Questions

1. `createContext<IncidentFilterValue | undefined>(undefined)` could just as easily have been
   given a default object of `'all'`, `'all'`, `''` and three no-op setters. Describe exactly
   what a user would see if `IncidentList` were rendered outside the provider under each of the
   two versions, and say which one a test would catch.
2. `useIncidentFilters` throws instead of returning `undefined`. Name three things that single
   design decision buys, and one thing it costs in Module 23.
3. Context is often described as making an app faster by avoiding prop drilling. Give a concrete
   change to this provider that would make the incident board measurably slower, and explain the
   re-render path that causes it.
4. `incidents` stayed a prop while `severity` moved to the context. State the rule that
   distinguishes them, and say which later lesson would become much harder if `incidents` were
   on the context too.
5. `isFiltered` was `useState` in Lesson 08.3, was updated in four handlers by the end of
   Lesson 08.4, and is one line now. Give the two questions from the thinking-in-React procedure
   that identify it as derived, and name the specific bug the four-handler version was one new
   filter away from.

## Learn More

- [Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) —
  react.dev's own walkthrough, including its "before you use context" checklist
- [`useContext`](https://react.dev/reference/react/useContext) — the reference, with the
  troubleshooting section on providers that do not take effect
- [`createContext`](https://react.dev/reference/react/createContext) — what the default argument
  is actually for, and the note that it is only used with no provider above
- [Thinking in React](https://react.dev/learn/thinking-in-react) — the procedure in Key Concept
  7, in the words of the people who designed the model
- [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) — the
  "avoid redundant state" and "avoid duplication" sections are the argument this lesson applied
  to `isFiltered`
- [Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) —
  lifting state to the nearest common ancestor, and no higher
- [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer)
  — where this provider would go next if it grew four more values; deliberately not used here
- [`global $post` and `setup_postdata()`](https://developer.wordpress.org/reference/functions/setup_postdata/)
  — worth one last read next to Key Concept 6, to see precisely what scoping bought
