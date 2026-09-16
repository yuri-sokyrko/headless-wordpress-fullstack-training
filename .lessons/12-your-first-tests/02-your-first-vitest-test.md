---
title: 'Your First Vitest Test'
module: 12
lesson: 2
teaches: [vitest, unit-testing, esm-test-runner, pure-functions, test-colocation, coverage]
produces: ['next-app/vitest.config.ts', 'next-app/src/lib/graphql/tags.test.ts', 'next-app/src/lib/graphql/errors.test.ts', 'next-app/src/types/content.test.ts', 'next-app/src/components/layout/nav.test.ts', 'next-app/src/components/incidents/IncidentList.test.ts']
requires: [12.1, 10.3, 10.4]
---

# Lesson 12.2 — Your First Vitest Test

## Quick Overview

A unit test is a function that calls your function and asserts something about the result.
That is the entire concept, and the whole of this lesson's novelty is in the plumbing around
it: where the file lives, how the runner finds it, what a good assertion looks like, and how
to read a failure. You will start with the two most testable modules in the repo — the cache-tag
builders from Lesson 10.3 and the error mapper from Lesson 10.4 — because both are pure
functions, and pure functions are where unit tests pay for themselves immediately.

**Vitest, not Jest**, and the reason is concrete rather than fashionable. This project is
native ESM end to end, and two dependencies it will acquire — `next-intl` in Module 20 and MSW
v2 in Module 23 — publish ESM only. Jest would need a Babel or SWC transform pipeline
configured, maintained and debugged in order to import them, and that pipeline is a permanent
tax paid to make a test runner accept modern JavaScript. Vitest reads your `tsconfig.json`
paths, understands ESM natively, and shares Vite's transform pipeline. The lesson also teaches
the part most tutorials skip: making a test fail on purpose, reading the diff output, and
noticing that a test you have never seen fail is not yet a test.

By the end of this lesson you will have:

- `next-app/vitest.config.ts` with the `@/*` path alias resolving and a `node` test environment
- `next-app/src/lib/graphql/tags.test.ts` — tags asserted against the exact strings Module 18's webhook will send
- `next-app/src/lib/graphql/errors.test.ts` — including the HTTP-200-with-`errors` case from Lesson 10.4
- `npm test` and `npm run test:watch` scripts, plus coverage reporting configured but not yet gated
- One test broken on purpose, its failure output read, and the code fixed rather than the assertion

## Classic WP Analogy

You have already written unit tests. They were called `test.php` and you deleted them
afterwards:

| What you did in WordPress | What a unit test is |
|---|---|
| A scratch `test.php` you hit in the browser | a test file, saved and named |
| `wp eval 'var_dump(btt_blame_score(3, 90));'` | `expect(blameScore(3, 90)).toBe(…)` |
| `error_log(print_r($result, true))` then reload | an assertion the runner checks for you |
| "let me try it with an empty value" | a second `it()` case |
| Running it once, then never again | the runner running it on every change |
| PHPUnit, if you were disciplined | Vitest — Module 23 adds Pest on the PHP side |

The instinct is already correct. When you `wp eval` a function with three different inputs to
see what it does, you are unit testing. The only things missing are that nobody else can run
it, nothing tells you when it stops being true, and the expected answer lives in your head
rather than in the file.

The analogy breaks on **isolation**, and it is the break that changes how you write code. Your
`wp eval` runs inside a booted WordPress with a real database, so it can call anything —
`get_post()`, `get_option()`, a REST endpoint — and it works. A unit test cannot: there is no
WordPress, no database, no network, and no server. If a function needs any of those, it cannot
be unit tested without mocking, and mocking is expensive enough that the better answer is
usually to restructure the function so the impure part is somewhere else. That constraint is
the actual benefit of this lesson. `incidentTag(slug)` is trivially testable because it
takes a string and returns a string; the reason it takes a string and returns a string is
partly that Lesson 10.3 was written by someone who knew this lesson was coming.

The second break: `wp eval` runs against your real content, so it tests your data as much as
your code. A unit test that touches real data is not a unit test — it is a slow, flaky
integration test, and it will fail on a colleague's machine for reasons that have nothing to do
with the code. Anything genuinely needing WordPress goes to Playwright (Lesson 12.3) or to the
PHP integration suite in Module 23. Knowing which of the three a given test belongs in is the
scope table you wrote in Lesson 12.1.

---

## Key Concepts

### 1. What a test runner actually does

Four phases, and knowing which one you are in tells you which config key is wrong.

```
   COLLECT              TRANSFORM             RUN                  REPORT
   ──────────           ──────────            ──────────           ──────────
   glob the             each file through     each `it()` in a      diff, frame,
   `include`            Vite: TS erased,      worker; `expect`      file:line,
   patterns             `@/…` resolved,       throws on a           exit code
        │               JSX compiled          failed match
        │                    │                    │                    │
   include/exclude      resolve.alias        environment          reporter
   (Key Concept 4)      (Key Concept 5)      (Key Concept 6)
```

The transform phase is the one Jest makes you build and Vitest inherits. Vitest **is** a Vite
application: the same esbuild pass that strips types for `npm run dev`, the same
`resolve.alias`, the same module graph. That is why watch mode is instant — a changed file
invalidates one node in a graph that is already in memory — and it is why the config in this
lesson is twenty lines rather than a `transform` object, a `moduleNameMapper` and a Babel
preset.

Two consequences worth holding on to. First, **a failure in the collect or transform phase looks
nothing like a failed assertion**: you get `Cannot find module '@/lib/graphql/tags'` or a syntax
error, and the fix is in `vitest.config.ts`, not in your test. Second, `tsc` is not in that
pipeline at all. esbuild *erases* types; it does not check them. `npm run test:run` can be green
while `npm run type-check` fails, which is exactly why both run in Verification and both run in
CI.

### 2. `describe`, `it`, `expect`, and picking a matcher you can read

```ts
// (illustration) src/lib/graphql/tags.test.ts — the anatomy, not the real file
describe('incidentTag', () => {          // a group; the name prefixes every failure
  it('prefixes the slug with the type', () => {   // one behaviour
    const tag = incidentTag('incident-01');       // arrange + act
    expect(tag).toBe('incident:incident-01');     // assert
  });
});
```

`describe` groups, `it` names one behaviour, `expect` throws. Nothing else is required. This
course imports all three explicitly from `vitest` rather than enabling `globals: true`: the
project is native ESM and `import { it } from 'vitest'` is a real import that your editor, your
linter and `tsc` all resolve, whereas a global needs `types: ['vitest/globals']` in
`tsconfig.json` — a fourth place to keep in sync for the benefit of saving one line per file.

The matcher is not a style choice. It decides what you can read when the test fails.

| Matcher | Compares | Reach for it when | Failure output |
|---|---|---|---|
| `toBe` | `Object.is` — identity | strings, numbers, booleans, the same object | `expected 'incident:x' to be 'incident-x'` |
| `toEqual` | deep structural equality, ignoring `undefined` properties | objects and arrays | a **diff**, with only the differing keys marked |
| `toStrictEqual` | deep, and `undefined` keys and class identity count | you care that a key is absent rather than `undefined` | same diff, stricter |
| `toContain` | membership / substring | "the string mentions this" | prints the haystack |
| `toThrow(msg)` | that the callback threw, and the message contains `msg` | error paths — Key Concept 8 | `expected function to throw` |
| `toHaveLength` | `.length` | arrays where the count is the point | `expected length 3 to be 4` |

Two traps in that table. `toBe` uses `Object.is`, so `expect(0).toBe(-0)` **fails** — which
matters the moment you assert on a comparator's return value, as `content.test.ts` does. And
`toThrow` passing a string means *substring of the message*, not equality: `toThrow('empty
slug')` matches `cache tag: empty slug — the caller has nothing to tag with`, which is what you
want, because pinning the whole sentence makes the test fail when someone improves the wording.

The verdict: **one `toEqual` on a small object beats five `toBe`s.** Five assertions stop at the
first failure and tell you about one value; one structural assertion prints every difference at
once. `tags.test.ts` uses that deliberately for the five contract strings.

### 3. Reading a failure is the skill

Most testing tutorials show you green. Green teaches nothing. Here is what a real failure
carries, and what each part is for:

```
 FAIL  src/lib/graphql/tags.test.ts > node tags > prefixes the slug with the type
AssertionError: expected 'incident-incident-01' to be 'incident:incident-01'

- Expected
+ Received

- incident:incident-01
+ incident-incident-01

 ❯ src/lib/graphql/tags.test.ts:14:29
     12|   it('prefixes the slug with the type', () => {
     13|     const tag = incidentTag('incident-01');
     14|     expect(tag).toBe('incident:incident-01');
       |                             ^
```

| Part | Reads as | What you do with it |
|---|---|---|
| `FAIL <file> > <describe> > <it>` | the full path to the behaviour | this is why `it()` names are sentences |
| `AssertionError: expected … to be …` | one line you can paste into a message | decide immediately whether the code or the assertion is wrong |
| `- Expected / + Received` | the diff | on an object, this is the whole answer |
| `❯ file:line:column` + frame | the assertion that threw, with a caret | jump straight there |

Then the fork in the road, and it is the whole reason Step 7 exists: **when a test fails, fix
the code, not the assertion.** Changing the expectation until it matches the output is not
testing; it is transcription. The only honest reason to edit an assertion is that you can say
out loud what the correct behaviour is and why the assertion described something else.

### 4. `include` and `exclude`, or Vitest eats your Playwright specs

This is the load-bearing config trap in the module, and it costs an afternoon if you meet it
by accident.

Vitest's default `include` is `**/*.{test,spec}.?(c|m)[jt]s?(x)`. Read it: **`.spec.ts` counts,
and so does every directory.** Lesson 12.3 creates `e2e/smoke.spec.ts`, which imports `test`
and `expect` from `@playwright/test`. Vitest would collect it, import it, and Playwright's
`test` would throw `Playwright Test did not expect test() to be called here` — a message about
Playwright, in the output of Vitest, in a file you were not running.

```
   DEFAULT include                          THIS PROJECT
   ─────────────────────────────────        ─────────────────────────────────
   **/*.{test,spec}.[jt]s?(x)               include: ['src/**/*.test.ts']
        │                                   exclude: ['e2e/**', …]
        ├─ src/lib/graphql/tags.test.ts ✅        │
        └─ e2e/smoke.spec.ts           ❌        └─ src/lib/graphql/tags.test.ts ✅
             imports @playwright/test                  e2e/ never collected
```

Two rules follow, and they are the ones to remember rather than the globs:

- **`.test.ts` is Vitest. `.spec.ts` is Playwright.** One convention, enforced by `include`, so
  the file extension tells you which runner owns a file before you open it.
- **Overriding `exclude` replaces Vitest's default list**, it does not extend it — so
  `node_modules/**` has to be restated. Forgetting that is how a runner starts trying to execute
  a dependency's own test files.

Verification proves the negative before `e2e/` exists (`npx vitest run e2e` finds nothing), and
Lesson 12.3 re-proves it after the spec is written. Two checks for one line of config, because
this is the failure mode that makes people delete a config they do not understand.

### 5. The alias, and why a test runner has to be told about `paths`

Every import in this project since Lesson 08.1 is `@/…`. That alias is declared in
`tsconfig.json` under `paths`, and `paths` is a **type-checker** instruction. It tells `tsc`
where to look when it resolves a specifier. It does not change what any runtime does.

```
   tsconfig.json  paths: { "@/*": ["./src/*"] }   ──▶  tsc / your editor
   next.config.ts + the Next compiler             ──▶  next dev, next build
   scratch/vite.config.ts  resolve.alias          ──▶  the Module 08 harness
   vitest.config.ts        resolve.alias          ──▶  this lesson
```

Four tools, four places, one truth. Next reads `paths` for you, which is exactly why the
requirement is easy to forget: the app works, so the alias "obviously" works, and then a test
run fails with `Cannot find module '@/lib/graphql/tags'` and you go looking in the test file.

The course declares the alias **by hand** rather than installing `vite-tsconfig-paths`, and it
is a deliberate trade: one extra dependency, forever, in exchange for four lines you write once.
Lesson 08.1's `scratch/vite.config.ts` did the same thing for the same reason, and the payoff is
that "the bundler owns resolution, the compiler owns types" stops being an abstract statement
you have read and becomes a line you maintain. The cost is real: add a second alias to
`tsconfig.json` and you must remember two more files.

### 6. `environment: 'node'`, and no jsdom

Vitest can give a test a fake DOM (`environment: 'jsdom'` or `'happy-dom'`). This project sets
`'node'` and means it.

| | `node` | `jsdom` |
|---|---|---|
| Startup per file | fastest | noticeably slower |
| `document`, `window` | absent | present, and **not a browser** |
| Suits | pure functions, `lib/`, server code | component tests |
| Failure mode | an honest `document is not defined` | a test that passes in jsdom and breaks in Safari |

Every function in this lesson is pure: strings in, strings out, no `document`, no `fetch`, no
`window`. Giving them a fake DOM would buy nothing and cost startup time on every run.

The stronger argument is about trust. **jsdom is a lie about a browser** — a JavaScript
reimplementation of a DOM with no layout engine, so it has no real notion of visibility,
scrolling, focus rings or `getBoundingClientRect`. A "the modal is visible" assertion in jsdom
means "the element is in a tree", which is not the claim you wanted to make. Anything that
depends on rendering goes to Playwright, in a real Chromium, in Lesson 12.3. Component testing
with React Testing Library and MSW arrives in Lesson 23.2, where jsdom is the correct tool for
a narrower job than people usually give it.

### 7. Pure, impure, and the reason `import 'server-only'` is missing on purpose

A unit test runs in a plain Node process. That constrains what is testable, and the constraint
is the useful part.

| Module | Pure? | Testable in Node | Why |
|---|---|---|---|
| `src/lib/graphql/tags.ts` | ✅ | ✅ this lesson | string in, string out |
| `src/lib/graphql/errors.ts` | ✅ | ✅ this lesson | data mapping, one class |
| `src/types/content.ts` | ✅ | ✅ this lesson | constants and a comparator |
| `src/components/layout/nav.ts` | ✅ | ✅ this lesson | two mappers, no React |
| `src/lib/graphql/client.ts` | ❌ | no | `fetch`, env vars, `import 'server-only'` |
| any `async` Server Component | ❌ | no | Lesson 23.1's RSC rule; Playwright covers it |

Now the detail that looks like an inconsistency and is not. `client.ts` opens with
`import 'server-only'`. `tags.ts` and `errors.ts` deliberately do not — and Lesson 10.3 and
Lesson 10.4 both say so in a comment at the top of the file, so that nobody "tidies" it later.

`server-only` is a package whose entire job is to throw when it is resolved outside React's
`react-server` condition. That is precisely what protects `client.ts`, which holds an endpoint
and a token: import it into a Client Component and the build fails. It is also precisely what
would make these two files **untestable in plain Node**, because a Vitest worker is not a
`react-server` environment, and the import would throw before a single test ran.

> **The house rule names files, not directories.** "Everything in `src/lib/` is server-only"
> would be tidier and would cost you the two most valuable unit tests in the repo. The guard
> belongs on the modules that hold a secret or perform I/O, and `tags.ts` holds neither: it is
> pure string manipulation whose output is a **contract between the code that attaches a tag and
> the code that expires it**, and a contract you cannot assert cheaply is a contract that drifts.

### 8. Test the throw, not just the return

`segment()` in `tags.ts` has two error paths, and they exist because of what happens downstream
if they do not:

| Input | Without the throw | With the throw |
|---|---|---|
| `''` | the tag `incident:` — attaches to the entry, matches nothing on invalidation, reports success | an exception at the call site, in your build output |
| `'incident:01'` | the tag `incident:incident:01`, which nothing will ever expire | an exception naming the offending slug |

Both failures are silent, permanent and look exactly like a caching bug from the outside. So the
tests that pin them are not "edge cases" — they are the two most important assertions in
`tags.test.ts`, because Module 18 adds a second caller — the revalidation route — and *these two*
are the paths where the attaching side and the expiring side are most likely to disagree.

`expect(() => fn()).toThrow('substring')` is the shape. The callback matters: `expect(fn())`
would call the function while building the argument, the exception would escape `expect`
entirely, and the test would fail as an error rather than pass as an assertion — with a message
that does not mention `toThrow`.

### 9. Assert the invariant, not the literal

There are two ways to test the severity ordering from `src/types/content.ts`:

```ts
// (illustration) src/types/content.test.ts
// ❌ transcription — passes, proves nothing, breaks on every legitimate edit
expect(SEVERITY_ORDER).toEqual(['s1-catastrophic', 's2-major', 's3-minor', 's4-cosmetic']);

// (illustration) ✅ the properties the rest of the app actually relies on
expect(SEVERITY_ORDER).toHaveLength(4);
expect(new Set(SEVERITY_ORDER).size).toBe(SEVERITY_ORDER.length);
expect([...SEVERITY_ORDER].sort()).toEqual(Object.keys(SEVERITY_LABEL).sort());
```

The first restates the source file in a second location. It fails if a fifth severity is
introduced — which is a change you *meant* — and it passes if `compareSeverity` is broken.

The invariants are the interesting statements: the order is a **permutation of the labelled
set** with no duplicates and nothing missing, and `compareSeverity` is a **total order**
(antisymmetric, transitive, and `0` only for equal levels). Those hold for any correct ordering
of any number of severities, so they survive a legitimate change and fail on a real bug. Lesson
10.2's argument is why this file exists at all — codegen owns the shape of a response, you still
own the closed sets that live in your *data*, because WPGraphQL types a term slug as `String` and
no amount of code generation will ever narrow it.

### 10. Arrange, act, assert — and one behaviour per `it()`

```
   it('rejects a slug containing the separator', () => {
        ARRANGE   const slug = 'incident:01';        ← inputs, nothing else
        ACT       const call = () => incidentTag(slug);
        ASSERT    expect(call).toThrow('contains ":"');
   });
```

The rule that does the work is **one behaviour per `it()`**, and the reason is the failure
output rather than purity. A test named `works` with nine assertions stops at the first failure
and tells you that `works` is broken. Nine tests with sentence names tell you exactly which
property broke, and — because the runner reports the passing eight — exactly which properties
still hold. That difference is worth more than the keystrokes.

Two related habits this module follows:

- **No logic in a test.** No `if`, no `try`, no computing the expected value with the same
  function you are testing. A loop over a fixed table is fine; a branch is a second test
  pretending to be one.
- **`noUncheckedIndexedAccess` applies to tests too.** `SEED_INCIDENTS[0]` is
  `Incident | undefined`, and the answer is a three-line `nth()` helper that throws with a
  readable message, not a `!`. A test that throws "fixtures are empty" tells you the real
  problem; a test that crashes on `undefined.title` does not.

---

## Task

### Step 1: Check the licences, then install two dev dependencies

```bash
cd next-app

npm view vitest license
# Expected: MIT
npm view @vitest/coverage-v8 license
# Expected: MIT
```

Both permissive, both fine for an MIT project. Install them as dev dependencies — nothing here
ships to a browser:

```bash
npm install --save-dev vitest@^3 @vitest/coverage-v8@^3
```

> **The two majors must match.** `@vitest/coverage-v8` is versioned in lockstep with `vitest`
> and declares it as a peer. A `vitest@3` with a `coverage-v8@2` fails at the moment you ask for
> coverage, with a peer-dependency message that does not obviously mean "these two numbers must
> agree". Upgrade them in one commit, always.

**Verify §1:**

- [ ] `npm pkg get devDependencies` lists both, and `npm pkg get dependencies` lists neither.
- [ ] `npx vitest --version` prints a `3.x` version.

### Step 2: Write `vitest.config.ts` and the four npm scripts

```ts
// next-app/vitest.config.ts
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The alias tsconfig.json declares in `paths`. `paths` is a TYPE-CHECKER
    // instruction — it tells tsc where to look and changes no runtime. Next reads
    // it for the app; Vitest has to be told separately. Key Concept 5.
    //
    // Declared by hand rather than with vite-tsconfig-paths: one fewer dependency,
    // and the same choice Lesson 08.1 made in scratch/vite.config.ts.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  esbuild: {
    // tsconfig.json says `jsx: "preserve"` (Lesson 09.1) because NEXT compiles JSX.
    // There is no Next compiler in a Vitest run, so the test transform needs the
    // automatic runtime — otherwise importing IncidentList.tsx in Step 6 fails with a
    // syntax error on the first `<`. Same principle as the alias above: one truth,
    // stated once per tool.
    jsx: 'automatic',
  },

  test: {
    // No DOM. Every function tested here is pure, and jsdom is a lie about a
    // browser — Key Concept 6. Component tests arrive in Lesson 23.2.
    environment: 'node',

    // COLOCATED and narrow. The default include is
    // `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which would collect Lesson 12.3's
    // e2e/smoke.spec.ts and blow up on Playwright's `test` import. Key Concept 4.
    include: ['src/**/*.test.ts'],

    // Overriding `exclude` REPLACES Vitest's defaults rather than extending them,
    // so node_modules has to be restated. e2e/ is the one that matters.
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],

    coverage: {
      provider: 'v8',
      // `text` for the terminal, `html` for coverage/index.html — the clickable
      // report where you read which BRANCH was never taken.
      reporter: ['text', 'html'],

      // Explicit, because tests are colocated: without an `include`, coverage
      // reports on src/gql/ (generated, 12k lines, 0%) and drowns the signal.
      // Lesson 23.2 widens this when component tests exist.
      include: [
        'src/lib/**/*.ts',
        'src/types/**/*.ts',
        'src/components/layout/nav.ts',
        'src/components/incidents/*.tsx',
      ],
      exclude: ['**/*.test.ts'],

      // NO thresholds. Deliberate, and argued in Step 8: a number attached
      // before anyone has read the report is a number
      // people learn to game. Lesson 23.1 sets the policy; Lesson 24.5 gates it,
      // on the patch rather than the total.
    },
  },
});
```

Then the scripts. The quoted `npm pkg set` form, so the value lands in `package.json` exactly as
written:

```bash
npm pkg set "scripts.test=vitest"
npm pkg set "scripts.test:run=vitest run"
npm pkg set "scripts.test:watch=vitest --watch"
npm pkg set "scripts.test:coverage=vitest run --coverage"
npm pkg get scripts
```

`npm test` is **watch mode**, because `vitest` with no arguments watches when it detects a TTY.
`test:watch` is therefore redundant as a command and useful as a name: it is the spelling people
reach for, and it says out loud what `npm test` does. `test:run` is the single-pass form CI and
every `## Verification` block in this course use — a watching runner in CI never exits.

**Verify §2:**

- [ ] `npm pkg get scripts.test` prints `"vitest"` — not `"vitest run"`. Module 13's Starting
      State runs `npm test -- --run`, which only works if `test` is the bare binary.
- [ ] `npm run type-check` is silent. `vitest.config.ts` is inside `tsconfig.json`'s `include`
      (Lesson 09.1 widened it to `**/*.ts`), so it is type-checked like any other file.

### Step 3: Write `tags.test.ts` — the strings Module 18's webhook has to expire

```ts
// next-app/src/lib/graphql/tags.test.ts
import { describe, expect, it } from 'vitest';

import {
  incidentTag,
  listTag,
  menuTag,
  pageTag,
  postTag,
  reviewTag,
  siteTag,
  taxonomyListTag,
  termTag,
} from '@/lib/graphql/tags';

describe('node tags', () => {
  it('prefixes the slug with the singular type', () => {
    expect(incidentTag('incident-01')).toBe('incident:incident-01');
    expect(postTag('blog-01')).toBe('post:blog-01');
    expect(reviewTag('review-01')).toBe('review:review-01');
    expect(pageTag('hobt')).toBe('page:hobt');
  });

  it('puts the locale in the middle, not at the end', () => {
    // type:locale:slug. Module 20 sends this shape; nothing does today, which is
    // exactly why it needs a test now.
    expect(incidentTag('incident-01', 'de')).toBe('incident:de:incident-01');
  });

  it('trims and lowercases the slug, because a slug is editorial input', () => {
    expect(incidentTag('  Incident-01  ')).toBe('incident:incident-01');
  });

  it('accepts a non-Latin slug — there is no ASCII allowlist', () => {
    // Module 20 adds uk and de, where slugs are legitimately not Latin. A test
    // pinning this is what stops someone "hardening" segment() with /^[a-z0-9-]+$/.
    expect(incidentTag('відмова-системи')).toBe('incident:відмова-системи');
  });
});

describe('segment() rejects what PHP could never reproduce', () => {
  it('throws on an empty slug rather than producing "incident:"', () => {
    expect(() => incidentTag('')).toThrow('cache tag: empty slug');
  });

  it('throws on a whitespace-only slug', () => {
    expect(() => incidentTag('   ')).toThrow('cache tag: empty slug');
  });

  it('throws when the slug contains the separator', () => {
    expect(() => incidentTag('incident:01')).toThrow('contains ":"');
  });
});

describe('listTag', () => {
  it('takes the SINGULAR type and returns the plural tag', () => {
    expect(listTag('incident')).toBe('incidents');
    expect(listTag('post')).toBe('posts');
    expect(listTag('review')).toBe('reviews');
    expect(listTag('page')).toBe('pages');
  });

  it('appends the locale to a list tag rather than infixing it', () => {
    expect(listTag('incident', 'en')).toBe('incidents:en');
  });

  it('makes the plural a COMPILE error, not a runtime one', () => {
    // @ts-expect-error listTag takes the singular type; 'incidents' is its output.
    const wrong = listTag('incidents');

    // And here is why the compile error matters: at runtime the lookup misses and
    // you get `undefined`, which stringifies into the tag "undefined" and matches
    // nothing. The type system is the only thing standing between you and that.
    expect(wrong).toBeUndefined();
  });
});

describe('taxonomyListTag', () => {
  it('pluralises a taxonomy without inventing a word', () => {
    // `severities`, not `severitys` — which is why the map is spelled out
    // rather than derived by appending an `s`.
    expect(taxonomyListTag('scapegoat')).toBe('scapegoats');
    expect(taxonomyListTag('severity')).toBe('severities');
    expect(taxonomyListTag('stack')).toBe('stacks');
  });

  it('appends the locale, like listTag and unlike a node tag', () => {
    expect(taxonomyListTag('scapegoat', 'de')).toBe('scapegoats:de');
  });

  it('does not accept a ContentType, and listTag does not accept a taxonomy', () => {
    // @ts-expect-error taxonomyListTag takes a TaxonomyName, not a ContentType.
    taxonomyListTag('incident');
    // @ts-expect-error and the mirror image — this is the pair that caught a
    // real type error in Lesson 16.2's termAllowlist().
    listTag('scapegoat');
  });
});

describe('term, site and menu tags', () => {
  it('shortens tech_stack to `stack`, so the tag is not the taxonomy name', () => {
    expect(termTag('stack', 'react')).toBe('stack:react');
  });

  it('builds severity and scapegoat term tags', () => {
    expect(termTag('severity', 's1-catastrophic')).toBe('severity:s1-catastrophic');
    expect(termTag('scapegoat', 'the-intern')).toBe('scapegoat:the-intern');
  });

  it('has one tag for the whole SCF options page and one per menu location', () => {
    expect(siteTag()).toBe('site-settings');
    expect(menuTag('primary')).toBe('menu:primary');
  });
});

describe('the contract with Module 18', () => {
  it('produces the exact five strings the PHP webhook must rebuild', () => {
    // ONE structural assertion instead of five `toBe`s: five toBe's stop at the
    // first failure, this prints every difference at once. Key Concept 2.
    expect({
      node: incidentTag('incident-01'),
      list: listTag('incident'),
      term: termTag('severity', 's1-catastrophic'),
      site: siteTag(),
      menu: menuTag('primary'),
    }).toEqual({
      node: 'incident:incident-01',
      list: 'incidents',
      term: 'severity:s1-catastrophic',
      site: 'site-settings',
      menu: 'menu:primary',
    });
  });
});
```

```bash
npm run test:run
```

**Verify §3:**

- [ ] 14 tests in 1 file, all passing.
- [ ] `npx vitest run -t "compile error"` runs exactly one test. That `-t` filter is the fastest
      debugging tool in the runner and it is worth knowing before you need it.

### Step 4: Write `errors.test.ts`, including the assertion that is about security

```ts
// next-app/src/lib/graphql/errors.test.ts
import { describe, expect, it } from 'vitest';

import {
  GraphQLRequestError,
  categoryOf,
  formatGraphQLErrors,
  isGraphQLRequestError,
} from '@/lib/graphql/errors';
import type { GraphQLErrorEntry } from '@/lib/graphql/errors';

// `verbatimModuleSyntax` (Lesson 07.3) is why the type import above is separate.

const userError: GraphQLErrorEntry = {
  message: 'Sorry, you are not allowed to create incidents.',
  path: ['createIncident', 'incident'],
  extensions: { category: 'user' },
};

const internalError: GraphQLErrorEntry = {
  // No `path`. WPGraphQL omits it for an error raised before resolution starts.
  message: 'Internal server error',
  extensions: { category: 'internal' },
};

const validationError: GraphQLErrorEntry = {
  message: 'Cannot query field "downtimeMinutes" on type "Incident".',
  // Offsets into YOUR query text. The formatter must never emit these.
  locations: [{ line: 12, column: 7 }],
  extensions: { category: 'graphql' },
};

describe('formatGraphQLErrors', () => {
  it('says something rather than nothing for an empty array', () => {
    // An empty log line is worse than a useless one: you cannot search for it.
    expect(formatGraphQLErrors([])).toBe('no error detail');
  });

  it('formats one entry as [category] at path message', () => {
    expect(formatGraphQLErrors([userError])).toBe(
      '[user] at createIncident.incident Sorry, you are not allowed to create incidents.'
    );
  });

  it('omits the " at …" fragment entirely when there is no path', () => {
    expect(formatGraphQLErrors([internalError])).toBe('[internal] Internal server error');
  });

  it('also omits it for an empty path array', () => {
    expect(formatGraphQLErrors([{ message: 'x', path: [] }])).toBe('[unknown] x');
  });

  it('joins multiple entries with " | "', () => {
    expect(formatGraphQLErrors([internalError, userError])).toBe(
      '[internal] Internal server error | ' +
        '[user] at createIncident.incident Sorry, you are not allowed to create incidents.'
    );
  });

  it('NEVER includes `locations` — they are offsets into your query text', () => {
    // This is a security assertion, not a formatting one. This string is logged,
    // and from Module 24 it is shipped to Sentry. `locations` would put fragments
    // of your own query shape into a third-party log.
    const formatted = formatGraphQLErrors([validationError]);

    expect(formatted).toBe('[graphql] Cannot query field "downtimeMinutes" on type "Incident".');
    expect(formatted).not.toContain('column');
    expect(formatted).not.toContain('12');
  });
});

describe('categoryOf', () => {
  it('passes through the three categories WPGraphQL actually sets', () => {
    expect(categoryOf(userError)).toBe('user');
    expect(categoryOf(internalError)).toBe('internal');
    expect(categoryOf(validationError)).toBe('graphql');
  });

  it('returns "unknown" for a missing extensions bag', () => {
    expect(categoryOf({ message: 'x' })).toBe('unknown');
  });

  it('returns "unknown" for a category nobody recognises', () => {
    expect(categoryOf({ message: 'x', extensions: { category: 'teapot' } })).toBe('unknown');
  });
});

describe('GraphQLRequestError', () => {
  it('prefixes the operation name onto the message', () => {
    const error = new GraphQLRequestError('IncidentBySlug', 200, [userError]);

    expect(error.message.startsWith('IncidentBySlug: ')).toBe(true);
    expect(error.operationName).toBe('IncidentBySlug');
  });

  it('treats HTTP 200 with an errors array as a failure — the WPGraphQL shape', () => {
    // The single most important assertion in this file. WPGraphQL answers 200 and
    // puts the failure in `errors`, so a client that branches on response.ok
    // reports success on a permission denial. `status` is 200 AND this is an Error.
    const error = new GraphQLRequestError('CreateIncident', 200, [userError]);

    expect(error.status).toBe(200);
    expect(error).toBeInstanceOf(Error);
    expect(isGraphQLRequestError(error)).toBe(true);
  });

  it('carries the entries through untouched for a caller that wants them', () => {
    const error = new GraphQLRequestError('CreateIncident', 200, [userError]);

    expect(error.errors).toHaveLength(1);
    expect(error.errors).toEqual([userError]);
  });

  it('has a log-safe toString(): no query text, no locations, no stack', () => {
    const error = new GraphQLRequestError('IncidentBySlug', 200, [validationError]);
    const line = error.toString();

    expect(line).toBe(
      'GraphQLRequestError(IncidentBySlug, HTTP 200): ' +
        '[graphql] Cannot query field "downtimeMinutes" on type "Incident".'
    );
    expect(line).not.toContain('column');
  });

  it('narrows an unknown from a catch block, and rejects everything else', () => {
    expect(isGraphQLRequestError(new Error('plain'))).toBe(false);
    expect(isGraphQLRequestError('IncidentBySlug: nope')).toBe(false);
    expect(isGraphQLRequestError(null)).toBe(false);
  });
});
```

**Verify §4:**

- [ ] `npm run test:run` shows 2 files, 28 tests, all green.
- [ ] The empty-`path` test expects `[unknown] x`, not `[user] x`. If that surprised you, reread
      `categoryOf` — an entry with no `extensions` has no category, and the formatter says so
      rather than guessing.

### Step 5: Pin the severity ordering and the nav mappers

Two files. `content.test.ts` asserts invariants rather than literals (Key Concept 9):

```ts
// next-app/src/types/content.test.ts
import { describe, expect, it } from 'vitest';

import { SEVERITY_LABEL, SEVERITY_ORDER, compareSeverity } from '@/types/content';
import type { SeverityLevel } from '@/types/content';

describe('SEVERITY_ORDER is a permutation of the labelled set', () => {
  it('has one entry per label, with no duplicates and nothing missing', () => {
    expect(SEVERITY_ORDER).toHaveLength(4);
    expect(new Set(SEVERITY_ORDER).size).toBe(SEVERITY_ORDER.length);
    expect([...SEVERITY_ORDER].sort()).toEqual(Object.keys(SEVERITY_LABEL).sort());
  });
});

describe('compareSeverity is a total order', () => {
  it('is antisymmetric', () => {
    for (const a of SEVERITY_ORDER) {
      for (const b of SEVERITY_ORDER) {
        // Summed rather than negated: Math.sign(0) is 0 and -Math.sign(0) is -0,
        // and toBe uses Object.is, for which Object.is(0, -0) is false.
        expect(Math.sign(compareSeverity(a, b)) + Math.sign(compareSeverity(b, a))).toBe(0);
      }
    }
  });

  it('returns 0 only for equal levels', () => {
    for (const a of SEVERITY_ORDER) {
      for (const b of SEVERITY_ORDER) {
        expect(compareSeverity(a, b) === 0).toBe(a === b);
      }
    }
  });

  it('is transitive', () => {
    for (const a of SEVERITY_ORDER) {
      for (const b of SEVERITY_ORDER) {
        for (const c of SEVERITY_ORDER) {
          if (compareSeverity(a, b) <= 0 && compareSeverity(b, c) <= 0) {
            expect(compareSeverity(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });

  it('sorts the worst severity first, whatever order it started in', () => {
    const shuffled: readonly SeverityLevel[] = [
      's3-minor',
      's1-catastrophic',
      's4-cosmetic',
      's2-major',
    ];

    expect([...shuffled].sort(compareSeverity)).toEqual([...SEVERITY_ORDER]);
  });
});
```

`nav.test.ts` covers the two functions Lesson 11.3 wrote specifically so this lesson could test
them:

```ts
// next-app/src/components/layout/nav.test.ts
import { describe, expect, it } from 'vitest';

import { toLocalePath, toNavTree } from '@/components/layout/nav';

/**
 * `noUncheckedIndexedAccess` (Lesson 07.3) types items[i] as T | undefined, and it
 * is right to. Throwing here reports the real problem — "the tree has no root" —
 * instead of crashing on undefined.label three lines later.
 */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`nth(${index}): out of range, length is ${items.length}`);
  }
  return item;
}

// The five items Lesson 05.4 created by hand, in the order it created them.
// `parentId` is OMITTED rather than set to undefined: exactOptionalPropertyTypes
// is on, and "absent" is a different statement from "present and undefined".
const SEEDED_PRIMARY = [
  { id: 'mi-1', label: 'Incidents', uri: '/incidents/', order: 1 },
  { id: 'mi-2', label: 'Scapegoats', uri: '/scapegoats/', order: 2 },
  { id: 'mi-3', label: 'Reviews', uri: '/reviews/', order: 3 },
  { id: 'mi-4', label: 'Blog', uri: '/blog/', order: 4 },
  {
    id: 'mi-5',
    label: 'Catastrophic only',
    uri: '/incidents/?severity=s1-catastrophic',
    // Order 1 AT ITS OWN LEVEL. If sorting were global this would come first.
    order: 1,
    parentId: 'mi-1',
  },
] as const;

describe('toLocalePath', () => {
  it('prefixes the locale and drops WordPress trailing slashes', () => {
    expect(toLocalePath('/about/', 'en')).toBe('/en/about');
  });

  it('maps the site root to the locale root', () => {
    expect(toLocalePath('/', 'en')).toBe('/en');
  });

  it('treats empty, null and undefined as the locale root', () => {
    expect(toLocalePath('', 'en')).toBe('/en');
    expect(toLocalePath(null, 'en')).toBe('/en');
    expect(toLocalePath(undefined, 'en')).toBe('/en');
  });

  it('leaves an absolute URL alone, whatever the case of the scheme', () => {
    expect(toLocalePath('https://example.test/pricing', 'en')).toBe(
      'https://example.test/pricing'
    );
    expect(toLocalePath('HTTP://example.test', 'en')).toBe('HTTP://example.test');
  });

  it('collapses repeated leading and trailing slashes', () => {
    expect(toLocalePath('///about///', 'en')).toBe('/en/about');
  });

  it('keeps a query string, because a custom menu link may carry one', () => {
    expect(toLocalePath('/incidents/?severity=s1-catastrophic', 'en')).toBe(
      '/en/incidents/?severity=s1-catastrophic'
    );
  });
});

describe('toNavTree', () => {
  it('turns the seeded flat list into four roots and one child', () => {
    const tree = toNavTree(SEEDED_PRIMARY, 'en');

    expect(tree).toHaveLength(4);
    expect(tree.map((item) => item.label)).toEqual([
      'Incidents',
      'Scapegoats',
      'Reviews',
      'Blog',
    ]);
    expect(nth(tree, 0).children).toHaveLength(1);
    expect(nth(nth(tree, 0).children, 0).label).toBe('Catastrophic only');
  });

  it('sorts `order` per level, independently', () => {
    // The child has order 1, the same as the first root. A global sort would have
    // hoisted it; a per-level sort leaves Incidents first among the roots.
    const tree = toNavTree(SEEDED_PRIMARY, 'en');

    expect(nth(tree, 0).label).toBe('Incidents');
  });

  it('locale-prefixes every href through toLocalePath', () => {
    const tree = toNavTree(SEEDED_PRIMARY, 'en');

    expect(tree.map((item) => item.href)).toEqual([
      '/en/incidents',
      '/en/scapegoats',
      '/en/reviews',
      '/en/blog',
    ]);
  });

  it('promotes an item whose parentId is not in the list to a root', () => {
    // The REAL behaviour, asserted rather than fixed. An editor can delete a
    // parent and leave the child, and a nav that silently loses an item is worse
    // than one that shows it at the top level. Change the behaviour and this test
    // is where the conversation happens.
    const tree = toNavTree(
      [{ id: 'orphan', label: 'Orphan', uri: '/orphan/', order: 1, parentId: 'deleted' }],
      'en'
    );

    expect(tree).toHaveLength(1);
    expect(nth(tree, 0).label).toBe('Orphan');
  });

  it('marks target="_blank" and absolute URLs as external', () => {
    const tree = toNavTree(
      [
        { id: 'a', label: 'Newsletter', uri: '/news/', order: 1, target: '_blank' },
        { id: 'b', label: 'Status', uri: 'https://status.example.test', order: 2 },
        { id: 'c', label: 'Blog', uri: '/blog/', order: 3 },
      ],
      'en'
    );

    expect(tree.map((item) => item.external)).toEqual([true, true, false]);
  });

  it('turns a null label into an empty string rather than rendering "null"', () => {
    const tree = toNavTree([{ id: 'a', label: null, uri: '/x/', order: 1 }], 'en');

    expect(nth(tree, 0).label).toBe('');
  });

  it('returns an empty tree for an empty menu', () => {
    expect(toNavTree([], 'en')).toEqual([]);
  });
});
```

**Verify §5:**

- [ ] 4 files, 46 tests, green.
- [ ] Change `SEVERITY_ORDER` to five entries by duplicating a line, run `npm run test:run`, and
      read which of the four `content.test.ts` tests fail. Put it back. The permutation test
      should fail; the total-order tests should still pass, because the comparator is still
      consistent — that is the difference between an invariant and a literal.

### Step 6: Test `matchesFilters`, and be honest about what it costs

`matchesFilters` is exported from `IncidentList.tsx` and marked
`/** Pure, exported for Module 12 … */`. It is genuinely pure — four arguments in, a boolean out
— but it lives in a `.tsx` file that imports React, a context module and two `ui/` components.
Importing it in a `node` environment works: nothing is rendered, `createContext` at module scope
is fine in Node, and the `esbuild.jsx` line in Step 2 is what compiles the JSX it never
executes.

> **State the cost rather than hiding it.** A pure function in a component file drags that
> component's entire import graph into a unit test. Today that graph is React and two shadcn
> primitives, so it costs milliseconds. The day it grows a browser-only import, this test breaks
> for a reason that has nothing to do with `matchesFilters` — and the fix then is to move the
> function to `src/lib/`, **not** to switch the environment to jsdom. Lesson 23.2 is where
> component tests arrive and this file gets revisited.

The fixtures are the point: `SEED_INCIDENTS` and `INCIDENTS` from Lesson 08.2 are in real
WPGraphQL response shape, and Lesson 09.3 kept `fixtures.ts` specifically so this test could use
them. Importing them also means the test never has to name a generated type.

```ts
// next-app/src/components/incidents/IncidentList.test.ts
import { describe, expect, it } from 'vitest';

import { INCIDENTS, SEED_INCIDENTS } from '@/components/incidents/fixtures';
import { matchesFilters } from '@/components/incidents/IncidentList';

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`nth(${index}): out of range, length is ${items.length}`);
  }
  return item;
}

describe('matchesFilters — the "all" sentinels', () => {
  it('matches every fixture when nothing is filtered', () => {
    const matched = SEED_INCIDENTS.filter((incident) =>
      matchesFilters(incident, 'all', 'all', '')
    );

    expect(matched).toHaveLength(SEED_INCIDENTS.length);
  });

  it('matches an incident with an EMPTY scapegoat connection under "all"', () => {
    // Fixture 5 has `scapegoats: { nodes: [] }` — nobody blamed yet. "all" must
    // still match it, and any specific scapegoat must not.
    const unblamed = nth(SEED_INCIDENTS, 4);

    expect(matchesFilters(unblamed, 'all', 'all', '')).toBe(true);
    expect(matchesFilters(unblamed, 'all', 'the-intern', '')).toBe(false);
  });
});

describe('matchesFilters — severity and scapegoat', () => {
  it('keeps exactly ten of the forty incidents per severity', () => {
    // The seeder assigns severities with $i % 4 (Lesson 04.5) and the fixture
    // expansion mirrors it, so ten per severity is an invariant of both.
    const catastrophic = INCIDENTS.filter((incident) =>
      matchesFilters(incident, 's1-catastrophic', 'all', '')
    );

    expect(catastrophic).toHaveLength(10);
  });

  it('matches on the term slug, not the term name', () => {
    const first = nth(SEED_INCIDENTS, 0);

    expect(matchesFilters(first, 'all', 'the-intern', '')).toBe(true);
    expect(matchesFilters(first, 'all', 'The Intern', '')).toBe(false);
  });
});

describe('matchesFilters — the query', () => {
  it('is case-insensitive and trims the needle', () => {
    const certificate = nth(SEED_INCIDENTS, 1);

    expect(certificate.title).toBe('The certificate expired (#2)');
    expect(matchesFilters(certificate, 'all', 'all', '  CERTIFICATE  ')).toBe(true);
  });

  it('matches against the title only, and finds the four headline repeats', () => {
    // Ten headlines cycled over forty incidents, so one headline appears four times.
    const hits = INCIDENTS.filter((incident) =>
      matchesFilters(incident, 'all', 'all', 'certificate')
    );

    expect(hits).toHaveLength(4);
  });

  it('ANDs the three filters rather than ORing them', () => {
    const certificate = nth(SEED_INCIDENTS, 1);

    expect(matchesFilters(certificate, 's2-major', 'all', 'certificate')).toBe(true);
    expect(matchesFilters(certificate, 's1-catastrophic', 'all', 'certificate')).toBe(false);
  });
});
```

**Verify §6:**

- [ ] `npm run test:run` reports 5 files and 53 tests, all green.
- [ ] `npm run lint` is clean on all five test files. The flat config's type-aware rules apply to
      `**/*.ts`, so a test file is held to the same standard as the code it tests.

### Step 7: Break one on purpose, and fix the code rather than the assertion

Nobody trusts a test they have never seen fail. Break the separator in `tags.ts` — the exact
mistake Module 18 is at risk of making in PHP:

```bash
sed -i.bak "s/join(':')/join('-')/" src/lib/graphql/tags.ts
npm run test:run; echo "exit=$?"
```

Read the output properly before restoring it:

**Verify §7:**

- [ ] `exit=1`. A failing suite exits non-zero — that is the whole mechanism CI uses.
- [ ] The header line names the file, the `describe` and the `it`, in that order.
- [ ] The diff shows `- incident:incident-01` against `+ incident-incident-01`, and the frame
      points at the failing `expect` with a caret under it.
- [ ] Exactly the tests you would expect fail — the node-tag tests and the Module 18 contract
      test — and the `listTag`, `termTag` and throw tests still pass. `listTag` builds its string
      with a template literal rather than `join`, so it is untouched, and that is a real fact
      about the code you just learned from a failure.

Now put it back — **the code**, not the expectation:

```bash
mv src/lib/graphql/tags.ts.bak src/lib/graphql/tags.ts
npm run test:run
```

> **Never `git checkout --` in this course.** Half the files these lessons touch were created by
> the lesson you are in, so git has never heard of them, and for the other half you would get the
> previous module's version. `sed -i.bak` plus `mv` restores exactly what was there thirty
> seconds ago, which is what you actually meant.

Then start watch mode once, so you know what the loop feels like:

```bash
npm test
```

**Verify §7b:**

- [ ] Editing `tags.test.ts` reruns only that file, in well under a second.
- [ ] `p` filters by filename, `t` by test name, `q` quits.

### Step 8: Read the coverage report, and do not gate it

```bash
npm run test:coverage
```

The `text` reporter prints a table; the `html` reporter writes `coverage/index.html`, which is
where the value is — click a file and every unexecuted line is red.

**Verify §8:**

- [ ] `src/lib/graphql/tags.ts`, `errors.ts`, `src/types/content.ts` and
      `src/components/layout/nav.ts` are all high. They are pure functions with tests written
      against their contract, so they should be.
- [ ] `src/lib/graphql/client.ts` is `0%`, and that is the correct answer, not a gap. It does
      I/O; Lesson 23.2 covers it with MSW. If the coverage run instead *errors* on that file,
      add `'src/lib/graphql/client.ts'` to `coverage.exclude` — `server-only` throws outside a
      `react-server` environment, and a file the instrumenter cannot load is not a coverage gap.
- [ ] `IncidentCard.tsx`, `IncidentFilters.tsx` and `IncidentFilterProvider.tsx` are near `0%`.
      **That is the map.** Read the list, notice that the whole filter UI is untested, and put it
      on Lesson 23.2's pile rather than writing a bad test for it today.
- [ ] Open `coverage/index.html`, click `nav.ts`, and find a branch that is red. There is at
      least one — the `target === '_blank'` and absolute-URL branches of `external` are not both
      exercised for every combination. Decide whether it is worth a test. That decision is the
      point of the report.

There are **no thresholds** in `vitest.config.ts`, deliberately. A number attached before anyone
has read a report is a number people learn to satisfy: the cheapest way to raise total coverage
is to test the getters, which moves the percentage and covers nothing. Lesson 23.1 writes the
policy — coverage measured on the **patch**, not the total — and Lesson 24.5 turns it into a gate
with a documented ratchet, the same argument Lesson 21.4 makes for performance budgets.

---

## Verification

```bash
cd next-app

# 1. The whole suite, single pass
npm run test:run
# Expected: Test Files 5 passed (5), Tests 53 passed (53), exit 0.
#           The five files are tags, errors, content, nav and IncidentList.

# 2. `npm test` is the WATCH form — Module 13's Starting State depends on it
npm pkg get scripts.test
# Expected: "vitest"     (not "vitest run")
npm test -- --run
# Expected: the same 53 passing tests. `--run` after `--` reaches vitest, which is
#           exactly how Modules 13 and 23 invoke it.

# 3. All four scripts this module owes exist, spelled exactly as later modules use them
npm pkg get scripts | grep -c 'test'
# Expected: 4 or more  (test, test:run, test:watch, test:coverage)

# 4. Single-file and single-test filters work — appendix 07 §5 promises both
npx vitest run src/lib/graphql/tags.test.ts
# Expected: 1 test file, 14 tests
npx vitest run -t "HTTP 200"
# Expected: 1 test passed, the rest reported as skipped

# 5. NEGATIVE — the include/exclude pair keeps e2e/ out, BEFORE e2e/ exists.
#    This is the trap from Key Concept 4, proved a lesson early.
npx vitest run e2e; echo "exit=$?"
# Expected: "No test files found" and exit=1. Nothing under e2e/ is collectable by
#           Vitest, so Lesson 12.3's smoke.spec.ts can never be imported by it.

# 6. NEGATIVE — the two unit-tested modules deliberately have no server-only guard
grep -c "import 'server-only'" src/lib/graphql/tags.ts src/lib/graphql/errors.ts
# Expected: 0 for both files
grep -c "import 'server-only'" src/lib/graphql/client.ts
# Expected: 1 — the guard belongs on the module that holds an endpoint and a token

# 7. NEGATIVE — the assertion that `locations` never reaches a log exists
grep -c 'locations' src/lib/graphql/errors.test.ts
# Expected: 2 or more — the fixture that carries locations, and the test that
#           proves the formatted string does not. A 0 here means the security
#           assertion from Lesson 10.4 is not pinned by anything.

# 8. Types and lint are clean INCLUDING the five new test files
npm run type-check && npm run lint
# Expected: no output. tsconfig.json's include is **/*.ts (Lesson 09.1), so test
#           files are type-checked like any other source.

# 9. Proof that the test files really are in the type-check, not merely on disk
npx tsc --noEmit --listFiles | grep -c '\.test\.ts$'
# Expected: 5

# 10. Coverage runs, writes both reporters, and is NOT gated
npm run test:coverage
# Expected: a table, then "coverage/index.html". No threshold error, because there
#           are no thresholds — that decision belongs to Lesson 23.1.
test -f coverage/index.html && echo "html report present"
# Expected: html report present

# 11. NEGATIVE — coverage output never enters git
git check-ignore -v coverage
# Expected: a rule from the root .gitignore, e.g. .gitignore:24:coverage/  coverage
git status --short | grep -c coverage
# Expected: 0

# 12. NEGATIVE — coverage does not report on generated code
npm run test:coverage 2>&1 | grep -c 'src/gql'
# Expected: 0. Without the explicit `include` in vitest.config.ts this table would
#           be twelve thousand generated lines at 0%, and the signal would be gone.

# 13. The config is a real file the compiler sees, not a stray
npx tsc --noEmit --listFiles | grep -c 'vitest.config.ts'
# Expected: 1
```

If check 1 reports a different test count than 53, that is fine as long as it is *your* number
and it is green — you may well have added a case. If check 5 collects a file, stop and reread
`include`: everything in Lesson 12.3 depends on it.

## Control Questions

1. `vitest.config.ts` declares `resolve.alias` even though `tsconfig.json` already declares
   `paths`, and the app itself works without it. Explain what each of the two settings actually
   instructs, and name the error message you get when only one of them is present.
2. Vitest's default `include` would collect `e2e/smoke.spec.ts`. Describe the failure that
   produces — which tool raises it, and what the message talks about — and explain why the
   convention `.test.ts` for one runner and `.spec.ts` for the other is stronger than a comment.
3. `tags.ts` and `errors.ts` have no `import 'server-only'` while `client.ts` does. State the
   rule that distinguishes them, and describe exactly what would happen to this lesson's suite if
   somebody applied the guard to the whole of `src/lib/`.
4. `expect(SEVERITY_ORDER).toEqual([...four literals])` passes today. Give one legitimate change
   that would break it and should not, and one bug it would not catch — then name the assertion
   that behaves correctly in both cases.
5. `matchesFilters` is imported from a `.tsx` file that pulls React and two `ui/` components into
   a `node`-environment test. Say why that works, name the day it stops working, and state the
   fix — including why switching to `jsdom` is the wrong one.

## Learn More

- [Vitest — configuration reference](https://vitest.dev/config/) — `include`, `exclude`,
  `environment` and `coverage` in full; skim it once so you know what exists before you need it
- [Vitest — `expect` API](https://vitest.dev/api/expect.html) — the matcher list from Key Concept
  2, including the `toBe`/`toEqual`/`toStrictEqual` distinctions and their failure output
- [Vitest — coverage](https://vitest.dev/guide/coverage.html) — the v8 versus istanbul trade-off
  and the `include`/`exclude` interaction that Step 8's report depends on
- [Vitest — migrating from Jest](https://vitest.dev/guide/migration.html#jest) — the API
  compatibility table, useful in the other direction too if you inherit a Jest codebase
- [Vite — `resolve.alias`](https://vite.dev/config/shared-options.html#resolve-alias) — what the
  alias does at resolution time, which is the half `tsconfig.json` cannot do
- [TypeScript — module resolution and `paths`](https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths)
  — the handbook stating plainly that `paths` does not affect runtime resolution
- [Node.js — `assert` module](https://nodejs.org/api/assert.html) — worth ten minutes to see how
  little a test framework is: `expect` is ergonomics on top of exactly this
- [Kent Beck — "Test Desiderata"](https://kentbeck.github.io/TestDesiderata/) — twelve properties
  a test can have, and the observation that they trade off against each other, which is the
  honest version of Key Concept 10
