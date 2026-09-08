---
title: 'The App Router & File Conventions'
module: 9
lesson: 1
teaches: [app-router, file-conventions, locale-segment, manual-next-scaffold, turbopack, next-env-files]
produces: ['next-app/next.config.ts', 'next-app/src/app/[locale]/layout.tsx', 'next-app/src/app/[locale]/page.tsx', 'next-app/.env.example']
requires: [8.5]
---

# Lesson 09.1 — The App Router & File Conventions

## Quick Overview

Next.js is a framework around React, and its most visible feature is that **the file system is
the router**. A folder is a URL segment, `page.tsx` makes that segment routable, `layout.tsx`
wraps everything below it, and square brackets make a segment dynamic. You already think this
way — WordPress has mapped files to output since 2003 — so this lesson is less about learning a
new idea than about learning where Next.js is stricter than the template hierarchy and where it
is more powerful.

The one decision in this lesson you would not think to make yourself is the route shape. You
will create `src/app/[locale]/` immediately, with a single locale, `en`, even though
internationalization is Module 20. Every route in the app therefore lives one segment deeper
than you would naively write it. This is the cheapest insurance in the whole course: adding a
locale segment later means editing every `page.tsx`, every `layout.tsx`, every `<Link href>`,
every `generateStaticParams`, every `redirect()` and every Playwright spec in the repo. Doing
it now costs one folder.

By the end of this lesson you will have:

- `next` installed into your existing Module 07 `package.json` by hand — no `create-next-app`, because it refuses to run in a directory that already holds your toolchain
- `next-app/src/app/[locale]/layout.tsx` — the root layout with `<html lang>` driven by the segment
- `next-app/src/app/[locale]/page.tsx` — a home page rendering `IncidentCard` from the Module 08 fixtures
- `next-app/next.config.ts` and `next-app/.env.example` with `WP_GRAPHQL_ENDPOINT` and `NEXT_PUBLIC_SITE_URL`
- `http://localhost:3000/en` served by `npm run dev`, and the Vite harness from Module 08 deleted

## Classic WP Analogy

The template hierarchy and the App Router solve the same problem — turning a URL into a
rendered page by picking a file — and the mapping is close enough to be genuinely useful:

| Classic WordPress | App Router |
|---|---|
| `index.php` | `src/app/[locale]/page.tsx` |
| `archive-incident.php` | `src/app/[locale]/incidents/page.tsx` |
| `single-incident.php` | `src/app/[locale]/incidents/[slug]/page.tsx` |
| `taxonomy-scapegoat.php` | `src/app/[locale]/scapegoats/[slug]/page.tsx` |
| `page.php` + `page-{slug}.php` | `src/app/[locale]/[...slug]/page.tsx` |
| `header.php` + `footer.php` via `get_header()` | `layout.tsx`, wrapping automatically |
| `404.php` | `not-found.tsx` |
| `functions.php` reading `$_ENV` | `next.config.ts` plus `.env.local` |
| Rewrite rules in `add_rewrite_rule()` | the folder name itself |

The strict improvement is that the mapping is **explicit and readable**. In WordPress the file
that renders a URL is chosen at runtime from a ranked fallback chain driven by the parsed
query, which is why `get_template_part()` calls and `template_include` filters make "which
file rendered this?" a genuine investigation. In the App Router, the URL path *is* the folder
path. There is no fallback chain and no filter that can redirect it.

That is also where the analogy breaks, and it breaks in both directions. WordPress will always
render *something* — if `single-incident.php` is missing it falls back to `single.php`, then
`singular.php`, then `index.php`. Next.js will not: a URL with no matching folder is a 404,
full stop, and the only catch-all is one you write explicitly as `[...slug]`. Conversely,
layouts do something the hierarchy cannot. `get_header()` re-runs on every request, whereas a
Next layout **persists across client-side navigations** — move from `/en/incidents` to
`/en/blog` and the layout component is not re-rendered, its state survives, and only the page
below it swaps. That single behaviour is why an open mobile-nav drawer stays open during
navigation in Module 11, and it has no Classic WordPress equivalent at all.

---

## Key Concepts

### 1. A folder is a segment, and `page.tsx` is what makes it real

The App Router reads one directory — `src/app/` — and turns its shape into your URL space. Two
rules cover almost everything:

- **A folder is a URL segment.** `src/app/[locale]/incidents/` is `/en/incidents`.
- **A folder is only routable if it contains a `page.tsx`** (or a `route.ts`, which is Lesson
  09.5). A folder without one is invisible to the router and useful only for grouping.

That second rule is the one that surprises WordPress developers, because the template hierarchy
has no equivalent. There is no ranked fallback chain, no `template_include` filter, no
`get_query_template()` deciding at runtime which of nine candidate files wins. The URL path is
the folder path, and if the folder is not there the answer is 404.

```
URL                          FILE
/en                          src/app/[locale]/page.tsx
/en/incidents                src/app/[locale]/incidents/page.tsx
/en/incidents/dns-again      src/app/[locale]/incidents/[slug]/page.tsx
/api/health                  src/app/api/health/route.ts
/en/foo                      — nothing. 404. There is no fallback.
```

The trade you are making is legibility for magic. In WordPress, renaming a template file changes
nothing about the URL; in the App Router, renaming a folder *is* changing the URL, and every
`<Link href>` that pointed at it now points at a 404. Lesson 09.4 names that cost again when it
builds the nav.

### 2. The eight file conventions, and the three the course never uses

Every filename inside `src/app/` with a reserved name is a hook into the framework. There are
more than eight in total, but these are the eight that matter, and knowing which lesson writes
each one tells you what Module 09 is deliberately leaving out.

| File | What it does | Where in this course |
|---|---|---|
| `page.tsx` | Makes the segment routable. Receives `params` and `searchParams`. | 09.1, 09.2, 09.3, 09.4 |
| `layout.tsx` | Wraps everything below it. Persists across navigation. Receives `children`. | **09.1** (the root layout) |
| `route.ts` | An HTTP endpoint. Exports `GET`, `POST`, … Cannot coexist with `page.tsx` in the same folder. | **09.5** (`/api/health`) |
| `middleware.ts` | Runs *before* the router, on every matched request. One file per project. | **09.5** |
| `loading.tsx` | The Suspense fallback for the segment below it. | Module 10 (Lesson 10.4) |
| `error.tsx` | A client-side error boundary for the segment. | Module 10 (Lesson 10.4) |
| `not-found.tsx` | The UI rendered when `notFound()` is thrown below it. | Module 10 (Lesson 10.4) |
| `template.tsx` | Like a layout, but **remounts** on every navigation. | **never** — see below |

> **Module 09 writes routes and nothing else.** No `loading.tsx`, no `error.tsx`, no
> `not-found.tsx`, and no cache options on any `fetch`. That is not an oversight, it is the third
> debt listed in the module README: adding boundaries before the routes exist means adding them
> twice. Lesson 09.4 calls `notFound()` several times with no `not-found.tsx` in the tree, and
> Next's built-in 404 answers. Module 10 replaces it.

Three conventions this course never writes, with the reason, because "why is this not here?" is a
fair question:

| Convention | Why not |
|---|---|
| `template.tsx` | It exists to *defeat* the persistence in Key Concept 5 — a fresh instance, fresh state and a re-run effect on every navigation. The only honest uses are an enter animation per route and a deliberate state reset. Blame The Tech wants the opposite. |
| `default.tsx` | Only meaningful with parallel routes (`@slot` folders). The course reaches for a dialog component in Module 16 instead, which is cheaper to reason about and easier to test. |
| Intercepting routes (`(.)`, `(..)`) | The "open this in a modal but keep the URL" pattern. Genuinely clever, genuinely a maintenance cost, and not worth it for one funnel. |

`sitemap.ts`, `robots.ts` and `opengraph-image.tsx` are also file conventions; Module 19 owns all
three.

### 3. Dynamic segments and route groups

Square brackets make a segment dynamic. The number of dots changes how greedy it is.

| Folder | Matches | Does not match | Used in |
|---|---|---|---|
| `[slug]` | `/en/blog/dns-again` | `/en/blog`, `/en/blog/a/b` | 09.3, 09.4 |
| `[...slug]` | `/en/a`, `/en/a/b/c` | `/en` | Module 14's WordPress page catch-all |
| `[[...slug]]` | `/en/a/b`, **and** `/en` | — | never in this course |
| `(auth)` | nothing — it is a **route group** | — | Module 15 |

A route group is a folder whose name is in parentheses, and it is **stripped from the URL**. It
exists so a set of routes can share a layout without sharing a path segment.
`src/app/[locale]/(auth)/login/page.tsx` serves `/en/login`, not `/en/auth/login`. The tree in
`next-app/README.md` already shows `(auth)/{login,register,verify}` — Module 15 fills it in, and
the group is what lets those three pages share a narrow centred layout that `/en/incidents` does
not get.

> **Two dynamic folders cannot be siblings.** `[slug]` and `[id]` in the same directory is a build
> error, because Next cannot tell which one `/en/blog/x` meant. This is the one structural
> constraint that occasionally forces a route redesign, and it is better to hit it now, in a
> paragraph, than in Module 15.

### 4. `params` and `searchParams` are Promises. This is the Next 15 change

In Next 14, `params` was a plain object and you wrote `params.slug`. **In Next 15 both `params`
and `searchParams` are Promises, and every access is `await`ed.** Every blog post, Stack Overflow
answer and generated snippet written before late 2024 gets this wrong, and the failure mode is
ugly: `params.locale` is `undefined` at runtime, or in development you get a warning about
accessing `params` synchronously that reads like a lint rule rather than a bug.

```tsx
// ❌ Next 14, and every stale tutorial. `params.locale` is not a string here — (illustration)
export default function Page({ params }: { params: { locale: string } }) {
  return <html lang={params.locale} />;
}

// ✅ Next 15. The component is async and the props type says Promise. — (illustration)
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <html lang={locale} />;
}
```

The type annotation is the important half. If you write `Promise<{ locale: string }>` in the props
type, then `params.locale` is a compile error rather than a runtime surprise — the strict
`tsconfig.json` from Lesson 07.3 turns the whole class of stale-tutorial mistakes into a red
squiggle. Every route file in this module is declared `async` for exactly this reason, even the
ones that do no fetching yet.

Why did this change? Because a Promise can be created before its value is known. That lets Next
start rendering the static parts of a page while the request-specific parts are still resolving,
which is the same mechanism that makes streaming work. You are paying one `await` for a
capability Module 18 spends a whole lesson on.

### 5. Layouts nest, and they persist

A `layout.tsx` receives `children` and wraps every route below it. They compose downward, so a
request to `/en/incidents/dns-again` renders as:

```
src/app/[locale]/layout.tsx                <html lang="en"><body>
  └─ src/app/[locale]/incidents/…           (no layout of its own — 09.4 explains why not)
       └─ [slug]/page.tsx                   the incident
                                           </body></html>
```

The behaviour that has no Classic WordPress equivalent is **persistence**. `get_header()` re-runs
on every request, because every request is a new PHP process with a new global state. A Next
layout is rendered once and then *survives* client-side navigation below it: move from
`/en/incidents` to `/en/blog` and the layout component is not re-rendered, its DOM is not
recreated, its state is intact, and only the page underneath swaps.

Two consequences worth writing on a sticky note:

- Module 11's mobile navigation drawer can stay open across a navigation, with no work, because
  the component holding `open: true` never unmounted.
- A `useEffect` in a layout **does not re-run** when the page below it changes. If you put
  analytics page-view tracking in a layout effect, you will record one page view per session and
  spend an afternoon wondering why. Module 21 puts it where it belongs.

### 6. The `[locale]` segment, on day one, with one locale

Every route in this app lives under `src/app/[locale]/`. Today `locale` is always `en`. Module 20
adds `uk` and `de`; nothing in this module pretends to do internationalization, and you are not
installing an i18n library.

The argument is retrofit cost. Here is what adding the segment in Module 20 would touch:

| Thing | Count at the end of Module 09 | Count by Module 20 |
|---|---|---|
| `page.tsx` files to move | 8 | ~16 |
| `layout.tsx` files to move | 1 | 3 |
| `<Link href>` values to rewrite | ~12 | dozens, in every component |
| `generateStaticParams` functions to extend with `locale` | 3 | ~8 |
| `redirect()` / `notFound()` call sites to re-check | 6 | ~20 |
| Playwright specs with hard-coded paths | 0 | the whole `e2e/` suite |
| Middleware `matcher` to rewrite | — | 1, and it is the fiddly one |

Cost of doing it now: **one folder**, plus `await params` in files that are already `async`, plus
one `generateStaticParams` returning a single-element array. That asymmetry is the entire content
of ADR 0006, which you write at the end of this lesson.

> **Do not add `uk` or `de` to `generateStaticParams` "to be ready".** A locale in the list with
> no translated content is a route that renders English under a German URL, which is worse than a
> 404 and will be indexed. Module 20 adds locales *and* the content model to back them, together.

### 7. `src/app/[locale]/layout.tsx` is the root layout

There is **no `src/app/layout.tsx`** in this project. The root layout — the one that renders
`<html>` and `<body>` — is `src/app/[locale]/layout.tsx`. That is Next's own documented shape for
App Router internationalization, and it is what makes `<html lang={locale}>` possible at all: the
element that needs the locale is the outermost one, so the segment carrying the locale has to be
above it.

The honest consequence, stated before you discover it:

```
GET /en/incidents     →  [locale] matches "en"  →  root layout renders  →  page renders
GET /incidents        →  [locale] matches "incidents" (!)  →  layout renders  →  no page  →  404
GET /                 →  nothing matches  →  no layout at all  →  Next's built-in 404
```

A request to `/` gets Next's built-in 404 page, not yours, because there is no layout above the
`[locale]` segment for a custom 404 to render inside. This is why Lesson 09.5's middleware is not
cosmetic: something has to put the locale prefix on, and `/` and `/incidents` are 404s until it
does. The Verification block below proves that 404 deliberately, so that the middleware has a
visible problem to solve.

`src/app/global-error.tsx` (Lesson 10.4) is the exception that proves the rule: it renders its own
`<html>` and `<body>` precisely because it has to work when the root layout itself has thrown, and
that is why it is allowed to sit outside `[locale]`.

### 8. What `create-next-app` would have done, and why you are doing it by hand

`create-next-app` refuses to run in a non-empty directory, and `next-app/` currently holds your
Module 07 toolchain and your Module 08 components. So the course does not use it — anywhere. You
install `next` into the project you already have and write the files the scaffold would have
written.

| What the scaffold generates | What you do instead |
|---|---|
| `package.json` with `dev`/`build`/`start` | Three `npm pkg set` calls in Step 2 |
| `tsconfig.json` tuned for Next | Four edits to the file you wrote in Lesson 07.3 — Step 3 |
| `next.config.ts` | You write it, typed, in Step 5 |
| `app/layout.tsx` + `app/page.tsx` | `src/app/[locale]/layout.tsx` + `page.tsx` — Step 7 |
| `.eslintrc.json` / flat config with `next/core-web-vitals` | A flat-config block in Step 4 |
| `.gitignore`, `README.md`, `public/`, a font import, `globals.css` | Already present, not wanted yet, or Module 11's |

That is five files, and you are about to see all of them. The scaffold is not doing anything
mysterious; it is doing this, with a spinner.

**The cost, stated plainly:** you own this configuration now. When Next 16 changes a default, a
scaffolded project inherits the new default the next time someone runs the tool, and yours does
not — you read the upgrade guide and make the edit. In exchange you know why every line is there,
which is worth more on a project you will maintain for two years than it is on a weekend prototype.

### 9. Turbopack, and the three env files

`next dev --turbopack` runs the development server on Turbopack, the Rust bundler that is stable
for `dev` in Next 15. It is meaningfully faster on cold start and on the recompile after a save,
which matters because this course asks you to keep the dev server running for the next sixteen
modules. `next build` is left alone and uses webpack: a Turbopack build exists but is newer than
the rest of this toolchain, and a production build is the last place to want novelty. If Turbopack
ever misbehaves, drop the flag — `next dev` alone is always valid.

Next reads env files in a fixed order, and the first file to define a variable wins:

| Order | File | In git | Who writes it |
|---|---|---|---|
| 1 | the real process environment | — | Vercel, Fly, your shell |
| 2 | `.env.development.local` / `.env.production.local` | never | rarely worth it |
| 3 | **`.env.local`** | **never** | **you, locally** |
| 4 | `.env.development` / `.env.production` | yes | not used in this project |
| 5 | `.env` | never (ignored by our `.gitignore`) | not used in `next-app/` |

This project uses exactly two of them: **`.env.local`**, which is gitignored and holds your real
values, and **`.env.example`**, which is tracked and holds variable *names* plus `__CHANGE_ME__`
placeholders. Nothing else. `wordpress-headless/` uses `.env` because Docker Compose reads that
name; `next-app/` does not, and keeping the two apps on different filenames removes an entire
category of "which env file was I editing?".

And the rule that makes the boundary real, from
[appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules): **`NEXT_PUBLIC_` is an
instruction, not a hint.** The prefix tells Next to inline the literal value into JavaScript that
anyone can read with View Source. `WP_GRAPHQL_ENDPOINT` has no prefix and stays on the server;
`NEXT_PUBLIC_SITE_URL` has one because it is already in the address bar. Lesson 09.5 greps the
production bundle to prove both halves of that sentence.

---

## Task

### Step 1: Confirm the Starting State, and confirm what is absent

```bash
cd next-app
npm run lint && npm run type-check
# Expected: no errors from either. If not, finish Module 08 first.

ls src/components/incidents/
# Expected: IncidentCard.tsx IncidentFilterProvider.tsx IncidentFilters.tsx
#           IncidentList.tsx IncidentSearch.tsx fixtures.ts useDebouncedValue.ts

test -d src/app && echo 'src/app exists — unexpected' || echo 'no src/app yet — correct'
# Expected: no src/app yet — correct
```

WordPress must be running, because Lesson 09.3 fetches from it and this lesson's `.env.example`
points at it:

```bash
cd ../wordpress-headless
docker compose ps
# Expected: wordpress, db, adminer, mailpit all "running", db "(healthy)"
cd ../next-app
```

### Step 2: Licence-check, install `next`, and set the three scripts

Module 07 established the habit and it is not ceremony: `next-app` is MIT-licensed and a GPL
dependency in it would be a licence problem for the whole application.

```bash
npm view next license
npm view @next/eslint-plugin-next license
# Expected: MIT for both. Anything with "GPL" in it does not get installed here.

npm install next@^15
npm install --save-dev @next/eslint-plugin-next
```

React and `react-dom` are already at 19 from Lesson 08.1, which is what Next 15 wants. Now the
scripts. The Vite harness from Module 08 is about to be deleted, so look at what is there before
you overwrite it:

```bash
npm pkg get scripts
# Expected: your Module 07 scripts plus whatever you named the Vite harness in Lesson 08.1.

npm pkg set scripts.dev="next dev --turbopack"
npm pkg set scripts.build="next build"
npm pkg set scripts.start="next start"
```

If the harness script had a name of its own rather than reusing `dev`, delete it now —
`npm pkg delete scripts.<that name>`. Step 8 removes the dependency and the directory it ran.

**Verify §2:**

- [ ] `npm pkg get scripts.dev` prints `"next dev --turbopack"`.
- [ ] `npm pkg get scripts` contains no command starting with `vite`.
- [ ] `npm ls next` reports a single `next@15.x` — not two versions, and not `UNMET`.

### Step 3: Point TypeScript at Next — four changes, no more

Lesson 08.1 already did the hard part by moving `moduleResolution` to `bundler` and adding the
`@/*` path alias. Next needs four further things, and it is worth knowing that if you skip this
step Next will make most of these edits *for you* on first run and print a message saying so. Make
them yourself, so the file stays a document you wrote rather than one a tool rewrote.

```jsonc
// next-app/tsconfig.json — the four changes, in place. Everything else stays.
{
  "compilerOptions": {
    // ...

    // WAS "react-jsx" (Lesson 08.1, for esbuild). Next's compiler transforms JSX itself,
    // so TypeScript must hand it over untouched.
    "jsx": "preserve",

    // The TS language-service plugin: it type-checks Server/Client Component rules in
    // your editor — a misplaced `useState` is underlined before you run a build.
    "plugins": [{ "name": "next" }],

    // Cache type information between runs. `next build` writes .tsbuildinfo; it is gitignored.
    "incremental": true
  },

  // next-env.d.ts is generated by Next on first run and declares the JSX and image types.
  // .next/types/**/*.ts is generated route typing — it is what makes a typo in a
  // `generateStaticParams` return value a compile error.
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["node_modules"]
}
```

The `include` widening from `src/**/*.ts` to `**/*.ts` is what brings `next.config.ts` and
`middleware.ts` into the type-check. `noEmit: true` stays: `tsc` still only judges, and Next still
does all the compiling.

**Verify §3:**

- [ ] `npx tsc --showConfig | grep -E '"(jsx|incremental)"'` shows `"preserve"` and `true`.
- [ ] `npm run type-check` still passes. `next-env.d.ts` does not exist yet and that is fine —
      `include` naming a missing file is not an error.

### Step 4: Add the Next ESLint plugin to the flat config

Two rule sets, both worth having from the first route file. `recommended` catches App Router
mistakes that are legal JavaScript — a `<head>` element in a layout, `next/head` in `app/`, a
missing `next/script` strategy. `core-web-vitals` upgrades the ones with a measurable performance
cost to errors, including the `<img>`-instead-of-`next/image` rule that Module 21 will thank you
for.

Edit `next-app/eslint.config.mjs`. Add the import at the top, alongside the existing ones:

```js
// next-app/eslint.config.mjs (fragment — add to the imports at the top of the file)
import nextPlugin from '@next/eslint-plugin-next';
```

Then insert this object **immediately before the final `prettier` entry** of the exported array:

```js
// next-app/eslint.config.mjs (fragment — the new block, before `prettier`)
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      // Registering the rules explicitly rather than spreading a preset export: this
      // form works on every version of the plugin, and you can read what you enabled.
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
```

`prettier` stays last, for the reason Lesson 07.5 gave: it only *disables* rules, so anything
after it could re-enable a formatting rule and start a fight.

**Verify §4:**

- [ ] `npx eslint .` runs with no *configuration* error.
- [ ] `prettier` is still the final element of the exported array.

### Step 5: Write `next.config.ts`

```ts
// next-app/next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Double-invokes render and effects in development to surface impure components.
  // Set explicitly because the default has moved between major versions, and because
  // Lesson 08.4's "why did my effect run twice?" answer lives here.
  reactStrictMode: true,

  images: {
    // next/image refuses remote hosts it was not told about, on purpose: without an
    // allowlist your optimiser is an open image proxy anyone can bill you for.
    // WordPress media is served from :8080, so declare it now — Module 14 renders
    // featured images and Module 24 replaces this entry with the S3/R2 host.
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8080',
        pathname: '/wp-content/uploads/**',
      },
    ],
  },
};

export default nextConfig;
```

Three things not in this file, deliberately. **No `env: {}` block** — it inlines values into the
bundle and undoes the `NEXT_PUBLIC_` boundary in a way that is easy to miss in review. **No
`headers()`** yet; Module 24 owns security headers, and putting a half-set here means half a
policy. **No `i18n` key at all** — that option belongs to the Pages Router and does nothing in the
App Router. If you find a tutorial that adds it, you have found a Pages Router tutorial.

### Step 6: Prove the ignore rule, then write the env files

Order matters, and it is the order from
[appendix 04 §1 rule 2](../appendix/04-env-reference.md#1-the-five-rules): confirm the file would
be ignored **before** any value exists to leak.

```bash
cd ..
git check-ignore -v next-app/.env.local
# Expected: a rule from .gitignore, e.g. `.gitignore:79:.env.*	next-app/.env.local`
#
# NO OUTPUT MEANS STOP. The file is not ignored. Fix .gitignore first — do not
# "remember to be careful". A secret committed once is compromised after deletion.
cd next-app
```

Now the tracked example. Names and placeholders only; this file goes into git.

```dotenv
# next-app/.env.example
#
# Copy to .env.local and fill in.  NEVER commit .env.local.
# Anything NOT prefixed NEXT_PUBLIC_ stays on the server.
# Anything prefixed NEXT_PUBLIC_ is baked into JavaScript the whole world can read.

# ── WordPress connection (server-only) ──────────────────────────────
# No NEXT_PUBLIC_ prefix, deliberately: the browser never talks to /graphql.
# Lesson 09.3 reads this; Lesson 09.5 proves it is absent from the client bundle.
WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql

# ── Public — inlined into JavaScript anyone can read ────────────────
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_DEFAULT_LOCALE=en
```

```bash
cp .env.example .env.local
```

Every value in the example is a real local value and none of them is a secret, so the copy is
usable as-is. That will not be true from Module 15 onward, which is when `__CHANGE_ME__` starts
appearing in this file and the copy stops being enough. The full inventory, including which module
adds which variable, is [appendix 04 §9](../appendix/04-env-reference.md#9-which-module-introduces-what).

**Verify §6:**

- [ ] `git status --short next-app/` lists `.env.example` as new and **does not mention**
      `.env.local`.
- [ ] `grep -c CHANGE_ME .env.example` is `0` — nothing in this file is secret yet.

### Step 7: Write the root layout and the home page

The root layout renders `<html>` and `<body>`. It is the only place in the app that does.

```tsx
// next-app/src/app/[locale]/layout.tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Blame The Tech',
  description: 'Incident reports, blame assignment, and reviews nobody asked for.',
  // Makes relative URLs in Open Graph tags absolute. Module 19 KEEPS this export —
  // it is the parent every route's generateMetadata merges into — and adds
  // generateMetadata to the ROUTE files, reading Yoast's output per node.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
};

// One locale today. Module 20 adds 'uk' and 'de' — and the translated content to
// justify them. A locale listed here with no content is an indexed English page
// on a foreign URL.
export function generateStaticParams(): ReadonlyArray<{ locale: string }> {
  return [{ locale: 'en' }];
}

export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  // Next 15: params is a Promise. See Key Concept 4.
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <html lang={locale}>
      {/* No className, no font import, no globals.css. Module 11 owns all three. */}
      <body>{children}</body>
    </html>
  );
}
```

The home page renders the Module 08 `IncidentCard` against the Module 08 **fixtures**. There is no
fetching in this lesson at all — Lesson 09.3 is where `fetch` arrives, and keeping them separate
means that when the first live page misbehaves you know it is the fetch and not the routing.

```tsx
// next-app/src/app/[locale]/page.tsx
import { IncidentCard } from '@/components/incidents/IncidentCard';
import { SEED_INCIDENTS } from '@/components/incidents/fixtures';

export default async function HomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <main>
      <h1>Blame The Tech</h1>
      <p>
        Six incidents, rendered from the fixtures you wrote in Lesson 08.2. Locale: {locale}.
        Lesson 09.3 replaces this array with live WordPress data.
      </p>

      <ul>
        {SEED_INCIDENTS.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </main>
  );
}
```

**Verify §7:**

- [ ] `npm run dev` starts and prints `Local: http://localhost:3000`, with `Turbopack` on the
      startup banner.
- [ ] `http://localhost:3000/en` renders six unstyled incident cards.
- [ ] View Source shows `<html lang="en">` — the segment reached the element.
- [ ] `next-env.d.ts` now exists, and `git status` does not list it. It is gitignored on purpose:
      it is generated, and Next rewrites it.

### Step 8: Delete the harness, then write ADR 0006

The Vite harness has been replaced by a real framework. Leaving it in place means two bundlers,
two dev servers and two ways to render the same component — a genuine source of "which one am I
looking at?" confusion.

```bash
rm -rf scratch
npm uninstall vite @vitejs/plugin-react
npm run type-check && npm run lint
# Expected: both clean. If tsc complains about a missing scratch file, an import
#           survived the delete — fix the import, do not restore the directory.
```

Now record the two decisions this lesson made, because both will be questioned by someone (quite
possibly you, in Module 20). Create `docs/adr/0006-locale-segment-and-no-create-next-app.md` — the
sixth in the series you started in Lesson 01.3:

```markdown
# ADR 0006 — The `[locale]` segment from day one, and no `create-next-app`

## Status
Accepted — Module 09.

## Context
Two decisions taken together in Lesson 09.1, both about the shape of the project rather
than its behaviour. (Say what the repository already contained, and why the scaffold
could not run in it.)

## Options considered

| Option | Verdict |
|---|---|
| `create-next-app` in a fresh directory, then move Modules 07–08 work into it | rejected — … |
| `create-next-app --example`, then reconcile | rejected — … |
| Install `next` into the existing project and write the five files by hand | **chosen** |
| Add `[locale]` in Module 20, when i18n actually arrives | rejected — … |

## Decision
(Both decisions, in two sentences.)

## Consequences — including what this costs us
- We own `next.config.ts`, the `tsconfig.json` compiler options and the ESLint blocks, and
  we do not inherit future scaffold defaults for free.
- Every route is one segment deeper, forever, and every `<Link href>` must carry a locale.
- `/` and `/incidents` are 404s until Lesson 09.5's middleware exists.

## What would reverse this
(Name the conditions honestly — e.g. a single-locale product with a hard commitment never
to translate would not have paid for the segment.)
```

Fill in each parenthesis in your own words. An ADR you did not write the reasoning for is a
file, not a record.

---

## Verification

```bash
cd next-app

# Leave `npm run dev` running in a second terminal for checks 2 and 6.

# 1. The router sees exactly the routes you created — and no more
find src/app -name 'page.tsx' -o -name 'layout.tsx' | sort
# Expected: exactly two lines — src/app/[locale]/layout.tsx and src/app/[locale]/page.tsx

# 2. The locale route answers
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en
# Expected: 200

# 3. The locale reached the html element (Key Concept 7)
curl -s http://localhost:3000/en | grep -o '<html lang="[a-z]*"'
# Expected: <html lang="en"

# 4. A production build succeeds and lists the route
npm run build
# Expected: a route table containing a `/[locale]` row, and no TypeScript errors.
#           `○ (Static)` next to it means Next prerendered it — correct, it reads fixtures.

# 5. Both quality gates are clean on the new files
npm run type-check && npm run lint
# Expected: no output from either

# 6. NEGATIVE — there is no root page, so `/` is Next's built-in 404.
#    This is the problem Lesson 09.5's middleware solves. Do not "fix" it here.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/incidents
# Expected: 404 and 404

# 7. NEGATIVE — the Vite harness is gone, in all three of its parts
test -d scratch && echo 'STILL PRESENT' || echo 'scratch removed'
# Expected: scratch removed
npm pkg get scripts | grep -c vite
# Expected: 0
npm ls vite 2>/dev/null | grep -c 'vite@'
# Expected: 0

# 8. NEGATIVE — your real env file is ignored and unstaged
cd .. && git check-ignore -v next-app/.env.local
# Expected: a .gitignore rule matching .env.*   — NO OUTPUT MEANS STOP
git status --short next-app/ | grep -c '.env.local'
# Expected: 0
git status --short next-app/ | grep -c '.env.example'
# Expected: 1   — the tracked example, which holds names and no secrets

# 9. NEGATIVE — no secret-shaped value in the tracked example
grep -E 'TOKEN|SECRET|PASSWORD' next-app/.env.example
# Expected: no output. Module 15 is the first lesson that adds a __CHANGE_ME__ here.

# 10. The ADR exists and is numbered correctly
ls docs/adr/
# Expected: 0001 … 0006, with 0006-locale-segment-and-no-create-next-app.md
```

If check 6 returns anything other than 404, you have an extra `page.tsx` somewhere above
`[locale]` — find it and delete it, because a root page would shadow the middleware redirect and
make Lesson 09.5 look broken.

## Control Questions

1. `src/app/[locale]/layout.tsx` renders `<html>` and `<body>`, and there is no
   `src/app/layout.tsx`. Explain what Next serves for `GET /` at the end of this lesson, whose 404
   page it is, and why a `not-found.tsx` inside `[locale]` would not change that answer.
2. A colleague copies a Next 14 route file into this project and writes `params.slug` in a
   non-`async` component. Describe the two different ways that fails — one at compile time in this
   repository, one at runtime in a repository with a looser `tsconfig.json` — and say which
   `tsconfig.json` setting from Lesson 07.3 is doing the work.
3. `[locale]` costs one folder today. Using the table in Key Concept 6, name the three categories
   of change that adding it in Module 20 would force, and say which one no code-search-and-replace
   could safely automate.
4. `next.config.ts` declares `images.remotePatterns` for `localhost:8080` even though this lesson
   renders no images. What breaks in Module 14 without it, and what is the security reason
   `next/image` requires the allowlist rather than accepting any URL?
5. `.env.local` is gitignored and `.env.example` is tracked. `WP_GRAPHQL_ENDPOINT` appears in both.
   Explain why that is not a leak, and then explain what would change if you renamed it
   `NEXT_PUBLIC_WP_GRAPHQL_ENDPOINT` — naming the two consequences beyond "the browser can see it".

## Learn More

- [Next.js project structure and file conventions](https://nextjs.org/docs/app/getting-started/project-structure)
  — the authoritative list of reserved filenames; skim it once so the eight in Key Concept 2 have
  context
- [`layout.tsx` API reference](https://nextjs.org/docs/app/api-reference/file-conventions/layout) —
  the `children` and `params` contract, and the rules that apply only to the root layout
- [`page.tsx` API reference](https://nextjs.org/docs/app/api-reference/file-conventions/page) — the
  `params` and `searchParams` props, in their Next 15 Promise form
- [Upgrading to Next.js 15](https://nextjs.org/docs/app/guides/upgrading/version-15) — the async
  request APIs section is the change in Key Concept 4, in the maintainers' own words
- [Dynamic route segments](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes)
  — `[slug]`, `[...slug]` and `[[...slug]]` compared, plus the sibling-segment constraint
- [Internationalization in the App Router](https://nextjs.org/docs/app/guides/internationalization)
  — Next's own `[lang]`-as-root-layout shape, which is what Key Concept 7 is following
- [Environment variables in Next.js](https://nextjs.org/docs/app/guides/environment-variables) —
  the load order in Key Concept 9, and the `NEXT_PUBLIC_` inlining rule stated by the framework
- [The WordPress template hierarchy](https://developer.wordpress.org/themes/templates/template-hierarchy/)
  — worth rereading now, because the differences are sharper once the App Router is in front of you
- [`next.config.js` options](https://nextjs.org/docs/app/api-reference/config/next-config-js) — check
  any config key you find in a blog post against this page before pasting it; half of them are
  Pages Router options
