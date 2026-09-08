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
because it is why translated slugs differ (`/en/incidents/dns` and
`/de/incidents/dns-ausfall`), why
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

### 1. One `wp_posts` table, no language column

Open `wp_posts` in Adminer (`http://localhost:8081`) and look for the language. There is not
one. There is no `lang` column, no `locale` column, and no core taxonomy that means "language".
WordPress core has never had an opinion about multilingual content, which is why the ecosystem
has five incompatible ones.

Polylang's answer, in two sentences: **each translation is its own post**, and a hidden
taxonomy groups the siblings. Nothing else. There is no parent post, no "original", no
`translation_of` meta field pointing at an ID.

```
wp_posts                                    wp_term_relationships
┌──────┬──────────────────┬──────────────┐   ┌─────────────────────────────┐
│  ID  │ post_name        │ post_status  │   │ object_id → term_taxonomy_id │
├──────┼──────────────────┼──────────────┤   ├─────────────────────────────┤
│ 412  │ incident-01      │ publish      │◀──┤ 412 → language:en           │
│ 588  │ incident-01-de   │ publish      │◀──┤ 412 → post_translations:#77 │
│ 601  │ відмова-01       │ draft        │◀──┤ 588 → language:de           │
└──────┴──────────────────┴──────────────┘   │ 588 → post_translations:#77 │
                                             │ 601 → language:uk           │
   three posts · three IDs · three slugs     │ 601 → post_translations:#77 │
   one group, term #77                       └─────────────────────────────┘
```

Two taxonomies do all the work, and both are registered with `'public' => false` so they never
appear in wp-admin's taxonomy menus:

| Taxonomy | One term per | Term holds |
|---|---|---|
| `language` | language | `name`, `slug`, and a **serialized `description`** carrying the locale (`de_DE`), the text direction and the flag |
| `post_translations` | translation **group** | a serialized map `{"en":412,"de":588,"uk":601}` in the term's `description` |

That second row is the one to remember. The group is a serialized PHP array in a term
description, which is why you read it with `pll_get_post_translations()` and never with a
`JOIN`. It is also why a translation group is invisible in a database diff until you know what
you are looking at.

### 2. Three consequences, and people meet them one at a time

Everything surprising about Polylang follows from "a translation is its own post". Each of these
looks like a bug the first time:

| Because a translation is its own post… | The consequence | Where it bites in this project |
|---|---|---|
| it has its own `post_name` | **slugs differ per language** — `/en/incidents/incident-01` and `/de/incidents/incident-01-de` are different URLs | Lesson 20.3's switcher cannot just swap the first path segment for a node page |
| it has its own `post_status` | a German post can be **published while its English sibling is a draft**, and vice versa | Lesson 20.2's `where: { status: PUBLISH, language: DE }` returns a set that no other locale's query returns |
| it has its own `post_date`, author, revisions and meta | "when was this published" has three answers | Lesson 20.4's sitemap emits three `lastmod` values, correctly |
| the link lives in a term, not on the post | **"the translation" is not a field you can fetch** — it is a relationship you traverse | every `hreflang` cluster in Lesson 20.4 is built by combining a node with its siblings |

The last row is the load-bearing one, and it is worth saying in the harshest form available:
**there is no query that returns "this post in German".** There is a query that returns a post,
and a second traversal that returns its siblings. WPGraphQL Polylang exposes the traversal as a
`translations` field (Lesson 20.2), which makes it look like a field — but it is a second read,
it can be empty, and treating it as "always there" is the single most common headless-Polylang
crash.

> **Free Polylang gives you translated slugs for nothing.** Because each translation is a real
> post, WordPress's own slug machinery translates them — you type a German title, you get a
> German `post_name`. This is worth naming explicitly because the *other* kind of slug is
> exactly what free Polylang does **not** translate, and that distinction decides a routing
> question three lessons from now.

### 3. What free Polylang does not translate: the rewrite slug

There are two slugs in a WordPress URL and they come from different places:

```
   /incidents/dns-ate-the-deploy/
    ▲          ▲
    │          └── the POST slug — post_name, per post, per translation      ✅ free
    └───────────── the REWRITE slug — register_post_type( 'rewrite' => … )   ❌ Pro only
```

| Slug | Set by | Translated by free Polylang |
|---|---|---|
| post slug (`post_name`) | the editor, per post | ✅ yes — each translation is its own post |
| CPT rewrite slug (`incidents`) | `register_post_type()` in `includes/post-types.php` | ❌ no. Polylang **Pro** adds "Translate custom post types slugs" |
| taxonomy rewrite slug (`scapegoat`) | `register_taxonomy()` | ❌ no, same |
| page slug | the editor | ✅ yes |

**Write that table down, because it is the fact that decides Lesson 20.3's routing model.** If
`incidents` cannot become `vorfaelle` on the WordPress side, then a Next route segment that says
`vorfaelle` disagrees with every `uri` WordPress returns, every menu item, every Yoast canonical
and every preview link. Lesson 20.3 declines next-intl's localised `pathnames` for exactly this
reason and states the condition that reverses it (buy Polylang Pro). The decision reads as a
consequence of this table rather than as a preference, which is why the table lives in the
WordPress lesson.

### 4. Languages are database state, so clicking them into existence is not reproducible

Here is the operational problem, and it is the reason this lesson writes a WP-CLI command
instead of a paragraph of wp-admin instructions.

```
   IN GIT (code)                        IN THE DATABASE (state)
   ─────────────────────────────        ─────────────────────────────────────
   includes/polylang.php                3 terms in the `language` taxonomy
     which post types are               the serialized `polylang` option:
     translatable                         force_lang, hide_default, browser,
     which taxonomies are not             media_support, default_lang
     the desired option values          post_translations terms, one per group

   `git clone` gives you this           `git clone` gives you NONE of this
```

A colleague who clones the repository and runs `docker compose up` gets a WordPress with your
plugin active, your post types registered, and **zero languages**. Every query returns nothing.
The Polylang admin greets them with the setup wizard. Their fix is fifteen clicks that nobody
wrote down, and their `en` locale ends up `en_GB` while yours is `en_US`, which changes date
formatting in a way that takes an afternoon to find.

The three-part answer this lesson builds:

| Concern | Where it lives | Why there |
|---|---|---|
| *which* post types and taxonomies are translatable | `includes/polylang.php`, as two filters | a declaration about the content model — code, reviewable in a diff |
| *what* the settings should be | `includes/polylang.php`, as a function returning an array | still a declaration; one place to read the intended configuration |
| *making the database match* | `wp blame ensure-languages` | a write to state, which only a command can perform |

### 5. Idempotence is what makes the command deployable

`ensure-languages` is not a migration and not a seeder. It is an **ensure**: a function of the
desired state, safe to run when the answer is already yes.

| Situation | What `wp blame ensure-languages` does | Exit code |
|---|---|---|
| no languages exist | creates `en`, `uk`, `de`; applies the options | `0` |
| all three exist, options match | logs `nothing to do`, writes nothing | `0` |
| `en` and `de` exist, `uk` missing | creates `uk` only, leaves the other two untouched | `0` |
| a language exists with a different `locale` | reports it and **does not "fix" it** — that is content-affecting | `0`, with a warning |
| Polylang is not active | errors before touching anything | **non-zero** |
| a language cannot be created | errors with Polylang's own message | **non-zero** |

Two of those rows are the whole design. **"Touches nothing that exists"** is what makes it safe
in a `release_command`: Module 24's Fly.io deploy runs it on every single release, including the
forty releases after the languages already exist, and a command that recreated or reset them
would destroy content on a routine deploy. **"Non-zero on a real failure"** is what makes it
worth running at all — a bootstrap that cannot fail is a bootstrap you cannot trust, because a
silent success is indistinguishable from a silent no-op.

> **Why not `wp term create language de`?** Because that produces a half-language. Polylang
> stores the locale, the text direction, the flag code and the term ordering **serialized into
> the language term's `description`**, and it keeps a parallel list in the `polylang` option.
> A hand-created term appears in `wp term list language` and works nowhere: the language
> switcher ignores it, `pll_set_post_language()` rejects it, and WPGraphQL Polylang builds no
> `LanguageCodeEnum` value for it. Use Polylang's own model API, which is what the setup wizard
> calls.

### 6. What is translatable here, and what is deliberately not

Three decisions, each with a cost. Register the wrong set and you will be undoing it against
live content later, which is the expensive direction.

| Object | Translatable | Reason |
|---|---|---|
| `incident` | ✅ | the point of the module |
| `post` | ✅ | the blog is editorial content |
| `page` | ✅ | `home`, `about` and `hobt` are marketing copy |
| `tech_review` | ✅ | **registered translatable, and deliberately not translated in the fixture** — Lesson 20.2 needs a post type where `where: { language: DE }` legitimately returns zero rows |
| `attachment` (media) | ❌ | Key Concept 7 |
| `scapegoat`, `severity`, `tech_stack` | ❌ | below |

**Taxonomies are shared across languages, on purpose.** Polylang can translate a taxonomy term
— you get a German `Der Praktikant` term linked to the English `The Intern` — and this course
does not. The reasons, in order of weight:

1. The term set is a **contract**, not content. Appendix 03 fixes ten scapegoat terms and four
   severity terms, and `src/types/content.ts` narrows the four severity slugs into a TypeScript
   union that codegen can never derive. Translating the terms triples that set and makes the
   contract "ten terms, times however many languages exist today".
2. `severity` slugs are rendered through `SEVERITY_LABEL` in TypeScript, and the labels
   `S1 — Catastrophic`…`S4 — Cosmetic` are pinned by `src/types/content.test.ts` and by
   `e2e/funnel.spec.ts` (Lesson 16.4 selects the option named `S2 — Major`).
3. An untranslated taxonomy needs no seeder work, no linking phase, and no locale in its cache
   tag.

**The cost, stated plainly** — and it is a real cost, not a rounding error:

- A German incident card shows `S2 — Major` and `The Intern`. The severity badge and the
  scapegoat name are English on every German page in this project.
- The leaderboard double-counts. `count` is `wp_term_taxonomy.count`, which WordPress maintains
  per **post**, not per translation group, so an incident translated into German adds two to
  `The Intern`'s tally. After this module `/de/scapegoats` and `/en/scapegoats` show the same
  inflated numbers, and both are "right" by their own definition. Fixing it properly means a
  language-scoped `COUNT(*)` grouped by term — precisely the query Lesson 05.4 rejected with an
  `EXPLAIN` when it chose a taxonomy over a CPT.
- The right long-term fix is not "translate the terms" but "read the term's translated `name`
  from WPGraphQL instead of from a TypeScript map". That is a Module 22-sized refactor of two
  components and it is written down here rather than pretended away.

### 7. Media: one upload, all languages, and the reason

Polylang has a media translation mode. It creates one attachment post per language so an editor
can write `alt` text in each. This course turns it **off** (`media_support => 0`), and the
argument is worth having because it is the one place where the cheap answer is also the right
one.

| | Media translated | Media shared (**this course**) |
|---|---|---|
| Attachment posts | 12 × 3 = **36** | **12** |
| What genuinely differs per language | the `alt` text, and nothing else | — |
| Re-uploading a replacement logo | three attachments to update, or two stale ones | one |
| `wp media import` in the seeder | runs three times, three sets of files on the uploads volume | once |
| Cache tags | an attachment change invalidates per language | one invalidation, all languages |
| What you lose | — | **per-language `alt` text** |

Twelve attachments duplicated three ways to change one string per image is a permanent
maintenance cost bought with a small accessibility win. The honest mitigation: `alt` text on
this project comes from the ACF field or the attachment's own `alt` meta and is therefore
English everywhere, which Module 22 will notice and record as a known gap. If your project's
media is text-heavy — screenshots with UI in them, infographics — flip this decision, because
then the *image itself* differs per language and shared media is simply wrong.

One consequence to assert rather than assume: with media untranslated, **no attachment has a
language assigned at all**. `pll_get_post_language( $attachment_id )` returns `false`, not
`'en'`. Verification checks that, because "every attachment is English" and "attachments have no
language" behave differently the moment someone enables the setting.

### 8. `pll_*` is the API you already know, called from a different place

Nothing in this lesson is a new API. It is the same seven functions a Classic Polylang theme
calls, invoked from WP-CLI instead of from a template.

| Function | Does | Used here in |
|---|---|---|
| `pll_set_post_language( $id, 'de' )` | assigns a post to a language | every post the seeder creates |
| `pll_save_post_translations( [ 'en' => 412, 'de' => 588, 'uk' => 601 ] )` | writes the **whole group**, replacing it | the seeder's final phase |
| `pll_get_post_translations( $id )` | reads the group as `lang => id`, **including `$id` itself** | Verification |
| `pll_get_post( $id, 'de' )` | one sibling, or `false` | the fallback path in Lesson 20.2 |
| `pll_get_post_language( $id )` | the slug, or `false` if unassigned | the media negative check |
| `pll_languages_list()` | the configured language slugs | `ensure-languages` |
| `pll_count_posts( 'de', $args )` | posts per language, without a `WP_Query` | Verification |

Two details that matter in a headless build:

- `pll_save_post_translations()` takes the **complete** map and replaces the group. Passing
  `[ 'de' => 588 ]` alone does not add German to an existing group; it makes a group whose only
  member is 588 and quietly detaches the others. Always pass every language you know about,
  which is why the seeder builds the whole map before it calls anything.
- `pll_get_post_translations()` **includes the post you asked about**. WPGraphQL's `translations`
  field does the opposite and returns siblings only. The same concept, two off-by-one
  conventions, one codebase — Lesson 20.2 opens with it because it is the first thing that will
  bite you.

### 9. Translation groups are relationships, so they are the seeder's last phase

A group cannot exist before its members do. That single sentence fixes the phase order, and it
is the rule appendix 03 §9 already records ("Polylang translations linked **last** with
`pll_save_post_translations()`").

```
   wp blame seed --fresh --yes
   ─────────────────────────────────────────────────────────────────
   1  assert_seed_environment()   passwords present, WP_HOME pinned
   2  reset_seeded()              --fresh only
   3  seed_users()                editor, reporter, e2e_agent
   4  seed_media()                12 attachments, NO language
   5  seed_incidents()  ┐
   6  seed_reviews()    │ every EN original exists
   7  seed_posts()      │ and is assigned to `en`
   8  seed_pages()      ┘
   9  seed_menu(), seed_site_settings()
  ──────────────────────────────────────────────────────────────────
  10  TRANSLATIONS  ◀── this lesson. Creates the de/uk siblings,
                        then links every group. Needs 5–8 to be done.
```

Run phase 10 in the middle and you get the failure mode worth understanding: `upsert_post()`
finds no German sibling to link, `pll_save_post_translations()` is handed a one-entry map, and
the group it writes says "this content exists in German only". Nothing errors. The site is
subtly wrong and the seeder reports success — which is why the phase order is enforced by the
call site rather than by a comment.

**The linker lives in `mu-plugins/`, and the phase call lives in the plugin.** That split is
forced by Module 24: the production image copies
`wp-content/plugins/blame-the-tech-core` and nothing else, so a `require` of a fixture file from
`Plugin.php` would be a fatal error on a real deploy. The seeder therefore *offers* a phase —
`apply_filters( 'btt_seed_translations', 0 )` — and the mu-plugin fills it. In production
nothing listens, the filter returns `0`, and the output reads `translations 0`, which is the
truth.

> **A filter used as an extension point returns its default when nothing is listening, and
> "nothing listening" is indistinguishable from "nothing to do".** That is a real weakness of
> this pattern and the reason `wp blame ensure-languages` exits non-zero when Polylang is
> missing: the *language* bootstrap fails loudly, so a `translations 0` line can only ever mean
> "the fixture loader is not installed here", which is exactly what production should say.

### 10. `SEED_VERSION`, the digest, and a refusal that is a feature

The seeder now produces different content, so every dump exported before this lesson is a lie.
Lesson 12.4 built the mechanism that notices: the fixture's first line is a digest over
`SEED_VERSION` plus a hash of each seeder input file, and both `npm run e2e:reset` and
`e2e/global-setup.ts` compare it against the seeder on disk and **refuse** rather than warn.

```
   BEFORE                                  AFTER (this lesson)
   SEED_VERSION 1.0.0                      SEED_VERSION 1.1.0
   inputs: seed.php migrations.php         inputs: + translations.php
           blame-command.php
   digest  a3f1…                           digest  7c92…
   fixtures/seeded.sql first line a3f1…    first line still a3f1…  ← STALE
                                           → e2e:reset exits 1 and says so
```

Bump the version, add the new file to the digest inputs, re-seed, re-export. Three of those four
are obvious; the third is the one people skip, and skipping it means a future edit to the
translation matrix changes the fixture without changing the digest — a stale dump that claims to
be fresh, which is worse than no digest at all.

One more downstream consequence, and it is not optional: the fixture guard asserts a **count**.
`Fixture_Command::load()` errors unless the imported database holds exactly 40 published
incidents, and `global-setup.ts` repeats the check. After this lesson there are 55 incident
posts — 40 English, 10 German, 5 Ukrainian — so both numbers move together in Step 7, and the
new number is derived from the matrix in Step 6 rather than typed in. Get this wrong and every
Playwright run from Module 21 onward fails during setup, before a single spec executes, with a
message about the fixture rather than about your code.

---

## Task

### Step 1: Install Polylang, and record the version you got

```bash
cd wordpress-headless

docker compose run --rm wpcli wp plugin install polylang --activate
docker compose run --rm wpcli wp plugin list --name=polylang --fields=name,status,version
```

`polylang` is the free plugin's slug on wordpress.org, so a plain slug install is correct here.
It will not be correct in Lesson 20.2 — `wp-graphql-polylang` is not in the plugin directory —
and the difference is worth noticing now rather than debugging then.

Take the version from that second command and pin it, so a colleague and CI install the same
plugin you tested against:

```bash
# Substitute the version the command above printed.
docker compose run --rm wpcli wp plugin install polylang --version=3.6.6 --force --activate
```

**Verify §1:**

- [ ] `wp plugin list --name=polylang --field=status` prints `active`.
- [ ] `docker compose run --rm wpcli wp term list language --format=count` prints `0`. The
      taxonomy exists; no language does. That is the gap Step 3 closes.
- [ ] `http://localhost:8080/wp-admin/admin.php?page=mlang` shows Polylang's setup wizard. **Do
      not complete it.** Everything it would write, `wp blame ensure-languages` writes
      reproducibly.

### Step 2: Declare the content model in `includes/polylang.php`

Two filters and one array. This file states *what* is translatable and *what the settings should
be*; it writes nothing — Key Concept 4.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/polylang.php
<?php
/**
 * Polylang configuration, as a declaration.
 *
 * This file says which post types and taxonomies are translatable and what the
 * plugin's settings should be. It performs no writes: languages and options are
 * database state, and `wp blame ensure-languages` is what reconciles them.
 *
 * Contract: .lessons/appendix/03-content-model-reference.md §1, §2 and §9
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * The three course locales. Order is the order Polylang lists them in, which is
 * the order the front-end switcher inherits.
 *
 * `locale` is the WordPress locale, not the URL segment: `de` in a URL, `de_DE`
 * in wp-content/languages. Getting `en_GB` here instead of `en_US` changes date
 * formatting for every English reader, which is why it is pinned rather than
 * chosen in a wizard.
 */
const LANGUAGES = array(
	array( 'name' => 'English',    'slug' => 'en', 'locale' => 'en_US', 'rtl' => 0, 'flag' => 'us', 'term_group' => 0 ),
	array( 'name' => 'Українська', 'slug' => 'uk', 'locale' => 'uk',    'rtl' => 0, 'flag' => 'ua', 'term_group' => 1 ),
	array( 'name' => 'Deutsch',    'slug' => 'de', 'locale' => 'de_DE', 'rtl' => 0, 'flag' => 'de', 'term_group' => 2 ),
);

/** The default language. Every fallback in this project resolves here. */
const DEFAULT_LANGUAGE = 'en';

add_filter( 'pll_get_post_types', __NAMESPACE__ . '\\translatable_post_types', 10, 2 );
add_filter( 'pll_get_taxonomies', __NAMESPACE__ . '\\translatable_taxonomies', 10, 2 );

/**
 * `incident` and `tech_review` are translatable; `attachment` is not.
 *
 * `tech_review` is translatable and deliberately has no translations in the
 * fixture — Lesson 20.2 needs a post type where `where: { language: DE }`
 * correctly returns an empty list.
 *
 * @param array<string, string> $types    post_type => post_type.
 * @param bool                  $is_settings True on Polylang's own settings screen.
 * @return array<string, string>
 */
function translatable_post_types( array $types, bool $is_settings ): array {
	unset( $is_settings );

	$types['incident']    = 'incident';
	$types['tech_review'] = 'tech_review';

	// Media is shared across languages — Key Concept 7. Removing it here as well
	// as setting media_support => 0 is belt and braces: the option governs the
	// admin UI, this filter governs the code path.
	unset( $types['attachment'] );

	return $types;
}

/**
 * NO taxonomy is translatable in this project. Key Concept 6 argues it and names
 * the two costs: English severity badges on German pages, and a leaderboard that
 * counts a translation as its own incident.
 *
 * @param array<string, string> $taxonomies taxonomy => taxonomy.
 * @param bool                  $is_settings True on Polylang's own settings screen.
 * @return array<string, string>
 */
function translatable_taxonomies( array $taxonomies, bool $is_settings ): array {
	unset( $is_settings );

	foreach ( array( 'scapegoat', 'severity', 'tech_stack' ) as $taxonomy ) {
		unset( $taxonomies[ $taxonomy ] );
	}

	return $taxonomies;
}

/**
 * The settings `wp blame ensure-languages` enforces.
 *
 * @return array<string, int|string>
 */
function polylang_options(): array {
	return array(
		// 1 = the language is set from the directory name in pretty permalinks.
		// WordPress's own permalinks are never visited by a human here, but the
		// setting is what makes `?lang=` unnecessary and keeps wp-admin's
		// language switcher honest.
		'force_lang'    => 1,

		// Keep `/en/` OFF WordPress's own URLs, so every `uri` WPGraphQL returns
		// is the same string Modules 11 and 14 were built against. `/about/`, not
		// `/en/about/`. Change this and `toLocalePath()` produces `/en/en/about`.
		'hide_default'  => 1,

		// NO automatic browser redirect. Polylang would otherwise 302 a visitor
		// from `/` to their Accept-Language match, which fights next-intl's
		// middleware (Lesson 20.3) and makes the canonical URL depend on who is
		// asking. One system owns locale detection, and it is the front end.
		'browser'       => 0,

		// Shared media — Key Concept 7.
		'media_support' => 0,

		'default_lang'  => DEFAULT_LANGUAGE,
	);
}
```

Load it beside the other declarations:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',   // Lesson 03.2
		'includes/taxonomies.php',   // Lesson 03.3
		'includes/statuses.php',     // Lesson 03.4
		'includes/roles.php',        // Lesson 03.5
		'includes/app-token.php',    // Lesson 06.2
		'includes/polylang.php',     // Lesson 20.1
	);
```

> **Keep your own list, do not copy that one.** `INCLUDES` has grown in six lessons and your
> file is the authority for what is in it. The only change this step makes is appending
> `includes/polylang.php`. The `pll_*` filters are safe to register when Polylang is inactive —
> nothing ever calls them — so there is no conditional around the require.

### Step 3: Write `wp blame ensure-languages`

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/ensure-languages.php
<?php
/**
 * `wp blame ensure-languages` — make the database match includes/polylang.php.
 *
 * IDEMPOTENT BY CONTRACT. Module 24's Fly.io release_command runs this on every
 * deploy, including the hundred deploys after the languages already exist, so it
 * creates what is missing and touches nothing that is present.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core\CLI;

use WP_CLI;

use const Blame\Core\DEFAULT_LANGUAGE;
use const Blame\Core\LANGUAGES;

defined( 'ABSPATH' ) || exit;

/*
 * The second lock from Lesson 04.4: `WP_CLI::add_command()` on a web request is a
 * fatal error on every URL, wp-admin included.
 */
if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/**
 * Create every configured language that does not exist, then apply the options.
 *
 * @param string[]             $args       Positional arguments (none).
 * @param array<string, mixed> $assoc_args Associative arguments.
 */
function ensure_languages( array $args, array $assoc_args ): void {
	unset( $args );

	$dry_run = (bool) \WP_CLI\Utils\get_flag_value( $assoc_args, 'dry-run', false );

	// FAIL LOUDLY. A language bootstrap that cannot fail is one you cannot trust,
	// and this is the exit code Module 24's release_command reads to stop a deploy.
	if ( ! function_exists( 'PLL' ) || ! function_exists( 'pll_languages_list' ) ) {
		WP_CLI::error( 'Polylang is not active, so there is nothing to configure. Run `wp plugin activate polylang`.' );
	}

	$pll = PLL();

	if ( ! isset( $pll->model ) || ! method_exists( $pll->model, 'add_language' ) ) {
		WP_CLI::error( 'Polylang is active but its model is unavailable. This build of Polylang needs a different bootstrap.' );
	}

	$existing = pll_languages_list( array( 'fields' => 'slug' ) );
	$created  = 0;

	foreach ( LANGUAGES as $language ) {
		$slug = (string) $language['slug'];

		if ( in_array( $slug, $existing, true ) ) {
			// Report a mismatch; do NOT correct it. Changing a language's locale
			// re-keys every translation group attached to it, which is a content
			// migration and not something a deploy hook may decide to do.
			$current = pll_get_language( $slug );

			if ( $current instanceof \PLL_Language && $current->locale !== $language['locale'] ) {
				WP_CLI::warning(
					sprintf(
						'%s exists with locale %s, but polylang.php declares %s. Left alone — fix it deliberately.',
						$slug,
						$current->locale,
						(string) $language['locale']
					)
				);
			}

			continue;
		}

		if ( $dry_run ) {
			WP_CLI::log( sprintf( 'would create: %s (%s)', $slug, (string) $language['locale'] ) );
			++$created;

			continue;
		}

		$result = $pll->model->add_language( $language );

		if ( is_wp_error( $result ) ) {
			WP_CLI::error( sprintf( 'Could not create %s: %s', $slug, $result->get_error_message() ) );
		}

		WP_CLI::log( sprintf( 'created: %s (%s)', $slug, (string) $language['locale'] ) );
		++$created;
	}

	if ( ! $dry_run ) {
		// add_language() writes terms; the in-memory list is now stale, and the
		// options write below reads it.
		$pll->model->clean_languages_cache();

		$options = get_option( 'polylang' );
		$options = is_array( $options ) ? $options : array();
		$desired = \Blame\Core\polylang_options();

		// Merge over, never replace: Polylang's option array carries state this
		// file has no opinion about, including the taxonomy sync settings and the
		// internal version number it uses for its own upgrade routines.
		$merged = array_merge( $options, $desired );

		if ( $merged !== $options ) {
			update_option( 'polylang', $merged );
			WP_CLI::log( 'options: updated ' . implode( ', ', array_keys( $desired ) ) );
		}
	}

	if ( 0 === $created ) {
		WP_CLI::success( sprintf( 'All %d languages already exist. Nothing to do.', count( LANGUAGES ) ) );

		return;
	}

	WP_CLI::success( sprintf( '%d language(s) %s.', $created, $dry_run ? 'pending' : 'created' ) );
}

/**
 * Registered from the hook, not at load time.
 *
 * `blame` is created at the bottom of blame-command.php, and require order is
 * not something this file should depend on. Lesson 12.4 §6 uses the same hook to
 * attach `blame fixture` from an mu-plugin.
 */
WP_CLI::add_hook(
	'after_add_command:blame',
	static function (): void {
		WP_CLI::add_command(
			'blame ensure-languages',
			__NAMESPACE__ . '\\ensure_languages',
			array(
				'shortdesc' => 'Create the configured Polylang languages if they are missing. Idempotent.',
				'when'      => 'after_wp_load',
				'synopsis'  => array(
					array(
						'type'        => 'flag',
						'name'        => 'dry-run',
						'description' => 'List what would be created and change nothing.',
						'optional'    => true,
					),
				),
			)
		);
	}
);
```

Add it to the CLI include list:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const CLI_INCLUDES = array(
		'includes/cli/migrations.php',        // Lesson 04.5
		'includes/cli/seed.php',              // Lesson 04.5
		'includes/cli/blame-command.php',     // Lesson 04.4
		'includes/cli/ensure-languages.php',  // Lesson 20.1
	);
```

```bash
docker compose run --rm wpcli wp blame ensure-languages --dry-run
docker compose run --rm wpcli wp blame ensure-languages
docker compose run --rm wpcli wp blame ensure-languages
```

**Verify §3:**

- [ ] The `--dry-run` lists three languages and `wp term list language --format=count` is still
      `0` afterwards.
- [ ] The first real run logs three `created:` lines and one `options:` line.
- [ ] The **second** real run prints `All 3 languages already exist. Nothing to do.` and exits
      `0`. Confirm the exit code: `echo $?`.
- [ ] `docker compose run --rm wpcli wp option get polylang --format=json | head -c 200` contains
      `"force_lang":1` and `"browser":0`.

### Step 4: Write the translation matrix down before you write the code

This table is the fixture's contract. Lesson 20.2's negative checks and Lesson 20.4's
`hreflang` counts both assert against it, so it belongs in the repository rather than in the
seeder's control flow.

| Content | `en` | `de` | `uk` | German slug | Ukrainian slug |
|---|---|---|---|---|---|
| `page` `home` | ✅ | ✅ | ✅ | `startseite` | `holovna` |
| `page` `about` | ✅ | ✅ | ✅ | `ueber-uns` | `pro-nas` |
| `page` `hobt` | ✅ | ✅ | ✅ | `hobt-de` | `hobt-uk` |
| `incident-01` … `incident-05` | ✅ | ✅ | ✅ | `incident-NN-de` | `відмова-NN` |
| `incident-06` … `incident-10` | ✅ | ✅ | — | `incident-NN-de` | — |
| `incident-11` … `incident-40` | ✅ | — | — | — | — |
| `blog-01`, `blog-02` | ✅ | ✅ | — | `blog-NN-de` | — |
| `blog-03` … `blog-10` | ✅ | — | — | — | — |
| `review-01` … `review-08` | ✅ | — | — | — | — |
| media (12) | **no language at all** | — | — | — | — |

Row totals, which are the numbers Step 7 propagates: **55** `incident` posts (40 + 10 + 5),
**12** `post` posts (10 + 2), **9** `page` posts (3 × 3), **8** `tech_review` posts, **12**
attachments.

Three deliberate choices, each with its reason:

- **The German slugs are the English slug plus `-de`.** That is not what a real project has —
  a real German site says `/de/incidents/zertifikat-abgelaufen`. It is what a *fixture* should
  have: mechanically derivable, immune to a translation service changing its mind, and
  reproducible on a machine with no network. The **titles** are real translations, because the
  titles are what break a layout, and `Autoskalierung skalierte auf null` in a fixed-width badge
  is a bug you want to see.
- **The Ukrainian incident slugs are Cyrillic.** `відмова-01` is percent-encoded in a URL
  (`%D0%B2%D1%96%D0%B4%D0%BC%D0%BE%D0%B2%D0%B0-01`) and **not** percent-encoded in a cache tag,
  and those two facts meet in Lesson 20.4. A fixture with only Latin slugs never exercises it.
  The Ukrainian *page* slugs are transliterated instead, because plenty of real Ukrainian sites
  transliterate and both forms have to work.
- **`incident-11` to `incident-40`, all eight reviews and eight of the ten blog posts have no
  translation at all.** That is the deliberate untranslated subset. Lesson 20.2's fallback
  policy and Lesson 20.4's "advertises no `de` alternate" check need content that genuinely does
  not exist in German, and content that does not exist is much harder to fake than content that
  does.

### Step 5: Write the seeder's final phase

`mu-plugins` is globbed at the top level only and never recursed into, so this file is
`require_once`d by `blame-seeder.php` — the loader pattern from Lesson 12.4 §6. And because
mu-plugins load **before** regular plugins, nothing in it may run at load time: `pll_*` does not
exist yet, and neither does `Blame\Core\CLI\SEED_EPOCH`.

```php
// wordpress-headless/wp-content/mu-plugins/blame-seeder/translations.php
<?php
/**
 * The seeder's final phase: Polylang languages and translation groups.
 *
 * DEV AND CI ONLY, like everything in this directory. Module 24's production
 * image copies wp-content/plugins/blame-the-tech-core and nothing else, so the
 * plugin OFFERS this phase as a filter and this file fills it in. In production
 * nothing listens, the filter returns 0, and the seed output says
 * `translations 0` — which is the truth rather than a silent skip.
 *
 * A translation group is a RELATIONSHIP between posts, so this runs after every
 * post in every language exists. Lesson 20.1 Key Concept 9; appendix 03 §9.
 *
 * @package Blame\Seeder
 */

declare( strict_types=1 );

namespace Blame\Seeder;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

/** German titles for headlines 1-10, in SEED_HEADLINES order. */
const TITLES_DE = array(
	'Am Freitag deployt',
	'Das Zertifikat ist abgelaufen',
	'Jemand hat den falschen Schlüssel rotiert',
	'Der Cronjob lief zweimal',
	'Ein Regex hat die Nutzdaten gefressen',
	'Der Cache wurde nie invalidiert',
	'DNS-Propagierung ins Nirgendwo',
	'Die Migration lief rückwärts',
	'Autoskalierung skalierte auf null',
	'Eine Schaltsekunde im Logdatei-Parser',
);

/** Ukrainian titles for headlines 1-5. */
const TITLES_UK = array(
	'Розгортання перед вихідними',
	'Сертифікат прострочено',
	'Хтось змінив не той ключ',
	'Завдання cron виконалося двічі',
	'Регулярний вираз знищив дані',
);

/** slug => [ locale => [ slug, title ] ] for the three pages. */
const PAGES = array(
	'home'  => array(
		'de' => array( 'startseite', 'Blame The Tech' ),
		'uk' => array( 'holovna', 'Blame The Tech' ),
	),
	'about' => array(
		'de' => array( 'ueber-uns', 'Über uns' ),
		'uk' => array( 'pro-nas', 'Про нас' ),
	),
	'hobt'  => array(
		'de' => array( 'hobt-de', 'HOBT' ),
		'uk' => array( 'hobt-uk', 'HOBT' ),
	),
);

/** slug => [ locale => [ slug, title ] ] for the two translated blog posts. */
const POSTS = array(
	'blog-01' => array( 'de' => array( 'blog-01-de', 'Die Technik beschuldigen, Teil 1' ) ),
	'blog-02' => array( 'de' => array( 'blog-02-de', 'Die Technik beschuldigen, Teil 2' ) ),
);

/** How many incidents get each language. Step 4's matrix, as two integers. */
const INCIDENTS_DE = 10;
const INCIDENTS_UK = 5;

/**
 * Meta keys never copied to a translation.
 *
 * Everything else IS copied, deliberately: `_wp_page_template` (without which
 * the German HOBT page does not match the ACF location rule and `hobtPromo`
 * resolves to null), `_thumbnail_id` (media is shared, so the same attachment id
 * is correct in every language), and every ACF field including the repeater rows.
 */
const META_DENYLIST = array( '_edit_lock', '_edit_last', '_pll_strings_translations' );

/**
 * Resolve a seeded post by slug, or fail.
 */
function by_slug( string $slug, string $post_type ): \WP_Post {
	$post = get_page_by_path( $slug, OBJECT, $post_type );

	if ( ! $post instanceof \WP_Post ) {
		WP_CLI::error( sprintf( 'No %s with slug %s. Run the content phases before this one.', $post_type, $slug ) );
	}

	return $post;
}

/**
 * Create or update one translation of a seeded post, copying meta and terms.
 *
 * @return int The translation's post id.
 */
function clone_for_language( \WP_Post $source, string $language, string $slug, string $title ): int {
	$id = \Blame\Core\CLI\upsert_post(
		array(
			'post_type'    => $source->post_type,
			'post_name'    => $slug,
			'post_title'   => $title,
			'post_status'  => $source->post_status,
			'post_author'  => (int) $source->post_author,
			// The SAME dates as the original, not today's. Rule 2 from Lesson
			// 04.5 applies to a translation exactly as it does to an original.
			'post_date'    => $source->post_date,
			'post_date_gmt' => $source->post_date_gmt,
			// Block markup carried over verbatim, so the German page renders the
			// same block tree. Lesson 20.4 sweeps the block COMPONENTS for
			// hard-coded English; the block DATA is fine.
			'post_content' => $source->post_content,
			'post_excerpt' => $source->post_excerpt,
		)
	);

	foreach ( get_post_meta( $id ) as $key => $ignored ) {
		if ( ! in_array( $key, META_DENYLIST, true ) ) {
			delete_post_meta( $id, $key );
		}
	}

	foreach ( get_post_meta( $source->ID ) as $key => $values ) {
		if ( in_array( $key, META_DENYLIST, true ) ) {
			continue;
		}

		foreach ( (array) $values as $value ) {
			// maybe_unserialize: get_post_meta() without a key returns raw column
			// values, so a serialized array would be stored twice-serialized.
			add_post_meta( $id, $key, maybe_unserialize( $value ) );
		}
	}

	// Taxonomies are NOT translated (Key Concept 6), so the translation points at
	// the same terms. Copy the assignment rather than re-deriving it, or the
	// German incident and its English original could drift apart.
	foreach ( array( 'scapegoat', 'severity', 'tech_stack' ) as $taxonomy ) {
		$terms = wp_get_object_terms( $source->ID, $taxonomy, array( 'fields' => 'ids' ) );

		if ( ! is_wp_error( $terms ) ) {
			wp_set_object_terms( $id, $terms, $taxonomy );
		}
	}

	// upsert_post() re-stamps SEED_MARKER, so `wp blame reset` removes
	// translations along with originals.
	pll_set_post_language( $id, $language );

	return $id;
}

/**
 * Assign `en` to every seeded post that has no language yet, then build and link
 * every translation group.
 *
 * @param int $ignored The filter's default. Present so the signature matches.
 * @return int Number of translations written.
 */
function seed_translations( int $ignored ): int {
	unset( $ignored );

	if ( ! function_exists( 'pll_set_post_language' ) || array() === pll_languages_list() ) {
		WP_CLI::error(
			'Polylang has no languages, so translation groups cannot be linked. '
			. 'Run `wp blame ensure-languages` first — Lesson 20.1 Step 3.'
		);
	}

	// PHASE A — every seeded post is English until told otherwise. Idempotent:
	// pll_get_post_language() returns false only for an unassigned post.
	$originals = get_posts(
		array(
			'post_type'      => array( 'incident', 'tech_review', 'post', 'page' ),
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'meta_key'       => \Blame\Core\CLI\SEED_MARKER,
			'lang'           => '',
		)
	);

	foreach ( $originals as $id ) {
		if ( false === pll_get_post_language( (int) $id ) ) {
			pll_set_post_language( (int) $id, 'en' );
		}
	}

	$written = 0;

	// PHASE B — pages.
	foreach ( PAGES as $en_slug => $translations ) {
		$source = by_slug( (string) $en_slug, 'page' );
		$group  = array( 'en' => (int) $source->ID );

		foreach ( $translations as $language => $spec ) {
			$group[ (string) $language ] = clone_for_language(
				$source,
				(string) $language,
				(string) $spec[0],
				(string) $spec[1]
			);
			++$written;
		}

		pll_save_post_translations( $group );
	}

	// PHASE C — the two translated blog posts.
	foreach ( POSTS as $en_slug => $translations ) {
		$source = by_slug( (string) $en_slug, 'post' );
		$group  = array( 'en' => (int) $source->ID );

		foreach ( $translations as $language => $spec ) {
			$group[ (string) $language ] = clone_for_language(
				$source,
				(string) $language,
				(string) $spec[0],
				(string) $spec[1]
			);
			++$written;
		}

		pll_save_post_translations( $group );
	}

	// PHASE D — incidents. The matrix as a loop: 1-10 German, 1-5 Ukrainian.
	for ( $i = 1; $i <= INCIDENTS_DE; $i++ ) {
		$source = by_slug( sprintf( 'incident-%02d', $i ), 'incident' );
		$group  = array( 'en' => (int) $source->ID );

		// The `(#N)` suffix survives translation, so the same incident is
		// recognisable in all three locales — and Lesson 12.3's assertion on
		// `A leap second in the log parser (#40)` keeps its shape.
		$group['de'] = clone_for_language(
			$source,
			'de',
			sprintf( 'incident-%02d-de', $i ),
			sprintf( '%s (#%d)', TITLES_DE[ $i - 1 ], $i )
		);
		++$written;

		if ( $i <= INCIDENTS_UK ) {
			$group['uk'] = clone_for_language(
				$source,
				'uk',
				sprintf( 'відмова-%02d', $i ),
				sprintf( '%s (#%d)', TITLES_UK[ $i - 1 ], $i )
			);
			++$written;
		}

		// ONE call per group, with EVERY language in it. Passing a partial map
		// does not add to a group — it replaces the group with the partial one.
		pll_save_post_translations( $group );
	}

	return $written;
}

add_filter( 'btt_seed_translations', __NAMESPACE__ . '\\seed_translations' );
```

Wire it into the loader — one line, beside the `require_once` Lesson 12.4 wrote:

```php
// wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php — after the WP_CLI guard
require_once __DIR__ . '/translations.php';
```

**Verify §5:**

- [ ] `docker compose exec wordpress php -l /var/www/html/wp-content/mu-plugins/blame-seeder/translations.php`
      prints `No syntax errors detected`.
- [ ] The file contains no top-level call to anything beginning `pll_`. Everything is inside a
      function that runs during `wp blame seed`, long after `plugins_loaded`.
- [ ] `docker compose run --rm wpcli wp help blame` still lists every subcommand. A parse error
      in an mu-plugin takes out the whole CLI, so this is the fastest smoke test you have.

### Step 6: Call the phase from the seeder, and bump `SEED_VERSION`

Three small edits to `includes/cli/seed.php`, all of which change the fixture digest — which is
the point.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php — edit
/** Bumped whenever the fixture content changes shape. 1.1.0: Polylang translations. */
const SEED_VERSION = '1.1.0';
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php — edit seed_all()
	$counts = array(
		'media'        => count( $media ),
		'users'        => count( $users ),
		'incidents'    => seed_incidents( $users ),
		'tech_reviews' => seed_reviews( $media ),
		'posts'        => seed_posts( $media ),
		'pages'        => seed_pages( $media ),
		'menu_items'   => seed_menu(),
		'site_settings' => seed_site_settings(),
	);

	/**
	 * THE LAST PHASE. A translation group is a relationship between posts, so it
	 * cannot exist until every post in every language does — Key Concept 9.
	 *
	 * A filter rather than a call: the linker lives in mu-plugins, which the
	 * production image does not contain. Nothing listening returns 0, and
	 * `translations 0` is the honest output for a production seed.
	 */
	$counts['translations'] = (int) apply_filters( 'btt_seed_translations', 0 );
```

And the digest has a new input, so `seeder_inputs()` has to know about it. Without this line an
edit to the translation matrix changes the fixture and **not** its digest — a stale dump that
claims to be fresh, which is worse than having no digest:

```php
// wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php — edit seeder_inputs()
	$files = array(
		$dir . '/seed.php',
		$dir . '/migrations.php',
		$dir . '/blame-command.php',
		// Lesson 20.1. Not under $dir: the linker is an mu-plugin, for the reason
		// its own file header gives. It is still a seeder input.
		__DIR__ . '/translations.php',
	);
```

**Verify §6:**

- [ ] `docker compose run --rm -T wpcli wp blame fixture status | head -1` prints a **different**
      digest from `head -1 ../fixtures/seeded.sql`. The dump is now correctly reported as stale.
- [ ] `docker compose run --rm -T wpcli wp blame fixture status 2>&1 >/dev/null` lists four
      input files, including `translations.php`.

### Step 7: Move the two hard-coded incident counts

Lesson 12.4 asserts that a loaded fixture holds exactly **40** published incidents, in two
independent places. There are 55 now, and both places have to learn the new number **before**
you re-seed — otherwise the next `npm run e2e:reset` refuses a fixture that is perfectly
correct, and the error message talks about the dump rather than about this lesson.

```php
// wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php — edit
/**
 * Published incident posts in a correct fixture.
 *
 * 40 English originals + 10 German + 5 Ukrainian = 55, from Lesson 20.1's
 * translation matrix. `wp_count_posts()` is a grouped COUNT(*) on wp_posts with
 * no language awareness, so this is the total across all three languages, and it
 * is deliberately the total: the assertion means "this dump is the fixture", and
 * the fixture has three languages in it now.
 */
const FIXTURE_INCIDENTS = 55;
```

```php
// wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php — edit Fixture_Command::load()
		if ( FIXTURE_INCIDENTS !== $count ) {
			WP_CLI::error(
				sprintf(
					'Imported, but there are %d published incidents rather than %d. '
					. 'The dump is not a seeded fixture — re-export it.',
					$count,
					FIXTURE_INCIDENTS
				)
			);
		}
```

```ts
// next-app/e2e/global-setup.ts — edit: the post-import assertion
  // 40 English + 10 German + 5 Ukrainian, from Lesson 20.1's translation matrix.
  // `wp post list` goes through WP_Query, and with Polylang active a WP_Query
  // without `lang` is answered per Polylang's own context rules — so this asks
  // wp_count_posts() instead, which is a plain grouped COUNT(*) and cannot be
  // filtered by language.
  const count = wp(['eval', 'echo (int) wp_count_posts("incident")->publish;']);

  if (count !== '55') {
    fail([`Expected 55 incidents after the import, found ${count}.`]);
  }

  console.log('[e2e] database reset from fixtures/seeded.sql — 55 incidents.');
```

> **This is the shape of every "add a language" change.** The content model grew by one
> dimension, and three assertions that were about *content* turned out to be about *English
> content*. There is no way to find them except by grepping for the number and reading each hit,
> which is why Verification greps for `40` across `e2e/` and the mu-plugin at the end.

### Step 8: Re-seed, then export a fresh fixture

`--fresh` calls `WP_CLI::confirm()`, so `--yes` is mandatory and `docker compose run` needs
`-T`. Without both, this command waits on a terminal that is not there and looks like a hang.

```bash
cd wordpress-headless

docker compose run --rm -T wpcli wp blame ensure-languages
docker compose run --rm -T wpcli wp blame seed --fresh --yes
```

No password variables are needed: the three accounts already exist, and `assert_seed_environment()`
asks for a credential only when it has to create one (Lesson 12.4 Step 3).

Then re-export the dump the digest just invalidated:

```bash
docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql
head -1 ../fixtures/seeded.sql
docker compose run --rm -T wpcli wp blame fixture status | head -1
```

**Verify §8:**

- [ ] The seed output ends with `translations 23` — 6 page translations, 2 post translations, 10
      German incidents and 5 Ukrainian ones. If it says `translations 0`, `blame-seeder.php` is
      not requiring `translations.php`.
- [ ] The two digest lines are now **identical**.
- [ ] `npm run e2e:reset` from `next-app/` prints `restored: 55 incidents.` and exits `0`.
- [ ] `http://localhost:3000/en/incidents` renders and now shows German rows mixed in with the
      English ones. **That is correct for exactly one lesson.** WPGraphQL has no idea about
      languages until Lesson 20.2 installs the extension, so `incidents(first: 12)` returns the
      newest twelve posts of any language — which is the ambient-versus-explicit problem from
      the Classic WP Analogy, visible in a browser.

---

## Verification

```bash
cd wordpress-headless

# 1. Three languages exist, with the locales polylang.php declares
docker compose run --rm -T wpcli wp term list language --fields=slug,name --format=csv
# Expected: a header row plus en/English, uk/Українська, de/Deutsch — three data rows

docker compose run --rm -T wpcli wp eval 'foreach (pll_languages_list() as $s) { $l = pll_get_language($s); printf("%s %s\n", $s, $l->locale); }'
# Expected: en en_US
#           uk uk
#           de de_DE

# 2. The options were applied, and the browser redirect is OFF
docker compose run --rm -T wpcli wp eval '$o = get_option("polylang"); printf("force_lang=%d hide_default=%d browser=%d media=%d default=%s\n", $o["force_lang"], $o["hide_default"], $o["browser"], $o["media_support"], $o["default_lang"]);'
# Expected: force_lang=1 hide_default=1 browser=0 media=0 default=en

# 3. NEGATIVE — running ensure-languages again creates nothing at all.
#    Byte-for-byte comparison of the term list, not a count: a count would not
#    notice a locale or an ordering change.
docker compose run --rm -T wpcli wp term list language --fields=term_id,slug,name,description --format=csv > /tmp/btt-lang-before.csv
docker compose run --rm -T wpcli wp blame ensure-languages
echo "exit=$?"
# Expected: "All 3 languages already exist. Nothing to do." and exit=0
docker compose run --rm -T wpcli wp term list language --fields=term_id,slug,name,description --format=csv > /tmp/btt-lang-after.csv
diff /tmp/btt-lang-before.csv /tmp/btt-lang-after.csv && echo IDENTICAL
# Expected: IDENTICAL. Same term ids, same serialized descriptions.

# 4. Per-language content counts match the Step 4 matrix.
#    pll_count_posts() rather than `wp post list --format=count`: it asks
#    Polylang directly instead of relying on how WP_Query behaves in CLI.
docker compose run --rm -T wpcli wp eval 'foreach (["en","uk","de"] as $l) printf("%s incidents=%d posts=%d pages=%d reviews=%d\n", $l, pll_count_posts($l,["post_type"=>"incident"]), pll_count_posts($l,["post_type"=>"post"]), pll_count_posts($l,["post_type"=>"page"]), pll_count_posts($l,["post_type"=>"tech_review"]));'
# Expected: en incidents=40 posts=10 pages=3 reviews=8
#           uk incidents=5  posts=0  pages=3 reviews=0
#           de incidents=10 posts=2  pages=3 reviews=0

# 5. The total across all languages — the number the fixture guard now asserts
docker compose run --rm -T wpcli wp eval 'echo (int) wp_count_posts("incident")->publish, PHP_EOL;'
# Expected: 55

# 6. A translated incident's group has all three languages, and includes ITSELF
docker compose run --rm -T wpcli wp eval '$id = get_page_by_path("incident-01", OBJECT, "incident")->ID; print_r(pll_get_post_translations($id));'
# Expected: an array with keys en, uk and de — three ids, and the `en` value IS
#           the id you passed in. pll_* includes the post; GraphQL will not.

# 7. An incident outside the matrix has a group of one — the untranslated subset
docker compose run --rm -T wpcli wp eval '$id = get_page_by_path("incident-40", OBJECT, "incident")->ID; echo count(pll_get_post_translations($id)), PHP_EOL;'
# Expected: 1. incident-40 exists in English only, deliberately.

# 8. The Cyrillic slug survived the round trip intact
docker compose run --rm -T wpcli wp eval '$p = get_page_by_path("відмова-01", OBJECT, "incident"); echo $p->post_name, " ", $p->post_title, PHP_EOL;'
# Expected: відмова-01 Розгортання перед вихідними (#1)
#           If the slug came back transliterated or empty, sanitize_title() ran
#           against a non-UTF8 connection — check the db charset (Lesson 02.2).

# 9. The German HOBT page kept the page template, so its ACF group still applies
docker compose run --rm -T wpcli wp eval '$id = get_page_by_path("hobt-de", OBJECT, "page")->ID; echo get_post_meta($id, "_wp_page_template", true), " thumb=", (int) get_post_thumbnail_id($id), PHP_EOL;'
# Expected: templates/hobt.php thumb=<a non-zero id>
#           A zero or an empty template means the meta copy in
#           clone_for_language() skipped a key it should not have.

# 10. NEGATIVE — no attachment has a language. Not "every attachment is English":
#     media is outside the translation model entirely (Key Concept 7).
docker compose run --rm -T wpcli wp eval '$n = 0; foreach (get_posts(["post_type"=>"attachment","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"any"]) as $id) { if (pll_get_post_language($id) !== false) ++$n; } printf("attachments_with_language=%d\n", $n);'
# Expected: attachments_with_language=0

# 11. NEGATIVE — no taxonomy is translatable, so no term carries a language
docker compose run --rm -T wpcli wp eval 'print_r(array_values(pll_get_taxonomies()));'
# Expected: an array WITHOUT scapegoat, severity or tech_stack in it
docker compose run --rm -T wpcli wp eval '$t = get_term_by("slug", "the-intern", "scapegoat"); var_export(pll_get_term_language($t->term_id));'
# Expected: false — the term is shared across all three languages

# 12. NEGATIVE — ensure-languages exits non-zero when Polylang is inactive.
#     This is the exit code Module 24's release_command depends on.
docker compose run --rm -T wpcli wp plugin deactivate polylang
docker compose run --rm -T wpcli wp blame ensure-languages
echo "exit=$?"
# Expected: "Error: Polylang is not active..." and exit=1
docker compose run --rm -T wpcli wp plugin activate polylang
# Expected: Success. Deactivating never deleted the language terms — they are
#           data, and that is the whole point of Key Concept 4.

# 13. NEGATIVE — a one-entry translation group is what a mid-order run produces.
#     Proved on a THROWAWAY post, so your fixture is never in that state.
docker compose run --rm -T wpcli wp eval '
$probe = wp_insert_post(["post_type"=>"incident","post_title"=>"probe","post_name"=>"btt-order-probe","post_status"=>"draft"], true);
pll_set_post_language($probe, "de");
pll_save_post_translations(["de" => $probe]);
printf("group_size=%d languages=%s\n", count(pll_get_post_translations($probe)), implode(",", array_keys(pll_get_post_translations($probe))));
wp_delete_post($probe, true);
'
# Expected: group_size=1 languages=de
#           A group that says "German only" with no error and no warning. That is
#           what linking before the English original exists produces, which is why
#           translations are the LAST seeder phase.

# 14. The digest agrees with the dump you just exported
diff <(head -1 ../fixtures/seeded.sql) <(docker compose run --rm -T wpcli wp blame fixture status 2>/dev/null) && echo FRESH
# Expected: FRESH

# 15. NEGATIVE — a dump whose digest does not match is REFUSED, not warned about.
#     A throwaway copy with a corrupted first line; the real fixture is untouched.
cp ../fixtures/seeded.sql /tmp/btt-stale.sql
{ echo '-- btt-seed-digest: 0000000000000000000000000000000000000000000000000000000000000000'; tail -n +2 /tmp/btt-stale.sql; } > /tmp/btt-stale-2.sql
test "$(head -1 /tmp/btt-stale-2.sql)" = "$(docker compose run --rm -T wpcli wp blame fixture status 2>/dev/null)" && echo ACCEPTED || echo REFUSED
# Expected: REFUSED — the same string comparison `npm run e2e:reset` makes
rm -f /tmp/btt-stale.sql /tmp/btt-stale-2.sql /tmp/btt-lang-before.csv /tmp/btt-lang-after.csv

# 16. NEGATIVE — no stale `40` is left in the two places that assert the count
grep -rn '40 incidents\|!== 40\|=== 40' ../fixtures 2>/dev/null; grep -rn "'40'" ../next-app/e2e/ wp-content/mu-plugins/blame-seeder/
# Expected: no output

# 17. The whole fixture round-trips: load the dump you exported and get the same DB
docker compose run --rm -T wpcli wp blame fixture load < ../fixtures/seeded.sql
# Expected: "restored: 55 incidents."
docker compose run --rm -T wpcli wp blame status
# Expected: incidents 55, tech_reviews 8, posts 12, pages 9, media 12, db_version 3
```

## Control Questions

1. `pll_get_post_translations()` on a three-language incident returns three entries;
   WPGraphQL's `translations` field on the same node returns two. Explain the difference, and
   say which of the two shapes an `hreflang` cluster needs.
2. `wp blame ensure-languages` is safe to run on every deploy, but `wp blame seed --fresh` is
   not. Both are idempotent in the sense of "the same result if you run it twice". Name the
   property `ensure-languages` has that `seed --fresh` does not, and say which line of
   `ensure_languages()` provides it.
3. This project registers `scapegoat`, `severity` and `tech_stack` as **not** translatable. Give
   the two costs that decision imposes on a German reader, and describe what would have to
   change in `src/types/content.ts` and in `e2e/funnel.spec.ts` if you reversed it.
4. Free Polylang translates a post slug but not a custom post type's rewrite slug. Explain, in
   terms of the `uri` field WPGraphQL returns, why that single limitation decides whether
   `/de/incidents/…` or `/de/vorfaelle/…` is the right route shape for this application.
5. Suppose you moved `apply_filters( 'btt_seed_translations', 0 )` from the end of `seed_all()`
   to immediately after `seed_media()`. Describe exactly what the seeder would write, what it
   would print, and why no error would be raised.

## Learn More

- [Polylang — Functions reference](https://polylang.pro/doc/function-reference/) — the canonical
  list of `pll_*` functions, including which ones return `false` rather than an empty array; read
  `pll_save_post_translations` before you call it
- [Polylang — Translating a custom post type](https://polylang.pro/doc/integrate-custom-post-types-and-taxonomies/)
  — the `pll_get_post_types` and `pll_get_taxonomies` filters used in Step 2, in the author's own
  words
- [Polylang FAQ — how the data is stored](https://polylang.pro/doc/faq/) — confirms the
  `language` and `post_translations` taxonomies and the serialized term description, which is
  what Key Concept 1's diagram is drawn from
- [Polylang Pro — translating URL slugs](https://polylang.pro/downloads/polylang-pro/) — the
  feature that would reverse Lesson 20.3's `pathnames` decision, so you know what the reversal
  costs before you argue for it
- [WordPress — `register_taxonomy()`](https://developer.wordpress.org/reference/functions/register_taxonomy/)
  — read `public`, `rewrite` and `show_in_graphql` together; Polylang's two taxonomies are
  private, which is why they never appear in wp-admin
- [WP-CLI — `WP_CLI::add_command()`](https://make.wordpress.org/cli/handbook/references/internal-api/wp-cli-add-command/)
  — the `synopsis` array and the `after_add_command:` hook used in Step 3
- [WP-CLI handbook — commands cookbook](https://make.wordpress.org/cli/handbook/guides/commands-cookbook/)
  — argument parsing, `WP_CLI\Utils\get_flag_value()`, and exit-code conventions for a command a
  deploy hook will run
- [WordPress — `wp_count_posts()`](https://developer.wordpress.org/reference/functions/wp_count_posts/)
  — the grouped `COUNT(*)` Step 7 relies on, and the `wp_count_posts` filter that would break the
  assumption if a plugin ever hooked it
- [W3C — Language tags in HTML and XML](https://www.w3.org/International/articles/language-tags/)
  — why `de` and `de_DE` are different strings for different jobs, which is the distinction
  `LANGUAGES` encodes in two adjacent keys
- [Yoast — hreflang: the ultimate guide](https://yoast.com/hreflang-ultimate-guide/) — read the
  "return links" section now; Lesson 20.4 builds the cluster, and knowing what a broken one looks
  like first makes that lesson shorter
