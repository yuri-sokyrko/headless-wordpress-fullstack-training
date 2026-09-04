---
title: 'Multilingual Content Modeling'
module: 20
lesson: 1
teaches: [polylang, translation-groups, pll-api, idempotent-bootstrap, seeder-determinism]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/polylang.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/ensure-languages.php', 'wordpress-headless/wp-content/mu-plugins/blame-seeder/translations.php']
requires: [04.4, 12.4]
---

# Lesson 20.1 — Multilingual Content Modeling

## Quick Overview

Before any JavaScript, decide what a translation *is* in your data model. WordPress core has no
answer — it has one `wp_posts` table with no language column — so every multilingual plugin
invents one. Polylang's answer is the one this course adopts: each translation is **its own
post**, with its own ID, slug, revisions and meta, and a hidden `post_translations` taxonomy
term groups the siblings together. That model is worth understanding rather than accepting,
because it is why translated slugs differ (`/incidents/dns` and `/vorfaelle/dns-ausfall`), why
a German post can be published while its English sibling is still a draft, and why "the
translation" is never a field you can fetch — it is a relationship you have to traverse.

The operational half of this lesson is making that setup **reproducible**. Languages in Polylang
are database state: terms in the `language` taxonomy plus a serialized option. Clicking three
languages into existence in wp-admin is not something you can put in git, and it is not
something CI can do. So you write `wp blame ensure-languages` — idempotent, safe to run on every
boot and every deploy, creating what is missing and touching nothing that exists. Module 24's
Fly.io `release_command` calls it, which is only safe because it is idempotent. Then the seeder
gets its final determinism rule: translation groups are linked **last**, after every post in
every language exists, with `pll_save_post_translations()`.

By the end of this lesson you will have:

- Polylang installed, pinned and configured for `en` (default), `uk` and `de`, with URL-prefix
  language detection and no automatic browser redirect
- `includes/polylang.php` — the bootstrap that registers the custom post types and taxonomies
  from [appendix 03](../appendix/03-content-model-reference.md) as translatable
- `includes/cli/ensure-languages.php` — `wp blame ensure-languages`, idempotent, exit code 0 on
  a no-op, non-zero on a real failure
- `mu-plugins/blame-seeder/translations.php` — translation linking as the seeder's final phase
- Seeded content in all three languages: every incident, review, post and page with at least an
  `en` original, and a documented subset deliberately left untranslated
- A written stance on media translation, and the reason for it

## Classic WP Analogy

You have almost certainly done multilingual WordPress before, and whichever way you did it, one
of these was your model:

| Approach | Model | Why not here |
|---|---|---|
| WPML | Same as Polylang — one post per language, grouped | Excellent, commercial, and its GraphQL story is weaker |
| **Polylang** | One post per language, grouped by a hidden taxonomy | **Chosen.** Free, `wp-graphql-polylang` exists and is maintained |
| Multisite | One site per language | Three databases, three plugin sets, three deploys. No. |
| An ACF field per language | `title_de`, `title_uk` on one post | Unqueryable, unsortable, and the schema grows with every language |
| A language taxonomy you built | One post, terms for language | You will reinvent Polylang badly, over eighteen months |

If you have used WPML or Polylang before, the model transfers exactly. `pll_get_post()`,
`pll_get_post_language()` and `pll_save_post_translations()` are the same functions you would
call from a Classic theme, and this lesson calls them from WP-CLI rather than from a template.

Where it breaks down is **which side does the language switching**. In a Classic Polylang site,
Polylang *is* the router: it filters the main query by the current language automatically,
before your theme runs, based on the URL prefix. Every `WP_Query` you write is silently scoped.
In a headless build there is no main query and no current language — WordPress is answering a
GraphQL request from a server in another country, and it has no idea which language the visitor
wants. **Every query must state its language explicitly**, and a query that forgets to returns
the default language or, worse, all languages mixed together. That is Lesson 20.2's central
problem, and it is the single most common headless-Polylang bug.

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
