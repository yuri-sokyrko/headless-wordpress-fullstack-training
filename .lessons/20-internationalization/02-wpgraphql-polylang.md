---
title: 'WPGraphQL Polylang'
module: 20
lesson: 2
teaches: [wp-graphql-polylang, language-code-enum, translations-field, locale-fallback, sibling-lookup]
produces: ['next-app/src/graphql/fragments/Translations.graphql', 'wordpress-headless/schema.graphql']
requires: [20.1, 10.2]
---

# Lesson 20.2 — WPGraphQL Polylang

## Quick Overview

`wp-graphql-polylang` adds three things to the schema, and all three matter. Every content node
grows a `language { code locale slug }` field, so you always know what you fetched. Every
content node grows a `translations` array of its siblings, so the switcher has somewhere to look.
And every connection's `where` argument grows `language`, so `incidents(where: { language: DE })`
returns only German incidents. Add the `LanguageCodeEnum` type and you have a locale that is
type-checked from the URL segment all the way to the SQL query — which is the whole reason to
put the locale in the GraphQL variables rather than filtering in JavaScript afterwards.

The judgement calls are about **absence**. A German visitor asks for an incident that has no
German translation: do you 404, redirect to English, or render the English content under a
German URL with a notice? Each is defensible and each has a different `hreflang` consequence, so
you decide once, write it down, and implement it in one place. Related and subtler: an
unspecified `language` in a `where` clause is not an error — it silently returns the default
language, which means a query you forgot to localise produces a page that looks completely fine
in English and is wrong in every other locale. This lesson makes locale a required argument in
every localised document so the type checker catches the omission instead of a user.

By the end of this lesson you will have:

- `wp-graphql-polylang` installed and pinned, with `LanguageCodeEnum` in the refreshed
  `schema.graphql`
- `src/graphql/fragments/Translations.graphql` — the sibling-lookup fragment the switcher needs
- Every localised document taking a required `$language: LanguageCodeEnum!` variable
- A single `localeToLanguageCode()` mapper — the only place `'de'` becomes `DE`
- A decided, implemented and documented fallback policy for untranslated content
- Proof from GraphiQL that `where: { language: DE }` returns German nodes only, and that omitting
  it returns English

## Classic WP Analogy

In a Classic Polylang theme, language filtering is **ambient**. Polylang hooks `pre_get_posts`,
reads the language from the URL, and scopes the main query and most secondary queries for you.
You write `new WP_Query(['post_type' => 'incident'])` and get incidents in the current language
without asking. The escape hatch is the one you had to look up once:
`'lang' => ''` to opt out and get everything.

`wp-graphql-polylang` inverts the default. There is no ambient request language, so **filtering
is explicit or it does not happen**. `incidents(first: 10)` returns the default language;
`incidents(where: { language: UK })` returns Ukrainian. The closest Classic analogue is writing
`'lang' => 'uk'` on every single `WP_Query` in the codebase and having no `pre_get_posts` safety
net behind you.

That inversion is where the analogy breaks, and it breaks in the direction of a silent bug.
An ambient default that is wrong shows up immediately — the whole page is in the wrong language
and you notice in one second. An explicit filter you forgot shows up as *one section* of a
German page in English: the nav is translated (next-intl handled it), the incident body is
translated (that query was localised), and the "Related incidents" rail is in English because
that document was written before you added the variable. Nobody notices for a month. The
defence is mechanical, not vigilant: make `$language` non-nullable in every localised document
and let `tsc` refuse to build.

The second break is smaller but sharper: `translations` returns **siblings only**, not the node
itself. A three-language cluster gives you two entries, and building an `hreflang` set means
combining `translations` with the current node. Forget that and the page omits itself from its
own alternate cluster, which is invalid and which Search Console will not tell you about.

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
