---
title: 'Server vs Client Components'
module: 9
lesson: 2
teaches: [react-server-components, use-client, client-islands, serialization-boundary, bundle-boundary]
produces: ['next-app/src/app/[locale]/incidents/page.tsx', 'next-app/src/components/incidents/IncidentFilterProvider.tsx', 'next-app/src/components/incidents/IncidentBrowser.tsx']
requires: [9.1]
---

# Lesson 09.2 — Server vs Client Components

## Quick Overview

In the App Router every component is a **Server Component** unless you say otherwise. It runs
on the server, during the request, and its code is never sent to the browser. Adding
`'use client'` at the top of a file opts that file and everything it imports into the client
bundle, where it hydrates and can hold state. This is one directive with two effects — where
the code runs, and whether the code ships — and confusing those two is the source of nearly
every "why is this component not interactive?" and "why is my bundle 400 KB?" question in
Phase 2.

You will build `/en/incidents` as a Server Component page and keep the Module 08 filter as a
**client island**: a small `'use client'` subtree inside an otherwise server-rendered page.
That means moving `'use client'` onto exactly three files and, critically, moving
`IncidentFilterProvider` *down* the tree rather than wrapping the layout in it. The Lesson 08.5
warning lands here — a provider at the top of a layout drags the whole page into the client
bundle, and you will measure that before and after.

By the end of this lesson you will have:

- `next-app/src/app/[locale]/incidents/page.tsx` — a Server Component page still using fixtures
- `'use client'` on `IncidentFilters`, `IncidentSearch` and `IncidentFilterProvider`, and nowhere else
- The provider mounted around the filter island only, not around the layout
- A before-and-after of the route's First Load JS, computed from the build manifests
- A deliberate `console.log` in a Server Component, observed in the terminal and *not* in the browser console

## Classic WP Analogy

Classic WordPress already has this split, and you have been managing it by hand for years:

| Classic WordPress | App Router |
|---|---|
| PHP in `single-incident.php` | a Server Component |
| `wp_enqueue_script('filters')` | `'use client'` on the filter component |
| `wp_localize_script('filters','BTT',$data)` | props passed from server to client component |
| "does this need JS?" answered per feature | answered per file, by the directive |
| `is_admin()` / `wp_doing_ajax()` guards | the compiler refuses the import instead |

The mental model transfers almost exactly. A PHP template runs on the server, touches the
database, and emits HTML the browser never gets the source of — that is a Server Component.
An enqueued script runs in the browser, holds state, and responds to clicks — that is a Client
Component. And `wp_localize_script()` is genuinely the same job as passing props across the
boundary: taking server-side data and handing it to browser-side code.

The analogy breaks in three specific ways, all of which you will hit in this lesson. First,
**the boundary is transitive in one direction only.** A Server Component can render a Client
Component, but a Client Component cannot render a Server Component — once you are in the
client bundle, everything you import comes with you. There is no PHP equivalent, because a
script tag cannot include a template part. Second, **props crossing the boundary must be
serializable.** You can pass a string, a number, a plain object or an array; you cannot pass a
function, a `Date` you expect to stay a `Date`, or a class instance. `wp_localize_script()` has
the same constraint via `wp_json_encode()`, but WordPress fails silently and React fails loudly
at build time. Third — and this is the one with security consequences —
**a Server Component can read secrets and a Client Component cannot.** `process.env.WP_APP_TOKEN`
in a Server Component is fine; the same line in a `'use client'` file is either `undefined` or,
if you rename the variable with a `NEXT_PUBLIC_` prefix to "fix" it, published to the world.
Lesson 09.5 verifies that boundary with `grep`, and rule 4 in
[the env reference](../appendix/04-env-reference.md#1-the-five-rules) states it plainly:
`NEXT_PUBLIC_` is an instruction, not a hint.

---

## Key Concepts

### 1. Server is the default, and the default is the point

Every file under `src/app/` is a Server Component unless something opts it out. Nothing about
your component tree ships to the browser by default: not the component function, not the module
it imports, not the fixtures array it reads. The browser receives HTML and a compact description
of where the interactive parts go.

That inversion is the whole architectural argument for the App Router. In a single-page
application, shipping code to the browser is the default and keeping it out is an optimisation
you have to fight for. Here it is the reverse, and the practical result is that a page you did
not think about is cheap rather than expensive.

```
YOUR TREE                        WHAT THE BROWSER GETS
─────────────────────────        ────────────────────────────────────
page.tsx            (server)     HTML
 ├─ IncidentBrowser (client)     HTML + JS for this subtree
 │   ├─ IncidentSearch  (client) HTML + JS
 │   ├─ IncidentFilters (client) HTML + JS
 │   └─ IncidentList    (client) HTML + JS  ← inside the boundary
 │       └─ IncidentCard         HTML + JS  ← dragged in by its importer
 └─ <p>40 incidents</p>          HTML only
```

### 2. One directive, two different questions

`'use client'` answers two questions at once, and almost every confusion about it comes from
collapsing them into one.

| Question | Server Component | Client Component |
|---|---|---|
| Where does this code run? | on the server only — during the request, or at build time | on the server **and** in the browser |
| Does this code ship to the browser? | ❌ never | ✅ yes, as a JavaScript chunk |
| Can it hold state across interactions? | ❌ no | ✅ yes |
| Can it `await` a database or an HTTP call in its body? | ✅ yes | ❌ no |
| Can it read `process.env.WP_APP_TOKEN`? | ✅ yes | ❌ `undefined` — and see Key Concept 6 |

The row that surprises people is the first one. **A Client Component still runs on the server.**
Next renders it during the request to produce the initial HTML, and then React runs it again in
the browser to attach event handlers — the process called hydration. "Client Component" does not
mean "browser-only", it means "browser-*capable*", and that is why a `console.log` in a Client
Component appears in your terminal *and* in the browser console.

The consequence you will meet in Module 16: code in a Client Component must not assume `window`
exists at module scope, because the first execution has no `window`.

### 3. `'use client'` is a boundary, not a per-file flag

The directive applies to the file it is in **and to everything that file imports, transitively.**
You do not annotate every interactive component; you annotate the *entry point* of the
interactive subtree, and everything beneath it is in the client graph automatically.

```
src/app/[locale]/incidents/page.tsx          SERVER GRAPH
        │  imports
        ▼
┌───────────────────────────────────────┐
│ IncidentBrowser.tsx  'use client'     │  ◀── the boundary is HERE, and only here
│    imports                            │
│      IncidentSearch.tsx    'use client'│
│      IncidentFilters.tsx   'use client'│     CLIENT GRAPH
│      IncidentList.tsx      (no directive — but it is in the client graph,
│         imports                              because only a client module imports it)
│           IncidentCard.tsx (no directive — same)
│           fixtures.ts      (no directive — the whole array is now in the bundle)
└───────────────────────────────────────┘
```

Two things follow, and both are load-bearing for the rest of this course.

**A file with no directive is not "a Server Component". It is undecided.** Next compiles it into
whichever graph imports it — the server graph when a Server Component imports it, the client graph
when a Client Component does, and into *both* if both do. `IncidentCard` is exactly this: the home
page from Lesson 09.1 renders it on the server, and `IncidentList` pulls the same file into the
browser bundle. It works because the file uses no hooks and no server-only API.

**Which means a component can call `useState` with no `'use client'` anywhere in it**, as long as
nothing in the server graph ever imports it. That is not a loophole to exploit; it is why Next's
error message for the mistake reads the way it does. Step 7 of the Task triggers it on purpose.

> **Put the directive at the boundary, not on every interactive file — but do put it on any file
> that would be broken by a server import.** `IncidentFilters` and `IncidentSearch` carry it even
> though `IncidentBrowser` would have pulled them in anyway, because a directive is documentation:
> it says "this file needs a browser" to the next person who tries to render it from a page.

### 4. The direction rule, and the `children` escape hatch

A Server Component can render a Client Component. A Client Component **cannot** render a Server
Component — importing one from a client module puts it in the client graph, which is the same as
it never having been a Server Component at all.

```
✅  server  ──renders──▶  client        (page.tsx renders IncidentBrowser)
❌  client  ──imports─▶  server        (there is no such thing after compilation)
✅  server  ──passes──▶  client as a prop, already rendered   (the escape hatch)
```

The escape hatch is the third line, and it is worth more than it looks. A Client Component can
*render children it did not import*:

```tsx
// The pattern, not a file — see the Task for the real one. — (illustration)
<IncidentFilterProvider>          {/* client: holds state */}
  <ExpensiveServerThing />        {/* server: rendered on the server, passed as children */}
</IncidentFilterProvider>
```

The page creates the `<ExpensiveServerThing />` element on the server, renders it there, and hands
the *result* to the provider as `children`. The provider re-renders freely in the browser without
re-running a line of that server code, because from its point of view `children` is opaque.

This is how Module 11 mounts a stateful `Header` and a stateful mobile drawer in a layout while
keeping every page under it on the server. Without this rule, one interactive element at the top
of the tree would force the whole application into the browser — which is exactly the mistake
Key Concept 8 measures.

### 5. Props crossing the boundary must be serializable

The server renders, then serializes, then the browser deserializes. Anything that survives that
round trip may be a prop; anything that cannot is a build-time error with a readable message.

| Prop type | Crosses? | Note |
|---|---|---|
| `string`, `number`, `boolean`, `null`, `undefined` | ✅ | |
| plain objects and arrays of the above | ✅ | This is what `readonly Incident[]` is |
| `Date` | ✅ | Serialized and revived — it arrives as a `Date`, not a string |
| `Map`, `Set` | ✅ | Supported by React 19's serializer |
| Promises | ✅ | Passed unresolved and `await`ed or `use()`d on the client |
| JSX elements | ✅ | The `children` escape hatch in Key Concept 4 |
| **functions** | ❌ | Except a `'use server'` Server Action — Module 16 |
| class instances, anything with methods | ❌ | The methods cannot be serialized, so the object arrives crippled |
| `Symbol` (unregistered) | ❌ | |

`wp_localize_script()` has the identical constraint, because it runs your data through
`wp_json_encode()` — a PHP closure or a `WP_Post` object with methods does not survive it either.
The difference is the failure mode. WordPress emits `null` into a `<script>` tag and your
JavaScript reads `undefined` at runtime, at 2 a.m., for one user. React refuses to build.

> **This is the constraint that bites in this lesson's own Task, at Step 2.** `IncidentFilters` is
> a controlled component: it takes `onSeverityChange` — a function. A Server Component cannot pass
> it one. That single fact is why this lesson introduces a client-side composition root instead of
> wiring the filters straight into the page. Lesson 09.4 hits the same wall from the other side,
> with `usePathname` in the navigation, and solves it the same way.

### 6. Secrets and the boundary

`process.env` behaves differently on each side, and the difference is the most consequential thing
in this lesson.

| Where | `process.env.WP_GRAPHQL_ENDPOINT` | Why |
|---|---|---|
| Server Component | the value | It runs in Node; the whole environment is available |
| Client Component | `undefined` | Next inlines only `NEXT_PUBLIC_*`; everything else is erased |
| Client Component, after you "fix" it by renaming the variable `NEXT_PUBLIC_…` | the value — **and so does every visitor** | The prefix is an instruction to publish it |

That third row is a real incident pattern, not a hypothetical. A component is moved into the
client graph during a refactor, a value goes `undefined`, and the quickest way to make the error
stop is to add the prefix. The build goes green and the endpoint is now in a JavaScript file on a
CDN. Rule 4 in [appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules) exists for this
one move: **`NEXT_PUBLIC_` is an instruction, not a hint.**

The structural fix is Lesson 10.1's `import 'server-only'` at the top of `src/lib/graphql/`, which
turns "this ended up in the client graph" from a silent `undefined` into a build failure. In this
module you have no such guard yet, so Lesson 09.5 verifies the outcome instead, by grepping the
built bundle for the endpoint.

### 7. What each side can do that the other cannot

| Only in a Client Component | Only in a Server Component |
|---|---|
| `useState`, `useReducer` | `async` component + `await` in the body |
| `useEffect`, `useLayoutEffect` | Direct data access — `fetch`, a database driver, the filesystem |
| `useContext` (and therefore `useIncidentFilters()`) | Reading secrets from `process.env` |
| `useRef` on a DOM node | `import 'server-only'` modules |
| `onClick`, `onChange`, any event handler | Zero bytes of bundle cost |
| `window`, `document`, `localStorage`, `matchMedia` | `cookies()`, `headers()` (Module 15) |
| `usePathname`, `useRouter`, `useSearchParams` | `notFound()` (Lesson 09.4), `redirect()` (Lesson 15.4) |

The two lists explain the shape of every page in this course: fetch and compose on the server,
then hand the smallest possible slice of the tree to the browser. Note where `usePathname` sits —
that single hook is why Lesson 09.4's active-navigation state is an island and the layout around
it is not.

### 8. Where the provider goes, and what moving it actually costs

Lesson 08.5 ended with a forward warning: a provider at the top of a layout is expensive. Now you
can be precise about *why*, because the folklore version of this claim is wrong and the real one
is more interesting.

The folklore: "wrapping your layout in a provider makes your whole app a Client Component."
**That is false**, and Key Concept 4 is the reason — `children` passed into a client provider are
still rendered on the server. Your pages do not move.

What actually happens:

| | Provider around the island (`incidents/page.tsx`) | Provider around `{children}` in the root layout |
|---|---|---|
| Where the provider ships | the `/[locale]/incidents` chunk | the chunk **shared by all** routes |
| First Load JS on `/[locale]/incidents` | pays for it | pays for it |
| First Load JS on `/[locale]`, `/en/blog`, `/en/reviews` | ✅ pays nothing | ❌ pays for it too |
| Every future import the provider grows | scoped to one route | added to every route in the app |
| Re-render blast radius | the filter island | anything under the layout that reads the context |

So the cost is not "the app became client-side", it is **"every route now pays for one route's
feature, and will keep paying as that feature grows"**. That second clause is the expensive one:
providers accumulate. A date formatter here, an icon set there, and a shared chunk that nobody
owns has grown 40 KB that `/en/blog` has no use for.

The rule, therefore: **push a provider as far down the tree as the components that read it
allow.** Step 6 of the Task measures both placements so the number is yours rather than mine.

### 9. Measuring it: route JavaScript versus shared JavaScript, and where the number went

Until Next 15 the build printed a table with `Size` and `First Load JS` columns, and every
tutorial you will find still shows it. **Next 16 removed both columns.** The framework's reasoning
is that in a server-driven application the figures were measuring something its two bundlers did
not even agree on, so rather than print a number people budget against, it prints none:

```
Route (app)                                    Revalidate      Expire
┌ ○ /[locale]
├ ○ /[locale]/incidents
└ ○ /_not-found

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

The two ideas the old columns named are still real, and they are what this Key Concept is about:

| Idea | Means |
|---|---|
| Route JavaScript | JavaScript unique to that route — its own client components and their imports |
| Shared JavaScript | React, the router and anything imported by a layout or by many routes — paid on **every** route |
| First Load JS | what a visitor landing on that URL downloads: the two above, deduplicated |

The bytes are still on disk and still attributed per route, in `.next/app-build-manifest.json`.
One command reads them, and it is the seed of the budget gate Module 21.4 builds:

```bash
# next-app, after `npm run build`. `node -e` runs as CommonJS, which is why
# `require` works here even though this package is "type": "module".
node -e '
const { gzipSync } = require("node:zlib");
const { readFileSync } = require("node:fs");
const read = (p) => JSON.parse(readFileSync(".next/" + p, "utf8"));
const shared = read("build-manifest.json").rootMainFiles;
const kb = (f) => gzipSync(readFileSync(".next/" + f), { level: 9 }).length / 1024;
for (const [route, chunks] of Object.entries(read("app-build-manifest.json").pages)) {
  const files = [...new Set([...shared, ...chunks])].filter((f) => f.endsWith(".js"));
  console.log(route.padEnd(40), files.reduce((s, f) => s + kb(f), 0).toFixed(1) + " kB");
}'
```

The number to watch when you move a provider is not one route's figure; it is what happens to
**every** route at once. A provider in the root layout moves bytes into the shared set, which
looks like a small change on one row and is a change on all of them.

Exact figures depend on your Next patch version and on your Module 08 code, so compare *your*
before and after rather than any number printed here.

---

## Task

### Step 1: Put `'use client'` on the three Module 08 files that need it

The directive goes on line 1, before every import, with nothing above it but the file's own path
comment if you keep one.

```tsx
// next-app/src/components/incidents/IncidentFilterProvider.tsx (fragment — line 1)
'use client';
```

```tsx
// next-app/src/components/incidents/IncidentFilters.tsx (fragment — line 1)
'use client';
```

```tsx
// next-app/src/components/incidents/IncidentSearch.tsx (fragment — line 1)
'use client';
```

Nothing else in those three files changes. `useDebouncedValue.ts` needs no directive: it is a
hook, it is imported only by `IncidentSearch`, and it therefore lands in the client graph with it.
`IncidentCard.tsx` and `fixtures.ts` get no directive either — they are the shared files from Key
Concept 3, rendered on the server by the home page and bundled for the browser by `IncidentList`.

### Step 2: Write the island root — `IncidentBrowser.tsx`

Here is the decision this lesson has to make, out loud. After Lesson 08.5, `IncidentList` reads
`useIncidentFilters()`, and `IncidentFilters` is still a **controlled** component taking
`onSeverityChange` and friends. A Server Component cannot pass a function across the boundary
(Key Concept 5), so *something* on the client side has to sit between the page and the filter UI,
read the context, and hand down the handlers.

**The decision: one client component, `IncidentBrowser`, is the island's root.** It is the only
new file this lesson adds to `src/components/incidents/`.

```tsx
// next-app/src/components/incidents/IncidentBrowser.tsx
'use client';

import { IncidentFilters } from '@/components/incidents/IncidentFilters';
import { useIncidentFilters } from '@/components/incidents/IncidentFilterProvider';
import { IncidentList } from '@/components/incidents/IncidentList';
import { IncidentSearch } from '@/components/incidents/IncidentSearch';
import type { Incident } from '@/types/content';

/**
 * The client boundary for the incident browser.
 *
 * Everything interactive on /[locale]/incidents lives under this file. The page above
 * it stays a Server Component; the data arrives as a plain serializable array.
 */
export function IncidentBrowser({ incidents }: { readonly incidents: readonly Incident[] }) {
  // The one call that forces this file to be a Client Component. Hooks need a browser
  // runtime, so a hook call is a boundary requirement, not a style choice.
  const { severity, scapegoat, query, setSeverity, setScapegoat, setQuery, clear } =
    useIncidentFilters();

  return (
    <section>
      <IncidentSearch value={query} onChange={setQuery} />

      {/* Controlled since Lesson 08.3. These five props include three functions, which
          is precisely why a Server Component could not render this component directly. */}
      <IncidentFilters
        severity={severity}
        scapegoat={scapegoat}
        onSeverityChange={setSeverity}
        onScapegoatChange={setScapegoat}
        onClear={clear}
      />

      {/* IncidentList reads the same context itself — see Lesson 08.5. It needs no
          directive of its own because only this client file imports it. */}
      <IncidentList incidents={incidents} />
    </section>
  );
}
```

> **The names in that destructuring are your Lesson 08.5 names.** The context exposes three
> values, three setters and a reset; if you called the reset `reset` rather than `clear`, or the
> text value `search` rather than `query`, use what your provider exports. The shape is what this
> lesson is about, not the spelling.

> **The trade-off, stated plainly.** `IncidentBrowser` pulls `IncidentList`, `IncidentCard` and —
> after Lesson 09.3 — the fetched incident data into the client bundle. The alternative was to
> keep `IncidentList` on the server and filter server-side, which means the filter state has to
> live in the URL (`?severity=s1-catastrophic`) rather than in React state. That version is
> genuinely better, it is what a production build of this page should do, and it needs
> `searchParams` plus a cache policy to avoid re-querying WordPress on every keystroke. Lesson
> 18.1 builds **the mechanism** — its per-route table commits `/[locale]/incidents` to "dynamic,
> reads `searchParams`", and it moves the text search into the URL so the page is dynamic while
> the query inside it is still cached per variable-set. It deliberately stops there and leaves
> the two taxonomy facets in client state, with the three remaining steps enumerated: once you
> have seen the pattern on one parameter, extending it is repetition rather than learning, and
> the cost of doing it here would be deleting the components this lesson exists to teach.
> This lesson keeps the Module 08 components working unchanged, because "the components
> you wrote last module still work" is worth more right now than one fewer kilobyte.

### Step 3: Build `/[locale]/incidents` as a Server Component

```tsx
// next-app/src/app/[locale]/incidents/page.tsx
import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import { INCIDENTS } from '@/components/incidents/fixtures';

export default async function IncidentsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Step 4 explains why this line is here and what it proves.
  console.log(`[btt] /${locale}/incidents rendered on the server`);

  return (
    <main>
      <h1>Incidents</h1>
      <p>
        {INCIDENTS.length} incidents, still from the Lesson 08.2 fixtures. Lesson 09.3 replaces
        this array with a live WPGraphQL query and does not touch a single component.
      </p>

      {/* The provider wraps the island and NOTHING ELSE. Not the layout, not this <main>,
          not the heading. See Key Concept 8 — Step 6 measures the difference. */}
      <IncidentFilterProvider>
        <IncidentBrowser incidents={INCIDENTS} />
      </IncidentFilterProvider>
    </main>
  );
}
```

Read the two imports again: this Server Component imports two Client Components and renders them.
That direction is always legal. What it does *not* do is call a hook, read a filter value, or pass
a function — the page knows nothing about filtering.

**Verify §3:**

- [ ] `http://localhost:3000/en/incidents` lists forty unstyled cards.
- [ ] Typing in the search box filters them, and the severity select works. If
      `useIncidentFilters()` throws its named error instead, your provider is not wrapping the
      component that reads it.
- [ ] The page file contains no `'use client'`, no `useState` and no `useContext`.

### Step 4: Watch a component render on the server

The `console.log` in Step 3 is not decoration. Reload `/en/incidents` twice and look in both
places:

```bash
# Terminal running `npm run dev` — the line appears on every full page load.
# Expected: [btt] /en/incidents rendered on the server
```

Then open the browser console. It is not there, and it never will be, because that function body
executed in Node and only its output crossed the network. Now add a temporary `console.log` inside
`IncidentBrowser` and reload: that one appears in **both** places — once during server rendering
and once during hydration, which is Key Concept 2's first row made visible. Delete the temporary
one before you continue.

**Verify §4:**

- [ ] The page's log line is in the terminal and **not** in the browser console.
- [ ] The temporary island log line appeared in both, and is now deleted.

### Step 5: Measure the island version

```bash
npm run build
```

Then run the `node -e` command from Key Concept 9 and write down two numbers:

| Number | Where |
|---|---|
| First Load JS for `/[locale]/incidents/page` | that row of the output |
| First Load JS for `/[locale]/page` | the home page row — it has no filters, and that is the point |

Keep them in a scratch note; Step 6 compares against them.

### Step 6: Move the provider into the layout, measure, then put it back

Temporarily wrap the layout's `children` in the provider — the mistake this whole key concept
exists to price:

```tsx
// next-app/src/app/[locale]/layout.tsx (fragment — TEMPORARY, reverted at the end of this step)
      <body>
        <IncidentFilterProvider>{children}</IncidentFilterProvider>
      </body>
```

Add the matching import, run `npm run build` and the Key Concept 9 command again, and compare all
four numbers.

**Verify §6:**

- [ ] `/[locale]/incidents` still works, and `/en` still renders. Nothing broke — that is the
      point of Key Concept 4, and the reason this mistake survives code review.
- [ ] **Every** route's figure went up, not just the one that uses the provider.
- [ ] `/[locale]/page` — the home page, which has no filters — went up by roughly the same amount
      as the route that needs it. That is the whole cost, on a route that gets nothing for it.
- [ ] Now **revert both edits**: remove the wrapper and the import from `layout.tsx`, and confirm
      `git diff src/app/\[locale\]/layout.tsx` is empty.

### Step 7: Prove the boundary is enforced by the compiler

Add a hook to `IncidentCard.tsx` — the shared file the home page renders on the server:

```tsx
// next-app/src/components/incidents/IncidentCard.tsx (fragment — TEMPORARY, reverted below)
import { useState } from 'react';

export function IncidentCard({ incident }: { readonly incident: Incident }) {
  const [open, setOpen] = useState(false);
  // ...
}
```

```bash
npm run build
# Expected: the build FAILS. The message names the hook and the missing directive:
#   You're importing a component that needs `useState`. This React hook only works
#   in a Client Component. To fix, mark the file with the "use client" directive.
```

Read the error properly, because it is the one you will see most often for the next fifteen
modules, and it points at a *file* rather than at the render that broke. The reason this fails is
Lesson 09.1's home page: that page is a Server Component and imports `IncidentCard`, so the file
is compiled into the server graph, where `useState` does not exist. Delete the hook and the import
and rebuild green.

**Verify §7:**

- [ ] The failing build named `useState` and `'use client'`.
- [ ] After reverting, `git diff src/components/incidents/IncidentCard.tsx` is empty and
      `npm run build` succeeds.

---

## Verification

```bash
cd next-app

# 1. Exactly four files declare the client boundary at this point in the course
grep -rl "'use client'" src/ | sort
# Expected, and nothing else (Lesson 09.4 adds a fifth, deliberately):
#   src/components/incidents/IncidentBrowser.tsx
#   src/components/incidents/IncidentFilterProvider.tsx
#   src/components/incidents/IncidentFilters.tsx
#   src/components/incidents/IncidentSearch.tsx

# 2. NEGATIVE — no route file is a Client Component
grep -rl "'use client'" src/app/ | wc -l
# Expected: 0

# 3. NEGATIVE — the hook probe from Step 7 was reverted; the card stays shared
grep -cE 'useState|useEffect|useContext' src/components/incidents/IncidentCard.tsx
# Expected: 0

# 4. The page renders on the server: its data is in the initial HTML, before any JS runs
curl -s http://localhost:3000/en/incidents | grep -c 'incident'
# Expected: a number well above 0. View Source, not the inspector — this is pre-hydration HTML.

# 5. A production build, and the two numbers from Step 5
npm run build
# Expected: the route table lists /[locale]/incidents. Re-run the Key Concept 9
#           command: its First Load JS is HIGHER than /[locale]'s, because only
#           it ships the filter island.

# 6. NEGATIVE — the server-only log line is not in the client bundle
grep -r 'rendered on the server' .next/static/
# Expected: no output. The string exists in the server build only.

# 7. The provider is mounted in the page, not in the layout
grep -c 'IncidentFilterProvider' src/app/\[locale\]/incidents/page.tsx
# Expected: 2   (the import and the element)
grep -c 'IncidentFilterProvider' src/app/\[locale\]/layout.tsx
# Expected: 0   — if this is not 0, Step 6's revert is incomplete

# 8. Both gates stay clean
npm run type-check && npm run lint
# Expected: no output from either

# 9. The working tree contains only the intended changes
git status --short src/
# Expected: the new IncidentBrowser.tsx and incidents/page.tsx, plus the three
#           modified Module 08 files. Nothing else.
```

Check 6 is the one to rerun any time you are unsure whether something is server-only. Grepping
`.next/static/` for a string you expect to be private is the cheapest security test in this
project, and Lesson 09.5 turns it on a real secret.

## Control Questions

1. `IncidentCard.tsx` has no `'use client'` directive, yet its code is downloaded by the browser
   on `/en/incidents` and is *not* downloaded on `/en`. Explain both halves, and say what would
   have to change for it to need a directive of its own.
2. Wrapping the root layout's `children` in `IncidentFilterProvider` broke nothing and made every
   route larger. Explain why nothing broke — naming the React feature responsible — and name the
   cost that grows over time rather than showing up in this build's numbers.
3. `IncidentFilters` takes `onSeverityChange`. Explain, in terms of the serialization boundary,
   why `incidents/page.tsx` could not simply render `<IncidentFilters onSeverityChange={…} />`
   itself, and name the one kind of function that *is* allowed to cross that boundary.
4. A teammate moves a component into the client graph, finds `process.env.WP_GRAPHQL_ENDPOINT` is
   `undefined`, and renames it `NEXT_PUBLIC_WP_GRAPHQL_ENDPOINT`. The build goes green. Describe
   what has actually shipped, and name the mechanism from Module 10 that would have made the
   original refactor fail loudly instead.
5. A `console.log` in `incidents/page.tsx` appears once, in the terminal. The same line inside
   `IncidentBrowser` appears twice, in two different places. Account for every one of those three
   appearances, and say which of them you would still see with JavaScript disabled in the browser.

## Learn More

- [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
  — Next's own framing of the boundary, including the composition patterns in Key Concept 4
- [`'use client'`](https://react.dev/reference/rsc/use-client) — React's reference, which is
  stricter and clearer than most framework docs about what the directive actually marks
- [Server Components](https://react.dev/reference/rsc/server-components) — read the
  "Serializable types" section next to Key Concept 5; it is the definitive list
- [`useContext`](https://react.dev/reference/react/useContext) — worth rereading now that the
  provider has a bundle cost attached to where you mount it
- [`wp_localize_script()`](https://developer.wordpress.org/reference/functions/wp_localize_script/)
  — the WordPress version of the serialization boundary, and its silent failure mode
- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist) — the
  bundle-size section explains what shared JavaScript is, and why Next 16 stopped printing it
- [Hydration](https://react.dev/reference/react-dom/client/hydrateRoot) — what the browser does
  with the HTML a Client Component produced on the server, and why mismatches are errors
