---
title: 'Effects, Refs & the Lifecycle'
module: 8
lesson: 4
teaches: [use-effect, effect-cleanup, use-ref, custom-hooks, you-might-not-need-an-effect]
produces: ['next-app/src/components/incidents/IncidentSearch.tsx', 'next-app/src/components/incidents/useDebouncedValue.ts']
requires: [8.3]
---

# Lesson 08.4 — Effects, Refs & the Lifecycle

## Quick Overview

`useEffect` is the hook that lets a component reach outside React — timers, event listeners,
focus, `document.title`, anything the render pass itself must not do. It is also the most
misused hook in React, because it looks like a lifecycle callback and it is not one. This
lesson teaches it the way you will want to have learned it: what an effect actually is, when
the dependency array runs it again, why cleanup exists, and — most importantly — the list of
things you are about to reach for an effect for that need no effect at all.

You will build `IncidentSearch`, a text input that filters incidents by title. The search
value is state, the filtered result is derived, and the only genuine effect in the whole
component is a debounce timer, which you extract into a reusable `useDebouncedValue` hook.
You will also use `useRef` to move keyboard focus to the input when the "clear filters" button
runs, which is the kind of thing that reads as a nice touch here and turns into a WCAG
requirement in Module 22.

By the end of this lesson you will have:

- `next-app/src/components/incidents/IncidentSearch.tsx` — a controlled search input with a debounced query
- `next-app/src/components/incidents/useDebouncedValue.ts` — your first custom hook, with a cleanup function
- A `useRef`-driven focus move, demonstrated with the keyboard only
- A deliberately wrong effect (deriving filtered results into state) written, observed double-rendering, then deleted
- A written note of the three effects you removed and what replaced them

## Classic WP Analogy

WordPress gives you hooks that fire at known points in a page's life, and you have used them
to do exactly what effects do:

| Classic WordPress | React | What fires it |
|---|---|---|
| `add_action('wp_enqueue_scripts', …)` | an effect with `[]` deps | once, after the first render |
| `add_action('save_post', …)` | an effect with `[value]` deps | after any render where `value` changed |
| `jQuery(document).ready(…)` | an effect with `[]` deps | after the DOM exists |
| `wp_deregister_script()` on teardown | the function an effect **returns** | before the next run, and on unmount |
| `$('#q').focus()` | `inputRef.current?.focus()` | whenever you call it |

The comparison holds for the "run this after the thing exists" shape. It breaks on
**frequency and ownership**. A WordPress hook fires once per request and the process then
exits, so cleanup is somebody else's problem. A React effect can run on every single render,
forever, in the same browser tab, which is why the returned cleanup function is not optional
politeness: an effect that adds an event listener and never removes it leaks one listener per
render. In development React deliberately mounts, unmounts and remounts every component once
to make missing cleanup visible immediately — that double-run is a feature, and this lesson
shows you the effect it exposes.

The second break is the one worth writing on a sticky note: **most effects are the wrong
tool.** WordPress trains you to think in hooks, so the instinct is to hook everything. In
React, if a value can be computed from props and state, compute it during render — do not
store it in state and sync it with an effect. Filtering a list, formatting a date, deriving a
count, resetting state when a prop changes: none of these is an effect. The official React
docs have a page titled "You Might Not Need an Effect", and the reason it exists is that the
WordPress-and-jQuery instinct is extremely common and extremely expensive.

---

## Key Concepts

### 1. An effect is code React runs after committing to the DOM

Rendering must be **pure**: given the same props and state, a component returns the same
description and touches nothing outside itself. No timers, no listeners, no `document.title`, no
network calls, no writes to anything a second render could observe.

`useEffect` is the sanctioned way to do those things anyway. React finishes rendering, applies
the changes to the DOM, lets the browser paint, and *then* runs your effect.

```
                    ┌──────────────────────────────────────────────┐
   state changes ──▶ │ 1. RENDER   App() runs. Pure. Returns a      │
                    │             description. No side effects.     │
                    │ 2. COMMIT   React mutates the real DOM to     │
                    │             match the description.            │
                    │ 3. PAINT    the browser draws it.             │
                    │ 4. EFFECTS  your useEffect callbacks run.     │
                    └──────────────────────────────────────────────┘
                                            │
                       setState in an effect ┘  ──▶ back to 1. This is why an
                                                  effect that sets state costs a
                                                  second render and a second paint.
```

That last arrow is the cost of every effect that writes state, and it is why Key Concept 9
exists. An effect is not free and it is not a lifecycle callback — it is a synchronisation
mechanism, and the question it answers is "what outside React needs to be brought in line with
this render?"

Nothing in this module needs data fetching, so the honest list of legitimate effects here is
short: a timer. That is it.

### 2. The dependency array decides when it runs again

```
useEffect(setup, deps)
```

React compares each entry of `deps` with the previous render's, using `Object.is`. If any
differ, it runs the cleanup from last time and then the setup again.

| `deps` | Setup runs | Typical use |
|---|---|---|
| `[]` | once, after the first commit | subscribe to something that never changes |
| `[a, b]` | after the first commit, then whenever `a` or `b` changes | the normal case — a timer keyed on a value |
| omitted entirely | after **every** commit | almost always a mistake; combined with a `setState` inside, an infinite loop |

The trap in the third row is worth spelling out. An effect with no dependency array that calls
`setState` renders, commits, runs, sets state, renders, commits, runs, forever. React catches
some of these with "Maximum update depth exceeded"; it does not catch all of them, and a
loop that only fires when a specific value is present will get past you.

`[]` is not "on mount" in the sense a WordPress hook is "on this request". It is "these
dependencies never change, so never re-synchronise". With StrictMode on, and with Fast Refresh
during development, an `[]` effect can run more than once in a session — see Key Concept 4.

### 3. Cleanup is not politeness

An effect may return a function. React calls it before the next run of the same effect, and
once more when the component unmounts.

```
mount            setup()                       timer scheduled
value changes    cleanup(); setup()            old timer cancelled, new one scheduled
value changes    cleanup(); setup()            same again
unmount          cleanup()                     nothing left running
```

A WordPress hook fires once per request and the process then exits, so anything you forgot to
tidy is freed by the operating system a few milliseconds later. Cleanup genuinely is somebody
else's problem. A React effect runs in a browser tab that a user leaves open for eight hours.

Concretely, what each missing cleanup costs:

| Effect does | Without cleanup |
|---|---|
| `setTimeout` | every scheduled callback fires, so a debounce is not a debounce — one update per keystroke, just later |
| `setInterval` | a second interval per run, all still ticking. Ten renders, ten intervals. |
| `addEventListener` | one listener per render, all of them called, forever, in the same tab |
| `WebSocket` / `EventSource` | one open connection per render |
| an in-flight `fetch` | the response of an abandoned request overwrites the current one — the classic out-of-order-results bug |

> **No tool in your toolchain catches a missing cleanup.** `tsc` sees a well-typed effect.
> ESLint sees exhaustive dependencies. The Verification block below proves both, with a leaky
> listener that passes every check you have. The only thing that surfaces it is StrictMode
> mounting your component twice, which is the next Key Concept and the reason it exists.

### 4. StrictMode mounts, unmounts and remounts — that is the feature

Lesson 08.1 established that `StrictMode` calls every component function twice in development.
It does something stronger to effects: it runs setup, then cleanup, then setup again, on the
very first mount.

```
PRODUCTION                          DEVELOPMENT, inside <StrictMode>
────────────────────────            ─────────────────────────────────────
setup()                             setup()
                                    cleanup()      ← simulates a remount
                                    setup()
```

If your effect is correctly written, that sequence is invisible: the cleanup undoes exactly what
the setup did and the second setup rebuilds it. If cleanup is missing, you now have two of
whatever the effect created, **on the first page load**, instead of discovering it in three
weeks when a user navigates away and back.

The doubled behaviour is stripped from a production build. It is not a performance concern and
it is not something to work around. Deleting `StrictMode` because a log line appeared twice is
the single most expensive shortcut available in this module: it does not fix anything, it
switches off the only detector you have for the bug class in Key Concept 3.

### 5. The dependency lint rule, and why suppressing it is almost always wrong

`react-hooks/exhaustive-deps` reads your effect body, works out every reactive value it uses,
and compares that with your `deps` array. `eslint.config.mjs` sets it to `error` (Lesson 08.1
Step 3) rather than the plugin's default `warn`, because `npm run lint` runs with
`--max-warnings=0` anyway and calling it a warning only hides which line is at fault.

When it complains, one of three things is true, and only the third is ever a suppression:

| The rule says | What it usually means | What to do |
|---|---|---|
| "missing dependency: `query`" | your effect reads a value it claims not to depend on, so it will run with a stale one | add it |
| "unnecessary dependency: `setQuery`" | setters returned by `useState` are stable and never need listing | remove it |
| you want the effect to run on mount only, but it reads a changing value | the effect is doing the wrong job — usually deriving state | **delete the effect** |

The suppression comment is the tell. `// eslint-disable-next-line react-hooks/exhaustive-deps`
almost always sits above an effect that should not exist, and this lesson's Verification asserts
that the count of those comments in the whole project is zero. If you find yourself reaching for
one, re-read Key Concept 9 first; the answer is there roughly nine times out of ten.

### 6. `useRef` is a box that does not cause a render

```
const [count, setCount] = useState(0);      changing it RE-RENDERS
const timer = useRef<number | null>(null);  changing it does NOT re-render
                                            read and write timer.current freely
```

`useRef(initial)` returns `{ current: initial }` — the same object on every render, forever.
Writing to `.current` is a plain property assignment: React does not know and does not care.

| | `useState` | `useRef` |
|---|---|---|
| Survives renders | yes | yes |
| Changing it re-renders | **yes** | **no** |
| Read during render | yes, that is the point | **no** — see below |
| Use for | anything the UI displays | a DOM node, a timer handle, a "did this already happen" flag |

The rule that catches people: **do not read or write `ref.current` during render.** Rendering
must be pure, and a ref is mutable state outside React's knowledge, so a render that reads it can
produce different output for the same props. React cannot re-render when it changes, so the
screen would be wrong with no way to fix itself. Refs belong in event handlers and effects,
where the render has already happened.

If a value is displayed, it is state. If it is machinery, it is a ref. `IncidentSearch` uses one
ref, for one DOM node, read in one click handler.

### 7. DOM refs: the one supported way to touch a real element

Pass a ref to an element's `ref` attribute and React writes the DOM node into `.current` after
the commit.

```tsx
// — (illustration)
const inputRef = useRef<HTMLInputElement>(null);

<input ref={inputRef} />

function handleClear(): void {
  onChange('');
  inputRef.current?.focus();   // AFTER the click. The node exists.
}
```

`null` is the correct initial value, and `?.` is not defensive noise: before the first commit
the node genuinely does not exist, and after an unmount it is set back to `null`.

The legitimate uses are narrow and they are all things React has no declarative API for:
focus, text selection, scrolling into view, measuring, and playing media. Everything else —
adding a class, changing text, showing and hiding — is state, and reaching for a ref to do it is
the jQuery habit wearing a React hat.

Moving focus is the one that matters most here. It reads as a nice touch in Module 08 and
becomes a WCAG 2.2 requirement in Module 22: a control that clears an input and leaves focus on
itself has stranded a keyboard user, who now has to tab backwards to reach the thing they were
editing.

### 8. A custom hook shares logic, never state

A custom hook is a function whose name begins with `use` and which calls other hooks. That is
the entire specification. There is no registration, no base class, and nothing special about the
file it lives in.

```
useDebouncedValue(value, delayMs)
  │
  ├── calls useState  ─── its own state, one copy per CALL SITE
  └── calls useEffect ─── its own effect, one per call site
```

The `use` prefix is not a convention for humans, it is how the linter knows to apply
`rules-of-hooks` to the function, and how it knows that calling it inside a condition is an
error. A helper that does not call hooks should **not** be named `useX`.

**Two components calling `useDebouncedValue` share the code and share nothing else.** Each call
site gets its own `useState`, its own timer and its own value. This is the opposite of what a
WordPress developer expects from a shared function reading a global, and it is the property that
makes hooks composable: there is no coordination to think about, because there is nothing shared
to coordinate.

Extracting one is a mechanical exercise: move the state and the effect into a function, take the
inputs as parameters, return what the component needs. If the extraction is hard, it is usually
because the effect was doing two jobs.

### 9. You Might Not Need an Effect

This is the section to re-read in six months. React's own documentation has a page with this
title, and it exists because the instinct to reach for an effect is close to universal — and for
someone whose mental model is `add_action()`, it is close to inevitable.

The rule: **an effect synchronises with something outside React. If both sides of the
synchronisation are inside React, you do not want an effect.**

| Tempted to | Do instead |
|---|---|
| store filtered results in state and sync them with an effect | compute during render |
| format a date, build a label or sum a column in an effect | compute during render |
| reset state when a prop changes | put a `key` on the component, or compute the value instead of storing it |
| update one piece of state when another changes | derive the second from the first; it was never state |
| notify a parent that something changed | call the parent's callback in the event handler that caused it |
| **fetch data in an effect** | **a Server Component — Lesson 09.3** |

That last row is the bridge out of this module, and it is why Module 08 has no data fetching in
it. The `useEffect(() => { fetch(...) }, [])` pattern is what every React tutorial written
before 2023 teaches, and in the App Router it is the wrong answer three times over: it runs in
the browser, so the request needs a public endpoint and a CORS policy; it runs after the paint,
so the user sees a spinner where content could have been; and it duplicates work the server has
already done. Lesson 09.3 replaces the whole pattern with an `async` component that awaits its
data before rendering, and this application never fetches from an effect. Not once, in
twenty-four modules.

The cost of the rule, stated plainly: computing during render means computing on every render.
For forty fixtures that is free. For a genuinely expensive computation over a large list there is
`useMemo`, this module deliberately does not teach it, and Module 21 introduces it **after**
measuring — because a reflex to memoise everything costs more in complexity than it ever
recovers in milliseconds.

---

## Task

### Step 1: Write the search input

Controlled, like the selects in Lesson 08.3, and with its own clear button so that the focus
move lives next to the thing being focused.

```tsx
// next-app/src/components/incidents/IncidentSearch.tsx
// A controlled search box. Holds no state: the query lives with the other
// filters, further up the tree. The only thing it owns is a ref to its own input.
import { useRef } from 'react';
import type { ChangeEvent } from 'react';

// `value` and `onChange`, matching the names the DOM element uses. Lesson 09.2's
// client island renders this component and passes exactly these two.
type IncidentSearchProps = {
  readonly value: string;
  readonly onChange: (next: string) => void;
};

export function IncidentSearch({ value, onChange }: IncidentSearchProps) {
  // A DOM node, not a displayed value. `null` until React commits the element.
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value);
  }

  function handleClear(): void {
    onChange('');
    // In an event handler, after the commit, so the node exists. Never during
    // render. A button that clears a field and keeps focus has stranded every
    // keyboard user — Module 22 audits exactly this.
    inputRef.current?.focus();
  }

  return (
    <div className="incident-search">
      <label htmlFor="incident-search">Search titles</label>
      <input
        id="incident-search"
        ref={inputRef}
        type="search"
        value={value}
        onChange={handleChange}
        placeholder="regex, certificate, cron"
      />
      <button type="button" onClick={handleClear} disabled={value === ''}>
        Clear search
      </button>
    </div>
  );
}
```

> **Why not forward a ref from the filter bar's `Clear filters` button?** React has an API for
> that — a ref passed as a prop, plus `useImperativeHandle` — and it is deliberately not used
> here. Pushing the focus move down to the component that owns the input needs no API at all,
> and it is the same instinct Lesson 08.5 formalises as state colocation: put the thing next to
> what it acts on, and the plumbing disappears.

### Step 2: Move the filter chain into `IncidentList`

Lesson 08.3 filtered in the harness `App` and handed `IncidentList` a pre-filtered array. That
was right for one filter and stops being right now, for a reason that has nothing to do with
effects: the count and the empty state are statements **about the list**, and they belong with
it. A component that renders a list should be the component that knows how many of them there
are.

Replace `IncidentList.tsx`:

```tsx
// next-app/src/components/incidents/IncidentList.tsx
// Now owns the filtering, the count and the empty state — the three things that
// are statements about the list rather than about whoever renders it.
//
// Three of these four props are filter values being handed down from two levels
// up. That is prop drilling, it is about to get worse, and Lesson 08.5 removes
// all three from this signature.
import type { Incident } from '@/types/content';

import { IncidentCard } from './IncidentCard';
import type { ScapegoatFilter, SeverityFilter } from './IncidentFilters';

type IncidentListProps = {
  readonly incidents: readonly Incident[];
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  readonly query: string;
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

export function IncidentList({ incidents, severity, scapegoat, query }: IncidentListProps) {
  // DERIVED during render — Lesson 08.3 Key Concept 7, one level lower down.
  const visible = incidents.filter((incident) =>
    matchesFilters(incident, severity, scapegoat, query)
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

The empty-state sentence changed, because the condition changed: an empty `incidents` array and
a filter that matches nothing are different situations and Lesson 08.2's wording only covered
the first. The fragment wrapper is there because the count and the `<ul>` are siblings and a
component returns one element (Lesson 08.1 Key Concept 6).

### Step 3: Add the query, add a wrapper, and feel the drilling

`App` now holds four pieces of state, and the two leaf components that need them sit under a
grouping component. Write that grouping component honestly — it uses **none** of the seven props
it receives.

```tsx
// next-app/scratch/App.tsx
import { useState } from 'react';

import { IncidentFilters } from '@/components/incidents/IncidentFilters';
import type {
  ScapegoatFilter,
  SeverityFilter,
} from '@/components/incidents/IncidentFilters';
import { IncidentList } from '@/components/incidents/IncidentList';
import { IncidentSearch } from '@/components/incidents/IncidentSearch';
import { INCIDENTS } from '@/components/incidents/fixtures';

type FilterBarProps = {
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  readonly query: string;
  readonly onSeverityChange: (next: SeverityFilter) => void;
  readonly onScapegoatChange: (next: ScapegoatFilter) => void;
  readonly onQueryChange: (next: string) => void;
  readonly onClear: () => void;
};

/**
 * Uses NOT ONE of its seven props. Every line of it is postage.
 *
 * This is prop drilling, in its purest form, and it is here rather than hidden
 * because Lesson 08.5 deletes the whole props type in one edit.
 */
function FilterBar({
  severity,
  scapegoat,
  query,
  onSeverityChange,
  onScapegoatChange,
  onQueryChange,
  onClear,
}: FilterBarProps) {
  return (
    <>
      <IncidentSearch value={query} onChange={onQueryChange} />
      <IncidentFilters
        severity={severity}
        scapegoat={scapegoat}
        onSeverityChange={onSeverityChange}
        onScapegoatChange={onScapegoatChange}
        onClear={onClear}
      />
    </>
  );
}

export function App() {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [scapegoat, setScapegoat] = useState<ScapegoatFilter>('all');
  const [query, setQuery] = useState('');
  // The Lesson 08.3 debt, now with a fourth handler to remember it in.
  const [isFiltered, setIsFiltered] = useState(false);

  function changeSeverity(next: SeverityFilter): void {
    setSeverity(next);
    setIsFiltered(next !== 'all' || scapegoat !== 'all' || query !== '');
  }

  function changeScapegoat(next: ScapegoatFilter): void {
    setScapegoat(next);
    setIsFiltered(severity !== 'all' || next !== 'all' || query !== '');
  }

  function changeQuery(next: string): void {
    setQuery(next);
    setIsFiltered(severity !== 'all' || scapegoat !== 'all' || next !== '');
  }

  function clearFilters(): void {
    setSeverity('all');
    setScapegoat('all');
    setQuery('');
    setIsFiltered(false);
  }

  return (
    <main>
      <h1>Blame The Tech — incident board</h1>

      <FilterBar
        severity={severity}
        scapegoat={scapegoat}
        query={query}
        onSeverityChange={changeSeverity}
        onScapegoatChange={changeScapegoat}
        onQueryChange={changeQuery}
        onClear={clearFilters}
      />

      {isFiltered ? <p>Showing a filtered subset.</p> : null}

      <IncidentList
        incidents={INCIDENTS}
        severity={severity}
        scapegoat={scapegoat}
        query={query}
      />
    </main>
  );
}
```

**Verify §3:**

- [ ] `npm run scratch`. Typing `cert` narrows the list; both selects still work; the count
      tracks the list exactly.
- [ ] Count the values threaded through `FilterBar`: seven, of which it uses zero. Count the
      filter props on `IncidentList`: three. Count the handlers that have to remember
      `isFiltered`: four. Write those three numbers down — Lesson 08.5's Verification asks for
      them again.
- [ ] The list re-renders on **every keystroke**. With forty fixtures that is imperceptible,
      which is the problem: it will not stay imperceptible. Lesson 09.3 puts a real WordPress
      query behind this input, and Lesson 23.2's component tests type into it one character at
      a time.

### Step 4: Extract the debounce into a custom hook

A timer is one of the genuinely correct uses of an effect: it touches a browser API, the browser
keeps running it whether or not React renders again, and it has to be cancelled. Every clause of
Key Concept 3 applies at once.

```ts
// next-app/src/components/incidents/useDebouncedValue.ts
// The module's only legitimate effect. A debounce touches a browser timer, which
// is outside React, keeps running on its own, and must be cancelled.
import { useEffect, useState } from 'react';

/**
 * Returns `value`, but no sooner than `delayMs` after it last changed.
 *
 * Generic on purpose: nothing in here knows or cares that the value is a search
 * string. Module 16 debounces a different type with the same hook.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    // Do not annotate the handle as `number`. With @types/node in scope this is
    // NodeJS.Timeout, and `ReturnType<typeof setTimeout>` is the portable way to
    // say "whatever this platform returns". clearTimeout accepts either.
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    // THE POINT OF THE HOOK. Every keystroke cancels the pending update before
    // scheduling a new one, so only the last one in a burst survives. Delete
    // this return and the hook stops being a debounce.
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
```

Both dependencies are listed, so `react-hooks/exhaustive-deps` is satisfied with no suppression.
`setDebounced` is not listed, because `useState` setters are stable across renders and the rule
knows it.

### Step 5: Wire the debounced value into the filter chain, and only there

Two values from one source, with two different consumers.

```tsx
// next-app/scratch/App.tsx — edit, inside App, under the useState calls
  // `query` drives the INPUT, so it must update on every keystroke.
  // `debouncedQuery` drives the FILTER, which does not need to.
  const debouncedQuery = useDebouncedValue(query, 250);
```

```tsx
// next-app/scratch/App.tsx — edit: the list filters on the debounced value
      <IncidentList
        incidents={INCIDENTS}
        severity={severity}
        scapegoat={scapegoat}
        query={debouncedQuery}
      />
```

`FilterBar` keeps receiving the undebounced `query`, because that is what the input displays.
Getting these two the wrong way round produces an input that drops characters when you type
quickly, which is the most annoying bug in this module to diagnose from a description.

**Verify §5:**

- [ ] Typing feels identical — the input never lags, because it is still driven by `query`.
- [ ] The list settles about a quarter of a second after you stop typing.
- [ ] Type `certificate` at speed with a temporary `console.count('filter')` next to the
      `visible` computation in `IncidentList`. It advances a handful of times, not once per
      character.
- [ ] Now delete `return () => { clearTimeout(timer); };` from the hook and repeat.
      `console.count('filter')` advances **once per character**, each one 250 ms late. The
      debounce is gone, and the symptom is not an error — it is the feature quietly not working.
      Put the cleanup back, and remove the log.

### Step 6: Write three effects that should not exist

Everything so far has been correct. Now write the code instinct would have produced, so that
deleting it in Step 7 is something you have done rather than something you read.

Two of them go in `IncidentList`, because that is where the derived values now live:

```tsx
// next-app/src/components/incidents/IncidentList.tsx — BOTH WRONG. Deleted in Step 7.
import { useEffect, useState } from 'react';

export function IncidentList({ incidents, severity, scapegoat, query }: IncidentListProps) {
  // WRONG #1 — derive the filtered array into state and sync it with an effect.
  const [visible, setVisible] = useState<readonly Incident[]>(incidents);

  useEffect(() => {
    setVisible(
      incidents.filter((incident) => matchesFilters(incident, severity, scapegoat, query))
    );
  }, [incidents, severity, scapegoat, query]);

  // WRONG #2 — derive the count into state, from the state effect #1 sets.
  const [count, setCount] = useState(incidents.length);

  useEffect(() => {
    setCount(visible.length);
  }, [visible]);

  // …and render {count} instead of {visible.length}
```

The third goes in the harness, because that is where `query` lives:

```tsx
// next-app/scratch/App.tsx — WRONG. Deleted in Step 7.
  // WRONG #3 — reset the search box whenever the severity changes.
  useEffect(() => {
    setQuery('');
  }, [severity]);
```

Add one temporary line at the top of `IncidentList` so you can watch the renders:

```tsx
// next-app/src/components/incidents/IncidentList.tsx — TEMPORARY
  console.log('IncidentList render', { severity, visible: visible.length, count });
```

**Verify §6:**

- [ ] Reload. The console shows **four** lines before you touch anything: the initial render and
      the post-effect render, each doubled by StrictMode. Both effects ran on mount and both set
      state, so the page rendered twice to show data that was available the first time.
- [ ] Change the severity to `S1 — Catastrophic` and read the lines in order. There is a render
      where `severity` is already `s1-catastrophic` and `visible` is still `40`. **The heading
      and the list disagree, for one frame.** That is the jQuery bug from Lesson 08.3's Classic
      WP Analogy, faithfully reintroduced by an effect.
- [ ] `count` lags `visible` by a further render, because effect #2 depends on the state effect
      #1 sets. Two effects, three renders, one keystroke.
- [ ] Type into the search box, then change the severity. Your text vanishes — effect #3 firing.
      It also fires on mount, and again on StrictMode's second mount, and it cannot tell any of
      those apart from a real change.
- [ ] `npm run lint` **passes**. Every dependency array above is exhaustive. All three effects
      are wrong and no tool objects, which is why Key Concept 9 is worth memorising rather than
      re-deriving each time.

### Step 7: Delete all three, then write down what you removed

Put `IncidentList` back to the Step 2 version: no `useState`, no `useEffect`, no `react` import
at all, `visible` computed during render and the count read from `visible.length`. Delete effect
#3 from `App.tsx` outright.

Effect #3 gets no replacement. Resetting the search when the severity changes was a guess about
what a user wants, it fought the user mid-word, and the honest options are to leave the query
alone or — if a reset genuinely is required — to give the component a `key` that changes with
the severity, so React remounts it and its state starts fresh. Leave it alone.

**Verify §7:**

- [ ] The console shows **two** render lines on load, not four. Then delete that log too.
- [ ] Changing a filter produces one render, in which the count and the list already agree.
      There is no frame where they disagree, because there is nothing to keep in sync.
- [ ] The search box keeps its text when you change the severity.
- [ ] `grep -c '] = useState' src/components/incidents/IncidentList.tsx` prints `0`.
- [ ] `grep -c '] = useState' scratch/App.tsx` prints `4` — severity, scapegoat, query and the
      `isFiltered` debt. Lesson 08.5 gets it to `0`.

Then record the pattern, in your own words, in the architecture document you started in
Module 01:

```markdown
<!-- docs/architecture.md — append -->
## Effects removed from the incident UI (Lesson 08.4)

An effect synchronises React with something outside it. If both sides of the
synchronisation are inside React, the effect buys a second render and a chance for two
values to disagree.

| Removed | Why it was wrong | Replaced by |
|---|---|---|
| effect deriving `visible` into state in `IncidentList` | both inputs were already in React; it produced a frame where the count and the list disagreed | `incidents.filter(...)` during render |
| effect deriving `count` from `visible` | derived from derived, and lagging by one more render | `visible.length` during render |
| effect resetting `query` when `severity` changed, in the harness | indistinguishable from a mount, and it fought the user mid-word | nothing. If a reset is ever required, a changing `key` remounts the component. |

The only effect left in the incident UI is the `setTimeout` inside `useDebouncedValue`,
which is legitimate because a browser timer keeps running whether React renders or not
and therefore has to be cancelled.

**Data fetching will never be an effect in this project.** Server Components fetch before
they render (Lesson 09.3), so there is no browser request, no public endpoint, no CORS
policy, and no spinner over content the server already had.
```

Then append that section to the file and commit both halves:

```bash
cd ..    # repo root
git add docs/architecture.md next-app/src/components/incidents/
git commit -m "feat(web): debounced incident search, and three effects deleted"
```

---

## Verification

```bash
cd next-app

# 1. Types and lint are clean
npm run type-check && npm run lint && echo "green"
# Expected: green

# 2. Exactly ONE useEffect survives in the whole incident UI, and it is the timer
grep -rc 'useEffect(' src/components/incidents/ scratch/ | grep -v ':0$'
# Expected: exactly one line —
#           src/components/incidents/useDebouncedValue.ts:1

# 3. That effect has a cleanup function
grep -c 'clearTimeout' src/components/incidents/useDebouncedValue.ts
# Expected: 1

# 4. The hook is generic, not hard-coded to a string
grep -c 'useDebouncedValue<T>' src/components/incidents/useDebouncedValue.ts
# Expected: 1

# 5. NEGATIVE — zero dependency-rule suppressions anywhere in the project
grep -rn 'eslint-disable.*exhaustive-deps' src/ scratch/
# Expected: no output. Not one. A suppression here is almost always an effect
#           that should have been deleted instead.

# 6. NEGATIVE — the rule is wired as an ERROR, so a lying deps array fails
cat > src/components/incidents/_deps.ts <<'TS'
import { useEffect, useState } from 'react';

export function useEcho(value: string): string {
  const [echo, setEcho] = useState('');

  useEffect(() => {
    setEcho(value);
  }, []);

  return echo;
}
TS
npm run lint; echo "exit=$?"
# Expected: react-hooks/exhaustive-deps naming 'value', then exit=1. NOT exit=0.
rm src/components/incidents/_deps.ts

# 7. NEGATIVE — NOTHING in your toolchain catches a missing cleanup
cat > src/components/incidents/_leaky.ts <<'TS'
import { useEffect } from 'react';

export function useLeakyListener(onResize: () => void): void {
  useEffect(() => {
    window.addEventListener('resize', onResize);
    // No cleanup. One listener per run, forever, in this tab.
  }, [onResize]);
}
TS
npm run type-check && npm run lint && echo "BOTH CLEAN"
# Expected: BOTH CLEAN. tsc sees a well-typed effect; ESLint sees exhaustive
#           dependencies. The only thing that surfaces this is StrictMode's
#           second mount, in the browser. That is why StrictMode stays on.
rm src/components/incidents/_leaky.ts

# 8. NEGATIVE — the module's exclusions still hold after adding a hook
grep -rnE 'useMemo|useCallback|React\.memo|\bfetch\(' src/components/incidents/ scratch/
# Expected: no output. The debounce is a timer, not a memoisation.

# 9. Nothing derived is stored in state; the harness still holds the four values
grep -c '] = useState' src/components/incidents/IncidentList.tsx
# Expected: 0 — the filtered array and the count are computed during render
grep -c '] = useState' scratch/App.tsx
# Expected: 4 — severity, scapegoat, query, and the isFiltered debt from 08.3

# 10. The ref is used for a DOM node and nothing else
grep -c 'useRef' src/components/incidents/IncidentSearch.tsx
# Expected: 1
grep -c 'inputRef.current' src/components/incidents/IncidentSearch.tsx
# Expected: 1 — read in a click handler, never during render

# 11. Back to green, with no scratch files left in src/
npm run type-check && ls src/components/incidents/
# Expected: silence, then exactly:
#           IncidentCard.tsx  IncidentFilters.tsx  IncidentList.tsx
#           IncidentSearch.tsx  fixtures.ts  useDebouncedValue.ts

# 12. Record the size of the incident UI. Lesson 08.5 compares against this.
wc -l src/components/incidents/*.ts src/components/incidents/*.tsx scratch/App.tsx | tail -1
# Expected: a total. Write it down, with the three numbers from Verify §3.
#           Lesson 08.5 ends the module smaller, having added a whole file.

# 13. The permanent files are committed; the harness is not
cd ..
git status --short
# Expected: clean. Nothing from next-app/scratch/ appears, ever.
```

Then, in the browser with `npm run scratch` running, the two checks no command can make: tab to
the search input, type, tab to `Clear search`, press Enter — focus must land back in the input,
not stay on the button. And confirm the console is empty.

## Control Questions

1. An effect with `[]` dependencies is often described as "runs on mount". Name two situations
   in this project where it runs more than once for one page load, and say what each is for.
2. `useDebouncedValue` returns a cleanup function that calls `clearTimeout`. Describe precisely
   what a user sees if you delete that return, and explain why neither `tsc` nor ESLint reports
   it.
3. Step 6's first wrong effect produced a render in which the count said 40 and the severity
   was already `s1-catastrophic`. Trace the render and effect sequence that causes that frame,
   and name the single line in Step 7 that makes it impossible.
4. `useState` and `useRef` both survive a render. Give the one behavioural difference that
   decides which to use, and say what goes wrong if you display a value held in a ref.
5. Two components call `useDebouncedValue(query, 250)`. Say what they share and what they do
   not, and explain how the `use` prefix affects what your linter is willing to allow.

## Learn More

- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — the
  page Key Concept 9 is built on; read the whole thing, twice, before you write your next effect
- [Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects) — what an
  effect is for, and react.dev's own explanation of the StrictMode double-run
- [Lifecycle of Reactive Effects](https://react.dev/learn/lifecycle-of-reactive-effects) — the
  dependency array explained as "when should this re-synchronise", which is the useful framing
- [Removing Effect Dependencies](https://react.dev/learn/removing-effect-dependencies) — what to
  do instead of suppressing the lint rule, case by case
- [Referencing Values with Refs](https://react.dev/learn/referencing-values-with-refs) — the
  state-versus-ref decision, and the rule about reading `.current` during render
- [Manipulating the DOM with Refs](https://react.dev/learn/manipulating-the-dom-with-refs) — the
  short list of things a DOM ref is legitimately for
- [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) —
  including the "share logic, not state" point and when *not* to extract one
- [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks) — the two rules
  `react-hooks/rules-of-hooks` enforces, and why call order is the reason for both
- [MDN: `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout) — the
  return value, the cancellation contract, and the clamping rules that make a 250 ms debounce
  approximate
