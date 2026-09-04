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
