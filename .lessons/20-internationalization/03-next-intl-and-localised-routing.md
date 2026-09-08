---
title: 'next-intl & Localised Routing'
module: 20
lesson: 3
teaches: [next-intl, message-catalogues, icu-message-format, intl-formatting, locale-switcher, middleware-composition]
produces: ['next-app/src/lib/i18n/routing.ts', 'next-app/src/lib/i18n/request.ts', 'next-app/src/lib/i18n/navigation.ts', 'next-app/src/messages/en.json', 'next-app/src/messages/uk.json', 'next-app/src/messages/de.json', 'next-app/src/components/layout/LocaleSwitcher.tsx', 'next-app/src/middleware.ts']
requires: [20.2, 09.4, 11.5]
---

# Lesson 20.3 — next-intl & Localised Routing

## Quick Overview

WordPress content is translated; the UI chrome is not. "Submit an incident", "Sort by
severity", "3 incidents found" and every button label in the design system are strings that
live in your codebase, and they need a translation layer of their own. next-intl is the one
this course picks: it is built for the App Router, it works in Server Components without
shipping the catalogue to the browser, and its middleware handles locale detection, prefixing
and the `NEXT_LOCALE` cookie so you are not writing that logic yourself. The alternative,
`next-i18next`, is a Pages Router design retrofitted to App Router; `react-intl` alone leaves
routing entirely to you.

Two things in this lesson are more subtle than the setup. First, **`useTranslations` and
`getTranslations` are the same API split along the server/client boundary** — the hook in client
components, the async function in Server Components and Server Actions — and picking the wrong
one produces an error message that does not obviously say "you are in the wrong environment".
Second, **the locale switcher is a genuine design problem**, not a `<select>`. A user reading
`/de/incidents/dns-ausfall` who clicks "English" must land on `/en/incidents/dns`, with any
`?scapegoat=` filter intact. That means the switcher needs the current document's translation
map from Lesson 20.2, which means it needs data — so it is a server-rendered component with a
small client island inside it, not a pure client component.

By the end of this lesson you will have:

- `src/lib/i18n/routing.ts` and `request.ts` — the locale list, the default locale, the request
  config that loads the right catalogue per request, and a written decision *declining*
  next-intl's localised `pathnames` with the condition that reverses it
- `src/lib/i18n/navigation.ts` — locale-aware `Link`, `redirect`, `usePathname` and `useRouter`
  wrappers, so no component ever hand-builds a `/de/...` href
- next-intl middleware **composed** with the Module 15 auth gate in a single `middleware.ts`, in a
  documented order
- `src/messages/{en,uk,de}.json` — every UI string, namespaced by feature, with ICU plurals for counts
- `LocaleSwitcher.tsx` — resolving the translated slug and preserving the query string
- Dates, numbers and currencies formatted through `Intl`, never through a hand-rolled helper

## Classic WP Analogy

| Classic WordPress | next-intl |
|---|---|
| `__( 'Submit', 'blame-the-tech' )` | `t('submit')` |
| `_n( '%d incident', '%d incidents', $n, 'btt' )` | ICU: `{count, plural, one {# incident} other {# incidents}}` |
| Text domain + `.pot` / `.po` / `.mo` files | Namespace + JSON catalogues per locale |
| `load_plugin_textdomain()` | `getRequestConfig()` in `src/lib/i18n/request.ts` |
| WP-CLI `i18n make-pot` scanning source | An ESLint rule that fails on a literal in JSX |
| `date_i18n()` / `number_format_i18n()` | `Intl.DateTimeFormat` / `Intl.NumberFormat` via `useFormatter` |
| Polylang's language switcher widget | `LocaleSwitcher` — which you write, because it needs data |

The gettext instinct transfers well, and one difference is a genuine improvement: ICU message
format handles plural *categories*, not just singular and plural. Ukrainian has `one`, `few` and
`many`, and `_n()` cannot express that without a custom plural forms header you would have to
get right. ICU has it built in, and this is exactly why `uk` is one of the three course locales
rather than a second Latin-script language.

Where the analogy breaks is **who resolves the string, and when**. `__()` runs on the server at
render time, always, with the full `.mo` file loaded in PHP memory — cheap and invisible. In
next-intl, a string used in a Server Component is resolved on the server and only the *result*
crosses to the browser; a string used in a client component means that message namespace must be
serialised into the RSC payload. Wrap the whole app in `NextIntlClientProvider` with all three
catalogues and you have just shipped every translation of every string to every visitor —
typically tens of kilobytes of JSON, in the critical path, for strings the user will never see.
Module 21 will measure that. The discipline is: keep translation on the server by default, and
pass only the namespaces a client island genuinely needs. There is no Classic equivalent of that
mistake, because in Classic WordPress no translation ever reached the browser at all.

---

## Key Concepts

### 1. Why next-intl, and what the alternatives actually cost

Three real candidates, judged on the one question that matters for an App Router application:
**can a string be translated on the server without shipping the catalogue to the browser?**

| | next-intl | `next-i18next` | `react-intl` alone |
|---|---|---|---|
| Designed for | App Router, RSC-first | Pages Router, retrofitted | any React, no router opinion |
| Server-only translation | ✅ `getTranslations()` | partial — its model is `getStaticProps` | ❌ everything is a hook |
| Routing, prefixing, cookie | ✅ its middleware | ✅ but via `next.config` i18n, which App Router ignores | ❌ you write it |
| Message format | ICU | i18next interpolation + a plurals plugin | ICU |
| Module format | ESM only | CJS + ESM | ESM |
| **Verdict** | ✅ **chosen** | ❌ the retrofit shows: its docs still route through `appWithTranslation` | ❌ fine library, half the job |

`react-intl` is the reference ICU implementation and next-intl's message layer is compatible
with it; what it does not give you is routing, which is most of the work here. And next-intl
being **ESM only** is a bill already paid — Lesson 12.2 chose Vitest over Jest partly because of
this exact package.

### 2. `routing.ts` is the single source of the locale list

Everything that needs to know which locales exist — the middleware, the request config, the
navigation wrappers, the layout's `generateStaticParams`, the switcher — reads one object.

```ts
// (illustration — the real file is in the Task)
export const routing = defineRouting({
  locales: ['en', 'uk', 'de'],
  defaultLocale: 'en',
  localePrefix: 'always',
});
```

`defineRouting` is not a formality: it captures `locales` as a **tuple of literals**, so
`Locale` is `'en' | 'uk' | 'de'` rather than `string`, and every consumer inherits that. Add a
fourth locale in this file and the failures appear in the three places that genuinely have to
change — `localeToLanguageCode`'s `Record` (Lesson 20.2), the text-direction map, and any
catalogue that is now missing.

`localePrefix: 'always'` keeps `/en` in the URL for the default locale. The alternative,
`'as-needed'`, serves English at `/` — breaking Lesson 12.3's assertion that `/` is a 307 to
`/en`, invalidating every `/en/…` path in `smoke.spec.ts` and `funnel.spec.ts`, and making
`toLocalePath()` conditional on which locale it was given. The prefix is worth one redirect.

**`defaultLocale` is a literal, and `NEXT_PUBLIC_DEFAULT_LOCALE` still exists**
([appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-four-of-them)).
A literal is required, because `defaultLocale` has to be a member of the `locales` tuple at the
*type* level and an environment variable is `string | undefined`. So the env var stops being
read and starts being **checked**: if the two disagree, every fallback in the application points
at a locale the router does not serve, which produces redirect loops rather than error messages.
The check is three lines in `routing.ts` and it fails the build, because `NEXT_PUBLIC_` values
are inlined at build time.

### 3. `request.ts`, the plugin, and the line that keeps your pages static

`getRequestConfig` runs once per request and answers two questions — which locale is this, and
which catalogue does it get — and everything server-side in next-intl reads the answer. It finds
the file through a **build-time module alias** rather than by convention, which is why it ships a
`next.config.ts` plugin:

```
   next.config.ts                     src/lib/i18n/request.ts
   withNextIntl('./src/lib/i18n/request.ts')  ───────▶  getRequestConfig(…)
        │                                                    │
        │ registers the alias `next-intl/config`             │ { locale, messages }
        ▼                                                    ▼
   getTranslations() · getFormatter() · getMessages()  read it, per request
```

Without the plugin, `getTranslations()` throws at runtime with a message about a missing
configuration module that does not say "add the plugin".

Then the line nobody expects to need: **`setRequestLocale(locale)`**. next-intl's server APIs
default to reading the locale from request headers, and reading a header makes a route dynamic.
Call `setRequestLocale` at the top of a layout or page and next-intl takes the locale from there
instead, so the route stays statically renderable.

| | Without `setRequestLocale` | With it |
|---|---|---|
| How the locale is found | request headers | the value you passed |
| Rendering | **dynamic**, every route | static, as before |
| Effect on Module 18 | silently undoes the whole module | none |

That table is why this is a Key Concept rather than a footnote. Lesson 18.1 spent a whole lesson
getting `cookies()` out of the root layout so pages could be pre-rendered, and one missing call
here would put every route back to dynamic — no error, and a `npm run build` output that looks
fine until you read the route markers.

### 4. `navigation.ts`: nobody hand-builds a `/de/…` href

`createNavigation(routing)` returns locale-aware replacements for four Next APIs:

| next-intl export | Replaces | What it does for you |
|---|---|---|
| `Link` | `next/link` | prefixes the current locale; `href="/incidents"` renders `/de/incidents` |
| `redirect` | `next/navigation`'s | prefixes the locale in a Server Component or Action |
| `usePathname` | `next/navigation`'s | returns the path **without** the locale prefix |
| `useRouter` | `next/navigation`'s | `push('/incidents')` stays in the current locale |

The third inverts expectations: next-intl's `usePathname()` returns the path with the locale
**stripped**, because a locale-aware component wants the *rest* of it. `NavLink` (Lesson 11.3)
compares `pathname` against an href that already contains the locale, so it stays on Next's
`usePathname` and this lesson does not touch it — mixing the two silently breaks active-link
highlighting, and the imports differ by one word.

### 5. `useTranslations` and `getTranslations` are the same API, split by environment

```
   SERVER COMPONENT / SERVER ACTION        CLIENT COMPONENT
   ────────────────────────────────        ────────────────────────────
   const t = await getTranslations('nav')  const t = useTranslations('nav')
     from 'next-intl/server'                 from 'next-intl'
     async, no hook rules                    hook rules apply
     resolves on the server                  needs a NextIntlClientProvider
     nothing crosses but the result          the namespace crosses the boundary
```

Same `t('openMenu')` call, same catalogue, same ICU. The failure mode is what makes this a Key
Concept: pick the wrong one and the error does not say "you are in the wrong environment". A
`useTranslations` in a Server Component gives you React's generic hooks error; a
`getTranslations` in a Client Component gives you a module-resolution failure about
`next-intl/server`, or — worse — a promise rendered as a child. Neither message names the actual
mistake, which is that the file is on the other side of the boundary from the API it imported.

The heuristic that avoids it entirely: **is there a `'use client'` at the top of this file?**
That is the whole decision procedure.

### 6. ICU message format, and why Ukrainian is in this course

`_n()` handles two forms. Ukrainian has three, and Polish, Russian, Arabic and Welsh have more
or different ones.

```
   gettext                                ICU
   ─────────────────────────────────      ────────────────────────────────────────
   _n( '%d incident',                     "{count, plural,
       '%d incidents', $n, 'btt' )          =0 {No incidents match}
                                             one {# incident found}
   two forms, and the plural rule           few {# incidents found}
   lives in a Plural-Forms header           many {# incidents found}
   you have to write correctly:             other {# incidents found}}"
   nplurals=3; plural=(n%10==1 &&
   n%100!=11 ? 0 : …)                     the rule ships with the runtime
```

Ukrainian's categories, which are the reason `uk` and not a second Latin-script locale:

| `count` | Category | Ukrainian |
|---|---|---|
| 1, 21, 31 | `one` | 1 інцидент |
| 2, 3, 4, 22 | `few` | 2 інциденти |
| 5–20, 25 | `many` | 5 інцидентів |
| 0 | `=0`, an exact match, which takes precedence | Немає інцидентів |

`#` interpolates the number *formatted for the locale*, so a German count over a thousand prints
`1.024` and an English one prints `1,024` from the same message — which is reason enough to
reach for ICU even in a two-form language. The same argument covers every other locale-specific
rendering: dates, numbers, currencies and relative times go through `useFormatter()` /
`getFormatter()`, which wraps `Intl.DateTimeFormat` and `Intl.NumberFormat` with the request's
locale already applied. **Never a hand-rolled helper** — `new Date(x).toLocaleDateString()` picks
up the *runtime's* locale, which on a server is whatever the container's environment says, and
that is how a German page gets American dates in production and correct ones on your laptop.

### 7. Where a string is resolved, and what the provider costs

This is the lesson's performance decision and it is worth more than every other line in it.

```
   SERVER-RESOLVED                          CLIENT-RESOLVED
   ────────────────────────────────         ─────────────────────────────────────
   <h1>{t('title')}</h1>  (server)          <button>{t('openMenu')}</button>
        │                                        │
        ▼                                        ▼
   HTML: <h1>Vorfälle</h1>                  RSC payload carries the WHOLE
   the CATALOGUE never leaves the server    `nav` namespace as JSON, so the
                                            client can re-render it
```

A string used in a Server Component costs its own bytes. A namespace reachable from a Client
Component costs **every string in it**, in JSON, in the critical path, for every visitor —
including the strings that render on other pages. So the mistake has a specific shape: wrap the
app in `NextIntlClientProvider` with `messages={await getMessages()}`, which is what most
examples show because it always works, and every page carries every namespace — eleven where a
page needs six, times however long your catalogues grow, forever.

| Approach | Ships to the browser | When it is right |
|---|---|---|
| no provider at all | nothing | an application with no interactive text — not this one |
| provider, **all** messages | every namespace, every page | prototypes, and demos |
| **provider, picked namespaces** | only what a client island needs | ✅ this project |

The discipline: **server by default**, and the provider receives an explicit object listing the
namespaces client islands genuinely use. In this application that is `nav`, `incidents`,
`incidentForm`, `hobt`, `auth` and `common` — and it excludes `home`, `blog`, `reviews` and
`scapegoats`, which only ever render on the server, **and `locale`**, which is the sharpest case:
`Header` resolves its three strings with `getTranslations()` and passes finished props, so
`LocaleSwitcher` calls no `t()` at all. Verify §6 below proves that with a grep, and it is why
`locale` never enters the provider even though the switcher is the most obviously
locale-shaped component in the app.

The cost, stated plainly: adding a `t()` call to a client component now sometimes requires
editing the layout, and forgetting produces a runtime `MISSING_MESSAGE` rather than a compile
error. That papercut buys a payload that does not grow every time somebody adds a string to an
unrelated feature, and **Lesson 21.3 measures the difference** with the bundle analyzer.

### 8. `localeDetection: false` — the URL is the only source of truth

next-intl's middleware will, by default, resolve `/` from the `Accept-Language` header and the
`NEXT_LOCALE` cookie. This project turns that off, and the argument is the same one Module 18
spent four lessons on.

| | Detection **on** (the default) | Detection **off** (**chosen**) |
|---|---|---|
| `/` for a German visitor | `/de` | `/en`, always |
| `/`'s response | **varies by request header** → needs `Vary: Accept-Language`, so it cannot be shared by a CDN | one cacheable redirect |
| Canonical URL of `/` | depends on who asked | one value |
| Lesson 12.3's `/` → `/en` assertion | passes today, because Playwright's `request` fixture sends no `Accept-Language` — so the test asserts a fact about the **runner** | asserts a fact about the app |
| Consistency with WordPress | contradicts it: Lesson 20.1 set Polylang's `browser` option to `0` | matches it |
| **Verdict** | ❌ a cacheability hole and a header-dependent canonical | ✅ |

**The cost, stated plainly:** a German visitor who types the bare domain gets English on the
first hit and uses the switcher once. One click, in exchange for a `/` that has a single answer a
CDN can hold and a search engine can index.

The subtler consequence is `NEXT_LOCALE`. With detection off, **nothing in the routing path
reads it** — the middleware neither consults it nor acts on it. It is written when a
locale-prefixed request is handled, and its only remaining job is to *record* the visitor's
choice for whatever later wants to know. It is a preference, not a credential, which is why
[appendix 04 §4](../appendix/04-env-reference.md#session-cookies) makes it the one cookie here
that is **not** `httpOnly`: JavaScript may read it, nothing is protected by it, and tampering
with it changes nothing, because the URL decides.

One more middleware default to turn off, for the same class of reason: **`alternateLinks`.**
next-intl will otherwise add an HTTP `Link` header advertising every locale as an alternate for
every path — which claims a German version of `/en/incidents/incident-40`, a URL that does not
exist. Lesson 20.4 builds the `hreflang` cluster from real translation data, and two systems
making the same claim from different data is how they disagree.

### 9. Middleware composition: three responsibilities, one file, one order

`middleware.ts` already does two jobs (Lesson 15.5 Step 2). It now does three, and the order is
not negotiable.

```
   request
     │
     ├─ 1. LOCALE          next-intl: prefix, negotiation (off), NEXT_LOCALE
     │       │
     │       ├─ returned a redirect (Location set)? ── return it NOW ──▶ 307
     │       └─ otherwise: keep the response object and carry on
     │
     ├─ 2. NEAR-EXPIRY HAND-OFF   secondsUntilExpiry(token) <= 60 ──▶ 307 /api/auth/refresh
     │
     ├─ 3. THE GATE               /account, /incidents/submit, no token ──▶ 307 /<locale>/login
     │
     └─ 4. Cache-Control: private, no-store   on a guarded response
```

Two composition rules that are easy to get wrong and hard to notice:

**Return next-intl's response object, not a fresh `NextResponse.next()`.** Its response carries
the `NEXT_LOCALE` cookie and next-intl's own internal request headers; replacing it throws that
away, and the symptom is not an error but a locale that resolves correctly on the first request
and inconsistently afterwards.

**Honour a redirect immediately.** If next-intl redirects `/incidents` to `/en/incidents`, the
gate must not run against the un-prefixed path — `isGuarded('/incidents', '')` slices the wrong
number of characters and reaches the wrong answer. Return, and let the gate run on the next hop.

And `config.matcher` **does not change**, for exactly the reasons Lesson 15.5 §4 gave: adding
`/api/auth/:path*` makes step 2 redirect to an endpoint that then runs middleware again, and
dropping the `api` exclusion sends `/api/health` to `/en/api/health`. `grep -c 'fetch(' src/middleware.ts`
stays `0` — locale resolution is string work, not a lookup.

### 10. `pathnames`: what it does, and why this course declines it

next-intl can localise the route segments themselves. You give it a map and it routes both
forms:

```ts
// (illustration — this project does NOT use this)
pathnames: {
  '/incidents': { en: '/incidents', de: '/vorfaelle', uk: '/vidmovy' },
  '/incidents/[slug]': { en: '/incidents/[slug]', de: '/vorfaelle/[slug]' },
}
```

It is a genuinely good feature, `/de/vorfaelle/zertifikat-abgelaufen` is a better URL than
`/de/incidents/incident-02-de`, and **this course does not use it.** The reason is not taste:
**free Polylang does not translate a custom post type's rewrite slug** (Lesson 20.1 §3). So
WordPress's own idea of that content's URI stays `/incidents/…` in every language, and a
localised Next segment would disagree with:

| Source | Would say | Next would say |
|---|---|---|
| `uri` on every content node | `/incidents/incident-02-de` | `/vorfaelle/incident-02-de` |
| every `menuItems.uri` | `/incidents/` | `/vorfaelle` |
| Yoast's `canonical` (Lesson 19.2) | `…/incidents/…` | `…/vorfaelle/…` |
| the preview link (Lesson 17.2) | `/incidents/…` | 404 |

**Two systems disagreeing about the canonical URL is worse than an untranslated segment.** One
has to win, the loser needs a translation map maintained by hand, and the failure mode is a
canonical tag pointing at a URL that 404s — invisible in development, catastrophic in Search
Console.

The reversal condition, so this is a decision rather than an omission: **Polylang Pro translates
CPT rewrite slugs.** Buy it, teach WordPress that the German archive is `/vorfaelle/`, then
adopt `pathnames` — accepting that the map in `routing.ts` and the rewrite rules in
`register_post_type()` must be kept in sync by hand, forever.

What declining it buys is why it is the cheap choice: `toLocalePath()` and `toNavTree()` need
**no change** and `nav.test.ts` stays green with no edit; Lesson 12.3's nine `/en/…` routes and
Lesson 16.4's `funnel.spec.ts` keep resolving; Module 21's Starting State — `/en`, `/uk`, `/de`
plus `/incidents`, all `200` — holds; and Lesson 20.2's `requireLocalisedNode()` compares one
enum against one segment with no path translation in between. **The translated part is the post
slug, and it comes from WordPress.** That is where the interesting bugs live, and it is enough.

---

## Task

### Step 1: Install next-intl, and check its licence before you commit

```bash
cd next-app

npm install next-intl
npm ls next-intl
npm view next-intl license
```

**Verify §1:**

- [ ] `npm view next-intl license` prints `MIT`. Lesson 07.1 §9 set the rule — `next-app` takes
      **no GPL or AGPL dependency** — and a licence check belongs in the lesson that installs the
      package, not in an audit six months later.
- [ ] Pin it. `npm install` writes a caret range, and a minor version of the package that owns
      your middleware is not CI's choice. Write the version `npm ls` printed back without a caret:

```bash
npm pkg set dependencies.next-intl=3.26.5   # substitute the version npm ls printed
npm install
npm pkg get dependencies.next-intl
```

- [ ] That last command prints an exact version with no `^`, and
      `git diff package.json` shows one dependency added and nothing else.

### Step 2: Write `routing.ts`, and make it the only locale list

The file lives at `next-app/src/lib/i18n/routing.ts`.

```ts
// next-app/src/lib/i18n/routing.ts
// THE locale list. Everything else — middleware, request config, navigation
// wrappers, generateStaticParams, the switcher — reads this object.
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  // A TUPLE of literals, so `Locale` below is a union and not `string`.
  locales: ['en', 'uk', 'de'],

  defaultLocale: 'en',

  // `/en` stays in the URL. 'as-needed' would serve English at `/`, which
  // contradicts Lesson 12.3's assertion that `/` is a 307 to `/en` and would
  // make toLocalePath() conditional on which locale it was handed.
  localePrefix: 'always',

  // Key Concept 8. The URL is the only source of truth for locale: no
  // Accept-Language negotiation, no cookie-driven root redirect. `/` is always
  // `/en`, so `/`'s response does not vary by request header and a CDN can hold
  // it. Matches Polylang's `browser => 0` from Lesson 20.1.
  localeDetection: false,

  // Do NOT emit a `Link: <…>; rel="alternate"` header per locale. It would claim
  // a German version of every path, including the ones that have none. Lesson
  // 20.4 builds the hreflang cluster from real translation data.
  alternateLinks: false,
});

export type Locale = (typeof routing.locales)[number];

/**
 * `NEXT_PUBLIC_DEFAULT_LOCALE` (appendix 04 section 3.2) is no longer READ — a
 * literal is required above, because `defaultLocale` must be a member of
 * `locales` at the type level and an env var is `string | undefined`. So it is
 * CHECKED instead. If the two disagree, every fallback in the application points
 * at a locale the router does not serve, and the symptom is a redirect loop
 * rather than an error message.
 *
 * `NEXT_PUBLIC_` values are inlined at build time, so a mismatch fails the build
 * on every target, which is where a configuration error belongs.
 */
const declaredDefault = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;

if (declaredDefault !== undefined && declaredDefault !== routing.defaultLocale) {
  throw new Error(
    `NEXT_PUBLIC_DEFAULT_LOCALE is "${declaredDefault}" but routing.defaultLocale is ` +
      `"${routing.defaultLocale}". One of them is wrong; they are not independent settings.`
  );
}
```

> **If your next-intl version rejects `localeDetection` or `alternateLinks` inside
> `defineRouting`, pass them to `createMiddleware()` in Step 5 instead.** Both options moved
> from the middleware call into the routing object during the 3.x line, and the behaviour is
> identical either way. This is the one version-sensitive line in the module, which is the second
> reason Step 1 pinned an exact version.

Now `locale.ts` (Lesson 20.2) stops carrying its own copy of the list, and gains the text
direction map that Lesson 20.4 will lean on:

```ts
// next-app/src/lib/i18n/locale.ts — edit: the list now comes from routing.ts
import { routing, type Locale } from '@/lib/i18n/routing';

// DELETE the three declarations Lesson 20.2 put here:
//   export const LOCALES = ['en', 'uk', 'de'] as const;
//   export type Locale = …;
//   export const DEFAULT_LOCALE: Locale = 'en';
// and re-export from the one source, so every existing import keeps working:
export const LOCALES = routing.locales;
export const DEFAULT_LOCALE = routing.defaultLocale;
export type { Locale };

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}

/**
 * Text direction per locale. All three current locales are `ltr`, so this looks
 * like ceremony — and it is the difference between "add Arabic" being a
 * configuration change and being a rewrite. Lesson 20.4 §7 argues it.
 */
export function dirOf(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'en' || locale === 'uk' || locale === 'de' ? 'ltr' : 'rtl';
}
```

**Verify §2:**

- [ ] `npm run type-check` is silent. Every Lesson 20.2 import of `LOCALES`, `Locale`,
      `DEFAULT_LOCALE` and `isLocale` still resolves, because the names did not change.
- [ ] Hover `routing.locales`: `readonly ["en", "uk", "de"]`, not `string[]`. `string[]` means
      the array lost its literal types — check it is inline inside `defineRouting`.
- [ ] Set `NEXT_PUBLIC_DEFAULT_LOCALE=uk` in `.env.local`, run `npm run build`, watch it fail
      with the message from `routing.ts`, and set it back to `en`.

### Step 3: Write `request.ts` and register it in `next.config.ts`

```ts
// next-app/src/lib/i18n/request.ts
// One catalogue per request. next-intl's server APIs — getTranslations,
// getFormatter, getMessages — all read what this returns.
import { getRequestConfig } from 'next-intl/server';

import { routing } from '@/lib/i18n/routing';
import { isLocale } from '@/lib/i18n/locale';

export default getRequestConfig(async ({ requestLocale }) => {
  // A Promise in Next 15, like `params` — and for the same reason.
  const requested = await requestLocale;

  // Never trust the segment. Middleware would have redirected an unknown locale,
  // but a `import()` built from an unvalidated string is a path-traversal shape,
  // and "middleware already checked" is not a property this file can verify.
  const locale = requested !== undefined && isLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    // A dynamic import, so only the requested locale's catalogue is loaded — and
    // only on the server. `../../messages` resolves to src/messages/.
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

The plugin wrapper is the one change this module makes to `next.config.ts`. **Show your own
file**: it already holds `images.remotePatterns`, `formats`, `qualities` and `minimumCacheTTL`
(Lessons 09.1 and 14.5), `async headers()` (Lesson 18.4), and `trailingSlash` plus
`async redirects()` (Lesson 19.4). None of them changes. Only the export is wrapped:

```ts
// next-app/next.config.ts — edit: the import and the export. Nothing else.
import createNextIntlPlugin from 'next-intl/plugin';

// The path is explicit because this project keeps its i18n config in src/lib/i18n/
// rather than at next-intl's default location. The plugin registers a build-time
// alias for `next-intl/config`; without it, getTranslations() throws at runtime
// with a message that does not mention the plugin.
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

// …your existing `const nextConfig: NextConfig = { … }` is UNCHANGED…

export default withNextIntl(nextConfig);
```

> **Lesson 21.3 adds a second wrapper.** `@next/bundle-analyzer` wraps the config too, and
> wrappers compose: `withNextIntl(withBundleAnalyzer(nextConfig))`. Replacing this line rather
> than nesting inside it removes i18n from the build with no error — the pages render, and every
> `t()` call throws on the first request.

**Verify §3:**

- [ ] `npm run type-check` is silent and `npm run dev` starts.
- [ ] `grep -c 'withNextIntl' next.config.ts` returns `2` — the definition and the export, with
      your `images` and `headers` keys untouched. A config object that shrank means you pasted
      over somebody else's lesson.

### Step 4: Write `navigation.ts` and the three catalogues

```ts
// next-app/src/lib/i18n/navigation.ts
// Locale-aware replacements for four Next APIs. Import from here in a component
// that should stay in the current locale — which is all of them except NavLink.
import { createNavigation } from 'next-intl/navigation';

import { routing } from '@/lib/i18n/routing';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

// NOTE: this `usePathname` returns the path WITHOUT the locale prefix, which is
// the opposite of what NavLink (Lesson 11.3) needs — it compares against an href
// that already carries the locale. NavLink keeps importing from
// 'next/navigation', deliberately. Mixing the two breaks active-link
// highlighting with no error, and the two import paths differ by one word.
```

Three catalogues, in `next-app/src/messages/en.json`, `uk.json` and `de.json`, namespaced by
**feature** — because a namespace is the unit that crosses to the client (Key Concept 7), so the
namespace boundaries decide your payload rather than just your tidiness.

```json
{
  "common": {
    "siteName": "Blame The Tech",
    "skipToContent": "Skip to main content",
    "dismiss": "Dismiss"
  },
  "nav": {
    "primary": "Primary",
    "openMenu": "Open main menu",
    "closeMenu": "Close menu"
  },
  "locale": {
    "label": "Language",
    "en": "English",
    "uk": "Українська",
    "de": "Deutsch",
    "unavailable": "{language} — not available for this page"
  },
  "home": { "title": "Blame The Tech" },
  "incidents": {
    "title": "Incidents",
    "notFound": "No such incident.",
    "empty": "No incidents match these filters. Somebody, somewhere, is relieved.",
    "resultCount": "{count, plural, =0 {No incidents match these filters} one {# incident found} other {# incidents found}}",
    "search": "Search incidents",
    "severity": "Severity",
    "scapegoat": "Scapegoat",
    "clear": "Clear filters"
  },
  "blog": { "title": "Blog" },
  "reviews": { "title": "Tech Reviews", "empty": "No reviews in this language yet." },
  "scapegoats": { "title": "The Blame Leaderboard" },
  "hobt": {
    "startNow": "Start Now",
    "getDemo": "Get Demo",
    "seatsLeft": "{count, plural, one {# seat left} other {# seats left}}"
  }
}
```

Two namespaces are missing from that listing on purpose: `incidentForm` and `auth`. Their keys
are the field labels you move out of the two form components in Step 7, and the values have to
be **copied from the components** rather than retyped, so they are listed there rather than
here.

`next-app/src/messages/uk.json` is the same tree with Ukrainian values, and where the plural
categories earn their place:

```json
{
  "incidents": {
    "title": "Інциденти",
    "resultCount": "{count, plural, =0 {Немає інцидентів} one {# інцидент} few {# інциденти} many {# інцидентів} other {# інцидента}}"
  },
  "scapegoats": { "title": "Таблиця винуватців" }
}
```

`next-app/src/messages/de.json` likewise — and German is where the layout breaks, which is the
point of having it:

```json
{
  "incidents": { "title": "Vorfälle", "clear": "Filter zurücksetzen" },
  "scapegoats": { "title": "Die Blame-Bestenliste" },
  "nav": { "openMenu": "Hauptmenü öffnen" }
}
```

> **The English values are a test contract, not copy.** Two suites locate elements by accessible
> name, so these strings must be byte-identical to what the components render today:

| Key | Value that is pinned | Pinned by |
|---|---|---|
| `common.skipToContent`, `nav.openMenu` | `Skip to main content`, `Open main menu` | `smoke.spec.ts` (Lesson 12.3) |
| `home.title`, `incidents.title`, `blog.title`, `reviews.title`, `scapegoats.title` | `Blame The Tech`, `Incidents`, `Blog`, `Tech Reviews`, `The Blame Leaderboard` | `smoke.spec.ts` route table |
| `incidents.notFound`, `hobt.startNow`, `hobt.getDemo` | `No such incident.`, `Start Now`, `Get Demo` | `smoke.spec.ts` |
| `hobt.seatsLeft` with `count: 12` | `12 seats left` | `smoke.spec.ts` (Lesson 12.4 Step 7) |
| every label in `incidentForm` and `auth` | `What happened`, `Submit for review`, `Register`, … | `funnel.spec.ts` (Lesson 16.4) |

Change one of those English values and a spec fails on a string comparison, which is the correct
and cheapest way to find out.

**Verify §4:**

- [ ] `node -e "['en','uk','de'].forEach(l=>{const m=require('./src/messages/'+l+'.json');console.log(l,Object.keys(m).length)})"`
      prints the same key count three times. A namespace present in one catalogue and missing in
      another is a `MISSING_MESSAGE` at runtime, in one locale, on one page.
- [ ] Each `resultCount` message has an `=0` branch **and** an `other` branch. `other` is
      mandatory in ICU; `=0` is an exact match that takes precedence over the plural category.
- [ ] `npm run lint` is clean — the catalogues are JSON, so Prettier formats them and ESLint
      ignores them.

### Step 5: Compose the middleware

An anchored replacement of the whole `middleware()` body. `config` is shown **unchanged**, for
the reasons Lesson 15.5 §4 gave.

```ts
// next-app/src/middleware.ts — the full new middleware() body
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { AT_COOKIE, secondsUntilExpiry } from '@/lib/auth/jwt';
import { routing } from '@/lib/i18n/routing';

// Created ONCE at module scope. Building it per request would re-parse the
// routing config on every navigation.
const handleLocale = createMiddleware(routing);

/** Prefixes BELOW the locale segment that require a session. A UX gate only. */
const GUARDED: readonly string[] = ['/account', '/incidents/submit'];

/** Hand off to /api/auth/refresh with fewer than this many seconds left. */
const REFRESH_WINDOW_SECONDS = 60;

function isGuarded(pathname: string, locale: string): boolean {
  const rest = pathname.slice(locale.length + 1);

  return GUARDED.some((prefix) => rest === prefix || rest.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // ── 1. LOCALE — next-intl owns prefixing and the NEXT_LOCALE cookie ──
  const response = handleLocale(request);

  // A redirect carries a Location header. Honour it and return IMMEDIATELY: the
  // gate must not run against an un-prefixed path, because isGuarded() slices
  // `locale.length + 1` characters and would slice the wrong ones. The gate runs
  // on the next hop, against the resolved path.
  if (response.headers.has('location')) {
    return response;
  }

  // Past this point the first segment IS a valid locale — next-intl would have
  // redirected otherwise.
  const locale = pathname.split('/')[1] ?? routing.defaultLocale;
  const token = request.cookies.get(AT_COOKIE)?.value ?? '';

  // ── 2. NEAR-EXPIRY HAND-OFF — unchanged from Lesson 15.5 ──────────────
  // exp arithmetic only: no signature check, no WordPress round trip.
  if (token !== '' && secondsUntilExpiry(token) <= REFRESH_WINDOW_SECONDS) {
    const handoff = request.nextUrl.clone();
    handoff.pathname = '/api/auth/refresh';
    // Assign `search`; searchParams.set() form-urlencodes `/` into %2F.
    handoff.search = `?next=${pathname}`;

    return NextResponse.redirect(handoff);
  }

  // ── 3. THE GATE — unchanged in behaviour ──────────────────────────────
  if (!isGuarded(pathname, locale)) {
    // next-intl's OWN response, not NextResponse.next(): it carries the
    // NEXT_LOCALE cookie and next-intl's internal request headers, and throwing
    // it away produces a locale that resolves inconsistently with no error.
    return response;
  }

  if (token === '') {
    const login = request.nextUrl.clone();
    login.pathname = `/${locale}/login`;
    // FROZEN SHAPE — Module 16's Starting State asserts the unescaped form.
    login.search = `?next=${pathname}`;

    return NextResponse.redirect(login);
  }

  // ── 4. NO SHARED CACHE FOR AN AUTHENTICATED RESPONSE ──────────────────
  response.headers.set('Cache-Control', 'private, no-store');

  return response;
}

// UNCHANGED from Lesson 09.5 and Lesson 15.5, and that is the finding rather
// than an oversight. Adding '/api/auth/:path*' would run middleware on the
// endpoint step 2 redirects TO, and the redirect would loop. Removing the `api`
// exclusion would send /api/health to /en/api/health.
export const config = {
  matcher: ['/((?!api|_next|favicon\\.ico|.*\\..*).*)'],
};
```

**Verify §5:**

- [ ] `git diff src/middleware.ts` shows **no change** to `config`.
- [ ] The `LOCALES` import Lesson 20.2 added is gone, replaced by `routing`. One locale list.
- [ ] `grep -c 'NextResponse.next()' src/middleware.ts` and `grep -c 'fetch(' src/middleware.ts`
      both return `0` — every non-redirect path returns next-intl's response, and nothing in
      middleware talks to WordPress.

### Step 6: Teach the root layout about the locale

Four additions to `src/app/[locale]/layout.tsx`, shown as an anchored fragment because Lessons
18.1 and 19.x also edit this file and none of their lines change here.

```tsx
// next-app/src/app/[locale]/layout.tsx — edit: imports, static params, and <html>
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { dirOf, isLocale } from '@/lib/i18n/locale';
import { routing } from '@/lib/i18n/routing';

/**
 * Every locale, pre-rendered. Without this the `[locale]` segment has no known
 * values and nothing below it can be statically generated — which would undo
 * Lesson 18.1 quietly.
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

// …inside the layout component, after `const { locale } = await params;`:
//
//   // A route param is a string. Middleware would have redirected an unknown
//   // locale; this line is why deleting middleware.ts still makes nothing
//   // reachable (Lesson 15.5's thesis).
//   if (!isLocale(locale)) notFound();
//
//   // THE LINE THAT KEEPS THIS ROUTE STATIC. Without it next-intl's server APIs
//   // read the locale from request headers, which makes every route below this
//   // layout dynamic — no error, no warning, and Lesson 18.1's build transcripts
//   // silently stop meaning anything. Key Concept 3.
//   setRequestLocale(locale);
//
//   const messages = await getMessages();
//
//   // ONLY the namespaces a client island genuinely needs. Passing `messages`
//   // wholesale ships `home`, `blog`, `reviews` and `scapegoats` to every
//   // visitor of every page, for strings that only ever render on the server.
//   // Key Concept 7; Lesson 21.3 measures it.
//   const { nav, incidents, incidentForm, hobt, auth, common } = messages;
```

```tsx
// next-app/src/app/[locale]/layout.tsx — edit: the <html> element and the provider
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-dvh bg-background text-foreground">
        <NextIntlClientProvider
          messages={{ nav, incidents, incidentForm, hobt, auth, common }}
        >
          {/* SkipLink, Header, main, Footer — unchanged from Lesson 11.4 */}
        </NextIntlClientProvider>
      </body>
    </html>
```

> **`lang` is not new; `dir` is.** `<html lang={locale}>` has been in this file since Lesson
> 09.1, and Lesson 09.1's own Verification already asserts `<html lang="en"`. This is the lesson
> where that value stops always being `en` — which is the cheapest possible demonstration of why
> the `[locale]` segment existed from the first Next.js lesson. `dir` is the genuinely new
> attribute, and Lesson 20.4 §7 explains what it buys.

Every page calling a server translation API needs `setRequestLocale(locale)` too — nine route
files, and the rule is mechanical: **if the file awaits `params` and calls `getTranslations`, the
call goes immediately after the `await`.** `src/app/global-error.tsx` gets **nothing**: it renders
its own `<html>` outside the `[locale]` segment, so there is no request locale to set and its
strings stay hard-coded English — a real gap, the correct trade for an error boundary that must
not depend on anything, and one Lesson 20.4 records in `docs/accessibility.md`.

**Verify §6:**

- [ ] `curl -s http://localhost:3000/de/incidents | grep -o '<html[^>]*>'` prints
      `<html lang="de" dir="ltr">`.
- [ ] `curl -s http://localhost:3000/uk | grep -o 'lang="[a-z]*"'` prints `lang="uk"`.
- [ ] `npm run build` still lists the `[locale]` routes as pre-rendered rather than dynamic. If
      everything went dynamic, a `setRequestLocale` call is missing.

### Step 7: Move every UI string into the catalogues, then lint for the next one

Sweep four directories, copying each value rather than retyping it. **Two exceptions, the only
two:** `search` is `Search incidents` (08.4's `Search titles` predates the filter searching more
than titles) and `scapegoat` is `Scapegoat` (08.3's `Blamed on` is a sentence fragment). Module
23's tests query by accessible name, so the catalogue is now the contract. Otherwise the rule is
mechanical — a literal a user can read becomes `t(key)`,
and the English value in the catalogue is **copied, not retyped**.

| File | Strings | API |
|---|---|---|
| `layout/SkipLink.tsx` | `Skip to main content` | `getTranslations` — it becomes `async` |
| `layout/MobileNav.tsx` | `Open main menu`, `Close menu` | `useTranslations` — it is a client island |
| `layout/Header.tsx`, `Footer.tsx` | the `Primary` aria-label, any static footer label | `getTranslations` |
| `incidents/IncidentList.tsx` | the empty state | `useTranslations` |
| `incidents/IncidentBrowser.tsx` | the result count — the ICU plural | `useTranslations` |
| `incidents/IncidentFilters.tsx`, `IncidentSearch.tsx`, `IncidentSubmitForm.tsx` | control and field labels | `useTranslations` |
| `hobt/*.tsx` | `Start Now`, `Get Demo`, `12 seats left` | mixed — check each file's directive |
| `auth/AuthForm.tsx`, `RegisterForm.tsx` | every field label and button | `useTranslations` |
| `app/[locale]/**/page.tsx` | the six `<h1>` strings | `getTranslations` |

The ICU plural in its natural habitat:

```tsx
// next-app/src/components/incidents/IncidentBrowser.tsx — edit: the count
'use client';

import { useTranslations } from 'next-intl';

// …inside the component, beside the existing useIncidentFilters() call:
//   const t = useTranslations('incidents');
//
//   // ONE message, three plural categories in Ukrainian, two in English and
//   // German, and `#` formatted for the locale. The alternative — `${n} ` plus a
//   // conditional — is the code ICU exists to delete.
//   <p aria-live="polite">{t('resultCount', { count: visible.length })}</p>
```

Then make the next hard-coded string a lint failure. `eslint.config.mjs` is also Lesson 23.7's,
so scope this block narrowly and leave the rest of the config alone:

```js
// next-app/eslint.config.mjs — edit: a new block, immediately above `prettier`
  // ── No user-visible literals in component JSX (Lesson 20.3) ───────────
  // Scoped to the four directories swept in this lesson. Lesson 20.4 widens it
  // to all of src/components/** once src/components/blocks/ is swept too.
  {
    files: [
      'src/components/layout/**/*.tsx',
      'src/components/incidents/**/*.tsx',
      'src/components/hobt/**/*.tsx',
      'src/components/auth/**/*.tsx',
    ],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          // Also catch `{'…'}`, which is the obvious way to get around the
          // default rule while changing nothing about the problem.
          noStrings: true,
          // className, href and every other prop stay legal. Without this,
          // every Tailwind class attribute in the project is an error.
          ignoreProps: true,
          // Punctuation and separators that are not language.
          allowedStrings: [' ', '·', '—', '/', ':'],
        },
      ],
    },
  },
```

**The hole in that rule, named rather than hidden:** `ignoreProps: true` makes an **accessible
name** passed as a prop — `aria-label`, `alt`, `title` — invisible to it. Those are strings a
screen-reader user hears, so they must come from `t()` as well and nothing but review enforces
it. Module 22.1 audits exactly that surface, which is the right place for it: a lint rule that
also flagged `className` would be off within a week.

```bash
npm run lint
npm run type-check
```

**Verify §7:**

- [ ] `npm run lint` is clean. Literals reported in `src/components/blocks/` mean your `files`
      glob is too wide — that sweep is Lesson 20.4's.
- [ ] `grep -rn "'use client'" src/components/layout/SkipLink.tsx` returns nothing: it became
      `async` and stayed on the server. A translated string does not require a client component.
- [ ] `E2E_MODE=1 npx playwright test --project=smoke` passes — every accessible name the spec
      locates by now comes out of `en.json`, byte-identical.

### Step 8: Build the switcher, mount it, and write the decision down

The switcher needs three things a naive `<select>` does not: the query string preserved, the
locale-appropriate target path, and a **disabled** option for a locale this document has no
version of. The first two are path work; the third needs data, and the layout that renders
`Header` cannot see the current page's data, so it has to arrive another way:

| Option | Cost | Verdict |
|---|---|---|
| read `headers()` in the layout to learn the path, then fetch | every route becomes dynamic — undoes Module 18 | ❌ |
| render a second switcher inside each node page | two switchers on one page | ❌ |
| the page publishes the locales it exists in as document metadata; the island reads it | one `<meta>`, and the disabled state is correct only after hydration | ✅ **chosen** |

```tsx
// next-app/src/components/layout/LocaleSwitcher.tsx
'use client';

import { Globe } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Link, usePathname } from '@/lib/i18n/navigation';
import { routing, type Locale } from '@/lib/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * The locale switcher.
 *
 * ONE 'use client' in this file, and the strings arrive as PROPS rather than
 * through useTranslations — so the `locale` namespace never has to be added to
 * NextIntlClientProvider. Header resolves them on the server with
 * getTranslations() and hands over three finished strings. Key Concept 7: the
 * server shell is Header, the client island is this.
 */
export function LocaleSwitcher({
  current,
  labels,
  groupLabel,
  unavailableLabel,
}: {
  readonly current: Locale;
  readonly labels: Readonly<Record<Locale, string>>;
  readonly groupLabel: string;
  /** Already interpolated per locale by Header — `(language) => string` cannot cross. */
  readonly unavailableLabel: Readonly<Record<Locale, string>>;
}) {
  // WITHOUT the locale prefix — next-intl's usePathname. `<Link locale={…}>` puts
  // the right prefix back on, which is why this component contains no string
  // concatenation of a locale at all. It also excludes the query string, so that
  // arrives separately below.
  const pathname = usePathname();

  // Server-render every locale as available and with a bare path, then correct
  // both after hydration from the document itself.
  const [available, setAvailable] = useState<readonly Locale[]>(routing.locales);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // `window.location.search`, not useSearchParams(): that hook forces a
    // Suspense boundary on a statically rendered route, which would leave the
    // switcher out of the server-rendered HTML entirely. The cost of this
    // version is smaller and stated plainly — with JavaScript disabled the
    // switcher links to the unfiltered list.
    setSearch(window.location.search);

    // Which locales does this document actually exist in? The page published the
    // answer as document metadata. Lesson 20.4 replaces this selector with
    // `link[rel="alternate"][hreflang]` once the hreflang cluster exists, so
    // there is one source of truth for that claim rather than two.
    const content = document
      .querySelector('meta[name="btt:alternates"]')
      ?.getAttribute('content');

    if (content === null || content === undefined || content === '') return;

    const listed = content.split(' ');
    setAvailable(routing.locales.filter((locale) => listed.includes(locale)));
  }, [pathname]);

  return (
    <nav aria-label={groupLabel} className="flex items-center gap-1">
      <Globe aria-hidden="true" className="size-4 text-muted-foreground" />

      {routing.locales.map((locale) => {
        if (locale === current) {
          return (
            <span
              key={locale}
              // aria-current, not a colour change: a screen reader announces the
              // former and cannot see the latter. Lesson 11.4's rule.
              aria-current="true"
              className="rounded-md px-2 py-1 text-sm font-medium text-foreground"
            >
              {labels[locale]}
            </span>
          );
        }

        // DISABLED, never hidden. A missing option is indistinguishable from a
        // bug; a disabled one with an accessible name that says why is an answer.
        if (!available.includes(locale)) {
          return (
            <button
              key={locale}
              type="button"
              disabled
              aria-label={unavailableLabel[locale]}
              className="cursor-not-allowed rounded-md px-2 py-1 text-sm text-muted-foreground/50"
            >
              {labels[locale]}
            </button>
          );
        }

        return (
          <Link
            key={locale}
            // next-intl's Link: `locale` swaps the prefix and keeps everything
            // after it. The query string is appended explicitly, because neither
            // usePathname() nor Link carries it.
            href={`${pathname}${search}`}
            locale={locale}
            className={cn(
              'rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'motion-reduce:transition-none'
            )}
          >
            {labels[locale]}
          </Link>
        );
      })}
    </nav>
  );
}
```

`Header` resolves the strings and mounts it:

```tsx
// next-app/src/components/layout/Header.tsx — edit: resolve labels, mount the switcher
import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from './LocaleSwitcher';
import { routing, type Locale } from '@/lib/i18n/routing';

// …inside the async component, beside the existing PrimaryMenu fetch:
//   const t = await getTranslations('locale');
//
//   // Three finished strings per locale, resolved on the server. The catalogue
//   // stays here; only the results cross the boundary.
//   const labels = Object.fromEntries(
//     routing.locales.map((l) => [l, t(l)])
//   ) as Record<Locale, string>;
//   const unavailableLabel = Object.fromEntries(
//     routing.locales.map((l) => [l, t('unavailable', { language: t(l) })])
//   ) as Record<Locale, string>;
//
//   // …and in the JSX, after the <nav aria-label={t('primary')}> block:
//   <LocaleSwitcher
//     current={locale as Locale}
//     labels={labels}
//     groupLabel={t('label')}
//     unavailableLabel={unavailableLabel}
//   />
```

The metadata half — one line per node route, so the island has something to read:

```ts
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — edit: inside generateMetadata
// The locales this document genuinely exists in, for the switcher. Lesson 20.4
// replaces this with `alternates.languages`, which carries the same claim in the
// standard form, and deletes this key — two mechanisms making one claim is how
// they drift.
//   other: { 'btt:alternates': availableLocales(incident).join(' ') },
```

Finally, append to `docs/architecture.md` under the heading Lesson 20.2 created:

```markdown
next-intl: `localePrefix: 'always'`, `localeDetection: false`, `alternateLinks: false`. The URL
is the only source of truth for locale; `NEXT_LOCALE` records a choice and nothing routes on it.
`pathnames` (localised route segments) is **declined** — free Polylang cannot translate a CPT
rewrite slug, so a localised Next segment would disagree with every `uri` WordPress returns.
Reversal condition: Polylang Pro. `NextIntlClientProvider` receives six named namespaces, never
`getMessages()` wholesale.
```

**Verify §8:**

- [ ] Three items render on every page, the current locale as a non-interactive
      `aria-current="true"` element and `grep -c "'use client'"` on the file returning `1`.
- [ ] On `/en/incidents/incident-40`, `Deutsch` and `Українська` are **disabled** buttons after
      hydration, with an accessible name that says why.
- [ ] Clicking `Deutsch` on `/en/incidents?severity=s1-catastrophic` lands on
      `/de/incidents?severity=s1-catastrophic` — the bug Lesson 23.8's charter hunts for.

---

## Verification

```bash
cd next-app

# 1. All three locales render their own chrome, and none of them redirects.
#    This is Module 21's Starting State, asserted here where it is created.
for l in en uk de; do
  curl -s -o /dev/null -w "$l %{http_code}\n" "http://localhost:3000/$l/incidents"
done
# Expected: en 200, uk 200, de 200

# 2. NEGATIVE — /de/incidents is a 200 and NOT a redirect. A localised segment
#    (`/de/vorfaelle`) would have made this a 404 or a 307; declining `pathnames`
#    is what keeps it a 200.
curl -s -o /dev/null -w '%{http_code} [%{redirect_url}]\n' http://localhost:3000/de/incidents
# Expected: 200 []

# 3. `/` still 307s to `/en` — the assertion Lesson 12.3 made about redirect codes
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/
# Expected: 307 http://localhost:3000/en

# 4. NEGATIVE — Accept-Language does NOT change that answer. One line, and it is
#    the whole `localeDetection: false` decision made testable (Key Concept 8).
curl -s -o /dev/null -H 'Accept-Language: de-DE,de;q=0.9' \
  -w '%{http_code} %{redirect_url}\n' http://localhost:3000/
# Expected: 307 http://localhost:3000/en
#           A `/de` here means localeDetection is on: `/`'s response now varies
#           by request header and cannot be shared by a CDN.

# 5. NEGATIVE — nor does the NEXT_LOCALE cookie. It records a choice; nothing
#    routes on it.
curl -s -o /dev/null -b 'NEXT_LOCALE=de' -w '%{redirect_url}\n' http://localhost:3000/
# Expected: http://localhost:3000/en

# 6. The locale reaches the <html> element, in all three locales
for l in en uk de; do
  curl -s "http://localhost:3000/$l/incidents" | grep -o '<html[^>]*>' | head -1
done
# Expected: <html lang="en" dir="ltr">, then lang="uk", then lang="de"

# 7. The chrome is translated, and the ICU plural categories work — proved with
#    two locales at once. Ukrainian has 5 incidents (Lesson 20.1's matrix) and 5
#    is the `many` category; English has 12, which is `other`.
curl -s http://localhost:3000/de/incidents | grep -o 'Vorfälle' | head -1
# Expected: Vorfälle
curl -s http://localhost:3000/uk/incidents | grep -c '5 інцидентів'
# Expected: 1  — the `many` branch. `_n()` could not have produced this.
curl -s http://localhost:3000/en/incidents | grep -c '12 incidents found'
# Expected: 1  — the `other` branch

# 9. NEGATIVE — the German page does not carry the Ukrainian catalogue.
#    This is the RSC-payload argument from Key Concept 7, as a test.
curl -s http://localhost:3000/de/incidents | grep -c 'Інциденти'
# Expected: 0

# 10. NEGATIVE — and it does not carry namespaces no client island on it needs.
#     `scapegoats.title` in German is "Die Blame-Bestenliste"; it renders on
#     /de/scapegoats and nowhere else. A wholesale `messages={await getMessages()}`
#     would put it in every page's payload.
curl -s http://localhost:3000/de/incidents | grep -c 'Bestenliste'
# Expected: 0

# 11. …and no catalogue string is in the JavaScript chunks at all. The chunks are
#     locale-agnostic; messages travel in the per-request payload.
npm run build >/dev/null
grep -rl 'Bestenliste\|інцидентів' .next/static/ | wc -l
# Expected: 0

# 12. NEGATIVE — the middleware matcher did not move
git diff src/middleware.ts | grep -E '^[-+].*matcher'
# Expected: no output. If the matcher appears in the diff, re-read Key Concept 9.

# 13. NEGATIVE — the switcher is ONE client island, and the labels reach it as
#     props rather than as a catalogue namespace.
grep -c "'use client'" src/components/layout/LocaleSwitcher.tsx
# Expected: 1
grep -c 'useTranslations' src/components/layout/LocaleSwitcher.tsx
# Expected: 0 — Header resolved the three strings on the server, so the `locale`
#           namespace never crosses the boundary at all.

# 14. The switcher preserves the query string, which is the bug Lesson 23.8's
#     charter is written to hunt. Check the rendered href.
curl -s 'http://localhost:3000/en/incidents?severity=s1-catastrophic' \
  | grep -o 'href="/de/incidents[^"]*"' | head -1
# Expected: href="/de/incidents" in the server-rendered HTML — the query is
#           appended after hydration (Step 8 states that trade-off). In the
#           browser, click Deutsch on that URL and confirm the address bar reads
#           /de/incidents?severity=s1-catastrophic.

# 15. NEGATIVE — a locale with no version of this document is offered as a
#     DISABLED control, not as a broken link. incident-40 is English-only.
curl -s http://localhost:3000/en/incidents/incident-40 | grep -o 'name="btt:alternates" content="[^"]*"'
# Expected: content="en" — one locale, so the switcher disables the other two on
#           hydration. Open the page and confirm Deutsch is a disabled button
#           with an accessible name, not a link to a 307.

# 16. NEGATIVE — a hard-coded JSX string now fails lint. Probed in a throwaway
#     file, so no tracked component is ever left broken.
cat > src/components/layout/_probe.tsx <<'PROBE'
export function Probe() {
  return <p>Submit an incident</p>;
}
PROBE
npm run lint
# Expected: error react/jsx-no-literals in src/components/layout/_probe.tsx
rm src/components/layout/_probe.tsx
npm run lint
# Expected: clean

# 17. NEGATIVE — nav.ts was not rewritten, and its tests were not edited
git diff --stat src/components/layout/nav.ts src/components/layout/nav.test.ts
# Expected: no output. Declining localised route segments is what buys this.

npm test -- --run
# Expected: all green, including nav.test.ts and tags.test.ts

# 18. Types, lint and the browser suite
npm run type-check
# Expected: silent
E2E_MODE=1 npx playwright test --project=smoke
# Expected: all pass. Every accessible name the spec locates by now comes out of
#           en.json, byte-identical to the literal it replaced.
```

## Control Questions

1. `setRequestLocale(locale)` is one line in the root layout and Key Concept 3 calls it the line
   that keeps your pages static. Explain the mechanism, and say which lesson's work it silently
   undoes when it is missing.
2. `NextIntlClientProvider` receives six named namespaces rather than `await getMessages()`.
   Name two namespaces that are deliberately excluded, say what makes them excludable, and
   describe the runtime error a developer sees when they add a `t()` call that needs one of them.
3. `localeDetection: false` means a German visitor typing the bare domain gets English. Give the
   two things that decision buys, and name the existing Playwright assertion that would have
   become a fact about the test runner rather than about the application if you had left
   detection on.
4. Free Polylang cannot translate a custom post type's rewrite slug. Trace that single fact
   through to three concrete things that would break if this course adopted next-intl's
   `pathnames`, and state the condition under which the decision reverses.
5. The middleware returns next-intl's response object on the non-redirect paths instead of
   `NextResponse.next()`. Say what would be lost, why the symptom is not an error, and why the
   redirect case has to `return` before the auth gate runs.

## Learn More

- [next-intl — App Router setup](https://next-intl.dev/docs/getting-started/app-router) — the
  canonical five-file setup; read it beside Steps 2 to 4 and note where this project deviates
- [next-intl — `defineRouting`](https://next-intl.dev/docs/routing) — every routing option
  including `localePrefix`, `localeDetection`, `alternateLinks` and `pathnames`, and which
  version moved which option where
- [next-intl — static rendering and `setRequestLocale`](https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing#static-rendering)
  — the mechanism behind Key Concept 3, in the author's words
- [next-intl — middleware](https://next-intl.dev/docs/routing/middleware) — its "Composing other
  middlewares" section, read against Step 5's ordering
- [ICU message format — plural rules](https://unicode-org.github.io/icu/userguide/format_parse/messages/)
  — the syntax reference for `{count, plural, …}`, including why `other` is mandatory
- [Unicode CLDR — plural rules by language](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
  — the table that says Ukrainian has `one`/`few`/`many`/`other`; look up your own target
  languages before you promise a client two forms
- [MDN — `Intl.NumberFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
  — what `useFormatter()` wraps, and the options worth knowing before you hand-roll a currency
  helper
- [`react/jsx-no-literals`](https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-no-literals.md)
  — every option, including the two that would have made Step 7's rule unusable
