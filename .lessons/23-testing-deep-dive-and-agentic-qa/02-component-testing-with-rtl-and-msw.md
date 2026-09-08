---
title: 'Component Testing with RTL & MSW'
module: 23
lesson: 2
teaches: [react-testing-library, user-event, queries-by-role, msw-v2, graphql-handlers, handler-reuse]
produces: ['next-app/tests/mocks/handlers.ts', 'next-app/tests/mocks/server.ts', 'next-app/tests/mocks/server-only.ts', 'next-app/src/components/incidents/IncidentFilters.test.tsx', 'next-app/src/components/layout/MobileNav.test.tsx', 'next-app/src/components/layout/LocaleSwitcher.test.tsx', 'next-app/src/lib/graphql/client.test.ts']
requires: [23.1, 12.2, 08.4]
---

# Lesson 23.2 — Component Testing with RTL & MSW

## Quick Overview

React Testing Library has one opinion and it is the right one: **test the component the way a
user reaches it.** Not by class name, not by component internals, not by state — by role, by
accessible name, by label text. `getByRole('button', { name: /submit/i })` passes only if there
is something that is genuinely a button and genuinely announces itself as "Submit". That makes
your tests resistant to refactoring and, as a side effect you will feel immediately, makes
inaccessible markup untestable. `user-event` completes the picture by simulating real
interaction sequences — a click is a pointerdown, a focus, a mouseup and a click, in order — so a
component that only works because you fired a synthetic `change` event fails honestly.

The other half is **MSW v2**, which intercepts at the network layer rather than mocking your
GraphQL client. `graphql.query('IncidentsList', resolver)` matches by operation name and returns
whatever you say, which means your component under test runs its real data-fetching code against
a fake WordPress that never has to be running. Type the handler responses with the codegen'd
types from Module 10 and the fake becomes a contract check: change the query, and the handler
stops compiling. Handlers live in `tests/mocks/handlers.ts` once and are reused by every test
file, with per-test overrides via `server.use()` for the error and empty cases — which are the
cases that actually break in production.

By the end of this lesson you will have:

- `tests/mocks/handlers.ts` — typed MSW v2 GraphQL handlers covering the queries the client
  islands issue, built on the `src/gql/` generated types
- `tests/mocks/server.ts` and the Vitest setup wiring, with `onUnhandledRequest: 'error'` so an
  unmocked call is a test failure rather than a silent hang
- `IncidentFilters.test.tsx` — filtering, empty state, and the `aria-live` announcement from
  Lesson 22.2 asserted by role
- Tests for the locale switcher and the mobile nav, queried by role and accessible name only
- Per-test overrides for a GraphQL error response and an empty connection, proving the error and
  empty UI exist
- A `user-event` keyboard-only test for at least one island, so keyboard support has a
  regression test and not just a manual pass

## Classic WP Analogy

The closest thing you have written is a PHPUnit test for a template tag, or more likely nothing
at all — Classic WordPress markup was rendered by PHP, and testing PHP-rendered markup meant
either string comparison (brittle, and everyone abandoned it) or loading WordPress and scraping
the output (slow, and everyone abandoned that too).

| Classic WordPress | RTL + MSW |
|---|---|
| Test the whole page output as a string | Render one component; query its accessibility tree |
| Need a database and a post to render anything | Props, or an MSW handler — no container, no MySQL |
| Mock `wp_remote_get` with `pre_http_request` | `graphql.query(...)` handler in MSW |
| `WP_UnitTestCase` factories for fixtures | Typed fixture objects, plus the seeder for E2E only |
| A jQuery behaviour: tested by clicking staging | `user-event` sequences in a real DOM (jsdom) |

The mocking row is the interesting one, because it is a place headless is straightforwardly
better. Faking HTTP in WordPress means hooking `pre_http_request` — a global filter, applied to
every request in the process, that you must remember to remove. MSW intercepts at the network
layer with per-test scoping and resets between tests automatically. Same idea, none of the
global-state hazard.

Where the analogy breaks: **there is no Classic equivalent of a component boundary, so there is
no Classic equivalent of choosing what to render.** A PHP template was the page. Here you choose
a unit, and choosing wrong is how you end up with a useless suite. Two failure modes to avoid,
both common. Rendering too small — asserting that `IncidentCard` renders a title — tests React,
not your code. Rendering too large — mounting a whole route — runs into the RSC rule from Lesson
23.1 and simply will not work, because the route is an async Server Component.

The sharp edge, stated once: **MSW only helps components that fetch in the browser or in a
jsdom-simulated client environment.** Your Server Components fetch on the server, and you are not
rendering them here. So this suite covers exactly the client islands — the filter, the switcher,
the nav, the dialog, the forms — and nothing else. Everything server-side is Lesson 23.3 or
Playwright. Being clear about that boundary is what stops this suite from silently pretending to
cover the site.

---

## Key Concepts

### 1. One opinion, and the loop it closes

RTL's whole design follows from one sentence in its own guiding principles: *the more your tests
resemble the way your software is used, the more confidence they can give you.* In practice that
means the query is the design constraint.

| Query | What it asserts | What it survives |
|---|---|---|
| `getByRole('button', { name: 'Clear filters' })` | there is something that **is** a button and **announces itself** as "Clear filters" | a class rename, a `<div>`→`<button>` fix, a Tailwind redesign |
| `getByLabelText('Search incidents')` | there is a form control with a programmatic label | the input changing type, the label moving |
| `container.querySelector('.incident-filters button')` | some element matched a CSS selector | nothing. It breaks on a design change and passes on a `<div onClick>` |

The last column is the point. A test that finds a control by class passes when that control is a
`<div>` with an `onClick` — invisible to a keyboard, silent to a screen reader. A test that finds
it by role and accessible name **cannot** pass in that state. That is Lesson 22.4's payoff loop
working exactly as advertised: an icon-only button with no accessible name is not a lint warning
you can ignore, it is a red test whose message names the button.

> **The cost, and it is real.** You will look roles up. `<select>` is `combobox`,
> `<input type="search">` is `searchbox` (not `textbox`), a Radix dialog is `dialog`, and a bare
> `<p aria-live="polite">` has **no role at all**. Getting it wrong gives "Unable to find an
> accessible element with the role X", which is confusing the first three times.
> `screen.getByRole('nonsense')` prints the whole accessible tree, and that is the fastest way to
> learn this.

### 2. `getBy` / `queryBy` / `findBy`, and the one rule

Three prefixes, two dimensions, and exactly one rule worth memorising.

| Prefix | Not found | Returns | Use it for |
|---|---|---|---|
| `getBy*` | **throws immediately**, printing the DOM | element | everything present now |
| `queryBy*` | returns `null` | element or `null` | **absence, and nothing else** |
| `findBy*` | rejects after a timeout | `Promise<element>` | something that appears after an update you did not `await` |

**The rule: `queryBy*` only for absence.** `expect(screen.queryByRole('alert')).not.toBeNull()`
fails with `expected null not to be null` — a message containing nothing about what was in the
DOM. Written as `screen.getByRole('alert')` it fails with the accessible tree printed underneath,
which usually answers the question without a debugger.

The plural forms matter here because Lesson 16.1's `FormMessage` renders an **always-present,
usually-empty** `<p role="alert">` per field. `getByRole('alert')` on a pristine form throws
"found multiple elements"; the correct query is `getAllByRole('alert')` plus a filter on text.
That is not a flaw in 16.1 — an empty live region that exists *before* the error is what Lesson
22.2 requires — it is a fact about the DOM your test has to know.

### 3. `user-event`, and why `fireEvent` lies about a click

`fireEvent.click(el)` dispatches **one** event. A real click is a sequence:

```
   user-event: await user.click(button)
   ─────────────────────────────────────────────────────────
   pointerover → pointerenter → pointermove → pointerdown
       → mousedown → focus → pointerup → mouseup → click
                       ▲
                       └── fireEvent.click dispatches ONLY this one
```

Three consequences, each a bug class `fireEvent` cannot see:

| Behaviour | `fireEvent.click` | `await user.click` |
|---|---|---|
| Focus moves to the control | no | **yes** — so a subsequent `Tab` goes to the right place |
| `pointerdown` handlers run | no | yes — Radix opens on `pointerdown`, not `click` |
| A `disabled` control refuses the interaction | it dispatches anyway | **it does nothing**, like a browser |

The last row catches a real defect. Lesson 08.4's `IncidentSearch` disables its clear button
while the value is `''`. `fireEvent.click` fires the handler and the test passes; `await
user.click` does nothing and the test fails — correctly, because a user cannot click it either.

Two mechanical rules follow. **v14 is async, so every interaction is `await`ed** — and
`no-floating-promises` (Lesson 07.5, at `error`) catches you the first time you forget. And
**set it up per test**, `const user = userEvent.setup()`, before rendering; a shared instance
carries pointer state between tests.

### 4. jsdom, opt in per file — and why not globally

Lesson 12.2 set `environment: 'node'` and argued it properly: **jsdom is a lie about a browser.**
It is a JavaScript reimplementation of a DOM with no layout engine, so it has no real notion of
visibility, scrolling, focus rings or `getBoundingClientRect`. That argument is still correct.
Component tests do not refute it; they need a DOM anyway.

Four ways to give some files a DOM, and only one of them is stable enough to teach:

| Mechanism | Verdict |
|---|---|
| `environment: 'jsdom'` globally | ❌ Lesson 23.3's Server Action tests want `node`, and every pure-function file pays jsdom's startup cost for nothing |
| `environmentMatchGlobs` | ❌ **deprecated** in current Vitest in favour of `projects`. Teaching a deprecated key is teaching a migration |
| `projects` (formerly `workspace`) | a real answer, and a moving target across Vitest 1→3. Two configs, two `include`s, two coverage merges — a lot of machinery for four files |
| **`// @vitest-environment jsdom` at the top of the file** | ✅ **chosen.** One comment, stable across Vitest 1–3, and it keeps jsdom **opt-in** — which preserves 12.2's argument instead of overturning it |

The per-file docblock has a property the config-level answers do not: **the file that needs a
fake DOM is the file that says so.** You can grep for it, and the grep tells you exactly how much
of your suite is running against a DOM that is not a browser. Verification check 5 does that.

> **jsdom is already installed, and you did not install it.** Lesson 14.3 added
> `isomorphic-dompurify` for block HTML sanitisation, which pulls `jsdom` transitively — and
> 14.3 named that cost explicitly and had you run `npm ls jsdom`. So the dependency is present.
> **Add it as a direct dev dependency anyway.** A transitive dependency you import directly is a
> real hazard: `isomorphic-dompurify` could switch to `happy-dom` or an alternative window
> implementation in a patch release and your entire component suite would fail to resolve an
> environment, with no line in your own `package.json` to explain why. The cost is one more row
> in `devDependencies` and the duty to keep it roughly in step. Lesson 23.2 declares it.

### 5. The `include` pattern that would have made this whole suite pass while testing nothing

Read Lesson 12.2's config again, carefully:

```ts
// (illustration) next-app/vitest.config.ts as Lesson 12.2 left it
include: ['src/**/*.test.ts'],
```

No `x`. Every file in Lesson 12.2 was `.test.ts` and the pattern was correct for them. Your first
component test is `IncidentFilters.test.tsx`, and `src/**/*.test.ts` **does not match it.**

Here is what happens, and it is the worst failure mode available in testing:

```
   npm run test:run
   ─────────────────────────────────────────────
    ✓ src/lib/graphql/tags.test.ts      (14)
    ✓ src/lib/graphql/errors.test.ts    (11)
    ✓ src/types/content.test.ts          (9)
    ✓ src/components/layout/nav.test.ts  (8)
    ✓ src/components/incidents/IncidentList.test.ts (11)

    Test Files  5 passed (5)
         Tests  53 passed (53)          ← green. And your new file was never opened.
```

No error, no warning, no mention of the file. A green suite, a passing pull request, and zero
coverage of the thing you just spent an hour writing. **Widen the pattern to
`src/**/*.test.{ts,tsx}` in the same commit that adds the first `.tsx` test**, and prove it with
`--reporter=verbose`, which lists every collected file by name.

The general lesson outlives the fix: **the first thing to verify about a new test is that it runs
at all.** A test you have never seen fail is not yet a test; a test that was never collected is
not even a file.

### 6. MSW v2 intercepts the network — it does not mock your client

Two fundamentally different techniques get called "mocking", and choosing between them is the
architectural decision in this lesson.

```
   vi.mock('@/lib/graphql/client')          MSW v2
   ────────────────────────────────         ─────────────────────────────────
   component                                component
      │                                        │
      │ calls fetchGraphQL(...)                │ calls fetchGraphQL(...)
      ▼                                        ▼
   ✂ REPLACED — returns your object         real client: builds the POST body,
                                            sets the headers, reads the env var
                                               │
                                               ▼
                                            ✂ INTERCEPTED at the network layer
                                               │
                                               ▼
                                            your resolver, matched by OPERATION NAME
```

With `vi.mock`, everything between the component and the wire is skipped: the document is never
serialised, the headers are never built, the error policy never runs. With MSW, **all of your
code runs** and only the socket is fake.

| | `vi.mock` on the client module | **MSW v2** |
|---|---|---|
| Your fetching code runs | no | **yes** |
| Catches a wrong header, endpoint or missing token | no | **yes** |
| Catches a broken error-mapping path | no | **yes** — return an `errors` array and watch |
| When the subject is a Server Action you are *isolating* | ✅ the right tool | works, and tests more than you meant to |
| Setup cost | one line | three files |

Three MSW facts that decide how you write handlers:

1. **`graphql.query('IncidentsList', resolver)` matches by operation name**, not by URL. That is
   why your handlers do not need to know `WP_GRAPHQL_ENDPOINT`, and why the same handler works for
   a browser-side call and a Node-side one.
2. **`onUnhandledRequest: 'error'`** turns an unmocked request into a test failure. The default is
   a console warning, which means a component that quietly started calling a second endpoint
   produces a passing test and a line of output nobody read. Set it to `'error'` and stay there.
3. **`server.use()` adds a handler for one test**, and `server.resetHandlers()` in `afterEach`
   takes it away again. That is the mechanism for the cases that actually break in production —
   a GraphQL `errors` array, an empty connection, a 500 — none of which you can make WordPress
   produce on demand.

### 7. A typed handler is a contract check, and the compiler is the workflow

The codegen from Module 10 exports a result type per operation. Use it as the handler's type
parameter and the fake stops being a guess:

```ts
// (illustration) the shape, not the file
graphql.query<IncidentsListQuery, IncidentsListQueryVariables>('IncidentsList', () =>
  HttpResponse.json({ data: { incidents: { nodes: [] } } })
);
```

Now change `src/graphql/incidents.graphql` to select one more field, run `npm run codegen`, and
`npm run type-check` fails **in your handler** — because `IncidentsListQuery` grew a required
property your fake does not supply. A fake that cannot drift from the schema is a contract check
that happens to also be a fixture.

That inverts the workflow in a way worth stating out loud: **you do not need to know the
selection set to write the handler.** Write `HttpResponse.json({ data: {} })`, run
`npm run type-check`, and the compiler enumerates every field you owe with its exact nullability.
Fill them in until it is silent, and never reach for `as`.

`tests/mocks/` sits **outside `src/`**, so `include: ['src/**/*.test.{ts,tsx}']` never collects it
as a test file — correct, because it contains no tests. But `tsconfig.json`'s `include` is
`["next-env.d.ts", "**/*.ts", "**/*.tsx", …]` relative to `next-app/`, so the handlers **are**
type-checked. That combination is exactly what you want, and it is worth verifying rather than
assuming: check 4 counts the type-checked files, check 3 proves the directory collects no tests.

### 8. The uncomfortable finding: nothing in this application fetches WPGraphQL from a browser

Before writing a handler, grep for the consumer. Do it now, because the answer changes the lesson:

```bash
# (illustration) run this before you write a single handler
grep -rl "'use client'" src/
grep -rn "fetch(" src/components/
```

Twenty-one files carry `'use client'`. **Exactly one of them issues a network request**, and it is
not a GraphQL request: `SessionMenu` (Lesson 18.1) calls `fetch('/api/auth/session')` in a
`useEffect`. Everything else — the filters, the search, the list, the cards, the mobile nav, the
locale switcher, the four forms, the dialog — receives its data as **serialisable props from a
Server Component**.

That is not a gap, it is the structural consequence of Lesson 10.1: `client.ts` opens with
`import 'server-only'`, so importing it from a client component is a **build failure**, proved
there with a deliberate leak probe. Browser-side GraphQL is impossible on purpose.

So be precise about what MSW is for here, because a fake with no consumer is a fake that rots:

| MSW handler | Its real consumer | Why it is worth having |
|---|---|---|
| `http.get('/api/auth/session')` | `SessionMenu`, in jsdom | the only client island with a network dependency, and its three states — pending, signed in, anonymous — are otherwise untestable |
| `graphql.query('SiteChrome')`, `graphql.query('IncidentsList')` | **`src/lib/graphql/client.ts`**, in Node | Lesson 12.2 Step 8 said this file is 0% covered and "Lesson 23.2 covers it with MSW". This is that promise being paid |
| the same handlers, overridden | Lesson 23.3's Server Action tests | an action's error path is the interesting path, and `server.use()` is how you produce it |

MSW's node interceptor patches `fetch` wherever it runs, so one handler file serves a jsdom test
and a plain-Node test identically. **The boundary from the Classic WP Analogy holds exactly as
stated:** MSW only helps a *component* that fetches, and this application has one. The rest of
the value is in the non-component consumers — a less exciting sentence and a more honest one.

> **What getting this wrong looks like.** A `handlers.ts` full of beautiful typed WPGraphQL
> responses no test ever triggers, `onUnhandledRequest: 'error'` never firing because no request
> is ever made, and a pull request that reports "MSW configured". Grep for the consumer first.

### 9. Choosing the unit — and the provider you cannot avoid

Two failure modes, both common, and one obstacle specific to this codebase.

**Too small.** Asserting that `IncidentCard` renders its title tests that React renders props.
It fails when you rename a prop and passes when the card is unreadable — not worthless, just not
worth its maintenance. **Too large.** Mounting `src/app/[locale]/incidents/page.tsx` runs into
Lesson 23.1's RSC rule and does not work at all: it is an async Server Component, and `react-dom`
hands React a Promise.

**The unit is the island** — the smallest subtree that owns the behaviour you are asserting:

| Behaviour | Unit | Why |
|---|---|---|
| "changing the severity select reports the new value" | `<IncidentFilters {...props} />` alone | it is fully controlled — five props, three of them functions. A spy on `onSeverityChange` **is** the assertion |
| "filtering to a severity with no matches shows the empty state" | `<IncidentFilterProvider>` wrapping the filter and the list | the state lives in the provider, the empty state lives in `IncidentList`, and neither component contains the behaviour |
| "the mobile menu trigger announces itself" | `<MobileNav items={…} />` | the trigger is the whole assertion. The *opened* sheet is Playwright's, for the reason below |

Two obstacles you will meet in the first five minutes:

- **`useIncidentFilters()` throws** without a provider above it, deliberately — Lesson 08.5 chose
  `undefined` as the context default so a missing provider is an error with a fix in it. Any test
  touching `IncidentList` or `IncidentBrowser` wraps in `IncidentFilterProvider`. The design
  working, not an inconvenience.
- **Radix needs browser APIs jsdom does not implement.** Opening a `Sheet` or a shadcn `Select`
  touches `matchMedia`, `ResizeObserver`, `hasPointerCapture` and `scrollIntoView`. Stubbing four
  APIs to assert "the dialog is in the tree" buys a weaker claim than Playwright's, in a fake DOM,
  at the cost of four shims that break on a Radix upgrade. **This lesson stubs them so a render
  does not crash, and still leaves the opened state to Lesson 23.6.** A fifth shim would be the
  signal to move the assertion, not to add it.

### 10. An accessible name that comes from a catalogue has to be asserted from somewhere

Module 20 moved every UI string into `src/messages/{en,uk,de}.json`. That changes component
testing in two ways, and neither is optional.

**First, `useTranslations` needs a provider.** `IncidentFilters`, `IncidentSearch`,
`IncidentList`, `IncidentBrowser` and `MobileNav` all call it (Lesson 20.3 Step 7). Rendering any
of them bare throws a next-intl error about a missing configuration, so every RTL test in this
lesson wraps its subject in `NextIntlClientProvider`.

**Second, you must decide who owns the string.** Two options, and the trade is not obvious:

| | Import `src/messages/en.json` into the test | **Declare a minimal namespace in the test** |
|---|---|---|
| The assertion reads | `messages.incidents.severity` | `'Severity'` |
| Catches a component that hard-codes the string | yes | yes |
| Catches a **wrong value** in the catalogue | no — the test and the component agree, wrongly | **yes** |
| Needs `resolveJsonModule` in `tsconfig.json` | yes, and this project does not set it | no |
| Couples the test to unrelated catalogue edits | yes — a copy change in `hobt` invalidates nothing but re-runs everything | no |
| Duplicates the string | no | **yes**, and that is the cost |

This course takes the second: **the test declares the two or three messages its subject needs,
with literal values.** Two simple checks beat one clever one, and the duplicated literal is what
makes the test able to fail when somebody "improves" a label.

> **One component is different, and it is the useful exception.** `LocaleSwitcher` receives its
> labels as **props**, resolved on the server by `Header`, precisely so the `locale` namespace
> never has to cross to the client. So its test needs no provider at all — but it does need
> `@/lib/i18n/navigation` mocked, because next-intl's `usePathname` reads a Next router that does
> not exist in jsdom. Two islands, two different obstacles, and Step 7 does both.


---

## Task

### Step 1: Check the licences, then install five dev dependencies

```bash
cd next-app

npm view @testing-library/react license
npm view @testing-library/user-event license
npm view @testing-library/jest-dom license
npm view msw license
npm view jsdom license
# Expected: MIT for all five. Nothing here ships to a browser, and nothing here is
#           copyleft — the no-GPL-in-a-proprietary-module rule is satisfied trivially,
#           but check rather than assume, as Lesson 14.3 did for DOMPurify.
```

```bash
npm install --save-dev \
  @testing-library/react@^16 \
  @testing-library/user-event@^14 \
  @testing-library/jest-dom@^6 \
  msw@^2 \
  jsdom@^26
```

`jsdom` is the one to think about: it is **already present transitively** through
`isomorphic-dompurify` (Lesson 14.3), so this install may resolve to the copy you already have.
Declaring it directly anyway is deliberate — Key Concept 4 — and the check below finds out
whether you now have two.

**Verify §1:**

- [ ] `npm ls jsdom` lists it **once**, deduped. Two majors means two copies in `node_modules`
      for no benefit; align the range you just pinned with the transitive one and reinstall.
- [ ] `npm pkg get devDependencies` lists all five; `npm pkg get dependencies` lists none.
- [ ] `npx msw --version` prints a `2.x` version. MSW v1's API is entirely different —
      `rest.get`, `req/res/ctx` — and half the blog posts you will find are v1.

### Step 2: Fix `vitest.config.ts` — five changes, and the first one is load-bearing

Lesson 12.2's config is correct for Lesson 12.2's files and wrong for yours. Edit these keys and
leave everything else exactly as it is:

```ts
// next-app/vitest.config.ts (fragment — five changed keys, in place)
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),

      // NEW. `server-only` throws when resolved outside React's `react-server`
      // condition, and a Vitest worker is not one — so importing
      // src/lib/graphql/client.ts would fail at import time, before any test ran.
      // Aliased to an empty module so the guard is inert HERE and intact in the
      // build. Lesson 23.1 §4 states the cost; check 11 below is the counterweight.
      'server-only': fileURLToPath(new URL('./tests/mocks/server-only.ts', import.meta.url)),
    },
  },

  test: {
    // UNCHANGED, and deliberately so. jsdom stays OPT-IN, per file, with a
    // `// @vitest-environment jsdom` docblock. Lesson 12.2 §6's argument survives.
    environment: 'node',

    // CHANGED: was `src/**/*.test.ts` — no `x`. A .tsx test file would not have
    // been collected, the suite would have stayed green, and nothing would have
    // said so. Key Concept 5.
    include: ['src/**/*.test.{ts,tsx}'],

    // NEW: starts the MSW server once per test file and resets handlers between
    // tests. Runs for `node` files too, which costs a few milliseconds and buys
    // one setup path instead of two.
    setupFiles: ['./tests/mocks/server.ts'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],

      // WIDENED. Lesson 12.2's comment said "Lesson 23.2 widens this when
      // component tests exist". They exist.
      include: [
        'src/lib/**/*.ts',
        'src/types/**/*.ts',
        'src/actions/**/*.ts',
        'src/components/**/*.{ts,tsx}',
      ],

      // CHANGED: `.tsx` tests and the mock directory are not subjects.
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'tests/**', 'src/components/ui/**'],
    },
  },
```

`exclude` under `test` (not `coverage`) stays as Lesson 12.2 wrote it —
`['e2e/**', 'node_modules/**', '.next/**', 'scratch/**']` — and still does the job it was written
for, because Vitest's `exclude` **replaces** its defaults rather than extending them.

**Verify §2:**

- [ ] `grep -c 'tsx' vitest.config.ts` is **3 or more**: the `include` pattern, the coverage
      `include` and the coverage `exclude`. A `1` means you widened one of the three.
- [ ] `npm run type-check` is silent. `vitest.config.ts` is inside `tsconfig.json`'s `**/*.ts`
      include (Lesson 09.1), so a typo here is a compile error, not a runtime surprise.
- [ ] `src/components/ui/**` is excluded from **coverage** only. shadcn primitives you have not
      edited are somebody else's tested code (Lesson 12.1 §5), and the one edit you did make —
      `ui/form.tsx`'s `role="alert"` — is covered through the forms that use it.

### Step 3: Write the `server-only` stub, and say what it costs

```ts
// next-app/tests/mocks/server-only.ts
// The `server-only` package, neutered — for tests only.
//
// The real package throws on import unless the resolver is running under React's
// `react-server` condition. That is exactly what protects src/lib/graphql/client.ts,
// which holds an endpoint and an app token, from ever entering a client bundle. It is
// also what makes that file impossible to import in a Vitest worker.
//
// vitest.config.ts aliases the specifier here. Consequences, both directions:
//
//   IN THE BUILD    unchanged. next.config.ts and tsconfig.json know nothing about
//                   this file, so an accidental client import still fails the build.
//   IN TESTS        the guard is gone for EVERY test, not just the ones that need it.
//                   A test could now import a module that reads WP_APP_TOKEN and no
//                   error would say so.
//
// The counterweight is a grep, not a hope: Verification check 11 asserts that the only
// test importing a server-only module is the one that is deliberately testing it, and
// that no test file names an environment variable that holds a credential.
export {};
```

`export {}` and nothing else — making it a module rather than an empty file is what stops
TypeScript treating it as a global script.

**Verify §3:**

- [ ] `npx vitest run src/lib/graphql/tags.test.ts` still passes. `tags.ts` has no `server-only`
      guard by design (Lesson 12.2 §7), so the alias changes nothing for it — and if this broke,
      the alias points at the wrong path.
- [ ] `grep -rn "from 'server-only'" src/` returns nothing. It is imported for its side effect
      only; a named import from it would be a different kind of mistake.

### Step 4: Write the handlers — one fake network, three consumers

```ts
// next-app/tests/mocks/handlers.ts
// The default fake network for the whole Vitest suite.
//
// GraphQL handlers match by OPERATION NAME, not by URL, so nothing here knows or
// cares what WP_GRAPHQL_ENDPOINT is set to. That is what lets one handler serve a
// jsdom test and a plain-Node test identically.
//
// Every root field below is `null`, which is a legitimate WPGraphQL response and is
// all the base handlers owe. Tests that need populated data add it with
// `server.use()`, because the interesting cases are per-test.
import { graphql, http, HttpResponse } from 'msw';

import type {
  IncidentsListQuery,
  IncidentsListQueryVariables,
  SiteChromeQuery,
  SiteChromeQueryVariables,
} from '@/gql/graphql';

/**
 * What GET /api/auth/session returns (Lesson 18.1). Two members and NO token —
 * the JWT lives in an httpOnly cookie the browser cannot read, so there is nothing
 * token-shaped for this payload to carry. Lesson 23.3 asserts that separately.
 */
export type SessionPayload =
  | { readonly isLoggedIn: true; readonly displayName: string }
  | { readonly isLoggedIn: false };

export const ANONYMOUS_SESSION: SessionPayload = { isLoggedIn: false };

export const SIGNED_IN_SESSION: SessionPayload = { isLoggedIn: true, displayName: 'Dev Reporter' };

export const handlers = [
  // ── REST ──────────────────────────────────────────────────────────────
  // A leading `*` so the same handler matches the relative URL a jsdom fetch
  // resolves against http://localhost AND an absolute one.
  http.get('*/api/auth/session', () => HttpResponse.json(ANONYMOUS_SESSION)),

  // ── GraphQL ───────────────────────────────────────────────────────────
  // Typed against the codegen'd result types, which is what turns these fakes
  // into contract checks: add a field to src/graphql/siteSettings.graphql, run
  // `npm run codegen`, and `npm run type-check` fails HERE. Key Concept 7.
  graphql.query<SiteChromeQuery, SiteChromeQueryVariables>('SiteChrome', () =>
    HttpResponse.json({ data: { siteSettings: null } })
  ),

  graphql.query<IncidentsListQuery, IncidentsListQueryVariables>('IncidentsList', () =>
    HttpResponse.json({ data: { incidents: null } })
  ),
];
```

**Verify §4:**

- [ ] `npm run type-check` is silent. If it names a missing property on `SiteChromeQuery` or
      `IncidentsListQuery`, **that is Key Concept 7 working** — add the field the compiler asks
      for, with the nullability it asks for, and do not reach for `as`. The error message is the
      selection set, written out for you.
- [ ] `grep -c 'as ' tests/mocks/handlers.ts` is `0`. A cast here would silence the exact signal
      this file exists to produce.
- [ ] `tests/mocks/handlers.ts` is **not** collected as a test file. `include` is
      `src/**/*.test.{ts,tsx}` and this file is outside `src/` and is not named `*.test.*`, so
      two independent reasons apply. Check 3 in the Verification proves it.

### Step 5: Write the server, and wire the lifecycle once

```ts
// next-app/tests/mocks/server.ts
// Vitest `setupFiles` entry. Runs once per test FILE, in whatever environment that
// file asked for.
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import '@testing-library/jest-dom/vitest';

import { handlers } from './handlers';

/** Exported so a test can call `server.use(...)` for a per-test override. */
export const server = setupServer(...handlers);

beforeAll(() => {
  // 'error', not the default 'warn'. An unmocked request must FAIL the test.
  // A warning means a component that quietly started calling a second endpoint
  // produces a green test and one line of output nobody read.
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  // Undoes every `server.use()`. Without this, an override leaks into the next
  // test in the file and the next test lies — the same hazard Brain Monkey's
  // tearDown addresses in PHP (Lesson 23.4).
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// ── jsdom shims for Radix, guarded so `node` files skip them entirely ─────
// Radix primitives touch four browser APIs jsdom does not implement. Without
// these, RENDERING a component that merely CONTAINS a Sheet or a Select throws,
// which looks like a bug in your component. Stubbing them makes a render possible;
// it does not make an OPENED overlay meaningfully testable — that stays in
// Playwright (Key Concept 9).
if (typeof window !== 'undefined') {
  if (window.matchMedia === undefined) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  }

  if (globalThis.ResizeObserver === undefined) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }

  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}
```

Note what is **not** here: `afterEach(cleanup)`. RTL auto-registers its own cleanup only when a
**global** `afterEach` exists, and Lesson 12.2 deliberately did not enable `globals: true` — so
auto-cleanup is off and each component test registers it explicitly. Three extra lines across the
suite, in exchange for not adding a fourth place where the compiler and the runner must agree.

**Verify §5:**

- [ ] `npx vitest run src/types/content.test.ts` still passes, still in milliseconds. This file
      now runs before it in a `node` environment, and the `typeof window` guard keeps that free.
- [ ] `grep -c 'onUnhandledRequest' tests/mocks/server.ts` is `1`, and the value is `'error'`.
- [ ] `grep -c 'cleanup' tests/mocks/server.ts` is `0`. Calling RTL's `cleanup` here would import
      `@testing-library/react` into every `node` test file for the benefit of three.

### Step 6: Write `IncidentFilters.test.tsx` — the controls, then the island

Two `describe` blocks, because the two units answer different questions: the filter component in
isolation (fully controlled, so a spy **is** the assertion) and the whole island (where the state
lives in the provider and the empty state lives in the list).

```tsx
// next-app/src/components/incidents/IncidentFilters.test.tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';


import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { INCIDENTS } from '@/components/incidents/fixtures';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import { IncidentFilters } from '@/components/incidents/IncidentFilters';

// RTL's auto-cleanup needs a GLOBAL afterEach, and `globals: true` is off
// (Lesson 12.2 §2). Register it explicitly, per file.
afterEach(cleanup);

// Only the namespaces the subjects read, with literal values. Key Concept 10
// argues for declaring these rather than importing src/messages/en.json: a
// duplicated literal is what lets this test fail when somebody "improves" a label.
const messages = {
  incidents: {
    empty: 'No incidents match these filters. Somebody, somewhere, is relieved.',
    resultCount:
      '{count, plural, =0 {No incidents match these filters} one {# incident found} other {# incidents found}}',
    search: 'Search incidents',
    severity: 'Severity',
    scapegoat: 'Scapegoat',
    clear: 'Clear filters',
  },
};

function withIntl(children: ReactNode) {
  return <NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>;
}

describe('IncidentFilters — controlled, so the spies are the assertions', () => {
  function renderFilters() {
    const onSeverityChange = vi.fn();
    const onScapegoatChange = vi.fn();
    const onClear = vi.fn();

    render(
      withIntl(
        <IncidentFilters
          severity="all"
          scapegoat="all"
          onSeverityChange={onSeverityChange}
          onScapegoatChange={onScapegoatChange}
          onClear={onClear}
        />
      )
    );

    return { onSeverityChange, onScapegoatChange, onClear, user: userEvent.setup() };
  }

  it('exposes both filters as comboboxes with accessible names', () => {
    renderFilters();

    // A native <select> is role `combobox`. Getting that wrong is the most common
    // first mistake in this file, and `getByRole('select')` does not exist.
    expect(screen.getByRole('combobox', { name: 'Severity' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Scapegoat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('reports the SLUG, not the label, when a severity is chosen', async () => {
    const { onSeverityChange, user } = renderFilters();

    // The option VALUES are term slugs (appendix 03 §2). The visible text is a
    // label that Module 20 may translate; the value is a contract with WordPress
    // and is never translated. Selecting by value is therefore the stable form.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 's1-catastrophic');

    expect(onSeverityChange).toHaveBeenCalledTimes(1);
    expect(onSeverityChange).toHaveBeenCalledWith('s1-catastrophic');
  });

  it('is operable with the keyboard alone', async () => {
    const { onClear, user } = renderFilters();

    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Severity' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Scapegoat' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toHaveFocus();

    // Enter on a focused button is a click. `fireEvent` cannot express this at
    // all, which is the whole of Key Concept 3.
    await user.keyboard('{Enter}');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: no control is still labelled with the pre-i18n string', () => {
    renderFilters();

    // Lesson 08.3 wrote <label>Blamed on</label>; Lesson 20.3 Step 7 moved every
    // control label into src/messages/. If this query finds something, the
    // component still hard-codes English and the catalogue is decoration.
    expect(screen.queryByRole('combobox', { name: 'Blamed on' })).toBeNull();
  });
});

describe('the incident island — provider, filters, search and list together', () => {
  function renderIsland() {
    vi.useFakeTimers();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    render(
      withIntl(
        <IncidentFilterProvider>
          <IncidentBrowser incidents={INCIDENTS} />
        </IncidentFilterProvider>
      )
    );

    return { user };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces the result count in a live region', () => {
    renderIsland();

    // role="status" implies aria-live="polite", so it is strictly LESS markup than
    // a bare aria-live — and it is the only form a test can query by role.
    // Lesson 11.4's standing rule ("could a native element or role have done
    // this?") points the same way. If this fails with "unable to find role
    // status", the region is a bare <p aria-live>: add role="status" to it.
    expect(screen.getByRole('status')).toHaveTextContent('40 incidents found');
  });

  it('filters to ten of the forty incidents per severity', async () => {
    const { user } = renderIsland();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Severity' }), 's1-catastrophic');

    // The seeder assigns severities with $i % 4 and the fixture expansion mirrors
    // it, so ten per severity is an invariant of both — the same number Lesson
    // 12.2 asserts against `matchesFilters` directly.
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByRole('status')).toHaveTextContent('10 incidents found');
  });

  it('NEGATIVE: the search does not filter until the debounce elapses', async () => {
    const { user } = renderIsland();

    await user.type(
      screen.getByRole('searchbox', { name: 'Search incidents' }),
      'nothing-matches-this'
    );

    // 250 ms have NOT passed. The list is unchanged, and asserting that is what
    // proves useDebouncedValue is wired at all — a broken debounce filters
    // immediately and every other test in this file still passes.
    expect(screen.queryByText(/Somebody, somewhere, is relieved/)).toBeNull();
  });

  it('shows the empty state once the debounce elapses', async () => {
    const { user } = renderIsland();

    await user.type(
      screen.getByRole('searchbox', { name: 'Search incidents' }),
      'nothing-matches-this'
    );

    await vi.advanceTimersByTimeAsync(300);

    expect(screen.getByText(/Somebody, somewhere, is relieved/)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
```

**Verify §6:**

- [ ] `npx vitest run src/components/incidents/IncidentFilters.test.tsx --reporter=verbose` lists
      the file by name and runs **eight** tests. If it says "No test files found", `include` is
      still Lesson 12.2's pattern — go back to Step 2.
- [ ] If Vitest reports `document is not defined`, the `@vitest-environment` docblock is not being
      read. Move it to **line 1**, above the path comment, and note the deviation: the course
      convention puts a path comment first, and a runner requirement outranks a convention.
- [ ] If a prop name does not compile — `onSeverityChange`, `severity`, `scapegoat`, `onClear` —
      use the names **your** Lesson 08.3 file declares. The assertions do not change; only the
      call site does. Lesson 09.2 gave the same instruction about the context destructuring.
- [ ] `npm run lint` is clean on the new file. The flat config's type-aware rules apply to
      `**/*.{ts,tsx}`, so a floating `user.click(...)` promise is an **error**, not a warning.

### Step 7: The header chrome — two islands, two different mocking problems

`MobileNav` reads the catalogue; `LocaleSwitcher` reads next-intl's **navigation** helpers. They
need different treatment, and seeing both is the point of doing them together.

```tsx
// next-app/src/components/layout/MobileNav.test.tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { MobileNav } from '@/components/layout/MobileNav';

afterEach(cleanup);

const messages = { nav: { primary: 'Primary', openMenu: 'Open main menu', closeMenu: 'Close menu' } };

// The four fields MobileNav reads off each entry (Lesson 11.3). If `type-check`
// names a fifth, add it — the assertions below do not depend on it.
const items = [
  { id: 'nav-1', href: '/en/incidents', label: 'Incidents', children: [] },
  {
    id: 'nav-2',
    href: '/en/reviews',
    label: 'Reviews',
    children: [{ id: 'nav-2-1', href: '/en/reviews/review-01', label: 'Latest', children: [] }],
  },
];

describe('MobileNav', () => {
  it('gives the icon-only trigger an accessible name', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MobileNav items={items} />
      </NextIntlClientProvider>
    );

    // The Menu icon is aria-hidden, so the ONLY thing naming this button is the
    // sr-only span. Delete that span and this test is the thing that notices —
    // before axe, before a screen reader, before a user.
    expect(screen.getByRole('button', { name: 'Open main menu' })).toBeInTheDocument();
  });

  it('NEGATIVE: renders no navigation landmark while it is closed', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MobileNav items={items} />
      </NextIntlClientProvider>
    );

    // Radix mounts SheetContent only when open, so the second <nav> landmark does
    // not exist yet. Two navigation landmarks in a closed mobile menu would be an
    // axe finding and a screen-reader annoyance, and this is the cheapest place to
    // catch it. The OPENED state is Lesson 23.6's — see Key Concept 9.
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).toBeNull();
  });
});
```

```tsx
// next-app/src/components/layout/LocaleSwitcher.test.tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

afterEach(cleanup);

// next-intl's navigation helpers wrap Next's router, and there is no router in
// jsdom — `usePathname()` returns null and `<Link>` has no App Router context to
// read. Replacing the module is honest: the thing under test is the accessible
// tree, and real navigation is Lesson 23.6's job in a real browser.
vi.mock('@/lib/i18n/navigation', () => ({
  usePathname: () => '/incidents',
  Link: ({ children, href }: { readonly children: ReactNode; readonly href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// `satisfies` rather than a type annotation, so a wrong prop NAME is a compile
// error here instead of a silent `undefined` at render time. If this does not
// compile, read your Lesson 20.3 file and use its names.
const props = {
  current: 'en',
  available: ['en', 'uk'],
  groupLabel: 'Language',
  labels: { en: 'English', uk: 'Українська', de: 'Deutsch' },
  unavailableLabel: {
    en: 'English — not available for this page',
    uk: 'Українська — not available for this page',
    de: 'Deutsch — not available for this page',
  },
} satisfies ComponentProps<typeof LocaleSwitcher>;

describe('LocaleSwitcher', () => {
  it('is a named navigation landmark, and the current locale is not a link', () => {
    render(<LocaleSwitcher {...props} />);

    expect(screen.getByRole('navigation', { name: 'Language' })).toBeInTheDocument();

    // The current locale renders a <span aria-current="true"> — which has NO role,
    // so getByRole can never find it. That is not a bug in the component: a link
    // to the page you are on is a link that does nothing. Query it by text.
    expect(screen.getByText('English')).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('link', { name: 'English' })).toBeNull();
  });

  it('NEGATIVE: an unavailable locale is disabled and explains itself, not hidden', () => {
    render(<LocaleSwitcher {...props} />);

    const german = screen.getByRole('button', { name: 'Deutsch — not available for this page' });

    // Disabled, never removed. A missing option is indistinguishable from a bug;
    // a disabled one whose accessible name says why is an answer. Lesson 20.3's
    // decision, pinned here so a later "tidy-up" cannot delete it silently.
    expect(german).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Українська' })).toBeInTheDocument();
  });
});
```

**Verify §7:**

- [ ] Both files run. `npx vitest run src/components/layout --reporter=verbose` lists
      `MobileNav.test.tsx`, `LocaleSwitcher.test.tsx` and Lesson 12.2's `nav.test.ts`.
- [ ] `MobileNav` renders without throwing. If it does throw about `matchMedia` or
      `ResizeObserver`, the shims in `tests/mocks/server.ts` are not running — check
      `setupFiles` in Step 2.
- [ ] The `vi.mock` factory in `LocaleSwitcher.test.tsx` returns **every** export the component
      imports from that module. `vi.mock` with a factory replaces the module wholesale, so a
      missing export is `undefined` at call time, not a helpful error.

### Step 8: Pay Lesson 12.2's promise — test the GraphQL client with MSW

Lesson 12.2 Step 8 recorded `src/lib/graphql/client.ts` at **0% coverage** and said, by name,
"Lesson 23.2 covers it with MSW". This is that — and the only test here where MSW does the work
rather than decorating it.

```ts
// next-app/src/lib/graphql/client.test.ts
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteChromeDocument } from '@/gql/graphql';
import { isGraphQLRequestError } from '@/lib/graphql/errors';

import { captureHeadersFor, graphqlErrorFor } from '../../../tests/mocks/handlers';
import { server } from '../../../tests/mocks/server';

/**
 * `client.ts` may read WP_GRAPHQL_ENDPOINT at IMPORT time or per call, and which
 * one it does changes how it can be tested. Resetting the module registry and
 * importing dynamically is correct either way — and noticing that you have to is
 * how you discover which kind of module you are holding.
 */
async function loadClient(env: Readonly<Record<string, string>>) {
  vi.resetModules();

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  return import('@/lib/graphql/client');
}

/** Generated per test. Nothing token-shaped is ever written into a tracked file. */
const appToken = randomUUID();

const ENV = {
  WP_GRAPHQL_ENDPOINT: 'http://localhost:8080/graphql',
  WP_APP_TOKEN: appToken,
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchGraphQL', () => {
  it('runs the real request and unwraps `data`', async () => {
    const { fetchGraphQL } = await loadClient(ENV);

    // Nothing is mocked between the call and the socket: the document is
    // serialised, the headers are built, the endpoint is read from the env var,
    // and MSW matches the operation NAME `SiteChrome` off the request body.
    await expect(fetchGraphQL(SiteChromeDocument)).resolves.toEqual({ siteSettings: null });
  });

  it('turns a GraphQL `errors` array into a thrown GraphQLRequestError', async () => {
    const { fetchGraphQL } = await loadClient(ENV);

    // The failure that no smoke test can produce on demand: HTTP 200 with an
    // `errors` array. House fact — WPGraphQL never uses a 4xx for this.
    server.use(graphqlErrorFor('SiteChrome', 'Internal server error', 'internal'));

    const failure = await fetchGraphQL(SiteChromeDocument).catch((error: unknown) => error);

    expect(isGraphQLRequestError(failure)).toBe(true);
  });
});

describe('fetchGraphQLAuthed — NEGATIVE: the two credentials never mix', () => {
  it('sends the app token and no Authorization header', async () => {
    const { fetchGraphQLAuthed } = await loadClient(ENV);
    const seen = new Headers();

    server.use(captureHeadersFor('SiteChrome', seen));

    await fetchGraphQLAuthed(SiteChromeDocument, {}, { kind: 'app' });

    expect(seen.get('x-btt-app-token')).toBe(appToken);
    // A user JWT on an app-token operation would authenticate the wrong principal.
    expect(seen.get('authorization')).toBeNull();
  });

  it('sends a bearer JWT and no app token', async () => {
    const { fetchGraphQLAuthed } = await loadClient(ENV);
    const seen = new Headers();
    const jwt = `header.${randomUUID()}.signature`;

    server.use(captureHeadersFor('SiteChrome', seen));

    await fetchGraphQLAuthed(SiteChromeDocument, {}, { kind: 'user', jwt });

    expect(seen.get('authorization')).toBe(`Bearer ${jwt}`);
    // The app token is the application's identity, not the user's. Appendix 04 §4.
    expect(seen.get('x-btt-app-token')).toBeNull();
  });
});

describe('NEGATIVE: an unmocked operation fails rather than hangs', () => {
  it('rejects when no handler matches', async () => {
    const { fetchGraphQL } = await loadClient(ENV);

    server.resetHandlers();
    server.use(graphqlErrorFor('SomethingElse', 'never reached', 'internal'));

    // `onUnhandledRequest: 'error'` is what makes this a failure. With the default
    // 'warn' this test would hang until Vitest's timeout and the output would say
    // "test timed out", which names the wrong problem.
    await expect(fetchGraphQL(SiteChromeDocument)).rejects.toThrow();
  });
});
```

Two helpers that file needs, and they belong beside the handlers rather than in a test:

```ts
// next-app/tests/mocks/handlers.ts (fragment — append these two exports)
/** A 200 with an `errors` array, which is how WPGraphQL reports every failure. */
export function graphqlErrorFor(operation: string, message: string, category: string) {
  return graphql.operation(({ operationName }) =>
    operationName === operation
      ? HttpResponse.json({ errors: [{ message, extensions: { category } }] })
      : undefined
  );
}

/**
 * Copies the request headers of the next matching operation into `seen`.
 *
 * It RETURNS the handler rather than registering it, so this module never imports
 * ./server — which would be a cycle, because ./server imports this file. A helper
 * that returns a value instead of performing a side effect is also a helper the
 * caller can read: `server.use(captureHeadersFor('SiteChrome', seen))` says what it
 * does at the call site.
 */
export function captureHeadersFor(operation: string, seen: Headers) {
  return graphql.operation(({ operationName, request }) => {
    if (operationName !== operation) return undefined;

    request.headers.forEach((value, key) => seen.set(key, value));

    return HttpResponse.json({ data: { siteSettings: null } });
  });
}
```

Both use `graphql.operation`, which matches **any** GraphQL request, and both return `undefined`
for an operation they do not care about — in MSW v2 that means "not handled here, try the next
handler", which is how a narrow override coexists with the base handlers.

**Verify §8:**

- [ ] `npx vitest run src/lib/graphql/client.test.ts` passes with five tests.
- [ ] `grep -c 'vi.mock' src/lib/graphql/client.test.ts` is `0`. Not one module is replaced in
      this file — that is the difference between MSW and `vi.mock`, and the whole reason these
      tests can catch a wrong header.
- [ ] If `client.ts` throws `Cannot find module 'server-only'`, the alias in Step 2 is wrong.
      If it throws the `server-only` error message itself, the alias is missing.

### Step 9: Prove the collection, then break one on purpose

Read the file list, not the totals — then make the failure happen deliberately, because a test
you have never seen fail is not yet a test:

```bash
cd next-app
npx vitest run --reporter=verbose
```

```bash
# Narrow `include` back to Lesson 12.2's pattern, run, then restore from the backup
# sed wrote thirty seconds ago. `|` as the delimiter, so no slash needs escaping.
sed -i.bak "s|src/\*\*/\*.test.{ts,tsx}|src/**/*.test.ts|" vitest.config.ts
npx vitest run --reporter=verbose | tail -6
mv vitest.config.ts.bak vitest.config.ts
```

**Verify §9:**

- [ ] With the narrowed pattern, the run reports **5 files, all passing, exit 0** — and none of
      the four files you wrote today appear. Sit with that for a moment. This is the failure this
      lesson exists to prevent, and it looks exactly like success.
- [ ] With the pattern restored, the run reports **9 files**.
- [ ] `npm run test:coverage` now lists `src/components/incidents/`,
      `src/components/layout/` and a non-zero figure for `src/lib/graphql/client.ts`. That last
      number is Lesson 12.2's `0%` row, closed.
- [ ] `git status --short` shows the seven new files, `vitest.config.ts` modified and
      `package.json` modified — and **no** `vitest.config.ts.bak` left behind.


---

## Verification

```bash
cd next-app

# 1. The whole suite, and READ THE FILE LIST rather than the totals
npx vitest run --reporter=verbose
# Expected: 9 test files. The five from Lesson 12.2 —
#           tags, errors, content, nav, IncidentList — plus
#           IncidentFilters.test.tsx (8), MobileNav.test.tsx (2),
#           LocaleSwitcher.test.tsx (2) and client.test.ts (5).
#           A count of 5 means the new files were never collected. See check 2.

# 2. NEGATIVE — Lesson 12.2's narrower pattern is gone, and the widened one is present
grep -c "include: \['src/\*\*/\*.test.ts'\]" vitest.config.ts
# Expected: 0. That exact pattern does not match a .tsx file, so leaving it in place
#           produces a GREEN suite that never opened four of your files. There is no
#           error, no warning and no mention of them anywhere in the output.
grep -c "src/\*\*/\*.test.{ts,tsx}" vitest.config.ts
# Expected: 1

# 3. NEGATIVE — tests/mocks/ is NOT collected as tests, for two independent reasons
npx vitest run tests/mocks; echo "exit=$?"
# Expected: "No test files found" and exit=1. It sits outside src/ AND is not named
#           *.test.*, so a fixture can never masquerade as a passing test file.

# 4. …but tests/mocks/ IS type-checked, which is what makes the handlers a contract
npx tsc --noEmit --listFiles | grep -c 'tests/mocks/'
# Expected: 3 — handlers.ts, server.ts, server-only.ts. tsconfig.json's include is
#           ["next-env.d.ts", "**/*.ts", "**/*.tsx", …] relative to next-app/, so a
#           file does not need to be in src/ to be judged. A 0 here means the typed
#           handlers are decoration: they would never fail on a schema change.
npx tsc --noEmit --listFiles | grep -c '\.test\.tsx$'
# Expected: 3 — the three component test files

# 5. How much of the suite runs against a DOM that is not a browser. Know the number.
grep -rl '@vitest-environment jsdom' src | sort
# Expected: exactly three files —
#           src/components/incidents/IncidentFilters.test.tsx
#           src/components/layout/LocaleSwitcher.test.tsx
#           src/components/layout/MobileNav.test.tsx
#           Everything else still runs in `node`, which is Lesson 12.2's decision
#           surviving contact with component tests rather than being overturned.

# 6. NEGATIVE — an unmocked request FAILS the test rather than hanging. Probe the
#    operation-name matching by renaming a handler's operation on a throwaway copy.
sed -i.bak "s/'SiteChrome'/'SiteChromo'/" tests/mocks/handlers.ts
npx vitest run src/lib/graphql/client.test.ts 2>&1 | grep -ciE 'intercepted a request without a matching request handler|onUnhandledRequest'
mv tests/mocks/handlers.ts.bak tests/mocks/handlers.ts
# Expected: 1 or more. `graphql.query` matches by OPERATION NAME, so a one-character
#           typo means nothing matches, and `onUnhandledRequest: 'error'` turns that
#           into a failure that names the request. With MSW's default 'warn' the same
#           run would hang until Vitest's timeout and report "test timed out", which
#           names the wrong problem entirely.
npx vitest run src/lib/graphql/client.test.ts
# Expected: 5 passed — the file is restored

# 7. NEGATIVE — a typed handler stops compiling when its document changes.
#    REASONED, NOT EXECUTED: running it means editing a .graphql document and
#    regenerating src/gql/, and the point is the compiler error, not the round trip.
#    Add a field to src/graphql/siteSettings.graphql, run `npm run codegen`, then
#    `npm run type-check`. The failure lands in tests/mocks/handlers.ts:
#      error TS2739: Type '{ siteSettings: null; }' is missing the following
#      properties from type 'SiteChromeQuery': …
#    That is the whole argument for typing a fake. An untyped handler would keep
#    returning yesterday's shape, every test would keep passing, and the drift would
#    surface as `undefined` in a browser.
grep -c 'SiteChromeQuery' tests/mocks/handlers.ts
# Expected: 2 — the type import and the handler's type argument. A 0 means the
#           handlers are untyped and check 7 can never fire.
grep -c 'as ' tests/mocks/handlers.ts
# Expected: 0. One cast silences exactly the signal this file exists to produce.

# 8. NEGATIVE — no test in this suite queries by class, structure or a test id
grep -rnE "querySelector|\.className|getByTestId|nth-child|firstChild|closest\(" \
  src --include='*.test.ts' --include='*.test.tsx'
# Expected: no output. Every query goes through the accessibility tree —
#           getByRole, getByLabelText, getByText. A structural query would also pass
#           on a <div onClick>, which is precisely the state RTL exists to make
#           untestable. Lesson 23.7 turns the same rule into an ESLint error for e2e/.

# 9. NEGATIVE — no snapshot of rendered markup, anywhere. Lesson 12.1 banned it and
#    Lesson 23.1 §10 restates the ban now that the temptation is real.
grep -rn 'toMatchSnapshot\|toMatchInlineSnapshot\|asFragment' src
# Expected: no output. `render(...).asFragment()` is the RTL doorway to a 400-line
#           Tailwind diff nobody reads and everybody approves.

# 10. Coverage now sees the components, and Lesson 12.2's 0% row is closed
npm run test:coverage 2>&1 | grep -E 'client.ts|IncidentFilters|MobileNav|LocaleSwitcher'
# Expected: a row for src/lib/graphql/client.ts with a NON-ZERO figure. Lesson 12.2
#           Step 8 recorded it at 0% and said "Lesson 23.2 covers it with MSW".
npm run test:coverage 2>&1 | grep -c 'src/gql'
# Expected: 0 — the coverage `include` still keeps twelve thousand generated lines
#           out of the table
test -f coverage/index.html && echo "html report present"
# Expected: html report present

# 11. NEGATIVE — the counterweight for the `server-only` alias. The guard is inert in
#     tests now, so a grep has to do the job the runtime used to do.
grep -rln "from '@/lib/graphql/client'\|from '@/lib/auth/" src --include='*.test.ts' --include='*.test.tsx'
# Expected: exactly one file, src/lib/graphql/client.test.ts, which imports the
#           client because the client IS the subject. Any other test importing a
#           server-only module is importing a module that reads a token, in a process
#           where nothing will stop it.
grep -rnE 'WP_APP_TOKEN|GRAPHQL_JWT_AUTH_SECRET_KEY|REVALIDATE_SECRET|E2E_SECRET' \
  src --include='*.test.ts' --include='*.test.tsx'
# Expected: one hit only — the `WP_APP_TOKEN` key in client.test.ts's ENV object,
#           whose VALUE is `randomUUID()` generated at run time. No test file may
#           contain a literal token, and `__CHANGE_ME__` is the only placeholder
#           permitted anywhere in a tracked file.

# 12. NEGATIVE — nothing in the mocks reaches a real network
grep -rn 'http://localhost:8080\|host.docker.internal' tests/mocks/
# Expected: no output. Handlers match by operation name and by a `*`-prefixed path,
#           so the fake never needs to know a real origin. An absolute WordPress URL
#           in a handler is a handler that stops matching the moment the endpoint
#           moves — and a suite that quietly needs Docker.

# 13. The compiler and linter are clean, including all four new files
npm run type-check && npm run lint
# Expected: no output from either. `no-floating-promises` is at `error`, so a missing
#           `await` on a `user.click(...)` fails the LINT rather than the test.

# 14. Everything this lesson touched, and nothing it did not
git status --short
# Expected: seven new files —
#             next-app/tests/mocks/handlers.ts
#             next-app/tests/mocks/server.ts
#             next-app/tests/mocks/server-only.ts
#             next-app/src/components/incidents/IncidentFilters.test.tsx
#             next-app/src/components/layout/MobileNav.test.tsx
#             next-app/src/components/layout/LocaleSwitcher.test.tsx
#             next-app/src/lib/graphql/client.test.ts
#           plus MODIFIED vitest.config.ts, package.json and package-lock.json.
#           NOT playwright.config.ts, NOT anything under e2e/ — those are Lesson
#           23.6's, and a diff touching them is a merge conflict waiting to happen.
```

Check 1 is the one to read properly, and check 6 is the one that will teach you something. Run
check 6 twice — once with the typo in place and once restored — so you have seen both the
failure and the message. An unmocked request that *warns* is the quietest way for a component
test suite to stop testing the thing it names.


## Control Questions

1. `include: ['src/**/*.test.ts']` would have left `IncidentFilters.test.tsx` uncollected while
   the suite reported nine of nine passing. Describe the sequence of events by which that reaches
   production — who sees what, at which stage — and name the single line of output that would
   have revealed it. Then say why "the suite is green" is a weaker claim than most people hear.
2. This lesson keeps `environment: 'node'` as the default and opts into jsdom with a per-file
   docblock. A colleague proposes `environment: 'jsdom'` globally, arguing that it is one line
   instead of one line per file. Give the two concrete costs, name the lesson that would break
   first, and identify the property of the per-file form that a global setting cannot have.
3. `vi.mock('@/lib/graphql/client')` and MSW would both make a component test pass. Name three
   defects MSW can catch that `vi.mock` structurally cannot, then name one situation in this
   codebase where `vi.mock` is nonetheless the correct tool and say what makes it correct there.
4. Twenty-one files in this application carry `'use client'` and exactly one issues a network
   request. Explain what makes that true — the specific mechanism, not "good architecture" — and
   then argue whether MSW earns its place in this repository at all. If your answer is yes, name
   its consumers; if no, say what you would delete and what you would lose.
5. `IncidentFilters` is asserted with `queryByRole('combobox', { name: 'Blamed on' })` returning
   `null`, and `IncidentBrowser`'s live region is asserted with `getByRole('status')`. Each of
   those depends on work in a *different* lesson. Say which lesson each depends on, what happens
   to the test if that lesson made a different choice, and whether an assertion that constrains
   another lesson's markup is a strength or a coupling problem.


## Learn More

- [Testing Library — Guiding Principles](https://testing-library.com/docs/guiding-principles) —
  the one paragraph the whole library follows from, and the source of Key Concept 1's argument
  that inaccessible markup becomes untestable
- [Testing Library — About Queries](https://testing-library.com/docs/queries/about) — the
  priority order (`getByRole` first, `getByTestId` last and only as an escape hatch) and the
  `getBy`/`queryBy`/`findBy` table from Key Concept 2, in the maintainers' own words
- [Testing Library — `ByRole`](https://testing-library.com/docs/queries/byrole) — how the
  accessible name is computed, and the `hidden` option that decides whether an `aria-hidden`
  honeypot field is findable at all
- [`user-event` — Introduction](https://testing-library.com/docs/user-event/intro) — the event
  sequence a real click produces, and why v14 is async; read the `pointer-events` and
  `advanceTimers` sections before you write a fake-timer test
- [MSW — Getting started](https://mswjs.io/docs/getting-started) — the v2 API. Skim it once so
  the v1 `rest.get(req, res, ctx)` examples you will inevitably find are recognisable as obsolete
- [MSW — GraphQL handlers](https://mswjs.io/docs/network-behavior/graphql) — operation-name
  matching, `graphql.operation()` for a catch-all, and how a handler declares its result type
- [MSW — `onUnhandledRequest`](https://mswjs.io/docs/api/setup-server/listen) — the four possible
  values and what each does; the argument for `'error'` is in the paragraph about silent passthrough
- [Vitest — test environment](https://vitest.dev/guide/environment.html) — the `@vitest-environment`
  docblock, and the note that `environmentMatchGlobs` is deprecated in favour of `projects`
- [jsdom — Unimplemented parts of the web platform](https://github.com/jsdom/jsdom#unimplemented-parts-of-the-web-platform)
  — the authoritative list behind "jsdom is a lie about a browser": no layout, so no real
  visibility, no scrolling and no `getBoundingClientRect`

