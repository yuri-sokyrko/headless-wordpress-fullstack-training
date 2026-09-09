---
title: 'State & Events'
module: 8
lesson: 3
teaches: [use-state, react-events, controlled-inputs, declarative-ui, immutable-updates]
produces: ['next-app/src/components/incidents/IncidentFilters.tsx']
requires: [8.2]
---

# Lesson 08.3 — State & Events

## Quick Overview

Everything so far has been a one-way trip: props in, markup out. This lesson adds the return
path. `useState` gives a component a value that survives between renders and a function to
change it; changing it tells React to render the component again with the new value. That two-line
API is the whole of React's interactivity model, and internalising it is the difference between
writing React and writing jQuery with extra build steps.

You will build `IncidentFilters`: a severity selector over the four-term closed set and a
scapegoat selector over the ten seeded terms, both driving a filtered `IncidentList`. The
filtered array is **not** state — it is computed from the incidents and the current filter
values on every render. Recognising which values are state and which are derived from state is
the single most valuable habit in this module, and Lesson 08.5 comes back to it with a
refactor.

By the end of this lesson you will have:

- `next-app/src/components/incidents/IncidentFilters.tsx` — two controlled `<select>` elements with typed values
- A `severity` filter whose option list is the closed four-term set, and a `scapegoat` filter over the ten seeded terms
- A filtered list computed on render, with a visible "N of 40 incidents" count
- A "clear filters" button that resets both selects through one state update
- A working demonstration that mutating state in place does nothing, and why

## Classic WP Analogy

You have built this filter before, with jQuery, and it looked like this:

```
jQuery (imperative)                        React (declarative)
──────────────────────────────────────     ──────────────────────────────────────
$('#severity').on('change', function(){    const [severity, setSeverity] = useState('all');
  var v = $(this).val();                   …
  $('.incident').each(function(){          <select value={severity}
    $(this).toggle(                                onChange={e => setSeverity(e.target.value)}>
      v === 'all' || $(this).data('sev')===v
    );                                     {visible.map(i => <IncidentCard … />)}
  });
  $('#count').text($('.incident:visible').length);
});
```

The jQuery version reads the DOM, decides what to change, and patches it. Three things now
hold the truth about what is on screen: your variable, the DOM's inline styles, and the count
element — and they drift the moment a fourth interaction is added. The React version stores
one value, `severity`, and re-derives the entire visible list and the count from it. There is
no patching step, so there is nothing to keep in sync. This is also the answer to "where did
`wp_localize_script()` go": you no longer need to smuggle server data into a global for a
script to find, because the data was passed as props in the first place.

The analogy breaks in two places, and both surprise people. First, **`setSeverity` does not
change the variable you are looking at.** `severity` is a `const` for the lifetime of that
render; calling the setter schedules a *new render* in which the value is different. Code
written as `setSeverity('s1-catastrophic'); console.log(severity);` logs the old value, and
that is correct behaviour, not a race condition. Second, **React state must be replaced, not
mutated.** With jQuery you would happily `arr.push(x)` and re-read the array. React compares
the old value to the new one by reference to decide whether to re-render, so `arr.push(x)`
followed by `setArr(arr)` changes nothing on screen — you write `setArr([...arr, x])`. Neither
of these has a Classic WordPress analogue, because PHP renders once per request and then the
process ends.

---

## Key Concepts

### 1. `useState` hands you a pair, and the value is a `const`

```
const [severity, setSeverity] = useState<SeverityFilter>('all');
       │          │                     │                 │
       │          │                     │                 └─ initial value, used
       │          │                     │                    on the FIRST render
       │          │                     │                    only, ignored after
       │          │                     └─ the type, when TypeScript cannot infer
       │          │                        a useful one from the initial value
       │          └─ the setter. Calling it schedules a render.
       └─ the value FOR THIS RENDER. Not a live reference. A const.
```

Two things about that line surprise people from every background:

**The initial value is used once.** `useState('all')` on the tenth render does not reset
anything. React remembers the value it is holding for this component instance and hands it back;
the argument is only consulted the first time. This is why an expensive initial value should be
passed as a function — `useState(() => build())` — though nothing in this module needs it.

**The annotation is often necessary.** `useState('all')` infers `string`, which throws away the
union and lets `setSeverity('s5-kinda-bad')` compile. `useState<SeverityFilter>('all')` is the
whole reason Module 07 built the `SeverityLevel` union in the first place. Where the initial
value already pins the type — `useState(false)` infers `boolean` — the annotation is noise.

React tracks which `useState` call is which by **call order**, not by name. That is the entire
reason hooks cannot be called conditionally, and why `react-hooks/rules-of-hooks` is an error
in `eslint.config.mjs` rather than a warning. Put a `useState` inside an `if` and the second
render associates your severity value with a different variable.

### 2. A render is a snapshot, and the setter does not change the variable

This is the concept that makes or breaks the mental model.

```
setSeverity('s1-catastrophic');
console.log(severity);            // 'all'.  Correct. Not a race condition.
```

`severity` is a `const` bound when this render's function body started executing. Nothing can
reassign it, including React. What `setSeverity` does is tell React "next time you call this
function, hand it `'s1-catastrophic'` instead". The current call keeps the old value until it
returns.

```
render #1                                   render #2
────────────────────────────────────────    ────────────────────────────────────────
App() is called                             App() is called again
severity === 'all'                          severity === 's1-catastrophic'
visible === all 40 incidents                visible === the 10 s1 incidents
                                            │
onChange fires ──▶ setSeverity('s1-…')      the count element, the <select> and
                   React schedules a render  the list are all rebuilt from the
                   ▼                         new snapshot together
```

Every value in a render — props, state, the derived array, the event handlers you defined — is
frozen together as a consistent picture. Two consequences worth having in advance:

- **An event handler closes over the snapshot it was created in.** A handler that runs three
  seconds after a `setTimeout` sees the values from the render that created it, not the current
  ones. That is not a bug and Lesson 08.4 uses it deliberately.
- **You cannot "read back" what you just set.** If a handler needs the new value, it already has
  it: it is the argument it passed to the setter.

There is nothing like this in PHP because PHP renders once and the process exits. The nearest
analogue is a `WP_Query` result you have already assigned to a variable: modifying the database
afterwards does not change your variable, and nobody finds that surprising.

### 3. The updater form, and the one case that needs it

The setter takes either a value or a function of the previous value.

```
setCount(count + 1);        uses this render's `count`.  Fine 95% of the time.
setCount((n) => n + 1);     uses React's LATEST value.   Required when queueing.
```

The difference only shows when you call the setter twice in one handler, or from a callback that
outlived its render:

| Handler body | Result if `count` is `0` |
|---|---|
| `setCount(count + 1); setCount(count + 1);` | `1` — both calls computed `0 + 1` from the same snapshot |
| `setCount((n) => n + 1); setCount((n) => n + 1);` | `2` — the second updater receives the first one's output |

**Use the plain form by default and reach for the updater when you are queueing or when the
value comes from outside this render.** Nothing in this lesson needs it — a filter is set to a
value, not incremented — but Lesson 08.4's debounce timer is exactly the "callback that outlived
its render" case, and knowing the shape now means it will not look like magic there.

### 4. State is replaced, never mutated

React decides whether to re-render by comparing the old value with the new one using
`Object.is`. For an object or an array, that is a **reference** comparison.

```
❌  history.push(label);            ✅  setHistory([...history, label]);
    setHistory(history);
    │                                   A NEW array. Different reference.
    │                                   React re-renders.
    └─ same array, same reference.
       React concludes nothing changed and does not render.
       Your data IS updated. The screen is not. Nothing is logged.
```

The equivalents for the operations you actually want:

| Instead of | Write |
|---|---|
| `arr.push(x)` | `setArr([...arr, x])` |
| `arr.splice(i, 1)` | `setArr(arr.filter((_item, n) => n !== i))` |
| `arr[i] = x` | `setArr(arr.map((item, n) => (n === i ? x : item)))` |
| `arr.sort()` | `setArr([...arr].sort(compare))` — `sort` mutates in place |
| `obj.field = x` | `setObj({ ...obj, field: x })` |

> **This is why the content model is `readonly` all the way down.** Lesson 07.4 declared every
> field of `Incident` `readonly`, so `incident.title = 'x'` and
> `incidents.push(newIncident)` do not compile. That was not tidiness: it converts the silent
> failure above into a build error. The single most useful habit available to you here is to type
> state as `readonly T[]` the moment it holds an array, so the mutation you were about to write
> is refused by the compiler rather than ignored by React. Step 6 does exactly that, in the
> order that makes the point.

### 5. React events are functions, and there is no `return false`

```
jQuery / classic WordPress                 React
────────────────────────────────────       ────────────────────────────────────
<button onclick="doThing()">               <button onClick={doThing}>
  a STRING, parsed and eval'd                a FUNCTION reference

$('#x').on('change', fn)                   onChange={fn}
  registered after the DOM exists            declared where the element is

return false;   // stop everything          event.preventDefault();
                                            event.stopPropagation();
                                            two separate, explicit acts

$(document).on('click','.card',fn)          no delegation needed — React already
  delegation, for elements not yet in        attaches one listener at the root
  the DOM                                    and dispatches from there
```

Three specifics:

- **`onClick={doThing}`, not `onClick={doThing()}`.** The second calls the function during
  render and passes its return value as the handler. If `doThing` sets state, you get an
  infinite render loop, which React eventually stops with an error about too many re-renders.
  When the handler needs an argument, wrap it: `onClick={() => remove(incident.slug)}`.
- **The event object is a `SyntheticEvent`,** React's own wrapper over the native one. It
  normalises browser differences and exposes the native event as `event.nativeEvent`. Its type
  is generic in the element: `ChangeEvent<HTMLSelectElement>`, `MouseEvent<HTMLButtonElement>`.
  Annotate the handler parameter and the whole thing is checked.
- **`type="button"` on every button that is not submitting a form.** The HTML default is
  `submit`, and a `<button>` inside a `<form>` with no `type` reloads the page. This costs
  someone half an hour in Module 16 every time.

### 6. Controlled inputs: the DOM stops being a source of truth

A form element can hold its own value (the browser's default) or it can render the value you
give it. React calls the second **controlled**, and it is what this course uses everywhere.

```
UNCONTROLLED                               CONTROLLED
─────────────────────────────────────      ─────────────────────────────────────
<select id="sev">                          <select value={severity}
  … browser owns the value …                       onChange={handleSeverity}>
$('#sev').val()   ← read it back            severity   ← already have it
                                            │
two sources of truth: the DOM and           one source of truth. The DOM is a
whatever variable you also kept             projection of it.
```

The rule is `value` and `onChange` together, always:

| What you wrote | What happens |
|---|---|
| `value` + `onChange` | ✅ controlled. Typing updates state, state updates the element. |
| neither | uncontrolled. Legal, and occasionally right — Module 16 uses a `ref`-free uncontrolled form field once. |
| `value` with no `onChange` | ⚠️ a **read-only field**. Keystrokes do nothing. React logs *"You provided a `value` prop to a form field without an `onChange` handler"*. |
| `value={undefined}` | React switches the element to uncontrolled mid-life and warns about that too. |

That third row is the one to internalise, because **TypeScript does not catch it**. A `<select>`
with a `value` and no `onChange` type-checks perfectly; the Verification block proves it, with
`exit=0`. It is one of the few React mistakes in this course that only the browser console
reports, which is a good reason to keep that console open.

### 7. Derived state is not state

If a value can be computed from props and state, it is **not** state. Compute it during render.

```
✅  const visible = INCIDENTS.filter((i) => matches(i, severity, scapegoat));
    const count   = visible.length;

❌  const [visible, setVisible] = useState(INCIDENTS);
    const [count, setCount]     = useState(40);
    // …and now every handler that touches a filter must remember to update
    // both, in the right order, or the count disagrees with the list.
```

The test is mechanical: **could two pieces of state ever disagree?** If yes, one of them is
derived and should not be state. A count that can disagree with the list it counts is not a
performance optimisation, it is a bug with a scheduling problem.

| Value on screen | State or derived |
|---|---|
| the selected severity | **state** — the user chose it and nothing else can produce it |
| the selected scapegoat | **state** |
| the filtered incident array | derived from `INCIDENTS` + the two filters |
| "12 of 40 incidents" | derived from the filtered array's length |
| the severity label on a card | derived from the incident |
| whether the empty state shows | derived from the array's length |

Two of six. That ratio is normal, and it is the point of Lesson 08.5, which walks the whole UI
this way and deletes what the process finds. It is also why this lesson does not reach for
`useMemo`: `filter` over forty objects is measured in microseconds, and the module README's
promise not to teach memoisation is a promise not to teach you a reflex you would then apply
everywhere.

### 8. Batching, and the three sources of truth collapsing into one

Two setters in one event handler produce **one** render, not two. React collects state updates
from an event and applies them together, so `clearFilters()` calling `setSeverity('all')` and
`setScapegoat('all')` never renders a half-cleared intermediate state. This has been true for
every update — inside promises, timeouts and native handlers as well — since React 18.

That guarantee is what finally kills the jQuery version of this screen. Expand the comparison
from the Quick Overview and count the places truth lives:

| | jQuery version | React version |
|---|---|---|
| Where the current severity lives | a `var`, **and** the DOM's `value`, **and** which rows have `display: none` | one `useState` value |
| Where the count lives | the text content of `#count` | recomputed from `visible.length` |
| Where "is anything filtered" lives | inferred by reading the DOM back | derived from the two filter values |
| Adding a search box means | a fourth place to update, and every existing handler must learn about it | one more value in the filter predicate |
| Rendering a half-updated screen | possible, and common | impossible within one event |
| The bug you actually get | count says 12, list shows 14, and only after two specific clicks | none of this class |

The jQuery column has three sources of truth for one fact, and they drift the moment a fourth
interaction is added — which is precisely what Lesson 08.4 does when it adds a search input.
Watch how little changes there.

---

## Task

### Step 1: Type the filters, then write the component

One file, and it is the first one in the course whose types do real work at run time. Every
option value below comes from the content model: the four severity slugs from
[appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies) via `SEVERITY_LABEL`,
and the ten scapegoat terms from the fixture you wrote in Lesson 08.2.

```tsx
// next-app/src/components/incidents/IncidentFilters.tsx
// Two controlled selects and a clear button. Fully CONTROLLED: this component
// holds no state at all. In this lesson the state lives in the harness App,
// which is uncomfortable by design — Lesson 08.5 pays that discomfort off.
import type { ChangeEvent } from 'react';

import type { SeverityLevel } from '@/types/content';
import { SEVERITY_LABEL } from '@/types/content';

import { SCAPEGOAT_TERMS } from './fixtures';

/** The closed severity set, plus one sentinel meaning "do not filter". */
export type SeverityFilter = SeverityLevel | 'all';

/**
 * `scapegoat` is a FREE-FORM taxonomy (appendix 03 §2), so its slug is `string`
 * and there is no union to be had. The types mirror the content model exactly:
 * closed set becomes a union, open set stays a string. That asymmetry is the
 * model showing through, not sloppiness.
 */
export type ScapegoatFilter = string;

function isSeverityLevel(value: string): value is SeverityLevel {
  return value in SEVERITY_LABEL;
}

/** Narrow a <select> value back into the union. A real check, never an `as` cast. */
export function isSeverityFilter(value: string): value is SeverityFilter {
  return value === 'all' || isSeverityLevel(value);
}

// Derived from SEVERITY_LABEL, which is a Record over SeverityLevel (Lesson 07.4).
// Add a fifth severity term to the union and SEVERITY_LABEL stops compiling until
// you give it a row — at which point this option list picks the term up with no
// edit here. Object.keys() is typed string[], and the guard is what restores the
// union without a cast.
const SEVERITY_OPTIONS: readonly SeverityLevel[] =
  Object.keys(SEVERITY_LABEL).filter(isSeverityLevel);

type IncidentFiltersProps = {
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  readonly onSeverityChange: (next: SeverityFilter) => void;
  readonly onScapegoatChange: (next: ScapegoatFilter) => void;
  readonly onClear: () => void;
};

export function IncidentFilters({
  severity,
  scapegoat,
  onSeverityChange,
  onScapegoatChange,
  onClear,
}: IncidentFiltersProps) {
  function handleSeverity(event: ChangeEvent<HTMLSelectElement>): void {
    // event.target.value is `string`, and it is a string even though every
    // <option> below carries a SeverityLevel — the DOM knows nothing about your
    // union. Narrow it with the guard. Do NOT write `as SeverityFilter`: that
    // would be a claim, and a claim is exactly what you cannot make about a
    // value that arrived from the browser.
    const value = event.target.value;
    if (isSeverityFilter(value)) {
      onSeverityChange(value);
    }
  }

  function handleScapegoat(event: ChangeEvent<HTMLSelectElement>): void {
    onScapegoatChange(event.target.value);
  }

  return (
    <div className="incident-filters">
      <label htmlFor="filter-severity">Severity</label>
      <select id="filter-severity" value={severity} onChange={handleSeverity}>
        <option value="all">All severities</option>
        {SEVERITY_OPTIONS.map((slug) => (
          <option key={slug} value={slug}>
            {SEVERITY_LABEL[slug]}
          </option>
        ))}
      </select>

      <label htmlFor="filter-scapegoat">Blamed on</label>
      <select id="filter-scapegoat" value={scapegoat} onChange={handleScapegoat}>
        <option value="all">Anyone</option>
        {SCAPEGOAT_TERMS.map((term) => (
          <option key={term.slug} value={term.slug}>
            {term.name}
          </option>
        ))}
      </select>

      {/* type="button" is not optional. The HTML default is "submit", and this
          component ends up inside a <form> in Module 16. */}
      <button type="button" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
```

> **`htmlFor`, not `for`.** `for` is a reserved word in JavaScript, and the second argument to
> `jsx()` is an object literal (Lesson 08.1 Key Concept 2). Pairing a `<label htmlFor>` with an
> input `id` is also the cheapest accessibility work in the course — Lesson 11.4 and Lesson 22.2
> both audit it, and passing that audit for free is better than fixing it later.

### Step 2: Lift the state into the harness and derive everything else

The two filter values are state. The filtered array and the count are not: they are recomputed
from scratch on every render.

```tsx
// next-app/scratch/App.tsx
import { useState } from 'react';

import { IncidentFilters } from '@/components/incidents/IncidentFilters';
import type {
  ScapegoatFilter,
  SeverityFilter,
} from '@/components/incidents/IncidentFilters';
import { IncidentList } from '@/components/incidents/IncidentList';
import { INCIDENTS } from '@/components/incidents/fixtures';
import type { Incident } from '@/types/content';

/** Pure, testable, and outside the component because it closes over nothing. */
function matchesFilters(
  incident: Incident,
  severity: SeverityFilter,
  scapegoat: ScapegoatFilter
): boolean {
  const bySeverity =
    severity === 'all' || incident.severities.nodes.some((term) => term.slug === severity);
  const byScapegoat =
    scapegoat === 'all' || incident.scapegoats.nodes.some((term) => term.slug === scapegoat);

  return bySeverity && byScapegoat;
}

export function App() {
  // STATE: two values, both chosen by the user, neither computable from anything
  // else. The annotations matter — useState('all') would infer `string` and let
  // an invented slug through.
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [scapegoat, setScapegoat] = useState<ScapegoatFilter>('all');

  // DERIVED: recomputed every render. Not state, so it can never disagree with
  // the two values above.
  const visible = INCIDENTS.filter((incident) =>
    matchesFilters(incident, severity, scapegoat)
  );

  // One handler, two setters, ONE render. React batches updates from an event.
  function clearFilters(): void {
    setSeverity('all');
    setScapegoat('all');
  }

  return (
    <main>
      <h1>Blame The Tech — incident board</h1>

      <IncidentFilters
        severity={severity}
        scapegoat={scapegoat}
        onSeverityChange={setSeverity}
        onScapegoatChange={setScapegoat}
        onClear={clearFilters}
      />

      <p>{`${visible.length} of ${INCIDENTS.length} incidents`}</p>

      <IncidentList incidents={visible} />
    </main>
  );
}
```

`onSeverityChange={setSeverity}` passes React's setter straight through. It works because
`Dispatch<SetStateAction<SeverityFilter>>` accepts a `SeverityFilter`, so it satisfies
`(next: SeverityFilter) => void`. The child never learns that the value it is changing is
`useState` and not something else, which is exactly what makes `IncidentFilters` testable in
Module 23 with two plain functions and no provider.

**Verify §2:**

- [ ] `npm run scratch`, then choose `S1 — Catastrophic`. The count reads `10 of 40 incidents`
      and ten cards remain — the seeder's spread, reproduced by your fixture.
- [ ] Choose `The Intern` as well. The count drops again, and both selects still show your
      choices — that is the controlled loop working.
- [ ] Click `Clear filters`. Both selects return to their first option in the same frame.
- [ ] `npm run type-check` and `npm run lint` are clean.

### Step 3: Prove that batching is real

Add one temporary line above the `return` in `App.tsx`:

```tsx
// next-app/scratch/App.tsx — TEMPORARY. Removed at the end of Step 3.
  console.count('App render');
```

**Verify §3:**

- [ ] Reload. The counter reads `2` before you touch anything: one render, doubled by
      `StrictMode` (Lesson 08.1 Key Concept 8).
- [ ] Set both filters, then click `Clear filters`. The counter advances by **2**, not by 4.
      Two setters, one render, doubled by StrictMode. If it advanced by 4 you would be looking
      at React 17 behaviour.
- [ ] Delete the line. A `console.count` left in a component is the kind of thing that ships.

### Step 4: Try to mutate state in place, and watch nothing happen

A filter history is a plausible feature and a perfect demonstration. Add it to `App.tsx`,
**wrong on purpose**, exactly as written — note the mutable `string[]`, which is what makes the
wrong version compile at all:

```tsx
// next-app/scratch/App.tsx — WRONG ON PURPOSE. Fixed in this same step.
  const [history, setHistory] = useState<string[]>([]);

  function remember(label: string): void {
    history.push(label); // mutates the array React is already holding
    setHistory(history); // …and hands React the same reference back
  }

  function handleSeverityChange(next: SeverityFilter): void {
    setSeverity(next);
    remember(`severity=${next}`);
  }
```

Wire `onSeverityChange={handleSeverityChange}` instead of `setSeverity`, and render the history
under the count:

```tsx
// next-app/scratch/App.tsx — edit, under the count paragraph
      <p>{`history: ${history.join(' → ')}`}</p>
```

**Verify §4a:**

- [ ] Change the severity three times. The `history:` line stays **empty**.
- [ ] Nothing is logged. No warning, no error, no hint.
- [ ] Add `console.log(history.length)` inside `remember`, after the `push`. It prints `1`,
      `2`, `3`. **The data is updating. The screen is not.** React compared the array with
      itself, found the same reference, and correctly concluded that nothing had changed.
      Remove the log.

Now fix it, in two moves. First replace the array instead of mutating it:

```tsx
// next-app/scratch/App.tsx — edit
  function remember(label: string): void {
    // A NEW array. New reference, so Object.is says "different", so React renders.
    setHistory([...history, label]);
  }
```

Then make the wrong version impossible to write again:

```tsx
// next-app/scratch/App.tsx — edit
  const [history, setHistory] = useState<readonly string[]>([]);
```

**Verify §4b:**

- [ ] The history line now fills in as you change the severity.
- [ ] Put the `history.push(label)` line back temporarily. `npm run type-check` fails with
      `TS2339: Property 'push' does not exist on type 'readonly string[]'`. The bug you spent
      five minutes not seeing is now a build error. Remove the line again.
- [ ] Finally, **delete the whole history feature** — the state, `remember`,
      `handleSeverityChange`, the paragraph — and pass `setSeverity` directly again. The
      incident board does not need a filter history, and Lesson 08.5's state inventory would
      have to justify every value on screen. This one cannot be justified, so it goes.

### Step 5: Add the piece of state that should not be state

Now write a small, plausible, entirely typical mistake, with its expiry date attached.

The page should say when a filter is active. That reads like a boolean worth remembering, so
remember it:

```tsx
// next-app/scratch/App.tsx — edit. A DEBT. Lesson 08.5 deletes all of this.
  const [isFiltered, setIsFiltered] = useState(false);

  function changeSeverity(next: SeverityFilter): void {
    setSeverity(next);
    setIsFiltered(next !== 'all' || scapegoat !== 'all');
  }

  function changeScapegoat(next: ScapegoatFilter): void {
    setScapegoat(next);
    setIsFiltered(severity !== 'all' || next !== 'all');
  }

  function clearFilters(): void {
    setSeverity('all');
    setScapegoat('all');
    setIsFiltered(false);
  }
```

Pass `changeSeverity` and `changeScapegoat` to `IncidentFilters`, and render:

```tsx
// next-app/scratch/App.tsx — edit, above the count
      {isFiltered ? <p>Showing a filtered subset.</p> : null}
```

> **Count the places that must stay in agreement: three handlers, one initial value, and one
> line of markup.** Every future filter — the search box in Lesson 08.4, a date range, an
> environment selector — adds another handler that must remember `setIsFiltered`, and the day
> one of them forgets, the page says "Showing a filtered subset" over an unfiltered list. This
> is written here because it is what everybody writes, it works, it passes review, and
> Lesson 08.5 replaces the whole thing with one derived line. Leave it in. It is the before
> half of that refactor.

**Verify §5:**

- [ ] Setting either filter shows the sentence; clearing hides it.
- [ ] Now find the bug on purpose: set a severity, then set a scapegoat, then set the severity
      back to `All severities`. The sentence is still correct — because each handler recomputes
      from both values. Then imagine adding a third filter and doing this again. That is the
      cost, and it is a maintenance cost rather than a bug, which is exactly why it survives.

### Step 6: Confirm the module's boundaries are intact

This module promises no data fetching, no styling and no memoisation. It is worth checking
rather than assuming, because all three are easy to drift into.

```bash
cd next-app
grep -rnE 'useMemo|useCallback|React\.memo|\bfetch\(' src/components/incidents/ scratch/
```

**Verify §6:**

- [ ] No output. Filtering forty objects is microseconds of work, and reaching for `useMemo`
      here would teach you to reach for it everywhere, which is the reflex the module README
      refuses to install. Module 21 measures before optimising anything.
- [ ] `grep -c 'className' src/components/incidents/*.tsx` returns small numbers and there is
      no stylesheet anywhere. Module 11 owns appearance.

### Step 7: Commit

```bash
cd ..
git add next-app/src/components/incidents/IncidentFilters.tsx
git commit -m "feat(web): controlled severity and scapegoat filters"
```

---

## Verification

```bash
cd next-app

# 1. Types and lint are clean, hooks rules included
npm run type-check && npm run lint && echo "green"
# Expected: green

# 2. The severity guard really is a runtime check over the closed set
cat > src/components/incidents/_guard.ts <<'TS'
import { isSeverityFilter } from './IncidentFilters';

console.log(
  isSeverityFilter('s1-catastrophic'),
  isSeverityFilter('all'),
  isSeverityFilter('s5-kinda-bad')
);
TS
npx tsx src/components/incidents/_guard.ts
# Expected: true true false
#           This runs a module that imports SEVERITY_LABEL through the `@/` alias,
#           so it also proves tsx is honouring the `paths` entry you added to
#           tsconfig.json in Lesson 08.1.
rm src/components/incidents/_guard.ts

# 3. The option list is DERIVED from SEVERITY_LABEL, not retyped
grep -c 'Object.keys(SEVERITY_LABEL)' src/components/incidents/IncidentFilters.tsx
# Expected: 1
grep -cE "'s[1-4]-" src/components/incidents/IncidentFilters.tsx
# Expected: 0 — not one severity slug is written out by hand in this file

# 4. NEGATIVE — no `as` cast anywhere near the event value
grep -nE '\bas\s+(Severity|Scapegoat|string)' src/components/incidents/IncidentFilters.tsx
# Expected: no output. A type predicate is a check; `as` is a promise, and you
#           cannot make promises about a value the browser handed you.

# 5. NEGATIVE — an invented severity slug does not compile
cat > src/components/incidents/_bad-slug.ts <<'TS'
import type { SeverityFilter } from './IncidentFilters';

export const chosen: SeverityFilter = 's5-kinda-bad';
TS
npm run type-check; echo "exit=$?"
# Expected: TS2322 naming 's5-kinda-bad', then exit=1. NOT exit=0.
rm src/components/incidents/_bad-slug.ts

# 6. NEGATIVE — state typed readonly cannot be mutated in place
cat > src/components/incidents/_push.ts <<'TS'
export function remember(history: readonly string[], label: string): void {
  history.push(label);
}
TS
npm run type-check; echo "exit=$?"
# Expected: TS2339, "Property 'push' does not exist on type 'readonly string[]'",
#           then exit=1. This is Step 4's silent bug, converted into a build error.
rm src/components/incidents/_push.ts

# 7. NEGATIVE — the compiler does NOT catch an uncontrolled `value`
cat > src/components/incidents/_uncontrolled.tsx <<'TSX'
export function Pinned() {
  return <input value="you cannot type in me" />;
}
TSX
npm run type-check; echo "exit=$?"
# Expected: exit=0 — CLEAN. TypeScript has nothing to say about a missing
#           onChange. React logs "You provided a `value` prop to a form field
#           without an `onChange` handler" in the browser console instead. This
#           is the one class of React mistake the compiler cannot reach, which
#           is why the console stays open.
rm src/components/incidents/_uncontrolled.tsx

# 8. NEGATIVE — the module's three exclusions still hold
grep -rnE 'useMemo|useCallback|React\.memo|\bfetch\(' src/components/incidents/ scratch/
# Expected: no output. No memoisation and no data fetching in Module 08.

# 9. Nothing derived is stored in state in the component you just wrote
grep -c 'useState' src/components/incidents/IncidentFilters.tsx
# Expected: 0 — IncidentFilters is fully controlled and holds no state at all

# 10. Back to green, with no scratch files left behind
npm run type-check && ls src/components/incidents/
# Expected: silence, then exactly:
#           IncidentCard.tsx  IncidentFilters.tsx  IncidentList.tsx  fixtures.ts

# 11. The permanent file is committed; the harness still is not
cd ..
git status --short
# Expected: clean. Nothing from next-app/scratch/ ever appears here.
```

Then, with `npm run scratch` running, three things only a browser can tell you: the count and
the list never disagree, `Clear filters` resets both selects in one frame, and the console is
empty. If the console has a `value` warning in it, check 7 explains why nothing else told you.

## Control Questions

1. `setSeverity('s1-catastrophic'); console.log(severity);` logs `all`. Explain why that is
   correct rather than a race condition, and say where the new value can be read inside the same
   handler.
2. `history.push(label); setHistory(history);` updates the array and does not update the screen.
   Name the comparison React performs, say what it concludes, and give the two-step change that
   makes the same mistake a compile error.
3. `IncidentFilters` contains no `useState` at all, yet the selects visibly respond to clicks.
   Describe the full round trip of one click, naming every component the value passes through.
4. `event.target.value` on the severity `<select>` is typed `string` even though every `<option>`
   value is a `SeverityLevel`. Explain why the type system cannot know better, and say what is
   wrong with `as SeverityFilter` as a fix.
5. `isFiltered` in Step 5 is state, and Lesson 08.5 deletes it. State the rule that identifies it
   as derived, and name the specific failure that appears when a fourth filter is added and one
   handler forgets it.

## Learn More

- [State: A Component's Memory](https://react.dev/learn/state-a-components-memory) — the
  `useState` mechanics, including why call order matters and hooks cannot be conditional
- [State as a Snapshot](https://react.dev/learn/state-as-a-snapshot) — the single most useful
  page on react.dev for the confusion in Key Concept 2; read it twice
- [Queueing a Series of State Updates](https://react.dev/learn/queueing-a-series-of-state-updates)
  — batching and the updater form, with a worked queue you can step through
- [Updating Arrays in State](https://react.dev/learn/updating-arrays-in-state) — the full
  replace-don't-mutate table, including the `sort` and `reverse` traps
- [Responding to Events](https://react.dev/learn/responding-to-events) — handler naming,
  propagation, and why there is no `return false`
- [Reacting to Input with State](https://react.dev/learn/reacting-to-input-with-state) — the
  declarative reframing of exactly the jQuery filter this lesson replaced
- [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) — the
  "avoid redundant state" section is the argument for deleting `isFiltered` in Lesson 08.5
- [MDN: `<select>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select) — the
  element's own behaviour, which is what "controlled" is layered on top of
- [`wp_localize_script()`](https://developer.wordpress.org/reference/functions/wp_localize_script/)
  — worth one last look, to see precisely which problem props and state removed
