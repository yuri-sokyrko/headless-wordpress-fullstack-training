---
title: 'WPGraphQL Polylang'
module: 20
lesson: 2
teaches: [wp-graphql-polylang, language-code-enum, translations-field, locale-fallback, sibling-lookup]
produces: ['next-app/src/graphql/fragments/Translations.graphql', 'next-app/src/lib/i18n/locale.ts', 'wordpress-headless/schema.graphql']
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

### 1. Exactly what the plugin adds, and exactly where

Three additions, and knowing *where* each one lands is what tells you which of your documents
has to change.

```
   CONTENT NODE                      CONNECTION                    ENUM
   ─────────────────────────         ──────────────────────        ──────────────
   incident {                        incidents(                    LanguageCodeEnum
     language { code locale slug }     where: { language: DE }       EN | UK | DE
     translations { … }              )                             + DEFAULT
   }                                                               + ALL
     ▲                                  ▲
     │ two new fields on every           │ one new key in every
     │ translatable post type            │ connection's `where`
```

| Addition | Appears on | Shape |
|---|---|---|
| `language` | every translatable content node | `{ code: LanguageCodeEnum, locale: String, slug: String, name: String }` |
| `translations` | every translatable content node | a list of **sibling** nodes — never the node itself |
| `where: { language: … }` | every content connection (`incidents`, `posts`, `pages`, `techReviews`) | `LanguageCodeEnum` |
| `LanguageCodeEnum` | the schema | one value per configured language, plus `DEFAULT` and `ALL` |

And the fourth thing, which is an **absence** and which shapes half this lesson: **nothing is
added to a single-node lookup.** `incident(id: $slug, idType: SLUG)` takes no language argument
and never will, because a slug already identifies exactly one post. There is no
`incident(slug: "incident-01", language: DE)`. So the module has two different kinds of query
with two different defences, and Key Concept 3 is that table.

> **`DEFAULT` and `ALL` are real enum values and this project uses neither.** `DEFAULT` means
> "whatever `default_lang` says", which puts a decision that belongs in your routing into a
> WordPress option. `ALL` means "every language mixed together", which is the state
> `/en/incidents` was in at the end of Lesson 20.1 and the reason that lesson's last Verify
> bullet warned you. Both exist for a Classic site with a language switcher widget. Here, the
> locale comes from the URL segment and is passed explicitly, every time.

### 2. An unspecified `language` is not an error

This is the single most expensive fact in the lesson. Leave the filter out and the query
succeeds:

| Query | Returns |
|---|---|
| `incidents(first: 12)` | the newest twelve **English** incidents — the default language, silently |
| `incidents(first: 12, where: { language: DE })` | the newest twelve German incidents |
| `incidents(first: 12, where: { language: ALL })` | mixed, all three languages |
| `techReviews(first: 8, where: { language: DE })` | **zero nodes**, correctly — nothing is translated |

No error. No warning. No `errors` array. HTTP 200, well-formed data, and a page that looks
perfect in the locale you happen to be testing in.

**The failure-mode asymmetry is what makes this dangerous, and it is worth stating precisely.**
In a Classic Polylang theme the ambient language can be *wrong*, and when it is, you find out
in one second: the entire page is in the wrong language and you cannot miss it. Here the filter
can be *absent*, and absence degrades gracefully:

```
   AMBIENT DEFAULT IS WRONG              AN EXPLICIT FILTER IS MISSING
   ─────────────────────────────         ──────────────────────────────────
   /de/incidents                         /de/incidents
     nav        German                     nav        German   (next-intl)
     headings   German                     headings   German   (next-intl)
     body       German                     body       German   (query localised)
     everything German — but it is         "Related incidents"  ENGLISH
     the wrong German page                   ↑ that document predates $language
   noticed in: 1 second                   noticed in: a month, by a customer
```

One rail on one page in one locale. Nobody browsing in English will ever see it, which means
nobody on your team will ever see it, which means it ships.

### 3. Two kinds of document, two mechanical defences

Vigilance does not scale and a compile error does. But you cannot bolt the same defence onto
both kinds of query, and pretending otherwise produces a document that will not even parse.

| Document kind | Example | Defence | Why that one |
|---|---|---|---|
| **connection** | `IncidentsList`, `PostsList`, `ReviewsList`, `PageUris`, `IncidentSlugs`, `HomepageFeeds`, `IncidentTicker` | a **required** `$language: LanguageCodeEnum!` variable | `tsc` refuses to build a call site that omits it |
| **single node** | `IncidentBySlug`, `PostBySlug`, `ReviewBySlug`, `PageByUri`, `HobtPromo` | select `language { code }` and **assert at runtime** | there is no argument to make required |

**Adding `$language` to a single-node document is not "belt and braces", it is a build failure.**
GraphQL validation rejects a declared variable that no field uses — `Variable "$language" is
never used in operation "IncidentBySlug"` — and codegen fails before TypeScript sees it. So
those five documents get a runtime check, in exactly one function that routes call instead of
unwrapping the node themselves. That check is more than a consolation prize: slugs are globally
unique, so `incident(id: "incident-01", idType: SLUG)` under a `/de/` URL returns the **English**
incident, and `node.language.code === 'EN'` while the URL says `de` is a complete description of
the problem — no second query, no lookup table. Key Concept 8 turns that one comparison into the
whole untranslated-content policy.

### 4. `translations` returns siblings only, and the off-by-one costs you a whole cluster

A three-language incident:

```
   pll_get_post_translations( 412 )      incident(id:"incident-01"){ translations }
   ─────────────────────────────────     ────────────────────────────────────────────
   [ en => 412,   ◀── ITSELF             [ { language:{code:UK}, slug:"відмова-01" },
     uk => 601,                            { language:{code:DE}, slug:"incident-01-de" } ]
     de => 588 ]                          ▲
   3 entries                              2 entries — the node is NOT in its own list
```

The PHP API includes the post you asked about. The GraphQL field does not. Same concept, two
conventions, one codebase, and the consequence lands in Lesson 20.4: an `hreflang` cluster has
to be **self-inclusive**, so building it from `translations` alone produces a page that does not
advertise itself. Google calls that missing return tags, ignores the whole cluster, and tells you
about it in Search Console roughly six weeks later — long after the deploy that caused it.

Write the combining step once, in one function, and never spread `translations` directly into a
cluster. Lesson 20.4's `alternates.ts` is that function; this lesson's job is to make sure the
data it needs is selected everywhere it is needed.

### 5. One mapper, because two vocabularies

`'de'` and `DE` are not the same string, and there is exactly one place in this codebase that
knows the difference.

| Vocabulary | Values | Owned by |
|---|---|---|
| URL segment / `NEXT_LOCALE` cookie / `<html lang>` | `en`, `uk`, `de` — BCP-47-ish, lowercase | the front end (Lesson 20.3's `routing.ts`) |
| `LanguageCodeEnum` | `EN`, `UK`, `DE` — a GraphQL enum | WordPress, derived from Polylang's slugs |

`.toUpperCase()` looks like it closes the gap and it is a bug waiting for its second language
region. `pt-BR` uppercases to `PT-BR`, which is not a valid GraphQL enum name — enum names match
`/[_A-Za-z][_0-9A-Za-z]*/`, and a hyphen is not in it. WPGraphQL Polylang emits `PT_BR`. So the
transformation is not "uppercase", it is "uppercase, then replace `-` with `_`", and the moment
you know that you also know it should be a lookup table rather than a string operation:

```ts
// (illustration — the real file is in the Task)
// ❌ works for exactly the three locales you have today
const language = locale.toUpperCase();

// ✅ a total function over a closed set, checked by the compiler
const LANGUAGE_CODE: Record<Locale, LanguageCodeEnum> = { en: 'EN', uk: 'UK', de: 'DE' };
```

The second form has a property the first cannot: **`Record<Locale, …>` is exhaustive.** Add
`'fr'` to `Locale` in Lesson 20.3's `routing.ts` and `npm run type-check` fails here, in the one
file that has to change, before anything renders. `.toUpperCase()` would have shipped a French
site querying a language WordPress has never heard of.

### 6. The ambient-versus-explicit inversion

You have written the Classic version of this code and the habits are the wrong way round.

| | Classic Polylang theme | Headless |
|---|---|---|
| Where the language comes from | the URL, read by Polylang on `parse_request` | the URL, read by **Next**, passed as a variable |
| The main query | scoped automatically by `pre_get_posts` | there is no main query |
| A secondary `WP_Query` | scoped automatically too | every query is secondary; nothing is scoped |
| Opting out | `'lang' => ''` — the escape hatch you looked up once | there is nothing to opt out of |
| Forgetting | impossible | the default behaviour |

The inversion is architectural rather than a plugin decision: WordPress is answering a request
from **a server in another country**, and that server's visitor is not WordPress's visitor.
`pll_current_language()` returns the default in a GraphQL request and it would be wrong to
return anything else. So the Classic escape hatch and the headless default are the same value
approached from opposite directions — which is why Lesson 20.1's seeder passed `'lang' => ''`
to enumerate every post regardless of language.

### 7. Three documents that deliberately do not take a language

The rule "every document states its language" has exactly three exceptions in this project, and
they are exceptions for the same reason: **the thing they fetch has no language.**

| Document | Fetches | Why no `$language` |
|---|---|---|
| `SiteChrome` | `generalSettings`, the ACF options page | one global record. Polylang can translate options with its Strings Translation screen; this project does not, so there is one set of values and asking for a language would be asking a question with no answer |
| `PrimaryMenu` | `menuItems(where: { location: PRIMARY })` | one menu. Polylang stores a menu per location **per language** (`primary___de` in `nav_menu_locations`), and Lesson 20.1's fixture seeds only the English one |
| `ScapegoatLeaderboard` | `scapegoats(where: { orderby: COUNT })` | taxonomies are not translatable here (Lesson 20.1 §6), so terms have no language and the connection has no `language` key to pass |

**The silent default that is a bug in Key Concept 2 is exactly right in these three cases**, and
that is worth sitting with rather than glossing over. `incidents(first: 12)` returning English
is a bug because German incidents exist and the query wanted them. `siteSettings` returning "the
default" is correct because there is only one, and the plugin's behaviour — an unspecified
language resolves to the default — is precisely the answer.

The cost, stated plainly: **the primary nav renders English labels in all three locales.** An
editor who wants a German nav creates a second menu, assigns it to the primary location for
German in Polylang's menu screen, and the query then needs a language after all. That is a
twenty-line change in `Header` and a seeder phase, it is written down here rather than pretended
away, and the reason it is not in this module is that translating a *menu* teaches nothing that
translating a *post* has not already taught.

### 8. Untranslated content: three options, one policy, three cases

A German visitor asks for something that has no German version. There are three defensible
answers and they differ in what they promise to a search engine:

| Option | The user sees | `hreflang` consequence | Verdict |
|---|---|---|---|
| **404** | "not found", for content that exists | honest, and hostile: an inbound link from a German-language forum dead-ends | ❌ punishes the visitor for your content gaps |
| Render the English content under the German URL | the article, in English, at `/de/…` | **a lie** — either you advertise a `de` alternate that is really English (duplicate content across three URLs) or you omit it and leave a URL no cluster mentions | ❌ two systems disagreeing about what the German version *is* |
| **307 to the default-locale URL with `?from=de`** | the English article at `/en/…`, with a dismissible "Not available in Deutsch" notice | **nothing is claimed** — the German URL does not exist, so no cluster anywhere advertises a `de` alternate for it | ✅ **chosen** |

The redirect wins because it is the only one of the three where the URL and the content agree.
`/en/incidents/incident-40` is English and says so; there is no German URL, so there is nothing
to describe. **The cost, stated plainly:** `?from=de` is a shareable URL carrying a piece of
session state, so someone pastes it into Slack and the recipient sees a notice about a language
they never asked for. The canonical tag (Lesson 19.2, extended in Lesson 20.4) never includes
the query string, so nothing indexes the flagged variant, and the notice is dismissible.

Now the cases, because they are not one branch:

| Case | Example | What happens |
|---|---|---|
| the node does not exist at all | `/de/incidents/no-such-thing` | `notFound()` — a 404, unchanged from Lesson 10.4 |
| the node exists in **another** locale | `/de/incidents/incident-40` | **307** to `/en/incidents/incident-40?from=de` |
| the node exists and a sibling in the requested locale exists too | `/de/incidents/incident-01` | **307** to `/de/incidents/incident-01-de` — the *right* German URL, not a bounce to English |
| a **list** is empty in this locale | `/de/reviews` | **200** with an empty state. A list exists in every locale; it is just empty |

The third row pays for itself: a German reader following an old English link lands on the German
article, and a hand-typed URL normalises itself. The fourth matters too, and confusing it with
the second is a real mistake — **an empty list is not untranslated content.** `/de/reviews` is a
real German page that correctly contains nothing, and redirecting it would hide "you have no
German reviews" from the only person who could fix it. One implementation rule, which Lesson
20.4 depends on: **the branch lives in one function that routes call, not in the routes.** Six
route files hand-rolling four cases is six chances to get the third one backwards.

### 9. Global slug uniqueness is what makes any of this work

WordPress enforces one `post_name` per post type across the whole table, and Polylang does not
change that in this configuration. `incident-01`, `incident-01-de` and `відмова-01` are three
globally unique slugs, so `incident(id: "incident-01-de", idType: SLUG)` resolves exactly once
with no language argument — and `/de/incidents/incident-01` carries information that
**contradicts** its own locale, which is what makes Key Concept 8 detectable.

One wrinkle follows, and it is duplicate content rather than a crash. `/hobt` has a dedicated
route (Lesson 14.4 §7 lists the five reserved first segments), so the English HOBT page is
unreachable through the `[...slug]` catch-all. Its German translation's slug is `hobt-de`, which
is **not** reserved — so `/de/hobt-de` renders the same document as `/de/hobt` through a
different route, with a different heading and no ACF field group, and Lesson 19.4's sitemap
would list both. The fix generalises: **a page reachable through a dedicated route is not
reachable through the catch-all in any language.** The catch-all already has the translation
group, so it asks whether any member of it sits at a reserved URI.

### 10. Where the locale must not go

Two boundaries this lesson does not cross, named so nobody crosses them by accident in the next
one.

**`fetchGraphQLAuthed` still takes no cache options.** The temptation, once locale is a cache
tag, is to tag the authenticated response with the locale too. The authenticated client
hard-codes `cache: 'no-store'` and has no options parameter at all, by design — Module 18's
README opens with the rule. A per-user response cannot be tagged, therefore cannot be cached,
therefore cannot be served to a different user; adding a locale would not make that safe, it
would make it *look* safe.

**Cache tags stay locale-free in this lesson.** Every read you edit keeps the tags Lesson 10.3
gave it. Locale-aware tags need the Next side and the PHP builder in `includes/Revalidate.php`
to change in the **same** lesson, or the webhook silently invalidates nothing — so both halves
are Lesson 20.4's. Locale-scope the tags here and publishing in German stops purging anything at
all, while the endpoint returns `200` and logs nothing.

---

## Task

### Step 1: Install `wp-graphql-polylang` from a release URL, not a slug

This plugin is **not** in the wordpress.org directory — it ships as a GitHub release and on
Packagist. `wp plugin install wp-graphql-polylang` therefore fails with `Plugin not found`,
which is a confusing error for a plugin that plainly exists.

Open [the releases page](https://github.com/valu-digital/wp-graphql-polylang/releases), copy the
`.zip` asset URL of the newest release, and install that:

```bash
cd wordpress-headless

# Paste the URL you copied. A release URL is a VERSION PIN — a slug is not, which
# is the second reason to prefer it here.
BTT_WPGQL_POLYLANG='https://github.com/valu-digital/wp-graphql-polylang/releases/latest/download/wp-graphql-polylang.zip'

docker compose run --rm wpcli wp plugin install "$BTT_WPGQL_POLYLANG" --activate
docker compose run --rm wpcli wp plugin list --name=wp-graphql-polylang --fields=name,status,version
```

Record that version in `docs/architecture.md` in Step 8, beside the plugin inventory in
[appendix 03 §8](../appendix/03-content-model-reference.md#8-plugin-inventory). A plugin
installed from a URL is invisible to `wp plugin update`, so a version number in a document is
the only thing telling a colleague what you built against.

**Verify §1:**

- [ ] `wp plugin list --name=wp-graphql-polylang --field=status` prints `active`.
- [ ] The enum exists in the live schema:

```bash
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"LanguageCodeEnum\"){ enumValues { name } } }"}' | jq -c '.data'
```

- [ ] The output lists `EN`, `UK`, `DE` plus `DEFAULT` and `ALL`. If it is `{"__type":null}`,
      the plugin is active but Polylang has no languages — go back to Lesson 20.1 Step 3.
- [ ] The two fields are on the **interface**, not only on the concrete types:

```bash
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"ContentNode\"){ fields { name } } }"}' \
  | jq -r '.data.__type.fields[].name' | grep -E '^(language|translations)$'
```

- [ ] That prints both names. **If it prints nothing**, your version of the plugin registers the
      fields on each post type individually rather than on the interface — in which case Step 3's
      fragment reads `on Incident` and you write one per post type instead of one shared
      fragment. Everything else in this lesson is unchanged. Find out now; the alternative is
      finding out from a codegen error with a confusing message.

### Step 2: Refresh the schema, read the diff, regenerate

```bash
cd ../next-app

npm run schema:pull
git diff --stat -- ../wordpress-headless/schema.graphql
```

**Read the diff before you regenerate.** A schema refresh is the one moment when another team's
plugin gets to change your types, and "forty types appeared and I did not look" is how a
`translations` field of an unexpected shape becomes a runtime crash in Lesson 20.4.

```bash
# What was added, grouped. Expect four kinds of line and nothing else.
git diff -- ../wordpress-headless/schema.graphql | grep '^+' | grep -cE 'language|translation|LanguageCode'
git diff -- ../wordpress-headless/schema.graphql | grep '^+' | grep -vE 'language|translation|LanguageCode|^\+\+\+|^\+$'
```

| Expected in the diff | Not expected |
|---|---|
| `enum LanguageCodeEnum` and `type Language` | any change to an existing field's type |
| `language: Language` and `translations: [...]` on the translatable post types | any change to `Incident`'s ACF field group |
| `language: LanguageCodeEnum` inside each `…WhereArgs` input | a new root query field |
| the same three on `ContentNode` and the term types | anything mentioning `menu` |

That second command prints every added line that is **not** about language. It should be empty
or near-empty; anything substantial in it is a plugin doing more than it advertised, and this is
the cheapest moment in the project to notice. One codegen configuration change goes in with it:

```ts
// next-app/codegen.ts — edit: one key added to `config`
  config: {
    useTypeImports: true,

    // Enums as string-literal unions, not TypeScript `enum` declarations.
    // Lesson 20.2. Three reasons, in order of weight: a union is assignable from
    // a literal (`'DE'`), so the locale mapper needs no runtime import; a TS enum
    // is a *value*, so importing one drags generated code into whatever bundle
    // imports it; and a union is erased at compile time, which matters for a file
    // a Client Component may touch.
    enumsAsTypes: true,
  },
```

```bash
npm run codegen
npm run type-check
git add ../wordpress-headless/schema.graphql src/gql
```

**Verify §2:**

- [ ] `grep -c 'LanguageCodeEnum' src/gql/graphql.ts` returns `1` or more.
- [ ] `grep -n 'LanguageCodeEnum =' src/gql/graphql.ts` shows a **type** alias of string
      literals, not `export enum`. If it shows an enum, `enumsAsTypes` did not take effect.
- [ ] `npm run codegen:check` is clean — the committed `src/gql/` matches the schema you just
      pulled.
- [ ] `npm run type-check` is silent. Nothing has been asked to pass a language yet, so this
      only proves the refresh did not break an existing selection.

### Step 3: Write the sibling-lookup fragment

```graphql
# next-app/src/graphql/fragments/Translations.graphql
# The switcher (Lesson 20.3) and the hreflang cluster (Lesson 20.4) both need the
# same thing: "which locales is this document available in, and at which slug".
#
# `translations` returns SIBLINGS ONLY — the node itself is never in the list, so
# this fragment selects the node's OWN language and identifiers alongside them and
# the consumer combines the two. Selecting only `translations` is how a page ends
# up missing from its own hreflang cluster (Key Concept 4).
#
# Everything inside `translations` is a scalar-ish field that exists on every
# content node, so this works whether your build of wp-graphql-polylang types the
# field as the concrete post type or as the interface.
fragment TranslationFields on ContentNode {
  language {
    code
    slug
  }
  uri
  slug
  translations {
    language {
      code
      slug
    }
    uri
    slug
  }
}
```

```bash
npm run codegen && npm run type-check
```

**Verify §3:**

- [ ] `grep -c 'TranslationFieldsFragmentDoc\|TranslationFieldsFragment' src/gql/graphql.ts`
      returns `1` or more.
- [ ] The fragment name is `TranslationFields` and the file is `Translations.graphql`. The names
      differ deliberately: the file was declared before the `*Fields` convention hardened, and
      renaming a file that another lesson's front matter names would break the module contract.
      The five Module 10 fragments set the convention for the fragment name, so the fragment
      follows it.

### Step 4: Make the locale a required variable, then read the failures

Two edits per file: a required `$language` on every **connection**, and `...TranslationFields`
on every **single-node** query. Do not fix the call sites yet.

```graphql
# next-app/src/graphql/incidents.graphql
# The language is a REQUIRED variable on every connection: a call site that forgets
# it does not compile. Single-node lookups by slug take no language argument —
# there is nothing to make required, so they select the language and the route
# asserts on it (Key Concept 3).

query IncidentsList($first: Int!, $language: LanguageCodeEnum!, $after: String, $search: String) {
  incidents(
    first: $first
    after: $after
    where: {
      status: PUBLISH
      language: $language
      search: $search
      orderby: { field: DATE, order: DESC }
    }
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ...IncidentCardFields
    }
  }
}

query IncidentBySlug($slug: ID!) {
  incident(id: $slug, idType: SLUG) {
    ...IncidentDetailFields
    ...TranslationFields
  }
}

query IncidentSlugs($first: Int!, $language: LanguageCodeEnum!) {
  incidents(first: $first, where: { status: PUBLISH, language: $language }) {
    nodes {
      slug
    }
  }
}

query HomepageFeeds($featuredCount: Int!, $recentCount: Int!, $language: LanguageCodeEnum!) {
  catastrophic: incidents(
    first: $featuredCount
    where: {
      status: PUBLISH
      language: $language
      taxQuery: { taxArray: [{ taxonomy: SEVERITY, field: SLUG, terms: ["s1-catastrophic"] }] }
    }
  ) {
    nodes {
      ...IncidentCardFields
    }
  }
  recent: incidents(first: $recentCount, where: { status: PUBLISH, language: $language }) {
    nodes {
      ...IncidentCardFields
    }
  }
}

query IncidentTicker($first: Int!, $language: LanguageCodeEnum!, $severities: [String!]!) {
  incidents(
    first: $first
    where: {
      status: PUBLISH
      language: $language
      orderby: { field: DATE, order: DESC }
      taxQuery: { taxArray: [{ taxonomy: SEVERITY, field: SLUG, terms: $severities }] }
    }
  ) {
    nodes {
      ...IncidentCardFields
    }
  }
}
```

Note `taxQuery` and `language` sitting side by side in `HomepageFeeds`. The severity term is
shared across languages (Lesson 20.1 §6), so a taxonomy filter and a language filter compose
without either knowing about the other — which is the practical payoff of leaving taxonomies
untranslated.

The same two edits go into the other four document files:

| File | Gains `$language: LanguageCodeEnum!` | Gains `...TranslationFields` |
|---|---|---|
| `posts.graphql` | `PostsList`, `PostSlugs` | `PostBySlug` |
| `reviews.graphql` | `ReviewsList`, `ReviewSlugs` | `ReviewBySlug` |
| `pages.graphql` | `PageUris` | `PageByUri` |
| `hobt.graphql` | — | `HobtPromo` |
| `siteSettings.graphql`, `menu.graphql`, `scapegoats.graphql` | **nothing** — Key Concept 7 | nothing |

Now regenerate and let it fail:

```bash
npm run codegen
npm run type-check
```

**Read that output rather than skipping past it.** Ten or so errors, all one shape:

```
src/app/[locale]/incidents/page.tsx:24:5 - error TS2345: Argument of type
'{ first: number; }' is not assignable to parameter of type 'Exact<{ first: number;
language: LanguageCodeEnum; after?: ...; }>'.
  Property 'language' is missing in type '{ first: number; }' but required in type ...
```

That list **is** the lesson: a complete, machine-generated inventory of every query in this
application that reads translatable content — the list you would otherwise assemble by grepping
and hoping. Work down it in Step 6.

**Verify §4:**

- [ ] `npm run codegen` succeeds. If it fails with `Variable "$language" is never used`, you
      added the variable to a single-node query — remove it and select
      `...TranslationFields` instead.
- [ ] `npm run type-check` fails, with one error per unlocalised call site.
- [ ] `grep -c 'language' src/graphql/siteSettings.graphql src/graphql/menu.graphql src/graphql/scapegoats.graphql`
      returns `0` for all three.

### Step 5: Write `src/lib/i18n/locale.ts`

One file, four exports, and it is the only place in the application that knows `'de'` becomes
`DE` or that an untranslated node redirects.

```ts
// next-app/src/lib/i18n/locale.ts
// The locale vocabulary, and the untranslated-content policy, in one module.
//
// NO `import 'server-only'`: `middleware.ts` imports LOCALES from here, and
// middleware is not a react-server context (Lesson 15.5 §3). The redirect helper
// below is only ever called from a Server Component, and `redirect()` throws a
// control-flow exception rather than performing I/O, so nothing here holds a
// secret or touches the network.
import { notFound, redirect } from 'next/navigation';

import { toLocalePath } from '@/components/layout/nav';
import type { LanguageCodeEnum } from '@/gql/graphql';

/**
 * The three course locales, in switcher order. Lesson 20.3's `routing.ts` takes
 * over as the single source of this list and this file imports it from there —
 * for one lesson, it lives here, because next-intl is not installed yet.
 */
export const LOCALES = ['en', 'uk', 'de'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** A route param is a string until something checks it. */
export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The ONLY place a locale becomes a GraphQL enum value.
 *
 * A Record rather than `.toUpperCase()`: this is exhaustive over `Locale`, so
 * adding a locale to LOCALES fails type-check HERE, in the one file that has to
 * change. It also survives a region subtag — `pt-BR` maps to `PT_BR`, which no
 * string operation you would reach for produces (Key Concept 5).
 */
const LANGUAGE_CODE: Record<Locale, LanguageCodeEnum> = {
  en: 'EN',
  uk: 'UK',
  de: 'DE',
};

export function localeToLanguageCode(locale: Locale): LanguageCodeEnum {
  return LANGUAGE_CODE[locale];
}

/** The shape `TranslationFields` produces, structurally typed. */
export type TranslationLink = {
  readonly language?: { readonly code?: LanguageCodeEnum | null } | null;
  readonly slug?: string | null;
  readonly uri?: string | null;
};

export type LocalisedNode = TranslationLink & {
  readonly translations?: readonly (TranslationLink | null)[] | null;
};

/** The sibling in `locale`, or null. Never the node itself — `translations` cannot contain it. */
export function siblingIn(node: LocalisedNode, locale: Locale): TranslationLink | null {
  const wanted = localeToLanguageCode(locale);

  return (
    (node.translations ?? []).find(
      (sibling): sibling is TranslationLink => sibling?.language?.code === wanted
    ) ?? null
  );
}

/** Every locale this document genuinely exists in, including its own. Lesson 20.4 builds hreflang from this. */
export function availableLocales(node: LocalisedNode): readonly Locale[] {
  const codes = new Set<LanguageCodeEnum>();

  if (node.language?.code != null) codes.add(node.language.code);
  for (const sibling of node.translations ?? []) {
    if (sibling?.language?.code != null) codes.add(sibling.language.code);
  }

  return LOCALES.filter((locale) => codes.has(localeToLanguageCode(locale)));
}

/**
 * THE UNTRANSLATED-CONTENT POLICY, in one place. Key Concept 8's four cases.
 *
 * `href` builds the Next path for one node in one locale, because only the route
 * knows whether its URLs are slug-shaped (`/de/incidents/<slug>`) or uri-shaped
 * (`/de/<uri>`). Everything else is identical for every route, which is the whole
 * reason this is a function and not six copies of a branch.
 *
 * Returns the node, or throws Next's redirect/notFound control-flow exception —
 * so a route may treat the result as non-null.
 */
export function requireLocalisedNode<T extends LocalisedNode>(
  node: T | null | undefined,
  options: {
    readonly locale: Locale;
    readonly href: (locale: Locale, node: TranslationLink) => string;
  }
): T {
  const { locale, href } = options;

  // 1. Nothing at this slug in any language. A real 404 — Lesson 10.4's
  //    not-found.tsx renders it, and Lesson 19.4's sitemap never listed it.
  if (node == null) notFound();

  // 2. The URL's locale and the document's language agree. The common case.
  if (node.language?.code === localeToLanguageCode(locale)) return node;

  // 3. A sibling exists in the requested locale, so this URL is the WRONG URL for
  //    a document that does exist here. Normalise rather than bounce to English:
  //    an old English link shared with a German reader lands on the German page.
  const sibling = siblingIn(node, locale);
  if (sibling !== null) redirect(href(locale, sibling));

  // 4. No version in this locale. Go to the default locale and say why. `?from=`
  //    is built by string concatenation, never URLSearchParams — which
  //    form-urlencodes `/` into %2F (Lesson 15.5 §2, same rule).
  const fallback = siblingIn(node, DEFAULT_LOCALE) ?? node;
  redirect(`${href(DEFAULT_LOCALE, fallback)}?from=${locale}`);
}

/** `/de` + `/ueber-uns/` → `/de/ueber-uns`. The Lesson 11.3 menu mapper, reused verbatim. */
export function localePathForUri(locale: Locale, node: TranslationLink): string {
  return toLocalePath(node.uri ?? null, locale);
}
```

> **`toLocalePath()` is imported, not reimplemented, and that is the payoff of a decision made
> two lessons from now.** Lesson 20.3 declines localised route segments, so the transform from a
> WordPress `uri` to a Next path is the same function for a menu item, a page and a translation
> sibling — one implementation, already unit-tested in Lesson 12.2, and `nav.test.ts` stays
> green without an edit. If this course localised its segments, this line would be a second
> mapper with a lookup table in it.

Middleware needs the same list, so it stops carrying its own copy:

```ts
// next-app/src/middleware.ts — edit: replace the two locale constants
import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n/locale';

// DELETE these two lines from Lesson 09.5:
//   const LOCALES: readonly string[] = ['en'];
//   const DEFAULT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en';
// Until this edit, /de/incidents 307s to /en/de/incidents and nothing German is
// reachable. Lesson 20.3 replaces this import with next-intl's `routing` object,
// which is the last time these lines change.
```

**Verify §5:**

- [ ] `npm run type-check` still fails — on route files only. If it now complains about
      `locale.ts`, the `Record<Locale, LanguageCodeEnum>` is missing a key.
- [ ] `grep -c "'en'" src/middleware.ts` returns `0`. There is one list of locales in the
      codebase.
- [ ] `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/de/incidents`
      returns `200` — or a `500` from the still-unfixed call sites, but **not** a 307 to
      `/en/de/incidents`.

### Step 6: Thread the locale through every call site

Work the `type-check` list from Step 4. Two representative files in full; the rest follow the
table.

The list route — a connection, so the locale is a variable:

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — the fetch, after localisation
import { notFound } from 'next/navigation';

import { IncidentsListDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { isLocale, localeToLanguageCode } from '@/lib/i18n/locale';

// …inside the component:
//   const { locale } = await params;
//
//   // A route param is a string. Middleware would have redirected an unknown
//   // locale, and Lesson 15.5's thesis applies here too: a route does not rely on
//   // middleware for correctness, because deleting middleware must not change what
//   // is reachable.
//   if (!isLocale(locale)) notFound();
//
//   const data = await fetchGraphQL(
//     IncidentsListDocument,
//     { first: 12, language: localeToLanguageCode(locale) },
//     // Tags UNCHANGED. Locale-scoped tags need the PHP builder to change in the
//     // same lesson — Lesson 20.4 does both halves together.
//     { revalidate: 300, tags: [listTag('incident')] }
//   );
```

The detail route — a single node, so the locale is an assertion:

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — the fetch and the guard
import { notFound } from 'next/navigation';

import { IncidentBySlugDocument, IncidentSlugsDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { incidentTag, listTag } from '@/lib/graphql/tags';
import {
  LOCALES,
  isLocale,
  localeToLanguageCode,
  requireLocalisedNode,
} from '@/lib/i18n/locale';

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  // One query PER LOCALE, because the slugs differ per locale — there is no
  // language-agnostic list of slugs and there never will be. Lesson 18.1 owns how
  // large the pre-rendered set should be; this changes what it iterates, not how
  // much of it there is.
  const perLocale = await Promise.all(
    LOCALES.map(async (locale) => {
      const data = await fetchGraphQL(
        IncidentSlugsDocument,
        { first: 100, language: localeToLanguageCode(locale) },
        { revalidate: 3600, tags: [listTag('incident')] }
      );

      return (data.incidents?.nodes ?? []).map((node) => ({ locale, slug: node?.slug ?? '' }));
    })
  );

  return perLocale.flat().filter((entry) => entry.slug !== '');
}

// …inside the component:
//   const { locale, slug } = await params;
//   if (!isLocale(locale)) notFound();
//
//   const data = await fetchGraphQL(
//     IncidentBySlugDocument,
//     { slug },
//     { revalidate: 3600, tags: [incidentTag(slug), listTag('incident')] }
//   );
//
//   // notFound(), a 307 to the German URL, or a 307 to /en with ?from= — one
//   // function, four cases, zero branches in this file.
//   const incident = requireLocalisedNode(data.incident, {
//     locale,
//     href: (target, node) => `/${target}/incidents/${node.slug ?? ''}`,
//   });
```

The rest, mechanically:

| File | Connection variable | Single-node guard | `href` |
|---|---|---|---|
| `[locale]/page.tsx` | `HomepageFeeds` | — | — |
| `[locale]/incidents/page.tsx` | `IncidentsList` | — | — |
| `[locale]/incidents/[slug]/page.tsx` | `IncidentSlugs` | `IncidentBySlug` | `/${l}/incidents/${slug}` |
| `[locale]/blog/page.tsx` | `PostsList` | — | — |
| `[locale]/blog/[slug]/page.tsx` | `PostSlugs` | `PostBySlug` | `/${l}/blog/${slug}` |
| `[locale]/reviews/page.tsx` | `ReviewsList` | — | — |
| `[locale]/reviews/[slug]/page.tsx` | `ReviewSlugs` | `ReviewBySlug` | `/${l}/reviews/${slug}` |
| `[locale]/[...slug]/page.tsx` | `PageUris` | `PageByUri` | `localePathForUri` |
| `[locale]/hobt/page.tsx` | — | `HobtPromo` | Step 7 |
| `components/blocks/IncidentTicker.tsx` | `IncidentTicker` | — | — |
| `[locale]/scapegoats/page.tsx` | **no change** | — | — |

`IncidentTicker` is the one outside `src/app/` and it needs nothing new: block components have
received a `locale` prop since Lesson 14.2, so the fix is one variable plus a `Locale` narrowing
at the top. A block inside a German page now queries German incidents — the "Related incidents
rail in English" bug from Key Concept 2, fixed before it ever shipped.

**Verify §6:**

- [ ] `npm run type-check` is **silent**. That is the whole point of the required variable: the
      compiler told you when you were done.
- [ ] `grep -rn 'localeToLanguageCode' src/app/ src/components/ | wc -l` matches the number of
      localised documents you edited. Every call is in a route or a block component; none is in
      `src/lib/graphql/`.
- [ ] `curl -s http://localhost:3000/de/incidents | grep -c 'Autoskalierung'` returns `1` or
      more — the German list is German.
- [ ] `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/de/incidents/incident-01`
      prints `307 http://localhost:3000/de/incidents/incident-01-de`. Case 3 from Key Concept 8:
      the URL normalised itself instead of bouncing you to English.

### Step 7: The two Next-owned routes that need a translated page

`/hobt` is a **path Next owns**, not a path WordPress owns: `/de/hobt` must keep working
(Lesson 20.3 declines localised segments, and Module 21's Starting State curls all three
locales), while the page behind it has the slug `hobt-de`. So the route resolves the English
page by its stable URI, then follows the translation map.

```tsx
// next-app/src/app/[locale]/hobt/page.tsx — the fetch, localised
import { notFound, redirect } from 'next/navigation';

import { HobtPromoDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag, pageTag } from '@/lib/graphql/tags';
import { DEFAULT_LOCALE, isLocale, siblingIn } from '@/lib/i18n/locale';

// …inside the component:
//   const { locale } = await params;
//   if (!isLocale(locale)) notFound();
//
//   const options = { revalidate: 60, tags: [pageTag('hobt'), listTag('page')] };
//
//   // `/hobt/` is the ENGLISH uri and it never changes, which is what makes it a
//   // usable key. Lesson 11.5 read this value out of WordPress rather than
//   // guessing it; the same value still applies.
//   const source = await fetchGraphQL(HobtPromoDocument, { uri: '/hobt/' }, options);
//
//   if (source.page == null) notFound();
//
//   let page = source.page;
//
//   if (locale !== DEFAULT_LOCALE) {
//     const sibling = siblingIn(source.page, locale);
//
//     // No translated landing page: the default locale, flagged. The same policy
//     // as every node route, reached through a different door.
//     if (sibling === null) redirect(`/${DEFAULT_LOCALE}/hobt?from=${locale}`);
//
//     const translated = await fetchGraphQL(
//       HobtPromoDocument,
//       { uri: sibling.uri ?? '' },
//       options
//     );
//
//     if (translated.page == null) notFound();
//     page = translated.page;
//   }
```

**The cost, stated plainly: `/de/hobt` and `/uk/hobt` cost two WordPress requests instead of
one.** `/en/hobt` is unchanged at one. Request memoization does not help — different variables
means genuinely different reads. Neither alternative wins: selecting the whole promo field group
inside `translations` triples the English payload for every visitor to pay for a minority of
requests, and a locale-to-URI map in the route file hard-codes fixture slugs into application
code, which is the coupling Lesson 20.1's matrix exists to avoid.

The catch-all needs the opposite fix — it can reach a page it should not:

```tsx
// next-app/src/app/[locale]/[...slug]/page.tsx — after the locale guard
// A page reachable through a DEDICATED route is not reachable through the
// catch-all — in ANY language. `hobt` is reserved, but its German translation's
// slug is `hobt-de`, which is not, so /de/hobt-de would render the same content
// as /de/hobt with a different heading and no ACF group: two URLs, one document,
// and Lesson 19.4's sitemap would list both.
//
// Ask the translation group rather than extending RESERVED with fixture slugs.
// const uris = [page.uri, ...(page.translations ?? []).map((t) => t?.uri)];
// const reserved = uris.some((uri) =>
//   RESERVED.has((uri ?? '').split('/').filter(Boolean)[0] ?? '')
// );
// if (reserved) notFound();
```

`generateStaticParams` in the same file loops locales exactly as the incident route does, and
`.map((segments) => ({ locale: 'en', slug: segments }))` — the hard-coded `'en'` Lesson 14.4
left there — is the line that changes.

**Verify §7:**

- [ ] `curl -s http://localhost:3000/de/hobt | grep -c '<h1'` returns `1`, and the page renders
      the ACF headline rather than a bare title.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/de/hobt-de` returns `404`.
      One document, one URL.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/de/ueber-uns` returns
      `200`, and `/de/about` returns `307`. The German page is at the German slug; the English
      slug under `/de/` redirects to where the content actually is.
- [ ] `npm run build` completes, and the route list shows the `[slug]` routes with more
      pre-rendered paths than before — 55 incidents across three locales rather than 40 in one.

### Step 8: Write the policy into `docs/architecture.md`

An undocumented redirect policy is one somebody will "fix" in six months. Append this under a
new `## Localisation (Module 20)` heading, beside the notes Lessons 09.3 and 10.3 asked for:

```markdown
## Localisation (Module 20)

Locales: `en` (default), `uk`, `de`. The URL segment is the single source of truth; see
`src/lib/i18n/locale.ts`.

**Route segments are not localised.** `/de/incidents/incident-01-de`, never
`/de/vorfaelle/…`. Free Polylang does not translate a custom post type's rewrite slug, so a
localised Next segment would disagree with every `uri` WordPress returns. Reversal condition:
Polylang Pro. Lesson 20.3 argues it in full.

**Every connection query takes a required `$language: LanguageCodeEnum!`.** Single-node lookups
by slug or URI take no language argument — they select `language { code }` and
`requireLocalisedNode()` asserts on it. Three documents deliberately take no language:
`SiteChrome`, `PrimaryMenu` and `ScapegoatLeaderboard`, because options, menus and (in this
project) taxonomy terms have no language.

**Untranslated content: 307 to the default locale with `?from=<locale>`.**

| Case | Response |
|---|---|
| no such slug in any language | 404 |
| the node exists in another locale, and a sibling exists in this one | 307 to the sibling's URL |
| the node exists in another locale, with no sibling here | 307 to `/en/…?from=<locale>` |
| a list is empty in this locale | 200, empty state |

No `hreflang` alternate is ever advertised for a locale in which a document does not exist.

wp-graphql-polylang version installed: <the version from Step 1>.
```

**Verify §8:**

- [ ] `docs/architecture.md` contains the four-row table, and `docs/` is still the only place
      this policy is written in prose.
- [ ] The plugin version in that file matches `wp plugin list --name=wp-graphql-polylang
      --field=version`.

---

## Verification

```bash
cd next-app

# 1. The generated types and the committed schema agree
npm run codegen:check
# Expected: no output, exit 0

npm run type-check
# Expected: silent

# 2. `where: { language: DE }` returns German nodes ONLY
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:100, where:{status:PUBLISH, language:DE}){ nodes { slug language { code } } } }"}' \
  | jq -r '[.data.incidents.nodes[].language.code] | unique | join(",")'
# Expected: DE
# (a single value: if you see "DE,EN" the filter is being ignored)

curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:100, where:{status:PUBLISH, language:DE}){ nodes { slug } } }"}' \
  | jq '.data.incidents.nodes | length'
# Expected: 10

# 3. Omitting the language is NOT an error — it silently answers in English.
#    This is Key Concept 2, as one command.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:100, where:{status:PUBLISH}){ nodes { language { code } } } }"}' \
  | jq -r '[.data.incidents.nodes[].language.code] | unique | join(",")'
# Expected: EN — no error, no warning, no `errors` key. 40 English rows.

# 4. NEGATIVE — zero German reviews, because none are translated. The empty list
#    is the correct answer, and it is NOT the untranslated-content policy firing.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ techReviews(first:100, where:{status:PUBLISH, language:DE}){ nodes { slug } } }"}' \
  | jq '{ errors: (.errors // [] | length), nodes: (.data.techReviews.nodes | length) }'
# Expected: {"errors":0,"nodes":0}

# 5. NEGATIVE — `translations` never contains the node itself (Key Concept 4)
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incident(id:\"incident-01\", idType:SLUG){ id slug language { code } translations { id slug language { code } } } }"}' \
  | jq -c '{ self: .data.incident.slug, selfCode: .data.incident.language.code, siblings: [.data.incident.translations[].slug], selfInSiblings: ([.data.incident.translations[].id] | index(.data.incident.id) != null) }'
# Expected: self "incident-01", selfCode "EN", two siblings
#           (incident-01-de and відмова-01), and selfInSiblings false.
#           `false` is the assertion. pll_get_post_translations() would say true.

# 6. All three locales render their own list, and none of them redirects
for l in en uk de; do
  curl -s -o /dev/null -w "$l %{http_code}\n" "http://localhost:3000/$l/incidents"
done
# Expected: en 200, uk 200, de 200

# 7. NEGATIVE — a node with no German translation 307s to English and says so.
#    incident-40 is outside Lesson 20.1's matrix, deliberately.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/de/incidents/incident-40
# Expected: 307 http://localhost:3000/en/incidents/incident-40?from=de
#           NOT a 404, and NOT 200 with English content under a /de/ URL.

# 8. The wrong-slug case normalises instead of bouncing
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/de/incidents/incident-01
# Expected: 307 http://localhost:3000/de/incidents/incident-01-de

# 9. …and the German URL itself is a 200 with a German heading
curl -s http://localhost:3000/de/incidents/incident-01-de | grep -o '<h1[^>]*>[^<]*' | head -1
# Expected: the German title — "Am Freitag deployt (#1)"

# 10. The Cyrillic slug survives the URL round trip. curl percent-encodes it;
#     WordPress stores it decoded; the cache tag will use the decoded form
#     (Lesson 20.4).
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/uk/incidents/%D0%B2%D1%96%D0%B4%D0%BC%D0%BE%D0%B2%D0%B0-01'
# Expected: 200 — that is `відмова-01`, percent-encoded exactly as a browser sends it

# 11. NEGATIVE — deleting a `$language` variable is a COMPILE error, not a
#     runtime one. Probed on a copy, so no tracked file is ever left broken.
cp src/graphql/posts.graphql /tmp/btt-posts.graphql
sed -i.tmp -e 's/, \$language: LanguageCodeEnum!//' -e 's/^ *language: \$language$//' src/graphql/posts.graphql
npm run codegen >/dev/null && npm run type-check
# Expected: an error naming src/app/[locale]/blog/page.tsx — `language` is not a
#           known property of the variables type, because the document no longer
#           takes one. Silence here would mean the variable was nullable: check
#           for the `!`, which is the entire mechanism.
cp /tmp/btt-posts.graphql src/graphql/posts.graphql && rm -f /tmp/btt-posts.graphql src/graphql/posts.graphql.tmp
npm run codegen >/dev/null && npm run type-check
# Expected: silent again

# 12. NEGATIVE — an unknown locale cannot even be named. A throwaway probe file,
#     never a tracked one.
cat > src/lib/i18n/_probe.ts <<'PROBE'
import { localeToLanguageCode } from '@/lib/i18n/locale';
export const wrong = localeToLanguageCode('xx');
PROBE
npm run type-check
# Expected: error TS2345 — '"xx"' is not assignable to parameter of type 'Locale'.
#           A runtime `undefined` would have become the GraphQL variable `null`,
#           which the plugin reads as "the default language".
rm src/lib/i18n/_probe.ts
npm run type-check
# Expected: silent

# 13. NEGATIVE — the schema is still committed from wordpress-headless only
ls ../wordpress-headless/schema.graphql
# Expected: the path prints
ls src/*.graphql 2>/dev/null; echo "exit=$?"
# Expected: a non-zero exit — there is no schema file under next-app/

# 14. NEGATIVE — no locale reached a cache tag in this lesson
grep -rn 'listTag(.*locale\|Tag(.*, locale' src/app/ src/components/
# Expected: no output. Locale-aware tags are Lesson 20.4, both halves at once.

# 15. The Module 12 unit tests are untouched by all of this
npm test -- --run
# Expected: all green, including nav.test.ts and tags.test.ts. `toLocalePath` was
#           reused rather than rewritten, so its tests never needed an edit.

# 16. Lint and build
npm run lint
# Expected: no errors, no warnings
npm run build
# Expected: completes; the [slug] routes list pre-rendered paths for all three locales
```

## Control Questions

1. `IncidentsList` takes `$language: LanguageCodeEnum!` and `IncidentBySlug` takes no language
   argument at all. Explain why adding one to `IncidentBySlug` would fail before TypeScript ever
   ran, and describe the defence that replaces it.
2. `SiteChrome`, `PrimaryMenu` and `ScapegoatLeaderboard` deliberately do not pass a language,
   even though "an unspecified language silently returns the default" is described in this lesson
   as the module's most expensive bug. Reconcile those two statements in one paragraph.
3. `/de/incidents/incident-01` and `/de/incidents/incident-40` both hit
   `requireLocalisedNode()` with a node whose `language.code` is `EN`. They produce different
   responses. Say what each one is, and which field of the fetched node decides.
4. `localeToLanguageCode` is a `Record<Locale, LanguageCodeEnum>` rather than
   `locale.toUpperCase()`. Give the locale that breaks the second form, say what WPGraphQL
   Polylang emits for it, and name the compile error the first form produces when someone adds a
   fourth locale.
5. `/de/hobt` costs two WordPress requests and `/en/hobt` costs one. Describe the single-request
   alternative, say what it would cost every English visitor, and explain why request
   memoization does not remove the second request.

## Learn More

- [wp-graphql-polylang](https://github.com/valu-digital/wp-graphql-polylang) — the README is the
  authoritative list of what the plugin adds; read the "Filtering by language" and "Translations"
  sections before Lesson 20.4
- [WPGraphQL — connections and `where` args](https://www.wpgraphql.com/docs/connections/) — how a
  `…WhereArgs` input is assembled, which is why a plugin can add a key to every connection at
  once
- [GraphQL spec — variables must be used](https://spec.graphql.org/October2021/#sec-All-Variables-Used)
  — the validation rule that makes `$language` on a single-node query a hard error rather than
  dead code
- [GraphQL spec — enum names](https://spec.graphql.org/October2021/#sec-Names) — the grammar that
  excludes a hyphen, and therefore the reason `pt-BR` cannot be an enum value
- [graphql-code-generator — `enumsAsTypes`](https://the-guild.dev/graphql/codegen/plugins/typescript/typescript)
  — the option Step 2 turns on, and the rest of the `typescript` plugin's config surface
- [Next.js — `redirect()` and `notFound()`](https://nextjs.org/docs/app/api-reference/functions/redirect)
  — both throw a control-flow exception, which is why `requireLocalisedNode()` can be typed as
  returning a non-null node
- [Next.js — `generateStaticParams`](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)
  — the multi-dynamic-segment section: `{ locale, slug }` pairs are the shape Step 6 returns
- [Google Search Central — localized versions of your pages](https://developers.google.com/search/docs/specialty/international/localized-versions)
  — the official statement of what a search engine expects when content exists in some languages
  and not others; the policy in Key Concept 8 is written against this page
