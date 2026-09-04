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
`/de/vorfaelle/dns-ausfall` who clicks "English" must land on `/en/incidents/dns`, with any
`?scapegoat=` filter intact. That means the switcher needs the current document's translation
map from Lesson 20.2, which means it needs data — so it is a server-rendered component with a
small client island inside it, not a pure client component.

By the end of this lesson you will have:

- `src/lib/i18n/routing.ts` and `request.ts` — the locale list, default locale, localised pathname
  map, and the request config that loads the right catalogue per request
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
