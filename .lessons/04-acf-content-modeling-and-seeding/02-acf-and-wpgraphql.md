---
title: 'ACF & WPGraphQL'
module: 4
lesson: 2
teaches: [wpgraphql-for-acf, acf-repeater-types, graphql-field-naming, acf-select-to-enum]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_tech_review_fields.json']
requires: [4.1]
---

# Lesson 04.2 — ACF & WPGraphQL

## Quick Overview

A field group with `show_in_graphql: true` and a `graphql_field_name` becomes an object on the
post type it is attached to, so `Incident.incidentDetails.downtimeMinutes` exists in the schema
and every field name is transformed from `snake_case` to `camelCase` automatically. This lesson
builds `Tech Review Fields` from
[appendix 03 §4.3](../appendix/03-content-model-reference.md#43-tech-review-fields) and then
looks hard at what WPGraphQL for ACF actually generated, because the mapping is not always the
one you would guess.

The **repeaters** are why this lesson exists. `pros` and `cons` are repeaters with a single Text
sub-field called `item`, and the natural expectation is that they arrive as `[String]`. They do
not. Each repeater generates its own object type — `TechReviewFieldsPros`, with a single `item`
field — so the query is `pros { item }` and the TypeScript that codegen produces in Module 10 is
an array of objects. That mismatch is the single most common "why is my generated type `any`?"
moment in a headless WordPress build, and meeting it here, with the schema in front of you and
GraphiQL open, is much cheaper than meeting it inside a React component. You will also see why a
`Select` field arrives as a bare `String` and note it for Lesson 06.1, which replaces it with a
real GraphQL enum so codegen produces a union type instead.

By the end of this lesson you will have:

- `group_tech_review_fields.json` tracked, with every field and both repeaters from §4.3
- Both repeaters queried successfully in GraphiQL, using the generated object list types
- A written note of the four generated type names your repeaters produced
- The `snake_case` to `camelCase` transformation confirmed field by field against the contract
- A hand-authored tech review with populated pros, cons and four ratings
- A recorded observation that `verdict` is currently a `String` and a pointer to Lesson 06.1

## Classic WP Analogy

In a Classic WordPress template a repeater is a loop and nothing more:

```php
// wordpress-headless/wp-content/themes/btt-headless/index.php — illustration only
if ( have_rows( 'pros' ) ) {
    while ( have_rows( 'pros' ) ) { the_row(); echo esc_html( get_sub_field( 'item' ) ); }
}
```

You know what that produces because you are standing inside the same process as the data: an
array of arrays keyed by sub-field name, which you index by hand and never think about again.
`get_field('pros')` hands you `[['item' => 'Great docs'], ['item' => 'Fast support']]` and PHP,
being PHP, lets you treat that shape however you like.

GraphQL is typed, so that shape must be *named*. There is no anonymous array-of-maps in a
GraphQL schema; every object needs a type, so WPGraphQL for ACF generates one per repeater from
the group name and the field name. `pros { item }` is the same data as the loop above, described
in a system that requires the description to be explicit. Once you see it that way the generated
names stop looking strange — they are the price of the schema being knowable in advance, which
is the same property that makes Module 10's codegen possible at all.

**Where the analogy breaks down:** `get_field()` is *lenient* in a way GraphQL cannot be. If a
repeater is empty, `get_field()` returns `false` and your `if` handles it. If a sub-field name is
misspelled, you get `null` and an empty string in the output, and the page still renders. If the
field group has not been loaded at all, you get `null` again. Every failure is soft, local, and
invisible to the visitor. In GraphQL a misspelled field is a **validation error that rejects the
entire query** before a single resolver runs — you get no data at all, not partial data. That
strictness is the feature you are buying, but it inverts your debugging instinct: the answer is
almost never "add a null check", it is "read the schema in GraphiQL and use the name that is
actually there".

---

## Key Concepts

### 1. What `show_in_graphql` on a field group actually generates

Two JSON keys — `show_in_graphql` and `graphql_field_name` — produce four things in the schema.
Knowing all four by name is what lets you read a WPGraphQL for ACF problem instead of guessing at
it.

```
  group_tech_review_fields.json
    show_in_graphql:    1
    graphql_field_name: techReviewFields
                │
                ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 1. an OBJECT TYPE          TechReviewFields                         │
  │      one GraphQL field per ACF field, snake_case → camelCase        │
  │                                                                     │
  │ 2. an INTERFACE            WithAcfTechReviewFields                   │
  │      declares `techReviewFields: TechReviewFields`                  │
  │                                                                     │
  │ 3. that interface APPLIED to every type the location rules resolve   │
  │      post_type == tech_review   ──▶   type TechReview               │
  │                                                                     │
  │ 4. one GENERATED TYPE PER nested structure                          │
  │      pros (Repeater)  ──▶  TechReviewFieldsPros                     │
  │      cons (Repeater)  ──▶  TechReviewFieldsCons                     │
  └─────────────────────────────────────────────────────────────────────┘
```

The naming rules are mechanical, which is good news — you can predict every type name before you
open GraphiQL:

| Thing | Rule | Example |
|---|---|---|
| Group object type | `graphql_field_name` in PascalCase | `techReviewFields` → `TechReviewFields` |
| Interface | `WithAcf` + the group type name | `WithAcfTechReviewFields` |
| Field on a content type | `graphql_field_name` verbatim | `TechReview.techReviewFields` |
| A field inside the group | ACF field `name`, `snake_case` → `camelCase` | `rating_incident_response` → `ratingIncidentResponse` |
| A repeater's row type | group type name + field name in PascalCase | `pros` → `TechReviewFieldsPros` |

> **`graphql_field_name` must be unique across the entire schema and must be a valid GraphQL
> name** — camelCase, starting with a letter, no hyphens. WPGraphQL for ACF will refuse to
> register a group whose name collides with an existing field and tells you so in an admin
> notice, which you will not see if you only ever work through WP-CLI. Check
> `wp-admin/edit.php?post_type=acf-field-group` after adding a group.

### 2. The full ACF type to GraphQL type mapping

This is the table to keep open. The left column is what you pick in the ACF UI; the right column
is what the front end has to consume. They do not always line up with intuition.

| ACF field type | GraphQL type | Watch out for |
|---|---|---|
| Text, Textarea, Email, Password | `String` | |
| WYSIWYG, oEmbed | `String` | HTML — goes through the one sanitising component in Module 14 |
| URL | `String` | not a URL scalar; validate it yourself |
| Number | `Float` | **not `Int`** — ACF stores meta as strings and does not promise integers |
| Range | `Float` | same reason |
| True/False | `Boolean` | |
| Select (single), Radio, Button Group | `String` | Lesson 06.1 replaces this with a real enum |
| Select (multiple), Checkbox | `[String]` | single vs multiple changes the type — a later toggle is a breaking change |
| Date Picker, Date Time Picker, Time Picker | `String` | formatted by `return_format` at resolve time |
| Image, File | `AcfMediaItemConnectionEdge` | a **connection edge** — needs a `node { … }` hop |
| Gallery | `AcfMediaItemConnection` | `nodes { … }` |
| Post Object, Relationship, Page Link | a content-node **connection** | Lesson 04.3, and the N+1 it invites |
| Taxonomy | a term **connection** | |
| User | a user **connection** | |
| Link | `AcfLink` — `url`, `title`, `target` | |
| Google Map | `AcfGoogleMap` — `latitude`, `longitude`, … | |
| Group | a generated object type | |
| **Repeater** | **`[GeneratedRowType]`** | Key Concept 3 |
| Flexible Content | a list of a **union** of layout types | the same shape Module 14 uses for blocks |
| Message, Tab, Accordion | **absent from the schema** | layout-only, no value to expose |

Three of those rows cause most of the surprise. **Number is `Float`**, so TypeScript gets
`number` and a downtime of `145` may arrive as `145` and print as `145`, but nothing stops it
arriving as `145.0` — do not `===` it against an integer literal. **A single Select is a
`String`**, which is why Module 10's codegen produces `string` for `verdict` rather than a union
of four values, and why Lesson 06.1 exists. And **images are connections**, so `logo` alone is not
a URL — you need `logo { node { sourceUrl altText } }`.

> **Verify the mapping against your own GraphiQL rather than against this table.** WPGraphQL for
> ACF v2 was a rewrite and changed several of these names from v1. The docs pane in GraphiQL is
> generated from the schema you actually have installed, which makes it the only source that
> cannot be out of date.

### 3. Repeaters are generated object list types, not `string[]`

This is the lesson. `pros` is a Repeater with a single Text sub-field named `item`. In PHP:

```php
// wordpress-headless/wp-content/themes/btt-headless/index.php — illustration only
// The shape get_field() hands you inside WordPress.
get_field( 'pros' ) === array(
	array( 'item' => 'The docs have runnable examples' ),
	array( 'item' => 'Support answers in hours, not weeks' ),
);
```

An array of associative arrays. PHP does not need to name that shape, so it never does. GraphQL
**must** name it, because a schema is a set of named types and there is no anonymous
object-with-these-keys in the type system. So WPGraphQL for ACF generates one:

```
        ACF                          GraphQL                    TypeScript (Module 10)
  ─────────────────────       ────────────────────────      ──────────────────────────────
  pros  (Repeater)            type TechReviewFieldsPros {   type TechReviewFieldsPros = {
    └── item  (Text)            item: String                  __typename?: 'TechReviewFieldsPros'
                                }                              item?: string | null
                                                              }
                              TechReviewFields {
                                pros: [TechReviewFieldsPros]  pros?: Array<TechReviewFieldsPros
                              }                                             | null> | null
```

So the query is `pros { item }`, never `pros`. And the value you render is
`review.techReviewFields.pros?.map(p => p?.item)`, not `review.techReviewFields.pros`.

| The expectation | The reality | The symptom when you assume the expectation |
|---|---|---|
| `pros: [String]` | `pros: [TechReviewFieldsPros]` | `Field "pros" of type "[TechReviewFieldsPros]" must have a selection of subfields` |
| `pros.map(String)` renders text | each element is an object | React renders `[object Object]`, or throws "Objects are not valid as a React child" |
| the generated type is `string[]` | it is an array of nullable objects, nullable at every level | you reach for `as any` and lose type safety for the rest of the component |

**The nesting is recursive, and the names get long.** A repeater inside a repeater generates a
type per level, concatenating each time: `HobtPromo` → `HobtPromoModules` →
`HobtPromoModulesLessons`. That is not a bug, it is what naming an anonymous shape costs. It is
also a useful design pressure — if your generated type names are running to five words, your
content model is probably nested a level too deep, and a repeater of Post Objects pointing at a
real CPT would model it better.

> **This is the single most common "why is my generated type `any`?" moment in a headless
> WordPress build.** It almost never surfaces as a repeater problem. It surfaces two modules
> later as a React error inside a `.map()`, in a component nobody has touched in a week. Meeting
> it here, with GraphiQL open and the schema in front of you, is the cheap version.

### 4. How a field group finds the type it attaches to

A field group's location rules are ACF's answer to "where does this form appear". WPGraphQL for
ACF reuses them to answer a different question — "which GraphQL types get this field" — and the
translation is not always one to one.

| Location rule | GraphQL types it maps to |
|---|---|
| `post_type == tech_review` | `TechReview` |
| `post_type == incident` | `Incident` |
| `taxonomy == scapegoat` | `Scapegoat` |
| `page` **and** `page_template == templates/hobt.php` | `Page` — the template half has no type of its own |
| `options_page == …` | a field on `RootQuery` (Lesson 04.3) |
| `post_status == draft` | `Post`, `Page`, `Incident`, … — **every** post type |
| `user_form == all` | `User` |

The last two are where automatic derivation stops being helpful. A rule like
`post_status == draft` is about an *instance*, not a type, so the only correct derivation is
"every content type", and you have just added a field to eight types you did not mean to touch.

That is what the manual escape hatch is for:

```json
{
	"map_graphql_types_from_location_rules": 1,
	"graphql_types": ["TechReview"]
}
```

Set the first key to `1` and WPGraphQL for ACF ignores the location rules entirely and uses your
explicit list. **Use it whenever the location rules are not a clean statement about types** — and
leave it at `0` when they are, so the two never drift apart. All five groups in this course leave
it at `0`; `HOBT Promo` in Lesson 04.3 is the closest call, and it resolves cleanly to `Page`.

### 5. Every exposed field is permanent API surface

`show_in_graphql` is available per field group **and** per field. The default is on, and leaving
it on for everything is the decision that costs you later.

```json
{
	"key": "field_review_internal_note",
	"name": "internal_note",
	"type": "textarea",
	"show_in_graphql": 0
}
```

Four things go wrong when a field is exposed by default:

| Problem | Concretely |
|---|---|
| It is a public read | `/graphql` has no per-field authorisation. A field on a published post is world-readable through any query, including introspection. An "internal editor note" is a leak. |
| It is a contract | Module 10 generates TypeScript from the schema and Module 06 commits `schema.graphql`. Removing a field later is a breaking change with a CI gate in front of it. |
| It is schema weight | Every field is validated, every type is built on every request. WPGraphQL builds lazily, but the type registry still grows and introspection responses get large. |
| It is a resolver | Even unqueried, the field must exist, be typed and be documented. Unqueried fields are the ones nobody notices are broken. |

**The rule this course follows: expose a field when a front-end route needs it, and not before.**
That is why `Incident Details` exposes all nine fields — every one of them is rendered or
filtered on in Modules 08 and 09 — while a hypothetical `internal_note` would not be exposed at
all, even though an editor can see it in wp-admin.

> **`is_verified` is the interesting counter-example.** It *is* exposed, deliberately, because
> the front end renders a "verified" badge. Exposing a field for reading says nothing about
> writing it: the `createIncident` mutation in Lesson 06.2 discards a client-supplied
> `is_verified` outright. Read surface and write surface are two separate decisions and this field
> is the course's worked example of getting them apart.

### 6. A Select is a `String`, and that is a problem you postpone on purpose

`verdict` has exactly four legal values — `adopt`, `trial`, `assess`, `hold` — and arrives in the
schema as `String`. Which means:

```
   TODAY (Lesson 04.2)                     AFTER Lesson 06.1
   ───────────────────────────────         ─────────────────────────────────
   verdict: String                         verdict: TechReviewVerdict

   TypeScript:  string                     TypeScript:  'ADOPT' | 'TRIAL'
                                                      | 'ASSESS' | 'HOLD'

   switch (verdict) {                      switch (verdict) {
     case 'adopt': …                         case 'ADOPT': …
     case 'adpot': …   ← compiles            case 'ADPOT': …   ← type error
   }                                       }
```

The typo on the left compiles, ships, and renders nothing for one of four verdicts. That bug is
invisible in code review and invisible in tests that only cover the happy path.

You are not fixing it in this lesson, and the reason is worth being explicit about: a registered
GraphQL enum needs `register_graphql_enum_type()` plus a resolver that maps between ACF's
kebab-case storage and GraphQL's `SCREAMING_SNAKE_CASE` convention. That is server-side GraphQL
work and it belongs in Module 06 with the rest of it. What you do today is **write the observation
down** — because the way this course gets to Lesson 06.1 is by having felt the problem, not by
being told about it.

### 7. Images are connections, so there is always a `node` hop

`logo` is an ACF Image field. Its GraphQL type is `AcfMediaItemConnectionEdge`, so:

```
  ❌  techReviewFields { logo }                  → validation error, needs subfields
  ❌  techReviewFields { logo { sourceUrl } }    → no such field on the EDGE
  ✅  techReviewFields { logo { node { sourceUrl altText mediaDetails { width height } } } }
```

The `node` hop exists because an ACF image field is a **relationship to an attachment**, and
WPGraphQL models relationships as connections so that edge-level data has somewhere to live.
Lesson 05.2 §2 explains the general principle; the practical consequence here is that
`return_format` in the ACF JSON — `id`, `array` or `url` — is **ignored by WPGraphQL for ACF**.
It always resolves the attachment and returns the edge. Set `return_format` for the benefit of
any PHP that reads the field, and read the shape you actually get from GraphiQL.

---
## Task

### Step 1: Upgrade to ACF PRO

`pros` and `cons` are Repeater fields, and **Repeater is an ACF PRO field type**. Free ACF loads a
JSON group containing one without complaint and then renders nothing for it, which is a confusing
way to lose an afternoon. Lesson 04.1 Key Concept 8 has the full breakdown of which group needs
which edition.

ACF PRO is a paid zip from your account rather than a wordpress.org slug, so the install is a file
install. The plugins directory is already a bind mount, and everything in it except this course's
two plugins is gitignored, which makes it the obvious drop point:

```bash
cd wordpress-headless

# 1. Free and PRO are two different plugin directories and cannot both be active.
docker compose run --rm wpcli wp plugin deactivate advanced-custom-fields

# 2. Stage the zip where the container can see it.
cp ~/Downloads/advanced-custom-fields-pro.zip wp-content/plugins/_acf-pro.zip

docker compose run --rm wpcli wp plugin install \
  /var/www/html/wp-content/plugins/_acf-pro.zip --activate

# 3. Do not leave a plugin zip lying in the plugins directory.
rm wp-content/plugins/_acf-pro.zip

docker compose run --rm wpcli wp plugin list --status=active --field=name
```

> **The licence key is only needed for updates, not for features.** ACF PRO's Repeater, Options
> Pages and Blocks all work on an unlicensed install; what you lose is the update channel. If you
> do want updates, ACF reads the `ACF_PRO_LICENSE` constant — so the key goes in the gitignored
> `.env` as `ACF_PRO_LICENSE=__CHANGE_ME__` and is defined from `getenv()` in the
> `WORDPRESS_CONFIG_EXTRA` block of `docker-compose.dev.yml` (Lesson 02.2 Step 6), alongside the
> other `define()` calls. Never in a tracked file, and never as a build argument.

**Verify §1:**

- [ ] `advanced-custom-fields-pro` shows in the active list and `advanced-custom-fields` does not.
- [ ] `http://localhost:8080/wp-admin/edit.php?post_type=acf-field-group` still lists **Incident
      Details**. Local JSON is edition-independent — the file did not move and did not change.
- [ ] `docker compose logs --tail=40 wordpress` shows no fatal error. Two ACF copies active at
      once is the one way to get one, which is why Step 1 deactivates first.

### Step 2: Install WPGraphQL and WPGraphQL for ACF

```bash
docker compose run --rm wpcli wp plugin install wp-graphql --activate
docker compose run --rm wpcli wp plugin install wpgraphql-acf --activate

docker compose run --rm wpcli wp plugin list --fields=name,version,status --format=csv
```

Add those two version numbers to the pin list you have been keeping since Lesson 02.2.

Module 05 is where WPGraphQL gets taught properly — connections, `where` arguments, fragments,
GraphiQL as your primary reference. This step installs it because you cannot see what
`show_in_graphql` produced without it, and both commands are idempotent, so Lesson 05.1 finding
them already active is the expected outcome, not a conflict.

One setting has to change before you can inspect anything from a terminal. WPGraphQL blocks
**introspection for unauthenticated callers** by default, so an anonymous `curl` asking for
`__type` gets an `errors` array instead of a type. GraphiQL introspects as your logged-in
administrator and never needed it; `curl` and `jq` do:

```bash
docker compose run --rm wpcli wp option patch insert graphql_general_settings public_introspection_enabled on
docker compose run --rm wpcli wp option pluck graphql_general_settings public_introspection_enabled
# Expected: on
```

> **This is a local-only convenience, and it is a database row, which is the wrong place for a
> policy.** Lesson 06.1 confirms it is still set, and Lesson 06.4 replaces the row with a
> code-owned filter that turns introspection on when `WP_ENVIRONMENT_TYPE` is `local` and off
> everywhere else. Until then it is one option on one development machine.

**Verify §2:**

- [ ] Both plugins show `active`.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' -d '{"query":"{__typename}"}'`
      prints `200`.
- [ ] `http://localhost:8080/wp-admin/admin.php?page=graphiql-ide` opens the GraphiQL IDE.
- [ ] An anonymous introspection query answers with data rather than an `errors` array:
      `curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' -d '{"query":"{ __type(name:\"Incident\"){ name } }"}'`
      returns `{"data":{"__type":{"name":"Incident"}}}`. If it returns `errors`, the option above
      did not take.

### Step 3: Write the field group

Ten fields, both repeaters, names fixed by
[appendix 03 §4.3](../appendix/03-content-model-reference.md#43-tech-review-fields), at
`wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_tech_review_fields.json`:

```json
{
	"key": "group_tech_review_fields",
	"title": "Tech Review Fields",
	"fields": [
		{
			"key": "field_review_company_name",
			"label": "Company name",
			"name": "company_name",
			"type": "text",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 120
		},
		{
			"key": "field_review_logo",
			"label": "Logo",
			"name": "logo",
			"type": "image",
			"instructions": "WPGraphQL ignores return_format and always resolves a connection edge.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"return_format": "id",
			"library": "all",
			"preview_size": "medium",
			"mime_types": "jpg,jpeg,png,svg,webp"
		},
		{
			"key": "field_review_rating_overall",
			"label": "Overall",
			"name": "rating_overall",
			"type": "range",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "25", "class": "", "id": "" },
			"default_value": 5,
			"min": 1,
			"max": 10,
			"step": 1,
			"prepend": "",
			"append": "/10"
		},
		{
			"key": "field_review_rating_dx",
			"label": "Developer experience",
			"name": "rating_dx",
			"type": "range",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "25", "class": "", "id": "" },
			"default_value": 5,
			"min": 1,
			"max": 10,
			"step": 1,
			"prepend": "",
			"append": "/10"
		},
		{
			"key": "field_review_rating_docs",
			"label": "Documentation",
			"name": "rating_docs",
			"type": "range",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "25", "class": "", "id": "" },
			"default_value": 5,
			"min": 1,
			"max": 10,
			"step": 1,
			"prepend": "",
			"append": "/10"
		},
		{
			"key": "field_review_rating_incident_response",
			"label": "Incident response",
			"name": "rating_incident_response",
			"type": "range",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "25", "class": "", "id": "" },
			"default_value": 5,
			"min": 1,
			"max": 10,
			"step": 1,
			"prepend": "",
			"append": "/10"
		},
		{
			"key": "field_review_verdict",
			"label": "Verdict",
			"name": "verdict",
			"type": "select",
			"instructions": "Kebab-case values. Lesson 06.1 maps these onto the TechReviewVerdict enum.",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"choices": {
				"adopt": "Adopt",
				"trial": "Trial",
				"assess": "Assess",
				"hold": "Hold"
			},
			"default_value": "assess",
			"allow_null": 0,
			"multiple": 0,
			"ui": 0,
			"ajax": 0,
			"return_format": "value"
		},
		{
			"key": "field_review_reviewed_at",
			"label": "Reviewed at",
			"name": "reviewed_at",
			"type": "date_picker",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"display_format": "d/m/Y",
			"return_format": "Y-m-d",
			"first_day": 1
		},
		{
			"key": "field_review_pros",
			"label": "Pros",
			"name": "pros",
			"type": "repeater",
			"instructions": "One per row. Surfaces as [TechReviewFieldsPros] in GraphQL, not [String].",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"layout": "table",
			"pagination": 0,
			"min": 0,
			"max": 8,
			"collapsed": "",
			"button_label": "Add pro",
			"rows_per_page": 20,
			"sub_fields": [
				{
					"key": "field_review_pros_item",
					"label": "Item",
					"name": "item",
					"type": "text",
					"instructions": "",
					"required": 1,
					"conditional_logic": 0,
					"wrapper": { "width": "", "class": "", "id": "" },
					"default_value": "",
					"maxlength": 160,
					"parent_repeater": "field_review_pros"
				}
			]
		},
		{
			"key": "field_review_cons",
			"label": "Cons",
			"name": "cons",
			"type": "repeater",
			"instructions": "One per row. Surfaces as [TechReviewFieldsCons] in GraphQL.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"layout": "table",
			"pagination": 0,
			"min": 0,
			"max": 8,
			"collapsed": "",
			"button_label": "Add con",
			"rows_per_page": 20,
			"sub_fields": [
				{
					"key": "field_review_cons_item",
					"label": "Item",
					"name": "item",
					"type": "text",
					"instructions": "",
					"required": 1,
					"conditional_logic": 0,
					"wrapper": { "width": "", "class": "", "id": "" },
					"default_value": "",
					"maxlength": 160,
					"parent_repeater": "field_review_cons"
				}
			]
		}
	],
	"location": [
		[
			{ "param": "post_type", "operator": "==", "value": "tech_review" }
		]
	],
	"menu_order": 0,
	"position": "normal",
	"style": "default",
	"label_placement": "top",
	"instruction_placement": "label",
	"hide_on_screen": "",
	"active": true,
	"description": "Satirical company reviews. Field names fixed by appendix 03 section 4.3.",
	"show_in_rest": 0,
	"show_in_graphql": 1,
	"graphql_field_name": "techReviewFields",
	"map_graphql_types_from_location_rules": 0,
	"graphql_types": "",
	"modified": 1730000000
}
```

**Verify §3:**

- [ ] `docker compose run --rm wpcli wp eval 'echo count( acf_get_fields( "group_tech_review_fields" ) );'`
      prints `10`.
- [ ] Open `http://localhost:8080/wp-admin/post-new.php?post_type=tech_review`. The **Pros** and
      **Cons** repeaters render as tables with an "Add pro" / "Add con" button. If the rows are
      missing entirely, Step 1 did not take.

### Step 4: Do the sync round trip once, deliberately

You have now hand-written two field groups. That will not be how you work day to day — the ACF UI
is a much faster field builder than a JSON editor — so do the round trip once and watch what
happens to the file.

1. Open `http://localhost:8080/wp-admin/edit.php?post_type=acf-field-group`.
2. Both groups show **Sync available**. Click the *Sync* link on **Tech Review Fields**.
3. Open it and click the **GraphQL** tab in the field group settings sidebar.
4. Change `max` on the **Pros** repeater from 8 to 6, then press **Update**.
5. Run `git diff wp-content/plugins/blame-the-tech-core/includes/acf-json/`.

**Verify §4:**

- [ ] The GraphQL tab shows *Show in GraphQL* checked and *GraphQL Field Name*
      `techReviewFields`. Those are the same two JSON keys you wrote by hand — the UI is a form
      over the file.
- [ ] The `git diff` is exactly two lines: `"max": 8` becoming `"max": 6`, and a new `"modified"`
      timestamp. **That diff is the review artifact.** A field-model change that does not show up
      here only exists in your database.
- [ ] The filename did not change. ACF names the file from the group key, and Lesson 04.1's
      `save_file_name` filter names it from the title — both give
      `group_tech_review_fields.json`.
- [ ] Put `max` back to 6 or 8, whichever you prefer, and commit whatever the file says. The
      point was the diff, not the number.

> **After a Sync the group exists in two places: the JSON file and a `wp_posts` row.** That is
> normal and correct. The JSON is the deployed artifact and the source of truth; the database copy
> is a local editing convenience, recreated by one click on any machine that pulls the repo. It is
> also why `git diff` — not the ACF UI — is the answer to "did my change land".

### Step 5: Author one review, with populated repeaters

Create a tech review at `http://localhost:8080/wp-admin/post-new.php?post_type=tech_review`:

- Title `Hyperscale Cloud Co`, slug `hyperscale-cloud-co`
- `company_name` `Hyperscale Cloud Co`
- All four ratings set to different values, so you can tell them apart in the response
- `verdict` `Trial`
- Two rows in **Pros**, two rows in **Cons**
- `reviewed_at` any date
- Assign a `tech_stack` term, and upload any image as the logo

Publish it.

### Step 6: Query the repeaters

Open GraphiQL and run this. Note that `pros` and `cons` have subselections and `logo` has two
levels of them.

```graphql
# queries.graphql — scratch. Lesson 05.3 turns this into a fragment library.
query ReviewBySlug($slug: ID!) {
  techReview(id: $slug, idType: SLUG) {
    __typename
    title
    techReviewFields {
      companyName
      ratingOverall
      ratingDx
      ratingDocs
      ratingIncidentResponse
      verdict
      reviewedAt
      pros {
        item
      }
      cons {
        item
      }
      logo {
        node {
          sourceUrl
          altText
          mediaDetails {
            width
            height
          }
        }
      }
    }
  }
}
```

With variables:

```json
{ "slug": "hyperscale-cloud-co" }
```

**Verify §6:**

- [ ] `pros` comes back as `[{ "item": "…" }, { "item": "…" }]` — a list of **objects**.
- [ ] Deleting `{ item }` from the query produces a validation error before any resolver runs, and
      the response has an `errors` array. Read that message once; it is the one you will see again
      in Module 10.
- [ ] `ratingOverall` is a number in JSON, and the schema calls it `Float`.
- [ ] `verdict` is `"trial"` — the raw kebab-case value, typed `String`.

### Step 7: Write down the four names and the one problem

In the GraphiQL docs pane, search for `TechReviewFields`. Record in your notes:

| What to record | Where to find it |
|---|---|
| The group object type name | docs pane, the type of `TechReview.techReviewFields` |
| The two repeater row type names | the type of `pros` and of `cons` |
| The interface name | docs pane, the interfaces `TechReview` implements |
| That `verdict` is `String`, not an enum | the type of `techReviewFields.verdict` |

Those four names are what Module 10's codegen will emit as TypeScript types, character for
character. Writing them down now is what makes the generated file readable when you first open it
instead of surprising.

Then commit: `git add -A && git commit -m "feat(wp): tech review field group, with repeaters"`.

---
## Verification

```bash
cd wordpress-headless

# 1. The right four plugins are active, and the free ACF is not
docker compose run --rm wpcli wp plugin list --status=active --field=name | sort
# Expected: includes advanced-custom-fields-pro, blame-the-tech-core, wp-graphql, wpgraphql-acf
#           and does NOT include advanced-custom-fields

# 2. Two field groups, two files
ls wp-content/plugins/blame-the-tech-core/includes/acf-json/
# Expected: group_incident_details.json  group_tech_review_fields.json

# 3. ACF loaded both, with the GraphQL names the contract fixes
docker compose run --rm wpcli wp eval 'foreach ( acf_get_field_groups() as $g ) { echo $g["key"], " => ", ( $g["graphql_field_name"] ?? "-" ), "\n"; }'
# Expected: group_incident_details => incidentDetails
#           group_tech_review_fields => techReviewFields

# 4. One helper, so the rest of this block reads as GraphQL rather than as curl
gql() { curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' -d "$1"; }

# 5. The group type AND both generated repeater row types exist in the schema
gql '{"query":"{ a: __type(name:\"TechReviewFields\"){ name } b: __type(name:\"TechReviewFieldsPros\"){ name kind fields{ name } } c: __type(name:\"TechReviewFieldsCons\"){ name } }"}' | jq -c '.data'
# Expected: a and c named as asked; b is kind OBJECT with exactly one field, "item"

# 6. The generated interface is applied to the TechReview type
gql '{"query":"{ __type(name:\"TechReview\"){ interfaces{ name } } }"}' | jq -r '.data.__type.interfaces[].name' | grep WithAcfTechReviewFields
# Expected: WithAcfTechReviewFields

# 7. `pros` is a LIST of an OBJECT — this is the whole lesson, read off the schema
gql '{"query":"{ __type(name:\"TechReviewFields\"){ fields{ name type{ kind name ofType{ kind name } } } } }"}' | jq -c '.data.__type.fields[] | select(.name=="pros")'
# Expected: {"name":"pros","type":{"kind":"LIST","name":null,"ofType":{"kind":"OBJECT","name":"TechReviewFieldsPros"}}}
#           NOT ofType SCALAR String.

# 8. ...and the data agrees
gql '{"query":"query($s:ID!){ techReview(id:$s, idType:SLUG){ techReviewFields{ verdict ratingOverall pros{ item } cons{ item } logo{ node{ sourceUrl } } } } }","variables":{"s":"hyperscale-cloud-co"}}' \
  | jq -c '.data.techReview.techReviewFields | {verdict, ratingOverall, pros, consCount: (.cons|length), logo: .logo.node.sourceUrl}'
# Expected: verdict "trial"; pros an array of {"item":"…"} OBJECTS; logo a URL string
#           reached through the node hop

# 9. NEGATIVE: a repeater with no subselection is rejected — and the status is still 200
STATUS=$(curl -s -o /tmp/gql.json -w '%{http_code}' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query($s:ID!){ techReview(id:$s, idType:SLUG){ techReviewFields{ pros } } }","variables":{"s":"hyperscale-cloud-co"}}')
echo "http=$STATUS"; jq -r '.errors[0].message' /tmp/gql.json
# Expected: http=200 AND an error saying "pros" of type "[TechReviewFieldsPros]" must have a
#           selection of subfields. This is why every failure check in this course inspects
#           .errors and never the HTTP status code.

# 10. NEGATIVE: the shape you assumed a repeater had does not exist
gql '{"query":"query($s:ID!){ techReview(id:$s, idType:SLUG){ techReviewFields{ pros{ label } } } }","variables":{"s":"hyperscale-cloud-co"}}' | jq -r '.errors[0].message'
# Expected: Cannot query field "label" on type "TechReviewFieldsPros".
#           One field only, named after the ACF sub-field: `item`.

# 11. `verdict` is a SCALAR today, not an ENUM. Record it; Lesson 06.1 changes it.
gql '{"query":"{ __type(name:\"TechReviewFields\"){ fields{ name type{ kind name } } } }"}' | jq -c '.data.__type.fields[] | select(.name=="verdict")'
# Expected: {"name":"verdict","type":{"kind":"SCALAR","name":"String"}}

# 12. Number and Range both surface as Float, not Int
gql '{"query":"{ __type(name:\"IncidentDetails\"){ fields{ name type{ kind name } } } }"}' | jq -r '.data.__type.fields[] | select(.name=="downtimeMinutes" or .name=="blameConfidence") | "\(.name) \(.type.name)"'
# Expected: downtimeMinutes Float
#           blameConfidence Float

# 13. Lesson 04.1's group still resolves, unchanged
gql '{"query":"{ incidents(first:1){ nodes{ slug incidentDetails{ downtimeMinutes environment isVerified } } } }"}' | jq -c '.data.incidents.nodes[0]'
# Expected: a slug, a numeric downtimeMinutes, a kebab-case environment, a boolean isVerified.
#           A null incidentDetails means show_in_graphql is not 1 in that JSON file.

# 14. No errors key at all on the queries that were supposed to work
gql '{"query":"{ techReviews(first:5){ nodes{ techReviewFields{ pros{ item } } } } }"}' | jq 'has("errors")'
# Expected: false

# 15. Only the field group file is new. No plugin zip, no vendor tree, no env file.
git status --short wp-content/plugins/
# Expected: includes/acf-json/group_tech_review_fields.json (and nothing named _acf-pro.zip)
```

Checks 9 and 10 are the ones to run before you move on. They are the two error messages that will
find you again in Module 10, and recognising them instantly is worth more than the query in check
8 succeeding.

## Control Questions

1. `HOBT Promo` has a `modules` repeater whose sub-fields include a `lessons` repeater. Predict
   both generated GraphQL type names from the naming rules in Key Concept 1, then say what that
   tells you about the content model.
2. A field group's only location rule is `post_status == draft`. Explain what WPGraphQL for ACF
   derives from that, why the result is almost certainly wrong, and give the exact two JSON keys
   you would set to fix it.
3. A teammate reports that "the GraphQL endpoint is down" because their request returned HTTP 200
   with no data. Say what actually happened, which part of the response body holds the answer, and
   why the endpoint returning 200 is correct behaviour rather than a bug in WPGraphQL.
4. An editor asks for an `internal_note` textarea on tech reviews, for notes the public must never
   see. Describe exactly what you would set in the field JSON, and name the two other places in
   this course where "invisible in wp-admin" would still not have been enough.
5. `verdict` arrives as `String`. Write the four-line TypeScript `switch` that this permits and
   that Lesson 06.1's enum would reject at compile time, then say which of the four verdicts a
   reader of that code would notice was broken.

## Learn More

- [WPGraphQL for ACF — documentation](https://acf.wpgraphql.com/) — the v2 rewrite's own docs;
  start with "Field Types" and compare it against the table in Key Concept 2
- [WPGraphQL for ACF — Repeater field](https://acf.wpgraphql.com/field-types/repeater/) — the
  generated type naming, stated by the plugin that generates it
- [WPGraphQL for ACF — options pages and field group settings](https://acf.wpgraphql.com/) — the
  `show_in_graphql`, `graphql_field_name` and manual type mapping settings in one place
- [ACF — Repeater field](https://www.advancedcustomfields.com/resources/repeater/) — the PHP side,
  including `have_rows()` and the nesting limits worth knowing before you nest
- [GraphQL specification — Field selection merging and leaf field selections](https://spec.graphql.org/October2021/#sec-Leaf-Field-Selections) —
  three paragraphs that explain check 9's error message better than any tutorial
- [GraphQL specification — Errors](https://spec.graphql.org/October2021/#sec-Errors) — why a
  GraphQL failure is a 200 with an `errors` array, in the specification's own words
- [Introspection](https://graphql.org/learn/introspection/) — the `__type` queries used in checks
  5, 7, 11 and 12, which are how you interrogate a schema without a UI
