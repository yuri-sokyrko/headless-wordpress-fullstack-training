# Module 20 — Internationalization: Polylang + next-intl

## Prerequisites

Before starting this module you should have completed:

- **Module 09** — the App Router, and specifically the `[locale]` segment created in Lesson 09.1
- **Module 10** — the typed data layer, because locale becomes a query variable everywhere
- **Module 18** — cache tags, because a cache tag that ignores locale serves German content to
  English readers
- **Module 19** — `generateMetadata`, because `hreflang` is a metadata concern

> ⚠️ **Do not add a second `[locale]`-shaped segment or a `/de` route group.** The segment
> already exists. Every route file under `src/app/[locale]/` was written in Module 09 against a
> `params.locale` that has always been there and has always been `en`. This module fills it in;
> it does not restructure it. If you are tempted to create parallel route trees per language,
> stop and re-read Lesson 09.1.

## Starting State

Module 19 complete: every page has editor-controlled metadata, JSON-LD, a sitemap, robots and
redirects.

```bash
# 1. Metadata comes from Yoast, not from code
curl -s http://localhost:3000/en/incidents/incident-01 | grep -o '<title>[^<]*</title>'
# Expected: the title an editor typed in the Yoast sidebar

# 2. The sitemap and robots files exist and are XML/text, not HTML
curl -s -o /dev/null -w '%{content_type}\n' http://localhost:3000/sitemap.xml
# Expected: application/xml

# 3. The locale segment is real, and there is exactly one locale so far
ls next-app/src/app/\[locale\]/
# Expected: layout.tsx page.tsx incidents/ blog/ reviews/ scapegoats/ hobt/ account/ ... 
```

## What You'll Learn

- **Polylang** — the free multilingual plugin, its post-translation data model, and why it beats
  a per-language site or a duplicated content tree for this project
- **WPGraphQL Polylang** — the `language` and `translations` fields, `where: { language: DE }`
  filtering, and sibling lookup for the switcher
- **next-intl** — routing, proxy, message catalogues, and the `useTranslations` vs
  `getTranslations` split that follows the server/client boundary
- **Localised formatting** — dates, numbers, currencies and plurals through the `Intl` APIs,
  with the ICU message syntax next-intl uses
- **A switcher that does not lose your place** — resolving the translated slug for the current
  document instead of sending everyone to the homepage
- **i18n SEO** — `hreflang` alternate clusters, `x-default`, per-locale sitemaps, and the
  canonical rules that keep three languages from competing with each other
- **Locale-aware caching** — extending the Module 18 tag scheme so a Ukrainian publish does not
  purge the German page, and does purge the Ukrainian one

## What You'll Build

- Polylang configured for `en`, `uk` and `de`, with `en` as default, bootstrapped idempotently by
  `wp blame ensure-languages` so a fresh database is never a manual click-through
- Seeder support that links translation groups **last**, with `pll_save_post_translations()`
- `src/lib/i18n/{routing,request,navigation}.ts` and next-intl proxy composed with the
  existing auth gate in `proxy.ts` — one proxy, two responsibilities, in a defined order
- `src/messages/{en,uk,de}.json` — every user-visible UI string, with a lint rule that catches
  the next hard-coded one
- `LocaleSwitcher` that navigates to the translated slug, preserving query parameters
- `hreflang` alternates on every route, per-locale sitemap entries, and RTL-ready layout primitives
- Locale-scoped cache tags, and the revalidation payload extended to carry `locale`

After this module the whole site works in English, Ukrainian and German. An editor writes an
incident in German, links it to its English sibling, publishes, and the German page appears with
a valid `hreflang` cluster pointing at both — while the English page's cache stays untouched.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Multilingual Content Modeling](01-multilingual-content-modeling.md) | Polylang, `pll_*` API | Three languages, `wp blame ensure-languages`, linked seed data |
| 2 | [WPGraphQL Polylang](02-wpgraphql-polylang.md) | `wp-graphql-polylang` | Locale-filtered queries and a `translations` fragment |
| 3 | [next-intl & Localised Routing](03-next-intl-and-localised-routing.md) | next-intl, ICU messages, `Intl` | Message catalogues, localised nav, the switcher |
| 4 | [i18n SEO & Edge Cases](04-i18n-seo-and-edge-cases.md) | `hreflang`, `x-default`, RTL | Alternate clusters, per-locale sitemaps, locale cache tags |

## The Three Locales

| Locale | Polylang slug | WPGraphQL `LanguageCodeEnum` | Why it is in the course |
|---|---|---|---|
| `en` | `en` | `EN` | Default. Every fallback resolves here. |
| `uk` | `uk` | `UK` | Cyrillic — forces you to notice font subsetting, URL encoding and string width |
| `de` | `de` | `DE` | Compound nouns — the layout breaks that only a real language exposes |

> **Ukrainian and German are not decoration.** English-plus-English-in-a-hat teaches you
> nothing. Cyrillic exposes a `next/font` subset you forgot to include and a slug that is
> percent-encoded in one place and not another; German exposes every fixed-width button and
> truncated nav label in your design system. Pick your test locales to break things.

## How to Work

1. **Work the lessons in order, WordPress first.** 20.1 and 20.2 make translated content exist
   and be queryable; 20.3 and 20.4 consume it. Starting with next-intl gives you a beautifully
   localised UI on top of monolingual content, which hides every interesting bug.
2. **Re-seed once after Lesson 20.1.** Translation groups are relationships between posts, so
   they cannot be retrofitted onto content that was seeded before languages existed. Run
   `wp blame seed --fresh` and let the seeder link them.
3. **Test in `de`, not `en`.** Every bug in this module hides in the default locale, because the
   default locale is the one where the fallback and the real value are the same string.
4. **Commit after every lesson.** `git commit -m "feat(i18n): locale-aware routing with next-intl"`
