---
title: 'Props, Lists & Conditional Rendering'
module: 8
lesson: 2
teaches: [react-props, list-rendering, react-keys, conditional-rendering, typed-component-props]
produces: ['next-app/src/components/incidents/IncidentList.tsx', 'next-app/src/components/incidents/fixtures.ts']
requires: [8.1]
---

# Lesson 08.2 — Props, Lists & Conditional Rendering

## Quick Overview

A component that renders hard-coded content is a static HTML file with extra steps. This
lesson makes `IncidentCard` take its content as **props** — a single typed object passed in by
the caller — and then builds `IncidentList`, which renders forty of them from an array. Along
the way you meet the two things that generate the most React bugs in real codebases: keys, and
rendering something that might be `null`.

The data comes from `fixtures.ts`, a typed array shaped exactly like the `incidents` GraphQL
connection you saved in Module 05 — nested `node` objects, connection edges for taxonomy
terms, nullable SCF numbers and all. Using the real shape now rather than a flattened
convenience shape is the point: when Lesson 09.3 replaces the fixture import with a live
query, the components do not change. Fixtures that lie about the shape of your data are a debt
you pay twice.

By the end of this lesson you will have:

- `next-app/src/components/incidents/fixtures.ts` — six typed incidents in real WPGraphQL response shape
- `next-app/src/components/incidents/IncidentList.tsx` — an array rendered with `.map()` and stable `key` values
- `IncidentCard` refactored to a typed props interface with no hard-coded content
- A severity `<Badge>`-style element driven by the four-term closed set from the content model
- An empty-state branch and a "no cost recorded" branch, both handled without `undefined` reaching the DOM

## Classic WP Analogy

The WordPress loop and a React list render the same job with the ownership reversed:

```
Classic                                   React
─────────────────────────────────────     ─────────────────────────────────────
$q = new WP_Query([...]);                 const { incidents } = props;
while ($q->have_posts()) {                {incidents.map((incident) => (
  $q->the_post();          ← mutates       <IncidentCard
  get_template_part('card','incident');       key={incident.slug}
}                                             incident={incident}
wp_reset_postdata();       ← or else        />
                                          ))}
```

`the_post()` advances an internal pointer and populates `global $post`, so the template part
receives its data through a global side effect. `get_template_part()` cannot take an argument
in older WordPress at all, and even with the modern `$args` parameter, nothing checks what you
passed. React inverts both: data travels as an explicit argument, and TypeScript rejects the
call at build time if the shape is wrong. Forgetting `wp_reset_postdata()` has no React
equivalent, because there was never a global to reset.

The analogy breaks on **`key`**. WordPress has nothing like it, and the WordPress instinct —
"use the loop index" — is specifically the wrong answer. `key` is how React matches an item
between two renders so it can move a DOM node instead of rebuilding it. Index keys are stable
only while the array order never changes, which is exactly not true of a filtered list, and
the failure mode is not a crash: it is a checkbox that stays ticked next to the wrong incident
after you filter. Use the field WordPress already guarantees is unique and stable — the
`slug`. The second break is subtler: in PHP, echoing `null` prints nothing and echoing `false`
prints nothing, so sloppy conditionals are invisible. In JSX, `{0}` renders a literal `0` and
`{undefined}` renders nothing, which means `{incident.downtimeMinutes && <p>…</p>}` silently
prints a bare `0` for an incident with no downtime. That specific bug appears in this lesson,
on purpose.

---

## Key Concepts

### 1. Props are one read-only argument, and mutating them is a bug

A component takes exactly one argument: an object React assembles from the attributes you wrote
in JSX. `<IncidentCard incident={x} compact />` calls `IncidentCard({ incident: x, compact: true })`.
There is no second argument, no variadic list, and no ambient context to read from.

Props flow **downward only**. A parent hands a child a value; the child cannot write back. This
is not enforced by JavaScript — the object is an ordinary object and `props.incident.title = 'x'`
would succeed at run time — it is enforced by convention, by React's assumption that a render is
pure, and in this project by the type system.

```
WordPress                                 React
────────────────────────────────────      ────────────────────────────────────
global $post   ← ambient, writable        props   ← passed, typed, readonly
$args          ← array, unchecked                  │
setup_postdata($post)                             ├── incident: Incident
the_title()    ← reads the global                  └── (nothing else exists)
wp_reset_postdata()  ← or the next
                       template breaks
```

Every field on the content model is declared `readonly`, all the way down — Lesson 07.4 did
that deliberately. So `incident.title = 'x'` is a compile error, and
`incident.severities.nodes.push(term)` is a compile error, and neither one waits until a page
renders wrong to tell you.

> **`readonly` is a claim about who owns the value, not about the object being frozen.**
> Nothing at run time stops a determined `Object.assign`. What `readonly` buys is that the
> mistake is found by `npm run type-check` in two seconds rather than by a user in three weeks.
> The Verification block for Lesson 08.3 proves that a mutation is rejected by the compiler.

### 2. Typing props, and what a typo costs on each side

Two spellings, and this course uses the first:

```
✅  type IncidentCardProps = {           ❌  function IncidentCard(props: {
      readonly incident: Incident;             incident: Incident;
    };                                       }) {
                                               const incident = props.incident;
    export function IncidentCard({
      incident,                            The second reads fine for one prop and
    }: IncidentCardProps) { … }            turns into `props.this`, `props.that`
                                           noise at three. Destructure in the
                                           signature.
```

A named `type` alias is worth the two extra lines: it is what you export when a test needs it
(Module 12), it is what your editor shows on hover, and it gives the error message something to
name. Destructuring in the signature means the body reads `incident`, not `props.incident`,
which matters more than it sounds like when a component has five props.

The interesting comparison is the failure mode:

| | `get_template_part($slug, $name, $args)` | `<IncidentCard incident={x} />` |
|---|---|---|
| Misspelled the key | `$args['incidnet']` is `null`; the template renders blanks | `incidnet={x}` is a build error naming the property |
| Forgot to pass it | template reads `global $post` and quietly renders the wrong post | build error: property `incident` is missing |
| Passed the wrong shape | a `Notice: Trying to access array offset` in the log, or nothing | build error naming the missing field |
| Found by | a user, eventually | `npm run type-check`, before the file is saved twice |

That third row is the one that pays for this whole module. A hand-written GraphQL query that
selects `downtimeMinutes` but not `environment` produces a props object missing a field, and the
build tells you which component and which line. Lesson 09.3 takes that guarantee away on
purpose — it hand-writes response types that can drift from the schema — and Lesson 10.2 buys it
back permanently with codegen.

### 3. `children` is a prop, and it is the one with syntax

Anything between a component's opening and closing tag arrives as the `children` prop.

```
<Panel title="Blame">        →   Panel({ title: 'Blame',
  <p>The Intern</p>                       children: jsx('p', { children: 'The Intern' }) })
</Panel>
```

Its type is `ReactNode` from `react`, which is the union of everything React can render: an
element, a string, a number, `null`, `undefined`, a boolean, an array of those. That breadth is
why the next Key Concept but one matters.

`children` is the mechanism behind `<Layout>`, `<Card>` and every wrapper you will write, and it
is the closest React equivalent to a template part that yields to its caller — closer than
`$args`, because the caller passes *markup*, not data. Nothing in Module 08 needs it: these
components take data and render it. Lesson 08.5 uses it for the context provider, and
Lesson 11.5 uses it properly, for page composition. It is named here so that
`{ children }: { readonly children: ReactNode }` in Lesson 08.5 is not the first time you see
it.

### 4. `.map()` produces an array of elements, and React renders arrays

There is no loop syntax in JSX because none is needed: an array of elements is a valid child.

```
while ($q->have_posts()) {                {incidents.map((incident) => (
  $q->the_post();                            <IncidentCard
  get_template_part('card','incident');        key={incident.slug}
}                                              incident={incident}
                                             />
                                           ))}
```

Three consequences that catch people:

- **Nothing is inserted between the elements.** No comma, no whitespace, no separator. Where a
  PHP `implode(', ', $parts)` would put commas, JSX puts nothing at all, and you add a separator
  element yourself if you want one.
- **`.map()` must return the element.** `incidents.map((i) => { <Card /> })` returns an array of
  `undefined` and renders nothing, because a brace-bodied arrow function needs an explicit
  `return`. Use the parenthesised form, `(i) => (<Card />)`, and the problem cannot occur.
- **A `.filter()` before the `.map()` is normal and cheap.** You are transforming a plain array
  with plain array methods. There is no `WP_Query` to re-run and no pointer to reset.

### 5. `key` is how React matches an item across two renders

This is the concept WordPress gives you no preparation for, and the one with the most expensive
failure mode.

React renders your list, then later renders it again, and has to decide for each element in the
new list: is this the same item as one in the old list, or a different item that happens to look
similar? If it is the same item, React keeps the existing DOM node and its state and just moves
it. If it is different, React destroys the old node and builds a new one. `key` is the only
information React has for that decision.

```
FILTER APPLIED: the s2 incident disappears from the middle of the list

key={incident.slug}                        key={index}
─────────────────────────────────────      ─────────────────────────────────────
before:  "incident-01"  [x] ticked         before:  0  [x] ticked
         "incident-02"                              1
         "incident-03"                              2

after:   "incident-01"  [x] ticked         after:   0  [x] ticked
         "incident-03"                              1     ← was key 1, now holds
                                                            incident-03's data,
React sees 01 unchanged, 02 gone.          keeps the DOM node and its state
It moves 03's existing node up and                        │
keeps its state with it.                   React sees keys 0 and 1, decides
                                           nothing was removed, and re-uses the
                                           node — with the wrong item in it.
```

The failure is not a crash and not a blank screen. It is **a ticked checkbox next to the wrong
incident after you filter**, or a half-typed comment that jumps to a different card, or a focus
ring on the wrong row. It looks like a data bug, so you go and read your query.

| Key candidate | Verdict |
|---|---|
| `incident.slug` | ✅ **Use this.** WordPress guarantees `post_name` is unique per post type, and the seeder pins it (Lesson 04.5). It is stable across reorders, filters and refetches. |
| `incident.id` | ✅ Also correct — the Relay global ID. Slightly noisier in the DOM inspector and no better. |
| `incident.databaseId` | ✅ Correct, and a fine choice if you already have it |
| the array index | ❌ Stable only while the array's order never changes. It is exactly wrong for a filtered list, which is what this module builds. |
| `Math.random()` | ❌ A new key every render, so every node is destroyed and rebuilt every time. Slower than no key, and it destroys state on purpose. |
| the array index, "because the list never changes" | ❌ It changes in Lesson 08.3. Lists that never change are rarer than they look. |

Two mechanical rules. The `key` goes on the **outermost element returned by the `.map()`
callback** — if you wrap the card in an `<li>`, the key goes on the `<li>`, not on the card.
And a `key` is not readable inside the component: it is React's bookkeeping, not a prop, and if
the component needs the slug you pass it again as data.

### 6. Conditional rendering, and the `{0}` that ruins an afternoon

JSX renders some falsy values as nothing and one falsy value as visible text. This table is the
single most useful thing in the lesson:

| Expression | Renders |
|---|---|
| `{null}`, `{undefined}`, `{false}`, `{true}` | nothing |
| `{''}` | nothing |
| `{0}` | the character `0` |
| `{NaN}` | the characters `NaN` |
| `{[]}` | nothing |

So `{value && <p/>}` evaluates to `value` when `value` is falsy — and if `value` is `0`, React
dutifully renders `0`. Applied to the field the content model actually has:

| You write | `downtimeMinutes: 0` renders | `downtimeMinutes: null` renders |
|---|---|---|
| `{d && <p>{d} min</p>}` | a bare `0` in the DOM ❌ | nothing |
| `{d ? <p>{d} min</p> : null}` | `<p>0 min</p>` ✅ | nothing |
| `{d != null && <p>{d} min</p>}` | `<p>0 min</p>` ✅ | nothing |

There is no PHP instinct that protects you here. `echo null`, `echo false` and `echo 0`… well,
two of those print nothing and the third prints `0`, but PHP developers reach for
`if (!empty($x))`, and `empty()` treats `0`, `''`, `null` and `[]` identically. Carrying that
habit into JSX gives you `{d && …}` and a stray zero.

**The recommendation, stated plainly: use `!= null` for numbers, and the conditional operator
for anything you want to read at a glance.** `!= null` with two equals signs is the one place
this course permits loose equality, because `x != null` is precisely "neither `null` nor
`undefined`" and there is no shorter way to say it. For everything else, `===`.

The other two branches this lesson needs:

- **The empty state.** `incidents.length === 0` gets its own early `return`, above the list. A
  list component that renders an empty `<ul>` when a filter matches nothing is a bug report
  waiting to happen.
- **The severity badge.** `SEVERITY_LABEL[severity.slug]` from
  [`src/types/content.ts`](../appendix/03-content-model-reference.md#2-taxonomies) is a `Record`
  over the four-term closed set, so it is exhaustive by construction and needs no fallback for a
  slug that exists. It needs a fallback for the term being **absent**, which is the next Key
  Concept.

### 7. `noUncheckedIndexedAccess` meets a Relay connection

Lesson 07.3 turned on `noUncheckedIndexedAccess`, and this is the lesson where it earns its
keep. Under that flag, indexing an array yields `T | undefined`, because the compiler will not
pretend to know the length.

```
incident.severities.nodes[0]         SeverityTerm | undefined
incident.severities.nodes[0].slug    ❌ TS18048: possibly 'undefined'
incident.severities.nodes[0]?.slug   SeverityLevel | undefined
```

The reflex is annoyance. The correct reaction is that the compiler is right: an incident with no
severity term is a real state. A moderator can remove a term. The Module 16 submission form
creates an incident before terms are assigned. `severities(first: 1)` on an incident with zero
terms returns `{ nodes: [] }`, not an error. In the seeded data every incident has one, and it
took the fixture in this lesson eight minutes to produce the case that does not.

Two shapes handle it, and both appear in this lesson:

```
const severity = incident.severities.nodes[0];        ← pull it out once
{severity === undefined ? 'Unclassified'              ← then branch explicitly
                        : SEVERITY_LABEL[severity.slug]}

function at<T>(items: readonly T[], index: number): T {   ← or narrow once, in a
  const item = items[index % items.length];               helper, for the case
  if (item === undefined) {                               where the array really
    throw new Error('at(): empty array');                  cannot be empty
  }
  return item;
}
```

Reach for the first inside a component, where "absent" is a state to render. Reach for the
second in a fixture generator, where an empty array is a programming error and throwing is the
honest response. What you must not do is silence it with `!` or `as SeverityTerm`: both convert
a compiler warning into a run-time `TypeError` in a component, which is strictly worse.

### 8. Fixtures that lie about the shape of your data are a debt you pay twice

`fixtures.ts` could have been forty objects of the form
`{ title: 'x', severity: 's1-catastrophic', downtime: 42 }`. It would be a third of the length
and every component in this module would be shorter.

It is the wrong choice, and here is the concrete cost. WPGraphQL returns taxonomy terms as Relay
connections, SCF groups as nullable objects and numbers as nullable floats:

```
what WPGraphQL actually returns            the convenient lie
─────────────────────────────────────      ─────────────────────────────────────
severities: { nodes: [ { name,             severity: 's1-catastrophic'
                         slug } ] }
incidentDetails: {                         downtime: 42
  downtimeMinutes: 42 | null               cost: 1200
} | null
scapegoats: { nodes: [] }                  scapegoat: ''
```

Write components against the right-hand column and Lesson 09.3 — which replaces the fixture
import with a live query — becomes a rewrite of every component instead of a one-line import
change. You would also never have met `noUncheckedIndexedAccess` on a connection, never handled
a `null` SCF group, and never seen the `{0}` bug, because the convenient shape has no zeros in
it. The bugs do not go away; they move to the lesson where you are also learning Server
Components.

| | Real response shape | Flattened convenience shape |
|---|---|---|
| Lines of fixture | ~200 | ~60 |
| Lesson 09.3 swap | change one `import` | rewrite three components |
| Teaches nullability | yes, unavoidably | no |
| Teaches connections | yes | no |
| Honest about what the API returns | yes | no |

**Verdict: real shape, always.** A fixture is a claim about your data source. A false claim is
worse than no fixture, because the components built on it compile.

---

## Task

### Step 1: Write the term fixtures and the six incidents

This is the longest file in the module and the one that matters most. Every field name comes
from [appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details), every
term slug from [§2](../appendix/03-content-model-reference.md#2-taxonomies), and the titles from
the seeder in Lesson 04.5, so what you see in the browser is what
`http://localhost:8080/graphql` will return in Lesson 09.3.

```ts
// next-app/src/components/incidents/fixtures.ts
// Typed incident fixtures in REAL WPGraphQL response shape.
//
// Six incidents are hand-written; INCIDENTS expands them to forty, which is what
// `wp blame seed` produces (appendix 03 §9) and what makes the Lesson 08.3 filter
// worth writing. Lesson 09.3 deletes the INCIDENTS import from the page and puts a
// live query in its place; no component changes, because the shape here is the
// shape the API returns.

import type { Incident, Scapegoat, SeverityTerm, Term } from '@/types/content';

/**
 * Index a non-empty array and narrow away `undefined`.
 *
 * `noUncheckedIndexedAccess` (Lesson 07.3) types `items[i]` as `T | undefined`,
 * and it is right to: nothing about an array type promises a length. Here an
 * empty array is a programming error rather than a state to render, so this
 * throws instead of returning a fallback.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) {
    throw new Error('at(): the array is empty');
  }
  return item;
}

/* ── Terms ────────────────────────────────────────────────────────────────
   `id` is an opaque base64 Relay global ID in the real API. Nothing in the UI
   parses it, which is exactly why a readable placeholder is safe in a fixture.
   `count` is wp_term_taxonomy.count — the leaderboard in Module 11 reads it. */

export const SEVERITY_TERMS: readonly SeverityTerm[] = [
  { id: 'fixture:severity:s1', name: 'S1 — Catastrophic', slug: 's1-catastrophic', count: 10 },
  { id: 'fixture:severity:s2', name: 'S2 — Major', slug: 's2-major', count: 10 },
  { id: 'fixture:severity:s3', name: 'S3 — Minor', slug: 's3-minor', count: 10 },
  { id: 'fixture:severity:s4', name: 'S4 — Cosmetic', slug: 's4-cosmetic', count: 10 },
];

// The ten terms the plugin creates on activation. `scapegoatProfile` is omitted
// rather than set to null: it is declared `?:` on the type, `exactOptionalPropertyTypes`
// is on, and "the query did not select it" is a different statement from "the
// field is empty". No Module 08 component reads it.
export const SCAPEGOAT_TERMS: readonly Scapegoat[] = [
  { id: 'fixture:scapegoat:1', name: 'The Intern', slug: 'the-intern', count: 4 },
  { id: 'fixture:scapegoat:2', name: 'Mercury Retrograde', slug: 'mercury-retrograde', count: 4 },
  { id: 'fixture:scapegoat:3', name: 'Legacy jQuery', slug: 'legacy-jquery', count: 4 },
  { id: 'fixture:scapegoat:4', name: 'DNS', slug: 'dns', count: 4 },
  { id: 'fixture:scapegoat:5', name: 'Solar Flares', slug: 'solar-flares', count: 4 },
  { id: 'fixture:scapegoat:6', name: 'The Cache', slug: 'the-cache', count: 4 },
  { id: 'fixture:scapegoat:7', name: 'Daylight Saving Time', slug: 'daylight-saving-time', count: 4 },
  { id: 'fixture:scapegoat:8', name: 'That One Regex', slug: 'that-one-regex', count: 4 },
  { id: 'fixture:scapegoat:9', name: 'Kubernetes', slug: 'kubernetes', count: 4 },
  {
    id: 'fixture:scapegoat:10',
    name: 'The Previous Contractor',
    slug: 'the-previous-contractor',
    count: 4,
  },
];

const TECH_STACK_TERMS: readonly Term[] = [
  { id: 'fixture:stack:1', name: 'React', slug: 'react', count: 4 },
  { id: 'fixture:stack:2', name: 'Next.js', slug: 'nextjs', count: 4 },
  { id: 'fixture:stack:3', name: 'WordPress', slug: 'wordpress', count: 4 },
  { id: 'fixture:stack:4', name: 'PHP', slug: 'php', count: 4 },
  { id: 'fixture:stack:5', name: 'MySQL', slug: 'mysql', count: 4 },
  { id: 'fixture:stack:6', name: 'AWS', slug: 'aws', count: 4 },
  { id: 'fixture:stack:7', name: 'Docker', slug: 'docker', count: 4 },
  { id: 'fixture:stack:8', name: 'Kubernetes', slug: 'kubernetes', count: 4 },
  { id: 'fixture:stack:9', name: 'jQuery', slug: 'jquery', count: 4 },
  { id: 'fixture:stack:10', name: 'Redis', slug: 'redis', count: 4 },
];

/** The seeder's ten headlines, cycled with `(#n)` appended. Lesson 04.5. */
const SEED_HEADLINES: readonly string[] = [
  'Deployed on a Friday',
  'The certificate expired',
  'Someone rotated the wrong key',
  'The cron job ran twice',
  'A regex ate the payload',
  'The cache never invalidated',
  'DNS propagated to nowhere',
  'The migration ran backwards',
  'Autoscaling scaled to zero',
  'A leap second in the log parser',
];

/* ── The six hand-written incidents ──────────────────────────────────────
   Three fields deviate from `wp blame seed` ON PURPOSE, and the deviation is
   the point. The seeder fills every field of all forty rows, so it can never
   produce a null or a zero. The Module 16 submission form will, because SCF
   cannot promise a sub-field was filled. A fixture set that only covers the
   happy path is a fixture set that hides your nullability bugs until Module 16.

   Coverage in this array:  downtimeMinutes 0 · downtimeMinutes null ·
   estimatedCostUsd null · stackTrace null · an empty scapegoat connection ·
   incidentDetails null entirely. */

export const SEED_INCIDENTS: readonly Incident[] = [
  {
    id: 'fixture:incident:1',
    databaseId: 1001,
    slug: 'incident-01',
    title: 'Deployed on a Friday (#1)',
    date: '2024-09-02T11:00:00',
    blameScore: 41.2,
    incidentDetails: {
      occurredAt: '2024-09-02T09:00:00',
      // ZERO, not null. A hot fix that caused no measurable outage. This single
      // value is what makes `{downtime && …}` print a bare 0 in Step 3.
      downtimeMinutes: 0,
      estimatedCostUsd: 0,
      environment: 'PRODUCTION',
      resolutionStatus: 'OPEN',
      blameConfidence: 0,
      stackTrace:
        'Traceback (most recent call last):\n  File "app/handler.php", line 40\n  RuntimeException: Deployed on a Friday',
      reporterDisplayName: 'Ada L.',
      isVerified: true,
    },
    severities: { nodes: [at(SEVERITY_TERMS, 0)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 0)] },
    techStacks: { nodes: [at(TECH_STACK_TERMS, 0)] },
  },
  {
    id: 'fixture:incident:2',
    databaseId: 1002,
    slug: 'incident-02',
    title: 'The certificate expired (#2)',
    date: '2024-09-03T11:00:00',
    blameScore: 88.7,
    incidentDetails: {
      occurredAt: '2024-09-03T09:00:00',
      // NULL. Nobody measured. Distinct from zero, and the card must say so.
      downtimeMinutes: null,
      estimatedCostUsd: 911,
      environment: 'STAGING',
      resolutionStatus: 'WONTFIX',
      blameConfidence: 17,
      stackTrace: 'x509: certificate has expired or is not yet valid',
      reporterDisplayName: 'Grace H.',
      isVerified: false,
    },
    severities: { nodes: [at(SEVERITY_TERMS, 1)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 1)] },
    techStacks: { nodes: [at(TECH_STACK_TERMS, 3)] },
  },
  {
    id: 'fixture:incident:3',
    databaseId: 1003,
    slug: 'incident-03',
    title: 'Someone rotated the wrong key (#3)',
    date: '2024-09-04T11:00:00',
    blameScore: 64.0,
    incidentDetails: {
      occurredAt: '2024-09-04T09:00:00',
      downtimeMinutes: 79,
      // NULL cost. Finance never replied. The card renders "No cost recorded".
      estimatedCostUsd: null,
      environment: 'DEVELOPMENT',
      resolutionStatus: 'BLAMED',
      blameConfidence: 34,
      stackTrace: 'AuthenticationError: signature does not match any known key',
      reporterDisplayName: 'Linus T.',
      isVerified: false,
    },
    severities: { nodes: [at(SEVERITY_TERMS, 2)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 2)] },
    techStacks: { nodes: [at(TECH_STACK_TERMS, 6)] },
  },
  {
    id: 'fixture:incident:4',
    databaseId: 1004,
    slug: 'incident-04',
    title: 'The cron job ran twice (#4)',
    date: '2024-09-05T11:00:00',
    blameScore: 12.5,
    incidentDetails: {
      occurredAt: '2024-09-05T09:00:00',
      downtimeMinutes: 116,
      estimatedCostUsd: 2733,
      environment: 'WORKS_ON_MY_MACHINE',
      resolutionStatus: 'MITIGATED',
      blameConfidence: 51,
      // NULL trace. No Module 08 component renders it — the incident detail
      // page in Lesson 09.3 does — but the fixture carries the field because
      // the fixture's job is to be the API's shape, not this card's shape.
      stackTrace: null,
      reporterDisplayName: 'Barbara L.',
      isVerified: true,
    },
    severities: { nodes: [at(SEVERITY_TERMS, 3)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 3)] },
    techStacks: { nodes: [at(TECH_STACK_TERMS, 9)] },
  },
  {
    id: 'fixture:incident:5',
    databaseId: 1005,
    slug: 'incident-05',
    title: 'A regex ate the payload (#5)',
    date: '2024-09-06T11:00:00',
    blameScore: 97.3,
    incidentDetails: {
      occurredAt: '2024-09-06T09:00:00',
      downtimeMinutes: 153,
      estimatedCostUsd: 3644,
      environment: 'PRODUCTION',
      resolutionStatus: 'OPEN',
      blameConfidence: 68,
      stackTrace: 'RegExpError: catastrophic backtracking after 30000ms',
      reporterDisplayName: 'Ken T.',
      isVerified: false,
    },
    severities: { nodes: [at(SEVERITY_TERMS, 0)] },
    // EMPTY CONNECTION. Nobody has been blamed yet. `nodes[0]` is `undefined`
    // here, and that is a state, not an error.
    scapegoats: { nodes: [] },
    techStacks: { nodes: [at(TECH_STACK_TERMS, 2)] },
  },
  {
    id: 'fixture:incident:6',
    databaseId: 1006,
    slug: 'incident-06',
    title: 'The cache never invalidated (#6)',
    date: '2024-09-07T11:00:00',
    blameScore: null,
    // THE WHOLE SCF GROUP IS NULL. This is what an incident created before the
    // field group existed looks like, and what WPGraphQL for SCF returns when
    // no field in the group has ever been saved. Every `incidentDetails.x`
    // access in every component has to survive it.
    incidentDetails: null,
    severities: { nodes: [at(SEVERITY_TERMS, 1)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 5)] },
    techStacks: { nodes: [at(TECH_STACK_TERMS, 5)] },
  },
];
```

**Verify §1:**

- [ ] `npm run type-check` is silent. If it names a field, compare that field with
      [appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) rather
      than with your memory.
- [ ] Every one of the six incidents has all ten `Incident` fields, or `incidentDetails: null`
      instead of the group.
- [ ] `grep -c 'severity:' src/components/incidents/fixtures.ts` prints `0`. If it prints
      anything else you have invented a flattened field that the API does not return.

### Step 2: Expand six into forty

Six is what a human can hand-write and keep honest. Forty is what a filter has to bite on, and
it is the number [appendix 03 §9](../appendix/03-content-model-reference.md#9-seed-data)
promises. Generate the rest, deterministically, from the six.

```ts
// next-app/src/components/incidents/fixtures.ts — append
/**
 * Forty incidents from six, deterministically.
 *
 * Cycles the four severity terms and the ten scapegoat terms exactly the way
 * `wp blame seed` does (`$i % 4` and `$i % 10`, Lesson 04.5), so severity and
 * scapegoat coverage matches the real site: ten incidents per severity, four per
 * scapegoat. Slugs follow the seeder's `incident-NN` pattern and are unique,
 * which is what makes them usable as React keys.
 *
 * No randomness anywhere. A fixture that differs between two runs is a fixture
 * you cannot write a test against — Lesson 12.4 makes the same argument in PHP.
 */
export function expandFixtures(seed: readonly Incident[], total: number): readonly Incident[] {
  return Array.from(
    { length: total },
    (_unused, i): Incident => ({
      ...at(seed, i),
      id: `fixture:incident:${i + 1}`,
      databaseId: 1001 + i,
      slug: `incident-${String(i + 1).padStart(2, '0')}`,
      title: `${at(SEED_HEADLINES, i)} (#${i + 1})`,
      severities: { nodes: [at(SEVERITY_TERMS, i)] },
      // The one incident with an empty scapegoat connection keeps it. Losing the
      // edge case to the expansion would defeat the purpose of having written it.
      scapegoats:
        at(seed, i).scapegoats.nodes.length === 0
          ? { nodes: [] }
          : { nodes: [at(SCAPEGOAT_TERMS, i)] },
    })
  );
}

/** What the components actually render. Lesson 09.3 replaces this with a query. */
export const INCIDENTS: readonly Incident[] = expandFixtures(SEED_INCIDENTS, 40);
```

`_unused` is the callback's first parameter, which `Array.from` supplies and this code has no
use for. The leading underscore is what `noUnusedParameters` and the ESLint
`argsIgnorePattern` from Lesson 07.5 both agreed to accept.

### Step 3: Give `IncidentCard` props — including one line that is wrong on purpose

Replace `IncidentCard.tsx` entirely. Every literal from Lesson 08.1 becomes a value read from
the prop, and the markup is otherwise identical.

The `Downtime` line below uses `&&`. That is the bug, it is deliberate, and you are going to
watch it happen in Step 4 before fixing it in the same file. Type it as written.

```tsx
// next-app/src/components/incidents/IncidentCard.tsx
// One incident, from props.
//
// The field set is deliberate and narrow: title, date, the severity term, the
// first scapegoat term, and downtimeMinutes + environment from incidentDetails.
// That is exactly the selection set of the `IncidentCardFields` GraphQL fragment
// from Lesson 05.3, and Lesson 10.2 narrows this component's props to the type
// codegen produces from it. A field rendered here that the fragment does not
// select compiles today and breaks then.
//
// So: no blameScore (computed, detail page), no stackTrace (detail page), no
// reporterDisplayName. Lesson 09.3 renders those on /incidents/[slug].
import type { Incident } from '@/types/content';
import { SEVERITY_LABEL } from '@/types/content';

export function IncidentCard({ incident }: { readonly incident: Incident }) {
  // Pull the nullable and possibly-absent values out once, at the top, so the
  // JSX below is about layout rather than about narrowing.
  const severity = incident.severities.nodes[0];
  const scapegoat = incident.scapegoats.nodes[0];
  const details = incident.incidentDetails;
  const downtime = details?.downtimeMinutes;
  const cost = details?.estimatedCostUsd;

  return (
    <article className="incident-card">
      <h2>{incident.title}</h2>

      {incident.date === null ? null : (
        <p>
          Reported <time dateTime={incident.date}>{incident.date.slice(0, 10)}</time>
        </p>
      )}

      <p className="incident-card__severity">
        {/* SEVERITY_LABEL is a Record over the closed four-term set, so there is
            no missing-label case. There IS a missing-TERM case. */}
        {severity === undefined ? 'Unclassified' : SEVERITY_LABEL[severity.slug]}
      </p>

      <dl>
        <dt>Blamed on</dt>
        <dd>{scapegoat?.name ?? 'Nobody yet'}</dd>

        <dt>Downtime</dt>
        {/* WRONG ON PURPOSE. Step 4 observes what this does to incident-01,
            whose downtimeMinutes is 0, and then fixes it. */}
        <dd>{downtime && `${downtime} min`}</dd>

        {/* A DEBT, named and dated. `estimatedCostUsd` is NOT in the
            IncidentCardFields fragment, so this row is one field of
            overfetching. It is here because the null-versus-zero branch is
            worth writing twice, and Lesson 10.5's overfetching audit is where
            it comes out. */}
        <dt>Estimated cost</dt>
        <dd>{cost != null ? `$${cost.toLocaleString('en-US')}` : 'No cost recorded'}</dd>

        <dt>Environment</dt>
        <dd>{details?.environment ?? 'Unknown'}</dd>
      </dl>
    </article>
  );
}
```

Three things worth naming in that file.

`import type` and `import` are two separate lines from the same module because
`verbatimModuleSyntax` (Lesson 07.3) makes the distinction real: `Incident` is erased at compile
time, `SEVERITY_LABEL` is a value that survives into the bundle.

`incident.date.slice(0, 10)` is legal only inside the `=== null` branch, because that check
narrowed the property for the rest of the expression.

And the markup **lost** Lesson 08.1's `<pre>` stack trace, its reporter name and its blame
confidence. That is the important one, and the reason is a design rule worth taking away from
this lesson: **a card component's field set should mirror exactly one GraphQL fragment.** The
frozen `IncidentCardFields` fragment from Lesson 05.3 selects `id title slug date`, one severity
term, one scapegoat term and `incidentDetails { downtimeMinutes environment }` — nothing else.
Lesson 10.2 replaces this component's `Incident` prop with the type codegen generates from that
fragment, and at that moment every field the fragment does not select becomes a build error. A
stack trace, a computed score and a reporter's name all belong on the incident detail page,
which selects a larger fragment. Lesson 09.3 builds it.

The one exception is flagged in the file: `estimatedCostUsd` is a labelled debt, kept for one
lesson because the `null`-versus-zero branch it produces is worth writing twice, and removed by
Lesson 10.5's overfetching audit.

### Step 4: Watch the stray zero, then fix it

Update the harness to render one card with the incident that has zero downtime.

```tsx
// next-app/scratch/App.tsx
import { IncidentCard } from '@/components/incidents/IncidentCard';
import { SEED_INCIDENTS } from '@/components/incidents/fixtures';

export function App() {
  const first = SEED_INCIDENTS[0];

  return (
    <main>
      <h1>Blame The Tech — incident board</h1>
      {first === undefined ? <p>No fixtures.</p> : <IncidentCard incident={first} />}
    </main>
  );
}
```

```bash
npm run scratch
```

**Verify §4a:**

- [ ] The `Downtime` row reads exactly `0` — no unit, no word. Not "0 min", not blank.
- [ ] `npm run type-check` is **silent**. The compiler has no objection: `number | null | undefined`
      is a legal thing to render. This is the class of bug types do not catch.
- [ ] Open the DOM inspector on that `<dd>`. Its only child is the text node `0`.

Now fix the line:

```tsx
// next-app/src/components/incidents/IncidentCard.tsx — edit, inside the <dl>
        <dt>Downtime</dt>
        {/* `!= null` is "neither null nor undefined" and nothing else. It is the
            one loose-equality comparison this course allows, for that reason. */}
        <dd>{downtime != null ? `${downtime} min` : 'Not recorded'}</dd>
```

**Verify §4b:**

- [ ] The row now reads `0 min`.
- [ ] Change `App.tsx` to render `SEED_INCIDENTS[1]` instead. The row reads `Not recorded`,
      because that incident's `downtimeMinutes` is `null`. Two different states, two different
      strings — which is the whole reason the fixture has both.
- [ ] Render `SEED_INCIDENTS[5]`, whose `incidentDetails` is `null`. Nothing throws and every
      row of the `<dl>` falls back — `Not recorded`, `No cost recorded`, `Unknown`. Put
      `SEED_INCIDENTS[0]` back afterwards.

### Step 5: Write `IncidentList`

```tsx
// next-app/src/components/incidents/IncidentList.tsx
// An array of incidents, keyed by slug. Lesson 08.5 refactors this to read its
// filters from context instead of taking them as props.
import type { Incident } from '@/types/content';

import { IncidentCard } from './IncidentCard';

type IncidentListProps = {
  readonly incidents: readonly Incident[];
};

export function IncidentList({ incidents }: IncidentListProps) {
  // The empty state gets its own return, above the list. A component that
  // renders an empty <ul> is a bug report waiting to be filed.
  if (incidents.length === 0) {
    return <p>No incidents on the board. Somebody, somewhere, is relieved.</p>;
  }

  return (
    <ul className="incident-list">
      {incidents.map((incident) => (
        // The key goes on the OUTERMOST element the callback returns — this
        // <li>, not the card inside it. `slug` is unique per post type and
        // stable across filters, which the array index is not.
        <li key={incident.slug}>
          <IncidentCard incident={incident} />
        </li>
      ))}
    </ul>
  );
}
```

### Step 6: Render all forty

```tsx
// next-app/scratch/App.tsx
import { IncidentList } from '@/components/incidents/IncidentList';
import { INCIDENTS } from '@/components/incidents/fixtures';

export function App() {
  return (
    <main>
      <h1>Blame The Tech — incident board</h1>
      <p>{`${INCIDENTS.length} incidents`}</p>
      <IncidentList incidents={INCIDENTS} />
    </main>
  );
}
```

**Verify §6:**

- [ ] The page says `40 incidents` and forty cards follow.
- [ ] The browser console is **empty**. No key warning, no nullability crash.
- [ ] Card 5 reads `Blamed on: Nobody yet`. Card 6 falls back on every detail row, because its
      whole `incidentDetails` group is `null`.
- [ ] Temporarily render `<IncidentList incidents={[]} />`. You get the empty-state sentence,
      not an empty list. Put `INCIDENTS` back.

### Step 7: Break the keys on purpose, then commit

Change the key to the array index and watch the difference — not in the markup, which looks
identical, but in what survives a re-order.

```tsx
// next-app/src/components/incidents/IncidentList.tsx — TEMPORARY. Reverted below.
      {incidents.map((incident, index) => (
        <li key={index}>
          <IncidentCard incident={incident} />
        </li>
      ))}
```

**Verify §7:**

- [ ] With index keys, the page renders identically. There is no warning and no visible symptom.
      That is exactly why this bug survives code review.
- [ ] Now delete the `key` prop entirely. The console logs
      `Each child in a list should have a unique "key" prop`, and names `IncidentList`. React
      tells you when a key is missing; it cannot tell you when a key is wrong.
- [ ] Restore `key={incident.slug}` and remove the `index` parameter. Leaving an unused
      parameter behind is a `noUnusedParameters` error, which is the compiler doing you a favour.
- [ ] `npm run lint && npm run type-check` are both clean.

```bash
cd ..
git add next-app/src/components/incidents/
git commit -m "feat(web): typed incident fixtures and a keyed list"
```

---

## Verification

```bash
cd next-app

# 1. Everything type-checks, fixtures and components together
npm run type-check && echo "types OK"
# Expected: no output from tsc, then "types OK"

# 2. Lint is clean, with the React rules from Lesson 08.1 active
npm run lint && echo "lint OK"
# Expected: lint OK

# 3. Forty incidents, forty unique slugs, and the seeder's severity spread
cat > src/components/incidents/_count.ts <<'TS'
import { INCIDENTS } from './fixtures';

const bySeverity: Record<string, number> = {};
for (const incident of INCIDENTS) {
  const slug = incident.severities.nodes[0]?.slug ?? 'none';
  bySeverity[slug] = (bySeverity[slug] ?? 0) + 1;
}

console.log('total  ', INCIDENTS.length);
console.log('unique ', new Set(INCIDENTS.map((i) => i.slug)).size);
console.log('severity', JSON.stringify(bySeverity));
TS
npx tsx src/components/incidents/_count.ts
# Expected: total   40
#           unique  40      ← a lower number means duplicate React keys
#           severity {"s1-catastrophic":10,"s2-major":10,"s3-minor":10,"s4-cosmetic":10}
#           Ten per severity is exactly what appendix 03 §9 promises. The
#           scapegoat spread is four per term everywhere except the six rows that
#           inherited the empty connection, which is deliberate.
rm src/components/incidents/_count.ts

# 4. One incident really does carry an empty scapegoat connection
grep -c 'scapegoats: { nodes: \[\] }' src/components/incidents/fixtures.ts
# Expected: 1

# 5. The nullability cases really are in the fixture
grep -c 'downtimeMinutes: 0' src/components/incidents/fixtures.ts
# Expected: 1
grep -c 'downtimeMinutes: null' src/components/incidents/fixtures.ts
# Expected: 1
grep -c 'estimatedCostUsd: null' src/components/incidents/fixtures.ts
# Expected: 1
grep -c 'incidentDetails: null' src/components/incidents/fixtures.ts
# Expected: 1

# 6. The fixture is in RESPONSE shape, not a convenient flattening
grep -cE '^\s+(severity|scapegoat|downtime|cost):' src/components/incidents/fixtures.ts
# Expected: 0 — every taxonomy is a connection and every SCF value is nested

# 7. NEGATIVE — reproduce the `{0}` bug in one command, then the fix
cat > src/components/incidents/_zero.tsx <<'TSX'
import { renderToStaticMarkup } from 'react-dom/server';

const downtime: number | null = 0;

console.log('&&     :', renderToStaticMarkup(<dd>{downtime && `${downtime} min`}</dd>));
console.log('!= null:', renderToStaticMarkup(<dd>{downtime != null ? `${downtime} min` : '-'}</dd>));
TSX
npx tsx src/components/incidents/_zero.tsx
# Expected: &&     : <dd>0</dd>
#           != null: <dd>0 min</dd>
#           The first line is the bug, rendered, with no warning anywhere.
rm src/components/incidents/_zero.tsx

# 8. NEGATIVE — a missing key is a React warning, and a WRONG key is not
cat > src/components/incidents/_nokey.tsx <<'TSX'
import { renderToStaticMarkup } from 'react-dom/server';

const slugs = ['incident-01', 'incident-02'];

console.log(renderToStaticMarkup(<ul>{slugs.map((s) => <li>{s}</li>)}</ul>));
TSX
npx tsx src/components/incidents/_nokey.tsx 2>&1 | grep -ci 'key'
# Expected: 1 or more. React's message is 'Each child in a list should have a
#           unique "key" prop.' If you get 0, NODE_ENV is "production" in this
#           shell and every React warning is stripped — unset it and re-run.
rm src/components/incidents/_nokey.tsx

# 9. NEGATIVE — no `any` reached either new file
grep -nE ':\s*any\b|as any|<any>' src/components/incidents/fixtures.ts \
  src/components/incidents/IncidentList.tsx src/components/incidents/IncidentCard.tsx
# Expected: no output. `@typescript-eslint/no-explicit-any` is an error
#           (Lesson 07.5), so this is belt and braces.

# 10. NEGATIVE — props cannot be mutated, and the compiler says so
cat > src/components/incidents/_mutate.ts <<'TS'
import type { Incident } from '@/types/content';

export function rename(incident: Incident): void {
  incident.title = 'something else';
}
TS
npm run type-check; echo "exit=$?"
# Expected: TS2540, "Cannot assign to 'title' because it is a read-only
#           property", then exit=1. NOT exit=0.
rm src/components/incidents/_mutate.ts

# 11. Back to green, with no scratch files left in src/
npm run type-check && ls src/components/incidents/
# Expected: silence, then exactly:
#           IncidentCard.tsx  IncidentList.tsx  fixtures.ts

# 12. The two new files are committed and the harness is still not
cd ..
git status --short
# Expected: clean. Nothing from next-app/scratch/ appears, ever.
```

Checks 7 and 8 together are the lesson. One shows a bug that no tool reports; the other shows
the one list mistake React does report. The gap between them is why `key={incident.slug}` is a
rule rather than a preference.

## Control Questions

1. `<IncidentCard incident={x} />` and `get_template_part('card', 'incident', ['post' => $x])`
   both pass data explicitly. Name two failures the first one makes impossible, and say which
   tool finds each.
2. `incident.severities.nodes[0]` is typed `SeverityTerm | undefined` even though every seeded
   incident has exactly one severity term. Give two real situations in this application that
   produce the empty case, and say why `nodes[0]!` would be the wrong response to either.
3. A list rendered with `key={index}` shows a checkbox ticked next to the wrong incident after
   a filter is applied. Explain what React did, step by step, and say why no warning appeared.
4. `{incident.incidentDetails?.downtimeMinutes && <p>…</p>}` renders a bare `0` for one of the
   six seeded fixtures. Say which one, what the DOM contains, and give two rewrites that fix it
   with different trade-offs.
5. `fixtures.ts` is roughly three times longer than a flattened equivalent would be. Name the
   specific lesson that would have to change if it were flattened, and the concrete edit that
   lesson would need instead.

## Learn More

- [Passing Props to a Component](https://react.dev/learn/passing-props-to-a-component) —
  including `children` and the spread syntax this lesson deliberately avoided
- [Rendering Lists](https://react.dev/learn/rendering-lists) — react.dev's own treatment of
  `key`, with the rules on where it goes and why the index is not one
- [Conditional Rendering](https://react.dev/learn/conditional-rendering) — the `&&` trap has
  its own section here, which is a good sign of how often it happens
- [Keeping Components Pure](https://react.dev/learn/keeping-components-pure) — why props are
  treated as read-only even though JavaScript would let you write to them
- [`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess)
  — the flag behind half this lesson's `?.` operators, and the reasoning for its default being
  off
- [MDN: `<dl>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dl) — the element
  `IncidentCard` uses for its name/value rows, and the nesting rules Module 22 will audit
- [`WP_Query`](https://developer.wordpress.org/reference/classes/wp_query/) — worth re-reading
  the "Usage" note about `wp_reset_postdata()` once, to appreciate what props removed
- [React `renderToStaticMarkup`](https://react.dev/reference/react-dom/server/renderToStaticMarkup)
  — the API checks 7 and 8 used to render a component from the command line with no browser
