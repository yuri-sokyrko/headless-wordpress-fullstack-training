---
title: 'JavaScript Weight & INP'
module: 21
lesson: 3
teaches: [bundle-analyzer, client-component-audit, next-dynamic, next-script, hydration-cost, long-tasks, inp]
produces: ['next-app/next.config.ts', 'docs/perf-baseline.md']
requires: [21.1, 08.4, 20.3]
---

# Lesson 21.3 — JavaScript Weight & INP

## Quick Overview

Every kilobyte of JavaScript is paid for three times: downloaded, parsed and compiled, then
executed to hydrate. On a mid-range Android the second and third costs dominate, which is why a
site can score well on LCP and still feel broken to touch. This lesson opens the bundle, finds
out what is actually in it, and removes what does not need to be there — then measures the
result rather than assuming it.

The single highest-leverage discipline is **server components by default**. `'use client'` is
not a performance annotation, it is a boundary declaration: everything imported below that
boundary ships to the browser. One `'use client'` on a component that imports a date library, or
a barrel `index.ts` that re-exports forty icons, or the whole next-intl catalogue from Lesson
20.3, and you have shipped all of it. So you audit: list every `'use client'` file, name the
interactive thing that justifies it, and for each one either push the boundary downward — make
the interactive leaf a client component and leave its parent on the server — or delete the
directive. `@next/bundle-analyzer` turns that audit from opinion into a treemap. Then
`next/dynamic` for the genuinely heavy and genuinely deferred (the "Get Demo" dialog body, not
its trigger button), `next/script` with a chosen strategy for every third party, and a look at
long tasks in a real profile to find what is actually delaying INP — on this site, the incident
filter re-rendering its rendered page of results synchronously is the honest suspect.

By the end of this lesson you will have:

- `@next/bundle-analyzer` wired into `next.config.ts` behind an env flag, with treemaps for the
  six key routes saved alongside the baseline
- A client-component inventory — every `'use client'` file, the interaction that justifies it, the
  ones you deleted — and at least one boundary pushed downward so a parent returns to the server
- `next/dynamic` on the dialog body and any genuinely deferred heavy component, with a
  matched-height placeholder so the win does not cost CLS
- A `strategy` chosen and justified for every `next/script`: analytics, Turnstile, anything else
- A recorded Total Blocking Time improvement and a long-task profile of the incident filter
- The First Load JS number per route, which becomes the budget in Lesson 21.4

## Classic WP Analogy

`wp_enqueue_script()` is the closest thing you have used, and the comparison is instructive
because Classic WordPress gave you *more* control here, not less.

| Classic WordPress | Next.js App Router |
|---|---|
| `wp_enqueue_script( 'x', $src, $deps, $ver, true )` | An `import` — the bundler decides placement |
| Conditional enqueue: `if ( is_singular('incident') )` | Route-level code splitting, automatic |
| `wp_dequeue_script()` to remove a plugin's bloat | Delete the import, or move the boundary |
| `wp_localize_script()` passing PHP data to JS | Props across the server/client boundary in the RSC payload |
| `defer` / `async` via `script_loader_tag` | `next/script` `strategy` |
| jQuery, always, because something needs it | React, always, but only where you declared a client |

Classic WordPress made JavaScript weight **visible and conditional**. You enqueued deliberately,
you could see the whole list in the page source, and dequeuing a bad plugin script was a
one-liner. The cost of that control was that every plugin author also had it, so a real
WordPress site shipped nineteen scripts, half of them on every page.

Where the analogy breaks, and this is the mental shift: **in Next.js, JavaScript weight is
implicit and follows from the module graph.** There is no enqueue list to read. You add
`'use client'` to a card component so it can have an `onClick`, that card imports a formatting
helper, the helper imports a 90 KB locale-data library, and none of that appears anywhere you
would naturally look. The failure mode is not "someone enqueued too much", it is "an import
three levels down crossed the boundary". `wp_dequeue_script` had no equivalent for that; the
bundle analyzer is the equivalent, and reading a treemap is the skill this lesson is actually
teaching.

The other break worth naming: `wp_localize_script` data was inert JSON. RSC payload props are
also serialised into the HTML, and a client component that takes a whole page of the incident array
as a prop pays for it **twice** — once in the flight payload and once in hydration. Passing an
ID and letting the server render the content is the headless-native answer, and it has no
Classic equivalent because in Classic WordPress the server rendered everything anyway.

---

## Key Concepts

### 1. A kilobyte is paid for three times

The download is the cost people quote and the cheapest of the three.

```
   100 KB of JavaScript, mid-range Android, Fast 4G

   1. TRANSFER      ~200ms   gzip helps here, and only here
   2. PARSE+COMPILE ~120ms   proportional to bytes, and CPU-bound
   3. EXECUTE       ~250ms   hydration: rebuild the tree, attach listeners
                    ──────
                    ~570ms   of which ~370ms is your CPU, not your network

   the same 100 KB on a 2024 laptop: ~40ms of steps 2 and 3
```

The ratio is the point. Faster networks make step 1 cheaper every year; steps 2 and 3 are bounded
by single-thread performance, which has improved far more slowly and is roughly **five times
worse** on a median Android than on the laptop you are reading this on. Which explains two
otherwise-baffling reports: a page with a great LCP that "feels broken to touch" has finished
painting and is still executing step 3; and a 20 KB dependency costing 200 ms on a phone is not
costing you the 20 KB, it is costing you what the 20 KB *does* when it initialises.

So "First Load JS is under budget" and "the page is responsive" are two claims, not one. Lesson
21.4 budgets the first because it is cheap to measure; this lesson profiles the second.

### 2. `'use client'` is a boundary declaration, not a performance annotation

The directive does not mark a file. It marks a **boundary**, and everything reachable by import
from below it is compiled into the client graph.

```
   page.tsx                          SERVER
     └── IncidentBrowser  'use client'   ◀── the boundary
           ├── IncidentSearch               in the client graph
           ├── IncidentFilters              in the client graph
           └── IncidentList                 in the client graph — NO directive
                 └── IncidentCard           in the client graph — NO directive
                       └── Badge, Card      in the client graph
```

`IncidentList` and `IncidentCard` carry no directive — Lesson 09.2 says so explicitly. They are
in the client bundle because `IncidentBrowser` imports them. So the useful question about any
`'use client'` is never "does this file need it" but **"what does this file drag with it"**, and
the answer lives three imports down, where nobody looks.

| Move | When it is right | What it costs |
|---|---|---|
| **Delete** the directive | nothing below the boundary is interactive | nothing — this is a free win, and it is rarer than it should be |
| **Push it down** — make the interactive leaf the client | one small piece is interactive, the rest is not | the parent must now pass data down instead of sharing a module |
| **Keep it** | the whole subtree genuinely reacts to state | the subtree's weight, honestly |

There is a fourth move people reach for and should not: leave the boundary alone and wrap the
result in `next/dynamic`. That defers the cost; it does not remove it. Key Concept 6.

### 3. Reading a treemap is the actual skill

`@next/bundle-analyzer` renders every chunk as nested rectangles sized by bytes. The instinct is
to look for the biggest box. The **skill** is to look for the biggest box **you did not choose**.

| Box | Verdict |
|---|---|
| `react-dom`, and the `next` framework chunks | you did not choose them and cannot remove them. Ignore them forever |
| A date library you do not remember installing | **this** is the finding |
| A shadcn primitive used on one route, sitting in the shared chunk | a boundary problem, not a dependency problem |
| Your own `src/` code, roughly the size you expect | correct, and worth confirming rather than assuming |

Three practical rules. **Read `client.html`, not `nodejs.html`** — the analyzer emits three
reports and only one is the browser's. **Compare, do not admire**: one treemap says what is
there, two say whether you changed anything. And **match it against the build table** — the
treemap is uncompressed bytes while `next build` reports gzipped First Load JS, so a box that
looks enormous may be highly compressible text.

### 4. Barrels, tree shaking, and the finding that is a non-finding

`export * from './x'` in an `index.ts` defeats tree shaking for anything with a module-level side
effect: the bundler cannot prove that evaluating the module is unobservable, so it keeps it. A
40-icon barrel becomes 40 icons in your bundle even though you imported one.

That is the textbook failure mode, and **this codebase does not have it.** There is no icon
barrel: `lucide-react` is imported twice, both times as a single named icon — `{ Menu }` in
`MobileNav`, `{ Globe }` in `LocaleSwitcher`. The one barrel that exists, `src/gql/index.ts`, is
codegen output that Lesson 10.1's `import 'server-only'` guard keeps out of the client graph. And
the course has never written `export * from` by hand.

So the treemap should show almost no icon weight, and the audit's value is **confirming that**.
An audit that only ever reports problems is an audit nobody believes when it reports nothing. The
reversal condition, so this does not become folklore: the day somebody re-exports four icons from
a shared `icons.ts`, re-read this Key Concept.

### 5. Pushing the boundary, and the one this codebase actually needs moved

Around twenty `'use client'` files exist by the end of Module 20 and most are correct. The
audit's job is to choose, per file, between Key Concept 2's three moves — and on this codebase the
answer is unusual: **one deletion, and no push-downs worth the churn.**

The deletion is `src/components/blocks/HobtCta.tsx`. Lesson 14.4 gave it the directive with an
honest comment:

> There is no `onClick` yet. Lesson 16.3 turns this into a Dialog trigger backed by a validated
> Server Action, and `leadSource` becomes the value it submits.

Lesson 16.3 then did something else: it built `GetDemoDialog` and mounted it from `HobtCtaBand`,
leaving this block as what it always was — a `Button asChild` wrapping a `Link` or an `<a>`, no
hooks, no handlers. The directive is paying for a plan that changed, and Task §5 deletes it,
returning the whole block subtree to the server on every content route.

The push-down that looks right and is not: `IncidentCard`. It has no hooks (Lesson 09.2 asserts
it) and is in the client bundle only because `IncidentBrowser` imports `IncidentList` which
imports it. You could pass server-rendered card elements into the island keyed by slug and let
`IncidentList` pick from them, removing `IncidentCard`, `Card` and `Badge` from the client graph.
The costs, which is why Task §5 measures and declines:

| Cost | Detail |
|---|---|
| The flight payload grows | the island still needs the facet data to filter on, so you ship the markup **as well as** the data |
| `IncidentList`'s props change shape | Module 12 tests it. The tests are not the reason to refuse; the churn-to-kilobyte ratio is |
| The reader loses a straight line | "the list receives elements it did not create" is a sentence a reviewer has to be told |

Measure it before you believe either verdict. That is the whole method.

### 6. `next/dynamic` defers, it does not remove — and it is the easiest way to trade JS for CLS

`next/dynamic` splits a component into its own chunk fetched on demand. Two rules make it useful
rather than decorative.

**Rule one: defer the body, never the trigger.** A trigger the user cannot click until a chunk
arrives is worse than one that was always there. So the thing to defer in the Get Demo dialog is
`LeadForm`; the Radix `Dialog` shell and its `DialogTrigger` stay in the initial chunk, because
Radix requires trigger and content inside the same provider and "server-render the trigger" means
rebuilding the dialog by hand. That restructure exists and is not worth it — say so rather than
implying the trigger is free.

**Rule two: the `loading` placeholder must match the final height**, or you have converted a
JavaScript cost into a layout shift — the worse trade, because CLS is budgeted and kilobytes are
cheap. Lesson 21.2 measured the lead form's height for this reason; this lesson reuses the number.

The honest accounting for this case, which the treemap will show you: **bytes saved, near zero** —
`/hobt` also renders `LeadForm` eagerly at `#lead` for the JavaScript-off path (Lesson 16.3), so
the chunk is in the graph either way; **hydration saved, one whole form** — two instances hydrate
today, one after this change; **Turnstile saved, nothing** — `next/script` dedupes by `src` and
the `#lead` copy still loads `api.js`.

So this is a TBT change dressed as a bundle change, and if your profile does not show it, revert
it. A `next/dynamic` that buys nothing is complexity somebody reads forever, and the module README
names it as one of the two self-inflicted wounds of this module.

### 7. `next/script` strategies — an audit, not an introduction

`next/script` is already in this codebase. Lesson 16.3 loads Cloudflare's `api.js` with
`strategy="afterInteractive"` and a comment justifying it, so there is nothing to introduce and
there is something to check.

| `strategy` | Loads | Right for | Wrong for |
|---|---|---|---|
| `beforeInteractive` | injected server-side, blocks hydration | a consent manager or bot detection that must run before anything | anything else. It blocks |
| `afterInteractive` (default) | immediately after hydration | a widget needed soon but not for first paint | anything below the fold |
| `lazyOnload` | during browser idle, after everything | analytics, chat widgets, social embeds | anything a user might touch in the first second |
| `worker` | in a web worker via Partytown | pure-telemetry third parties with no DOM access | anything that touches the DOM, which is most of them. Still experimental |

The complete third-party inventory of this application is **one script**: Cloudflare's
`turnstile/v0/api.js`, loaded by `LeadForm` at `afterInteractive`. That is correct and it stays —
it gates the submit button, so `lazyOnload` would leave a form the user cannot submit during
idle. There is **no analytics script in this course**, so there is nothing to convert. Task §7
records the inventory and the rule that will matter later: the day an analytics snippet arrives,
it is `lazyOnload` and it arrives with a TBT number in its pull request.

### 8. INP versus TBT, and how to find a long task honestly

They are related and they are not the same, and the difference decides what you are allowed to
assert in CI.

| | TBT | INP |
|---|---|---|
| Window | page load | the whole visit |
| Needs a human | no | **yes** |
| Source | lab | field only |
| Composed of | blocking time across long tasks | input delay + processing + presentation delay, for the worst interaction |
| Assertable in `lighthouserc.json` | **yes** | **no.** Lesson 21.4 must not pretend otherwise |

A long task hurts both: during load it is TBT, and after load it is input delay, because a click
arriving while a 300 ms task runs waits for it.

**The honest suspect, and the honest answer.** Lessons 08.3, 08.4 and 08.5 each deferred
memoisation to this module in a different sentence — 08.3's is "Module 21 measures before
optimising anything" — and the candidate they had in mind is `IncidentList`, which re-runs a
`.filter()` on every keystroke. Then Lesson 18.1 capped the route's query at
`{ first: 12, search }`, so the synchronous work is a `.filter()` over **twelve** objects, three
string comparisons each, behind a 250 ms debounce. That is microseconds. Task §8 profiles it,
finds no long task, does not add `useMemo` — and then raises the cap to the seeded 55 temporarily,
because you should know the shape of a real problem before you need to find one.

That is the module README's thesis executed rather than quoted. A measurement saying "do nothing"
is a result.

### 9. The RSC payload: a client component holding an array pays twice

A prop crossing the server/client boundary is serialised into the flight payload, embedded in the
HTML, downloaded, deserialised — and then the component that received it hydrates. So a client
component whose prop is a list of records pays for that list **twice**: once as bytes in the
document, once as objects rebuilt during hydration.

```
   SERVER                                     CLIENT
   page.tsx fetches 12 incidents
        │
        ├── serialise into the flight payload  ──▶ bytes in the HTML  (cost 1)
        │                                            │
        └── <IncidentBrowser incidents={…}>          ▼
                                                deserialise + hydrate  (cost 2)
```

Lesson 09.2 priced this at the time — "`IncidentBrowser` pulls `IncidentList`, `IncidentCard` and
the fetched incident data into the client bundle" — and it is the right trade, because the island
filters that data in the browser with no round trip. The alternatives and their costs:

| Approach | Payload | Client JS | Interaction |
|---|---|---|---|
| Pass the whole array (today) | 12 records, serialised | list + card components | instant, no network |
| Pass ids, let the server render | ids only | smaller | a server round trip per filter change |
| Pass ids **and** pre-rendered nodes | records **plus** markup — bigger | smaller | instant |

Row three is the one people expect to be a pure win and it is not: you keep the data because you
still filter on it, and you add the markup. Lesson 09.2's decision stands, and the reason it
stands is that somebody measured it rather than reasoning from the principle.

### 10. The i18n payload, which Lesson 20.3 told you to measure here

Lesson 20.3 made a specific, checkable claim as its Key Concept 7:

> …every page carries every namespace — **eleven where a page needs six** … The discipline:
> server by default, and the provider receives an explicit object listing the namespaces client
> islands genuinely use.

and then named this lesson: *"Lesson 21.3 measures the difference with the bundle analyzer."*

So measure it. `messages` is destructured in the root layout and handed to
`NextIntlClientProvider` as an explicit object literal, so what reaches the browser is exactly the
keys named there — in the flight payload rather than in a JavaScript chunk, which is why you look
in the document and not in the treemap.

Task §4 finds **seven** namespaces, not six: the six 20.3 names plus `locale`. And 20.3's own
Verification asserts `LocaleSwitcher` calls `useTranslations` zero times, because `Header`
resolves those three strings on the server and passes them as props — so the `locale` namespace
has no client consumer at all.

That is the whole lesson in one artifact: **an earlier lesson's prose and its code disagreed, and
the measurement is what noticed.** Task §4 greps for a consumer, finds none, removes it.

---

## Task

### Step 1: Wire the analyzer, nested and not replacing

```bash
# next-app
cd next-app
npm install --save-dev @next/bundle-analyzer
npx license-checker --production --summary | head -20
# Expected: no GPL or AGPL. @next/bundle-analyzer is MIT, like Next itself, and
#           it is a devDependency so it never reaches a production install —
#           but check rather than assume, because this is the habit that keeps a
#           copyleft dependency out of a proprietary module.
```

Two anchored additions to a file six lessons share. It already holds `reactStrictMode` and
`images.remotePatterns` (09.1), `formats` / `qualities` / `minimumCacheTTL` (14.5),
`experimental.serverActions.allowedOrigins` (15.5), `async headers()` (18.4), `trailingSlash` and
`async redirects()` (19.4). **None of them changes**, and the `nextConfig` object is not retyped.

```ts
// next-app/next.config.ts — the import and the factory call, added near the top
// The package's default export is a FACTORY: you call it with options and it
// returns the wrapper. Imported under a short name so the wrapper below is the
// only identifier that reads like one.
import bundleAnalyzer from '@next/bundle-analyzer';

// The flag comes from the invoking shell and NEVER from an env file — appendix
// 04 §9 records the rule and gives E2E_MODE the same treatment. A build switch
// in .env.local is a build switch somebody forgets is on.
// openAnalyzer: false so `npm run analyze` does not hijack your browser; the
// three reports land in .next/analyze/, which .gitignore already covers.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});
```

```ts
// next-app/next.config.ts — the export line. NEST it, do not replace it.
export default withNextIntl(withBundleAnalyzer(nextConfig));
```

> **This is the single most expensive one-line mistake available in this module.** Writing
> `export default withBundleAnalyzer(nextConfig)` removes next-intl's plugin from the build,
> because the build-time alias for `next-intl/config` is never registered. Measured on Next
> 15.5: it **compiles clean** — `✓ Compiled successfully` — and then dies at `Generating static
> pages (0/15)` with `Couldn't find next-intl config file`. Note what changed that: before
> Lesson 18.1 made these routes static there would have been no build error at all, and every
> `t()` call would simply have thrown on the first request. Lesson 20.3 wrote the
> instruction into the course before this lesson existed, and the check is a count:
> `grep -c 'withNextIntl' next.config.ts` must stay at **2** — the `createNextIntlPlugin` call and
> the export.

```bash
# next-app
npm pkg set "scripts.analyze=ANALYZE=true next build"
npm run type-check
```

`npm run analyze` is the form [appendix 07](../appendix/07-command-reference.md) §4 names;
`ANALYZE=true npm run build` is the form [appendix 04](../appendix/04-env-reference.md) §9 names.
Same thing, both work. Neither works in Windows `cmd`, and the repo targets macOS and Linux —
`.nvmrc` and `nvm use` say so already.

**Verify §1:**

- [ ] `grep -c 'withNextIntl' next.config.ts` returns `2`, and `grep -c 'withBundleAnalyzer'`
      returns `2`.
- [ ] `npm run build` with no `ANALYZE` produces **no** `.next/analyze/`. A flag on by default is
      not a flag. `npm run analyze` produces all three reports.
- [ ] `npm run type-check` is clean. If TypeScript rejects the default import, `tsconfig.json`
      needs `esModuleInterop` — it has had it since Lesson 07.3, so a failure means something else
      changed it.

### Step 2: Produce the treemaps and write down the biggest box you did not choose

```bash
# next-app
npm run analyze
open .next/analyze/client.html   # or: xdg-open, or just open the file in a browser
```

Read `client.html` and nothing else — `nodejs.html` is server code that never ships. For each of
the six budgeted routes, note the chunk that owns it and answer one question: **what is the
largest rectangle in here that I did not deliberately choose?**

Record it as a table with four columns — route, First Load JS in gzip from `next build`, the
largest box you did not choose, and its uncompressed bytes — one row per budgeted route. Step 9
copies it into `docs/perf-baseline.md`, and you will compare against it twice before the lesson
ends.

**Verify §2:**

- [ ] `react-dom` is the biggest box on every route. That is correct and it is not a finding.
- [ ] `lucide-react` is a small box or absent. Key Concept 4 predicts this — two named icon
      imports, no barrel. If it is large, somebody wrote a re-export and you have found it.
- [ ] Every row has a name in the third column, even if the honest answer is "nothing I did not
      choose". An empty cell is a route you did not look at.

### Step 3: Write the client-component inventory

`docs/architecture.md` has carried a partial one since Lesson 11.2, whose own note said "nothing
after that should join the list in this module" — and nine lessons have joined since. Bring it up
to date in `docs/perf-baseline.md`, where the numbers live, with a justification per file.

```bash
# next-app — the raw list, so the inventory is derived and not remembered
grep -rl "'use client'" src/ | sort
# Expected: 21 files at the end of Module 20. Count them; the number is the
#           first line of your inventory and the thing 21.4 will watch.
```

Three columns per file: the interaction that justifies the boundary, what it drags into the client
graph, and the decision — **keep**, **push down** or **delete**. It is a real piece of work and the
highest-value hour in this lesson, because it is the only artifact that turns the next boundary
somebody adds into a conversation.

**Verify §3:**

- [ ] Every `'use client'` file has a row, and every row has a named interaction. "It is
      interactive" is not a justification; `useActionState` is.
- [ ] At least one row's decision is not **keep**. If every row is perfect, you wrote a list
      rather than an audit.

### Step 4: Measure the i18n payload, then act on what you find

Lesson 20.3 claimed six namespaces and named this step as where it is measured. The payload
travels in the flight data embedded in the document, not in a JavaScript chunk, so you look in the
HTML.

```bash
# next-app
npm run build && npm start &
sleep 6

# Which namespaces actually reach the browser
curl -s http://localhost:3000/en/hobt | grep -o '\\"\(nav\|locale\|incidents\|incidentForm\|hobt\|auth\|common\|home\|blog\|reviews\|scapegoats\)\\"' \
  | sort -u
# Expected: SEVEN names — the six Lesson 20.3's Key Concept 7 lists, plus
#           `locale`. `home`, `blog`, `reviews` and `scapegoats` are absent,
#           which is 20.3's discipline working.
grep -c 'NextIntlClientProvider' 'src/app/[locale]/layout.tsx'
# Expected: 1
```

Now find out whether the seventh has a consumer, before removing anything:

```bash
# next-app
grep -rn "useTranslations('locale')\|useTranslations(\"locale\")" src/
# Expected: no output. Lesson 20.3's own Verification asserts
#           `grep -c 'useTranslations' src/components/layout/LocaleSwitcher.tsx`
#           is 0 — Header resolves those three strings on the server and hands
#           over finished props, so this namespace never crosses the boundary.
grep -rn 'useTranslations' src/components/ | sort
# Expected: only client components that genuinely call it, and none of them
#           with 'locale'. If ONE does, stop: keep the namespace and record why.
```

With no consumer found, remove it. Two lines, both of which Lesson 20.3 shows verbatim.

```tsx
// next-app/src/app/[locale]/layout.tsx — the destructure, one member removed
// `locale` was in this list and had no client consumer: Lesson 20.3's own
// Verification asserts LocaleSwitcher calls useTranslations zero times, because
// Header resolves its three strings on the server. Lesson 20.3 Key Concept 7
// says six namespaces; the code shipped seven. The measurement found it.
  const { nav, incidents, incidentForm, hobt, auth, common } = messages;
```

```tsx
// next-app/src/app/[locale]/layout.tsx — the provider, the same member removed
        <NextIntlClientProvider messages={{ nav, incidents, incidentForm, hobt, auth, common }}>
```

**Verify §4:**

- [ ] `curl` now finds **six** namespace names in the document, not seven.
- [ ] The locale switcher still works in all three locales and its label is still translated — it
      comes from props, which is the whole reason this removal is safe.
- [ ] `npx playwright test` passes. A missing namespace is a **runtime** `MISSING_MESSAGE`, not a
      compile error, so the e2e run is the check that matters here.
- [ ] Record the payload delta per route. It is small; record it anyway, because "small" is a
      measurement and "negligible" is an opinion.

### Step 5: Delete the boundary that stopped being needed, and price the one that stays

Key Concept 5 named it. Confirm before cutting.

```bash
# next-app
grep -nE "use[A-Z][a-zA-Z]*\(|onClick=|onChange=|onSubmit=" src/components/blocks/HobtCta.tsx
# Expected: no output — no hooks, no handlers. It renders a Button asChild
#           around a Link or an <a>, and Lesson 16.3 built GetDemoDialog
#           instead of wiring this block, so the directive is paying for a plan
#           that changed. Anchor on `onClick=`: Lesson 14.4's own comment says
#           "there is no onClick yet", and a loose grep counts that sentence.
grep -c "'use client'" src/components/ui/button.tsx
# Expected: 0 — Button is a Server Component, so nothing below the boundary
#           needs it either. This is the check that makes the deletion safe.
```

Delete the directive **and Lesson 14.4's forward-looking comment above it**. A comment stops
being true the moment the thing it describes changes, and that one predicts a future which
happened differently — Lesson 14.5 Task §5 states the rule.

```tsx
// next-app/src/components/blocks/HobtCta.tsx — the client directive and Lesson
// 14.4's comment about it, both DELETED. 14.4 predicted that Lesson 16.3 would
// turn this block into a dialog trigger; 16.3 built GetDemoDialog and mounted it
// from HobtCtaBand instead. So this block is still what it always was — a
// Button asChild around a Link, no hooks, no handlers — and `Button` carries no
// directive of its own, so the whole subtree returns to the server on every
// content route. Measured before and after, in docs/perf-baseline.md.
import Link from 'next/link';
```

Then price the push-down you are **not** doing, with numbers rather than taste. `IncidentCard` is
in the client graph only because `IncidentBrowser` imports `IncidentList` which imports it.

```bash
# next-app
grep -cE 'useState|useEffect|useContext' src/components/incidents/IncidentCard.tsx
# Expected: 0 — Lesson 09.2 asserts this. It is a pure renderer sitting in the
#           client bundle because of where the boundary is, not what it does.
```

Read its box in the treemap, add `Card` and `Badge`, write the number down, and put Key Concept
5's cost beside it: the island still needs the facet data to filter on, so you would ship the
markup **in addition to** the records. Decide on the ratio, record it either way, and name what
would change your mind — a list of 500 cards, or a card that grows a chart.

**Verify §5:**

- [ ] `grep -rl "'use client'" src/components/blocks/ | wc -l` returns `0`. The directory is now
      entirely server-rendered, which is what a block system should be.
- [ ] `npm run verify` and `npx playwright test` both pass. Lesson 12.3 asserts the CTA counts on
      `/en/hobt` by accessible name; a boundary move must not change one.
- [ ] `/en/blog/blog-01`'s First Load JS went **down** — write the delta down. If it did not move,
      the block was already tree-shaken out of that chunk and the deletion is a tidiness win
      rather than a weight win, which is still worth having and is a different claim.

### Step 6: `next/dynamic` on the dialog body, with a matched placeholder

```tsx
// next-app/src/components/hobt/GetDemoDialog.tsx — the import, replaced
// The BODY is deferred; the trigger is not. A trigger the user cannot click
// until a chunk arrives is worse than a trigger that was always there.
//
// The Radix shell stays in the initial chunk on purpose: DialogTrigger and
// DialogContent must live inside the same <Dialog> provider, so "server-render
// the trigger" means rebuilding the dialog by hand. That restructure exists and
// is not worth it — Key Concept 6.
//
// Not server-rendered — Radix does not mount a closed DialogContent anyway, so
// the dialog's form was never in the server HTML — and /hobt already renders an
// always-visible copy at #lead for the JavaScript-off path (Lesson 16.3).
//
// The placeholder height is the number Lesson 21.2 measured for #lead. A
// mismatched placeholder converts a JavaScript saving into a layout shift,
// which is the worse of the two because CLS is budgeted.
import dynamic from 'next/dynamic';

const LeadForm = dynamic(() => import('@/components/hobt/LeadForm').then((m) => m.LeadForm), {
  ssr: false,
  loading: () => <div className="min-h-[34rem]" aria-hidden="true" />,
});
```

Then measure, and be willing to undo it:

```bash
# next-app
npm run analyze
npm run build 2>&1 | sed -n '/Route (app)/,$p' | grep 'hobt'
# Expected: /[locale]/hobt's First Load JS barely moves, and Key Concept 6 says
#           why — the LeadForm chunk is still in the graph via the eager #lead
#           copy. The win is one fewer form hydrating, which shows up in TBT.
```

Re-run the Lighthouse procedure on `/en/hobt` and compare **TBT**, not First Load JS.

**Verify §6:**

- [ ] `grep -rc 'next/dynamic' src/ | grep -v ':0$'` names exactly one file. A bounded count, and
      each use justified in a comment, is the rule.
- [ ] The "Get Demo" button is still in the server HTML:
      `curl -s http://localhost:3000/en/hobt | grep -c 'Get Demo'` returns `2` — one per CTA band,
      exactly as Lesson 12.3's smoke spec asserts.
- [ ] `npx playwright test` passes. A spec that opens the dialog now waits for a chunk;
      Playwright's auto-waiting covers it, and if a spec becomes flaky the placeholder must expose
      the same accessible structure — or revert this step.
- [ ] **TBT on `/en/hobt` improved.** If it did not, revert. A `next/dynamic` that buys nothing is
      complexity somebody reads forever, and the module README names this as one of the two
      self-inflicted wounds of the module.

### Step 7: Audit `next/script`, and resist inventing a third party

```bash
# next-app
grep -rn "from 'next/script'" src/
# Expected: one hit — src/components/hobt/LeadForm.tsx, Lesson 16.3
grep -rn 'strategy=' src/
# Expected: one hit — strategy="afterInteractive"
grep -rn 'https://' src/ | grep -vE 'schema.org|\.md|@|localhost' | sort -u
# Expected: challenges.cloudflare.com and nothing else. One third party.
```

The verdict is that 16.3 was right and there is nothing to change: `api.js` gates the submit
button, so `lazyOnload` would leave a form the user cannot submit during browser idle, and
`beforeInteractive` would block hydration for a widget that is not needed for first paint.

Record the inventory and the forward rule anyway, because the value is in the row that does not
exist yet:

| Script | Strategy | Justification | Budget impact |
|---|---|---|---|
| `challenges.cloudflare.com/…/api.js` | `afterInteractive` | gates submit; not needed for first paint | third-party, not counted in First Load JS |
| *(an analytics snippet, when it arrives)* | `lazyOnload` | nothing on the page depends on it | must arrive with a measured TBT delta in its pull request |

**Verify §7:**

- [ ] One `next/script` and one `strategy`. If a second appeared between Module 16 and here,
      justify it in the table or remove it.
- [ ] There is **no** analytics script. Do not add one for the sake of demonstrating
      `lazyOnload` — an unused third party is the exact regression this module exists to prevent.

### Step 8: Profile the incident filter, then decide about memoisation

Three lessons deferred `useMemo` to this module. This is where the deferral is honoured, and
honouring it means profiling first.

1. `npm run build && npm start`, then open `http://localhost:3000/en/incidents`.
2. DevTools → **Performance**, CPU **4× slowdown**.
3. Record, type six characters into the search box, stop.
4. Look for tasks over 50 ms in the main track, and open **Interactions** — every keystroke
   should appear with its own duration.

What you will find: the route queries `{ first: 12, search }` (Lesson 18.1), so `matchesFilters`
(Lesson 08.5) runs over twelve objects with three string comparisons each, behind Lesson 08.4's
250 ms debounce. Microseconds, and no long task to fix. **Do not add `useMemo`.**

Then do the experiment, so you know the shape of a real problem before you meet one:

```bash
# next-app — temporarily raise the cap to the whole seeded corpus, then profile
grep -n 'first: 12' 'src/app/[locale]/incidents/page.tsx'
# Expected: 1 — Lesson 18.1's cap. Change 12 to 55 (appendix 03 §9: 55
#           incidents after Lesson 20.1), rebuild, profile the same way, then
#           CHANGE IT BACK. This is an experiment, not a change.
```

Fifty-five objects is still not a long task on any machine, which is the useful result: the
threshold is nowhere near where instinct puts it. Record what you saw at both sizes, and what
would actually produce a 50 ms task — `Intl.DateTimeFormat` constructed inside the loop, a regex
compiled per item, or a list two orders of magnitude longer.

Three memoisation decisions, all recorded, none applied:

| Candidate | Verdict |
|---|---|
| `useMemo` on `IncidentList`'s `.filter()` chain | **no.** 12 items, debounced. Profiled at 12 and at 55 |
| `useMemo` on `IncidentFilterProvider`'s `value` object | **no.** The provider's only state *is* the three filter values, so the object changes exactly when it should. Memoising it is ceremony — the same conclusion Lesson 13.3 reached about a constant query object |
| `React.memo` on `IncidentCard` | **no.** Its props change whenever the filtered list changes, which is every keystroke that matters |

**Verify §8:**

- [ ] `grep -rnE 'useMemo\|useCallback\|React\.memo' src/components/incidents/` returns no output.
      Three lessons deferred it here, and the measurement declined it. That is the deferral
      honoured, not ignored.
- [ ] `grep -n 'first: 12' 'src/app/[locale]/incidents/page.tsx'` returns `1`. The experiment was
      reverted.
- [ ] You have a screenshot or a note of the longest task during six keystrokes, at both list
      sizes. A number, not "it felt fine".

### Step 9: Record everything, including what you declined

```markdown
<!-- docs/perf-baseline.md — append -->
## JavaScript weight and INP (Lesson 21.3)

Measured: ______  ·  `npm run analyze`, `@next/bundle-analyzer` ______  ·  three Lighthouse runs
per route, median, same device preset and throttling as Lesson 21.1.

| Route | First Load JS before | after | TBT before | TBT after |
|---|---|---|---|---|
| `/[locale]` | ______ | ______ | ______ | ______ |
| `/[locale]/incidents` | ______ | ______ | ______ | ______ |
| `/[locale]/incidents/[slug]` | ______ | ______ | ______ | ______ |
| `/[locale]/reviews/[slug]` | ______ | ______ | ______ | ______ |
| `/[locale]/blog/[slug]` | ______ | ______ | ______ | ______ |
| `/[locale]/hobt` | ______ | ______ | ______ | ______ |

**The after column is Lesson 21.4's budget.** Absolute ceiling 180 kB gzip per route, delta
≤ +10 kB against `main`.

### Client-component inventory

______ `'use client'` files at the end of Module 20; ______ after this lesson.

| File | Interaction that justifies it | Dragged into the client graph | Decision |
|---|---|---|---|
| ______ | ______ | ______ | keep / push down / delete |

### Changed

| Change | Effect | Measured |
|---|---|---|
| `@next/bundle-analyzer`, nested inside `withNextIntl` | `npm run analyze` | n/a — devDependency, MIT |
| `locale` namespace removed from `NextIntlClientProvider` | seven namespaces to six; Lesson 20.3's Key Concept 7 said six and the code shipped seven | ______ bytes of flight payload per route |
| `'use client'` deleted from `blocks/HobtCta.tsx` | `src/components/blocks/` is now entirely server-rendered | ______ kB on content routes |
| `next/dynamic` on `LeadForm` inside `GetDemoDialog` | one fewer form hydrating on `/hobt`; bytes unchanged, because `#lead` mounts the same chunk eagerly | ______ ms TBT |

### Measured and declined

| Candidate | Why not | What would change it |
|---|---|---|
| `useMemo` on the incident filter chain | 12 items behind a 250 ms debounce; profiled at 12 and at 55, no task over 50 ms | per-item `Intl` construction, or a list 100× longer |
| `useMemo` on the provider `value` | it changes exactly when its own state changes | a provider holding state its consumers do not all depend on |
| `React.memo` on `IncidentCard` | props change on every keystroke that matters | a card whose props are stable across filter changes |
| Pushing `IncidentCard` to the server via pre-rendered nodes | the island still needs the records to filter on, so markup would be added rather than substituted | ______ kB of card weight, against ______ kB of extra payload |
| An analytics script | there is none. Adding one to demonstrate `lazyOnload` is the regression this module prevents | when one is genuinely required, at `lazyOnload`, with a TBT delta in its PR |
| The `web-vitals` attribution build (Lesson 21.1 Task §3) | ______ kB for element-level attribution nothing yet consumes | an LCP regression whose element you cannot identify |

### Third-party scripts

| Script | Loaded by | Strategy | Justification |
|---|---|---|---|
| `challenges.cloudflare.com/turnstile/v0/api.js` | `LeadForm` (16.3) | `afterInteractive` | gates the submit button; not needed for first paint |
```

```bash
# next-app
npm run verify
npm test -- --run
npx playwright test
cd ..
git add -A
git commit -m "perf: bundle analyzer, boundary audit, measured memoisation decisions"
cd next-app
```

**Verify §9:**

- [ ] Both tables have real numbers in every cell, including the ones that did not move.
- [ ] The "measured and declined" table has at least five rows. On this codebase the declines are
      the more interesting half, and Lesson 21.4 cites them when someone asks why a threshold sits
      where it does.
- [ ] The First Load JS "after" column is the number you are about to enforce. Ask whether any
      route is already over 180 kB — if one is, Lesson 21.4 opens with a decision rather than a
      config file.

---

## Verification

```bash
cd next-app
# A production build is running: `npm run build && npm start`.

# 1. The gate
npm run verify
# Expected: exit 0, silent

# 2. THE CONFIG CHECK. Two wrappers, nested, and next-intl still outermost.
#    Replacing the wrapper instead of nesting inside it removes i18n from the
#    build with NO error: pages render and every t() throws on first request.
grep -c 'withNextIntl' next.config.ts
# Expected: 2 — the createNextIntlPlugin call and the export
grep -c 'withBundleAnalyzer' next.config.ts
# Expected: 2 — the factory call and the export
grep -c 'export default withNextIntl(withBundleAnalyzer(nextConfig));' next.config.ts
# Expected: 1 — this exact nesting, in this order

# 3. NEGATIVE — the config object that six lessons share did not shrink. A
#    config object that shrank means you pasted over somebody else's lesson.
grep -c 'remotePatterns' next.config.ts
# Expected: 1 — Lesson 09.1's
grep -c 'minimumCacheTTL' next.config.ts
# Expected: 1 — Lesson 14.5's
grep -c 'async headers()' next.config.ts
# Expected: 1 — Lesson 18.4's, which Lesson 24.2 will append to
grep -c 'async redirects()' next.config.ts
# Expected: 1 — Lesson 19.4's
grep -c 'trailingSlash' next.config.ts
# Expected: 1 — Lesson 19.4's
grep -c 'allowedOrigins' next.config.ts
# Expected: 1 — Lesson 15.5's

# 4. Proof the i18n plugin still runs. A missing plugin is a RUNTIME failure,
#    so a build that succeeds proves nothing — render a page that calls t().
curl -s http://localhost:3000/de/incidents | grep -c 'Vorf\|Incidents'
# Expected: 1 or more — a translated heading rendered. If this page 500s with a
#           message about next-intl/config, check 2 is the reason.

# 5. NEGATIVE — ANALYZE is in no env file. It is a shell-only flag, the same
#    discipline appendix 04 §3.1 gives E2E_MODE.
grep -rn 'ANALYZE' .env* 2>/dev/null | wc -l
# Expected: 0
grep -c 'process.env.ANALYZE' next.config.ts
# Expected: 1 — read once, in the factory call, and nowhere else

# 6. NEGATIVE — the analyzer is OFF by default. A flag that is on by default is
#    not a flag, and three HTML reports per build is a slow build for nobody.
rm -rf .next/analyze
npm run build > /dev/null 2>&1
test -d .next/analyze && echo 'WRONG — analyzer ran without ANALYZE' || echo ok
# Expected: ok

# 7. And ON when asked, writing three reports that git ignores
npm run analyze > /dev/null 2>&1
ls .next/analyze/
# Expected: client.html  edge.html  nodejs.html
cd .. && git check-ignore -v next-app/.next/analyze/client.html && cd next-app
# Expected: a rule from the root .gitignore naming `.next/`

# 8. NEGATIVE — the analyzer is a devDependency and never a production install
grep -c '"@next/bundle-analyzer"' package.json
# Expected: 1
node -e "const p=require('./package.json'); process.exit(p.devDependencies?.['@next/bundle-analyzer']?0:1)"
# Expected: exit 0. A non-zero exit means it is in `dependencies`, which ships
#           a build tool to production.

# 9. The i18n payload is six namespaces, not seven
curl -s http://localhost:3000/en/hobt \
  | grep -o '\\"\(nav\|locale\|incidents\|incidentForm\|hobt\|auth\|common\)\\"' | sort -u | wc -l
# Expected: 6 — Lesson 20.3 Key Concept 7's number, now also the code's number
grep -c "locale: localeMessages" 'src/app/[locale]/layout.tsx'
# Expected: 0 — the namespace with no client consumer is gone

# 10. NEGATIVE — and it had no consumer, which is why removing it was safe
grep -rn "useTranslations('locale')" src/ | wc -l
# Expected: 0
grep -c 'useTranslations' src/components/layout/LocaleSwitcher.tsx
# Expected: 0 — Lesson 20.3's own assertion, still true

# 11. NEGATIVE — the four server-only namespaces never reached the browser
#     either. This is Lesson 20.3's discipline, verified rather than assumed.
#     Checks 9-11 depend on how your Next version escapes flight-payload keys
#     in the document. If check 9 returned 0 as well, the escaping differs:
#     open the HTML, find the payload by eye once, and adjust the pattern.
curl -s http://localhost:3000/en/hobt \
  | grep -o '\\"\(home\|blog\|reviews\|scapegoats\)\\"' | sort -u | wc -l
# Expected: 0

# 12. NEGATIVE — blocks/ is now entirely server-rendered
grep -rl "'use client'" src/components/blocks/ | wc -l
# Expected: 0
grep -c "'use client'" src/components/blocks/HobtCta.tsx
# Expected: 0 — the directive AND Lesson 14.4's comment about it are both gone
grep -cE "use[A-Z][a-zA-Z]*\(|onClick=" src/components/blocks/HobtCta.tsx
# Expected: 0 — nothing in it ever needed the boundary

# 13. NEGATIVE — deleting the directive did not change a single accessible name.
#     Lesson 12.3 addresses /en/hobt by role and name, and a boundary move that
#     changes markup is not a boundary move.
curl -s http://localhost:3000/en/hobt | grep -c 'Get Demo'
# Expected: 2 — one per CTA band
curl -s http://localhost:3000/en/hobt | grep -c 'Start Now'
# Expected: 2

# 14. next/dynamic is bounded, and it is on the body rather than the trigger
grep -rc 'next/dynamic' src/ | grep -v ':0$'
# Expected: exactly one file — src/components/hobt/GetDemoDialog.tsx
grep -c '<DialogTrigger' src/components/hobt/GetDemoDialog.tsx
# Expected: 1 — the trigger is NOT dynamic; it is in the initial chunk. Match
#           the element, not the identifier: the import and the closing tag are
#           two more lines carrying the same word.
grep -c 'ssr: false' src/components/hobt/GetDemoDialog.tsx
# Expected: 1
grep -c 'min-h-\[34rem\]' src/components/hobt/GetDemoDialog.tsx
# Expected: 1 — the placeholder height Lesson 21.2 measured. A placeholder that
#           does not match trades a JS saving for a layout shift.

# 15. NEGATIVE — no memoisation was added, because the profile said not to.
#     Lessons 08.3, 08.4 and 08.5 all deferred this here; the deferral is
#     honoured by measuring, and the measurement declined.
grep -rnE 'useMemo|useCallback|React\.memo' src/components/incidents/
# Expected: no output
grep -n 'first: 12' 'src/app/[locale]/incidents/page.tsx' | wc -l
# Expected: 1 — Step 8's 55-item experiment was reverted

# 16. NEGATIVE — one third-party script, and no analytics snippet appeared
grep -rn "from 'next/script'" src/ | wc -l
# Expected: 1
grep -rc 'strategy="afterInteractive"' src/components/hobt/LeadForm.tsx
# Expected: 1
grep -rn 'googletagmanager\|google-analytics\|plausible\|segment.com' src/ | wc -l
# Expected: 0 — there is no analytics in this course, and adding one to
#           demonstrate `lazyOnload` is the regression this module prevents

# 17. NEGATIVE — no barrel appeared, and the icon imports are still named
grep -rn 'export \* from' src/ --include='*.ts' --include='*.tsx' | wc -l
# Expected: 0 — the one barrel in the project is codegen's src/gql/index.ts,
#           and Lesson 10.1's server-only guard keeps it out of the client graph
grep -rn "from 'lucide-react'" src/ | wc -l
# Expected: 2 — { Menu } and { Globe }, both single named imports

# 18. NEGATIVE — no route became dynamic, and none became static either. Every
#     number above is comparable only if the strategies are unchanged.
npm run build 2>&1 | sed -n '/Route (app)/,$p' > /tmp/btt-routes-213.txt
grep -cE '^[┌├└│] *ƒ +/\[locale\]' /tmp/btt-routes-213.txt
# Expected: 1 — /[locale]/incidents only
grep -c 'ƒ /\[locale\]/hobt' /tmp/btt-routes-213.txt
# Expected: 0

# 19. The First Load JS table is recorded, and it is 21.4's budget
grep -c 'JavaScript weight and INP (Lesson 21.3)' ../docs/perf-baseline.md
# Expected: 1
grep -c 'Measured and declined' ../docs/perf-baseline.md
# Expected: 1
grep -cE '^\| `/\[locale\]' ../docs/perf-baseline.md
# Expected: 12 or more — six rows in Lesson 21.3's table plus Lesson 21.2's

# 20. Every route is inside the ceiling it is about to be held to
npm run build 2>&1 | sed -n '/Route (app)/,$p' | grep -E '^[┌├└│].*/\[locale\]'
# Expected: read the last number on each line. Every one under 180 kB. If one is
#           over, Lesson 21.4 opens with a decision instead of a config file —
#           either this lesson is not finished, or the ceiling is wrong, and
#           saying which is the whole of Lesson 21.4's argument.

# 21. Both suites green
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures
```

If check 4 returns a 500 mentioning `next-intl/config`, you replaced the wrapper instead of
nesting inside it. That failure does not appear at build time, it appears on the first request to
a page that calls `t()` — which is why check 2 is a count and check 4 renders a German page.

## Control Questions

1. `'use client'` on `blocks/HobtCta.tsx` was correct when Lesson 14.4 added it and wrong by the
   time you deleted it, and nothing in the toolchain reported the change. Describe the mechanism
   that would have caught it automatically, say where in this repository it would have to live,
   and name the false positives it would produce.
2. Deferring `LeadForm` inside `GetDemoDialog` moved TBT and left First Load JS essentially
   unchanged. Explain, in terms of Key Concept 1's three costs, exactly which of them you saved
   and which you did not — then say what would have to change about `/hobt` for the same edit to
   save bytes as well.
3. Three lessons deferred `useMemo` to this one and the profile declined it. Construct the
   smallest realistic change to `IncidentCard` that would make `useMemo` on the filter chain the
   right call, and say what number in a profile would tell you the moment it became right.
4. Lesson 20.3's Key Concept 7 said six namespaces and its code passed seven, and its own
   Verification contained the evidence that the seventh was unnecessary. Explain why neither
   TypeScript nor `npm run verify` nor the e2e suite caught the discrepancy, and propose a check
   that would have.
5. A colleague's pull request adds a 45 kB charting library to `IncidentCard` so each card shows a
   sparkline, and wraps it in `next/dynamic` "so it does not affect the bundle". Evaluate that
   claim against Key Concepts 1, 6 and 9, and state what you would ask them to measure before you
   approve or refuse.

## Learn More

- [`@next/bundle-analyzer`](https://www.npmjs.com/package/@next/bundle-analyzer) — the options
  used in Task §1, including `enabled` and `openAnalyzer`, and the three reports it emits
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
  — the boundary model in Key Concept 2, in the framework's own words, including the
  "move client components down the tree" section
- [Next.js — `next/dynamic`](https://nextjs.org/docs/app/guides/lazy-loading) — `ssr: false`,
  the `loading` option, and the named-export import form Task §6 uses
- [Next.js — `next/script`](https://nextjs.org/docs/app/api-reference/components/script) — all
  four strategies with the framework's own guidance on which third parties suit which
- [web.dev — optimise INP](https://web.dev/articles/optimize-inp) — input delay, processing and
  presentation delay, which is the breakdown Task §8's profile shows you
- [web.dev — long tasks and breaking them up](https://web.dev/articles/optimize-long-tasks) —
  `scheduler.yield`, `isInputPending` and why `setTimeout(0)` is the wrong tool
- [React — `useMemo`](https://react.dev/reference/react/useMemo) — read the "How to tell if a
  calculation is expensive" section next to Task §8, because it agrees with the declines
- [web.dev — the cost of JavaScript](https://web.dev/articles/the-cost-of-javascript-2023) — the
  parse/compile/execute measurements behind Key Concept 1's ratio, on real devices
- [Chrome DevTools — Performance panel reference](https://developer.chrome.com/docs/devtools/performance/reference)
  — the Interactions track and the long-task markers Task §8 asks you to read
