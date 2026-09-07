---
title: 'Relationships & Options Pages'
module: 4
lesson: 3
teaches: [acf-term-field-groups, acf-options-page, acf-relationship-vs-taxonomy, root-query-settings, page-template-location-rule]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_scapegoat_profile.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_hobt_promo.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_site_settings.json', 'wordpress-headless/wp-content/themes/btt-headless/templates/hobt.php']
requires: [4.1]
---

# Lesson 04.3 — Relationships & Options Pages

## Quick Overview

Three groups, three locations that are not "a post type". `Scapegoat Profile` attaches to a
**taxonomy term**, giving every scapegoat an avatar, a tagline, a defensiveness rating and an
official excuse — which is how the taxonomy decision from Lesson 03.3 pays for itself
editorially. `HOBT Promo` attaches to a `page` **and** a page template, so you also write
`templates/hobt.php` for the location rule to key off. `Site Settings` is an
`acf_add_options_page()` group with no object at all, exposed on the GraphQL **root query** so
the Next.js root layout can fetch the tagline, the primary CTA and the social links in one
request instead of per page.

The lesson also settles a modelling question that comes up on every headless project: when do
you use an ACF Relationship or Post Object field instead of a taxonomy? The short answer is
"when the thing on the other end needs its own editorial body, revisions and permalink" — and
`scapegoat` does not, which is why it is a term with a field group rather than a CPT with a
relationship. You will also meet `incident_submission_open` in Site Settings, a True/False that
is a genuine kill switch: the Server Action in Module 16 must honour it, and a setting that some
code paths respect and others ignore is worse than no setting at all.

By the end of this lesson you will have:

- `group_scapegoat_profile.json` — an ACF **term** field group, queried through
  `scapegoat.scapegoatProfile` in GraphiQL
- `group_hobt_promo.json` with a two-condition location rule, and
  `themes/btt-headless/templates/hobt.php` for it to match
- `group_site_settings.json` exposed on the root query as `siteSettings`, fetched in one query
- All ten scapegoat terms given a tagline and an official excuse in wp-admin
- A written decision record on taxonomy-with-term-fields versus CPT-with-relationship, with the
  cost named
- `incident_submission_open` set, and a note that Module 16's Server Action must check it

## Classic WP Analogy

Term meta is not new to you, even if you have rarely used it: `add_term_meta`,
`get_term_meta` and `update_term_meta` have been in core since 4.4, and ACF term field groups
are a UI over exactly those functions plus `wp_termmeta`. Options pages are the same idea over
`wp_options` — an ACF options page is `get_option()` with a nicer form, and the values land as
autoloaded option rows, which is the thing Lesson 02.3 told you to be careful about. If you have
ever built a Theme Options page with the Settings API and `register_setting`, this is that, with
the boilerplate removed.

The relationship question also has a familiar Classic form. You have surely faced "should this
be a taxonomy or a CPT?" on a real project — categories versus a Departments CPT, tags versus a
People CPT — and you know the tie-breakers: does it need a body, an image gallery, revisions, an
author, its own permalink structure? Nothing about that decision procedure changes here. What
changes is that one of the tie-breakers gets much heavier, because term counts are maintained by
core and post relationships are not, and the front end reads counts on every list page.

**Where the analogy breaks down:** `get_option('btt_site_settings')` in Classic WordPress is
free — the row is autoloaded, it is already in memory, and calling it in a header template a
dozen times costs nothing. In this architecture the same value has to be *requested over the
network* by the front end, and where you request it determines whether it is fetched once per
page or once per component. That is why `Site Settings` is deliberately exposed on the root
query and fetched in the root layout: the pattern that Classic WordPress made free has to be
designed for here. The mirror-image trap is also real — the autoload behaviour that made
`get_option()` free is what puts these rows on the hot path of every single GraphQL request,
so an options page with a 200-row repeater is a tax on every API call.

---

## Key Concepts

### 1. ACF's `$post_id` is not always a post id

Every ACF read and write takes a second argument that names the *thing* the value belongs to, and
it accepts far more than a post id. This is the mechanism that makes term field groups and options
pages work at all, and it is the first thing to learn here because everything else in this lesson
is a special case of it.

| Target | ACF identifier | Stored in | Example |
|---|---|---|---|
| A post | the integer id | `wp_postmeta` | `get_field( 'downtime_minutes', 4218 )` |
| The current post in the loop | omit the argument | `wp_postmeta` | `get_field( 'downtime_minutes' )` |
| A **term** | `term_<term_id>` | `wp_termmeta` | `get_field( 'tagline', 'term_45' )` |
| A term, older form | `<taxonomy>_<term_id>` | `wp_termmeta` | `get_field( 'tagline', 'scapegoat_45' )` |
| A user | `user_<user_id>` | `wp_usermeta` | `get_field( 'bio', 'user_7' )` |
| An **options page** | the literal string `option` | `wp_options` | `get_field( 'site_tagline', 'option' )` |
| A block | `block_<uuid>` | the block's own attributes | Module 13 |

`term_45` is the modern form and the one to use; `scapegoat_45` still works and you will meet it
in older codebases. Passing a bare `45` when you meant a term reads post 45's meta instead —
silently, returning `null` or, worse, someone else's value. **When a `get_field()` call returns
`null` and you are certain the value is set, check this argument before you check anything else.**

### 2. Term field groups: `wp_termmeta`, and a different GraphQL attachment point

`Scapegoat Profile` has one location rule, `taxonomy == scapegoat`. Two consequences follow, and
they are on different layers.

```
   POST field group                        TERM field group
   ───────────────────────────────         ───────────────────────────────
   location: post_type == incident         location: taxonomy == scapegoat
   values in wp_postmeta                   values in wp_termmeta
   GraphQL: Incident.incidentDetails       GraphQL: Scapegoat.scapegoatProfile
   ACF id:  4218                           ACF id:  'term_45'
   admin UI: below the block editor        admin UI: on the Edit Term screen
```

`wp_termmeta` has the same shape as `wp_postmeta` — `term_id`, `meta_key`, `meta_value` — and the
same absence of an index on `meta_value`. So the Lesson 02.3 lesson applies unchanged: you can
read a term's fields cheaply by id, and you cannot **sort ten thousand terms by
`defensiveness`** without a filesort over the whole table. That is precisely why the blame
leaderboard in Lesson 05.4 orders by `wp_term_taxonomy.count`, a maintained counter, rather than
by anything in this field group.

The GraphQL side is what makes this lesson necessary rather than obvious. WPGraphQL for ACF
resolves the location rule `taxonomy == scapegoat` to the `Scapegoat` type, so the group lands on
a **term** type rather than a content type:

```graphql
# queries.graphql — scratch. See Lesson 05.4 Step 3 for the full version.
scapegoat(id: "the-intern", idType: SLUG) {
  name
  count
  scapegoatProfile {
    tagline
    defensiveness
    avatar { node { sourceUrl } }
  }
}
```

That is a different root field, a different type and a different id strategy from everything you
queried in Lesson 04.2 — and it is the payoff for the Lesson 03.3 decision to make `scapegoat` a
taxonomy. Terms got you a free maintained count and free archives; the term field group gets you
the editorial content that the taxonomy decision appeared to give up.

### 3. Post Object, Relationship, and why this project has neither

ACF has three relational field types and they differ only in ergonomics, not in storage.

| Field type | Stores | UI | Cardinality |
|---|---|---|---|
| Post Object | one post id, or an array of them | a select box | one, or many |
| Relationship | an array of post ids | two-pane search-and-add | many, ordered |
| Page Link | a URL or a post id | a select box | one, or many |
| Taxonomy | term ids | checkboxes, select, or the core term box | many |

All of them store **ids in `wp_postmeta`**, serialised when there is more than one. So the choice
between them is a choice about the editor's experience, and the choice between *any of them* and a
taxonomy is a choice about queries.

Compare the two ways to answer "which incidents relate to this review":

| | ACF Relationship field on the review | `tech_stack` taxonomy on both |
|---|---|---|
| Stored as | `a:3:{i:0;s:4:"4218";…}` in one meta row | rows in `wp_term_relationships` |
| Query "incidents for this review" | unserialise, then `post__in` | `tax_query` — an indexed join |
| Query "reviews for this incident" | ❌ requires `LIKE '%4218%'` over `meta_value` | the same `tax_query`, reversed |
| Maintained count | ❌ none | ✅ `wp_term_taxonomy.count` |
| Editorial control of order | ✅ drag to reorder | ❌ terms are unordered |
| Bidirectional by construction | ❌ two fields to keep in sync | ✅ one relationship, both directions |

**The verdict for this project: no relationship fields.** `tech_stack` spans `incident`,
`tech_review` and `post` (appendix 03 §2) and answers the relation in both directions with an
indexed join. Adding a Relationship field would buy editorial ordering and cost the reverse
query, the count, and a second place for the truth to live.

The honest case for a Relationship field, so you can recognise it: **when the order is editorial
content.** "The three incidents we want featured on this review page, in this sequence" is not a
classification, it is a curated list, and no taxonomy can express it. If that requirement arrives,
add the field — and read Key Concept 4 first.

### 4. Relationship fields invite an N+1, and the invitation is easy to accept

The performance trap is not in ACF. It is in what a GraphQL resolver does with a list of ids.

```
   QUERY                              WHAT THE SERVER DOES
   ────────────────────────────       ─────────────────────────────────────────────
   techReviews(first: 20) {           1 query   → 20 reviews
     techReviewFields {
       relatedIncidents {             20 queries → one per review, to unserialise
         nodes {                                   and load its ids
           title
           incidentDetails {          20 queries → one per incident's meta group
             downtimeMinutes            × 3 incidents each = 60
           }
         }
       }
     }
   }                                  ─────────────────────────────────────────────
                                      81 queries for one HTTP request
```

Every resolver in that tree is individually correct and individually cheap. The cost is
**multiplicative**, and nothing in the query text hints at it — the request looks like one query
because, from the client's side, it is one query. This is the defining performance characteristic
of GraphQL and the reason Lesson 06.4 exists: it covers WPGraphQL's loaders, batching, and the
query-complexity limits that stop a client asking for 81 queries in the first place.

> **The relevant point for today:** a schema decision made in a field group in Module 04 sets the
> performance ceiling of a page in Module 08. Nothing between here and there will flag it. The
> only cheap moment to think about it is while you are choosing the field type.

### 5. Options pages: no object, one root field, one fetch

`acf_add_options_page()` creates an admin screen with no post and no term behind it. Values land in
`wp_options`, one row per field, named `options_<field_name>`.

`show_in_graphql` plus `graphql_field_name: siteSettings` puts it on the **root query**, which is
the whole point:

```
   ROOT-QUERY SETTINGS (what this course does)        PER-COMPONENT SETTINGS (what not to do)
   ─────────────────────────────────────────         ────────────────────────────────────────
   app/layout.tsx                                    Header.tsx    → query siteSettings
     one query: SiteChrome {                         Footer.tsx    → query siteSettings
       generalSettings { … }                         CtaBlock.tsx  → query siteSettings
       siteSettings { … }                            Banner.tsx    → query siteSettings
       menuItems(where: {location: PRIMARY}) { … }
     }                                               4 requests, 4 cache entries, 4 chances
   ─────────────────────────────────────────          for the header and footer to disagree
   1 request, fetched once per render of the
   layout, passed down as props
```

Lesson 05.4 Step 6 builds that exact `SiteChrome` query, and Module 11 wires it into the root
layout. Two properties make root-query placement the right call: it is fetchable **without a
node**, so the layout does not need to know which page is rendering; and it is one cache entry,
so the tagline cannot be stale in the footer and fresh in the header.

The Classic WordPress reflex to unlearn is the one about autoload. `get_option()` was free because
the row was already in memory; here the value crosses a network, and where you ask for it
decides how many times. This course also turns ACF's autoload **off**:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf.php (fragment)
add_filter( 'acf/settings/autoload', '__return_false' );
```

| Autoload | Cost when settings ARE read | Cost on every other request |
|---|---|---|
| on | zero extra queries | every option's bytes loaded on **every** request, including the 40-incident list query |
| **off** (chosen) | one query per option read | **zero** |

Since the settings are read by exactly one query, on exactly one route, off is clearly right. If
you ever add a 200-row repeater to an options page, that decision is what stops it becoming a tax
on every API call in the system.

### 6. A two-condition location rule, and the file it depends on

ACF location rules are an array of arrays. The nesting is the boolean logic, and getting it
backwards is a classic:

```
   "location": [                             "location": [
     [ A, B ]        →  A AND B                [ A ],
   ]                                           [ B ]        →  A OR B
                                             ]
```

`HOBT Promo` needs **AND**: it appears on a `page`, *and* only when that page uses the HOBT
template. One inner array, two rules.

```json
{
	"location": [
		[
			{ "param": "post_type", "operator": "==", "value": "page" },
			{ "param": "page_template", "operator": "==", "value": "templates/hobt.php" }
		]
	]
}
```

The second rule has a prerequisite that catches everyone: **WordPress will not offer a page
template it cannot find.** The Page Attributes box is populated from the active theme's files, so
if `wp-content/themes/btt-headless/templates/hobt.php` does not exist, the dropdown has no HOBT
entry, `_wp_page_template` is never set, the location rule never matches, and the field group
never appears. The symptom is "my ACF fields are missing" and the cause is a missing PHP file in a
theme that renders nothing.

| Requirement | Detail |
|---|---|
| The file must exist | in the active theme, at the path the rule names |
| It must carry a `Template Name:` header | that is what makes WordPress list it |
| It should carry `Template Post Type: page` | so it is not offered on posts and incidents |
| It may be in a subdirectory | WordPress scans the theme root and one level down, so `templates/` is fine |
| The stored value is the theme-relative path | `templates/hobt.php`, which is exactly what the rule compares against |

The file itself renders nothing. In a headless install the theme's `template_redirect` hook has
already sent the visitor to Next before any template loads, so `templates/hobt.php` exists purely
so WordPress has a name to put in a dropdown — which is a genuinely odd thing to have to build,
and worth understanding rather than copying.

### 7. Navigation does not go in Site Settings

This is a mistake that looks like good design for about three weeks.

`Site Settings` is an options page, options pages are easy to add a repeater to, and "primary
navigation" feels like a site-wide setting. So a `nav_links` repeater with `label` and `url`
appears, and then:

| What core menus give you | What a `nav_links` repeater gives you |
|---|---|
| Hierarchy — `parentId`, arbitrary depth | one flat list, or a `parent` text field you maintain by hand |
| Real object references | strings, which rot silently when a slug changes |
| `uri` resolved by WordPress, including `/blog` rewrites | a URL an editor typed |
| Multiple locations — primary, footer, legal | one repeater per location, each a new deploy |
| The menu UI editors already know | a repeater |
| Polylang per-language menus (Module 20) | nothing |
| `menuItems(where: { location: PRIMARY })` in WPGraphQL | a field you have to design |

**The rule: navigation comes from core WordPress menus, exposed through `menuItems`.** Lesson 05.4
Step 1 registers the `primary` location and builds the menu; Module 11 renders it. `Site Settings`
holds settings — a tagline, a CTA, a footer blurb, social links, a kill switch — and nothing that
points at content.

> **The tell that you are about to make this mistake** is an options-page field whose value is a
> URL to your own site. `primary_cta_url` is borderline and survives review because the CTA target
> is a business decision that changes without any content changing. A list of page links is not
> borderline: that is a menu.

### 8. `incident_submission_open` is a kill switch, which means every path must honour it

A True/False in an options page, and the most consequential field in the group. Its job is to stop
public incident submissions during a moderation backlog or an abuse wave — without a deploy.

A kill switch that some code paths respect and others ignore is **worse than no kill switch**,
because you now believe submissions are closed. So the check has to exist at every write path, and
one of them has to be authoritative.

| Layer | What it does with the switch | Authoritative? |
|---|---|---|
| Next root layout (Module 11) | hides the "Report an incident" CTA | no — cosmetic |
| The submission form (Module 16) | renders a closed-state message instead of the form | no — cosmetic |
| The **Server Action** (Module 16) | refuses before it validates anything | no — it is one client |
| The **`createIncident` mutation** (Module 06) | refuses with an error, whatever the caller | ✅ **yes** |
| wp-admin | unaffected — editors always may create incidents | n/a |

The reasoning is the same as for `is_verified` in Lesson 04.1. Next is not a trusted client: it is
*a* client. Anything reachable with an app token has to be re-checked in WordPress, which is where
the switch lives and where the only check that cannot be bypassed belongs. The Next-side checks
are there so a user sees a sensible page, not so the system is safe.

---
## Task

### Step 1: The term field group

Six fields, names fixed by
[appendix 03 §4.2](../appendix/03-content-model-reference.md#42-scapegoat-profile), at
`wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_scapegoat_profile.json`:

```json
{
	"key": "group_scapegoat_profile",
	"title": "Scapegoat Profile",
	"fields": [
		{
			"key": "field_scapegoat_avatar",
			"label": "Avatar",
			"name": "avatar",
			"type": "image",
			"instructions": "",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"return_format": "id",
			"library": "all",
			"preview_size": "thumbnail",
			"mime_types": "jpg,jpeg,png,webp"
		},
		{
			"key": "field_scapegoat_tagline",
			"label": "Tagline",
			"name": "tagline",
			"type": "text",
			"instructions": "One line, shown under the name on the term page.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 120
		},
		{
			"key": "field_scapegoat_defensiveness",
			"label": "Defensiveness",
			"name": "defensiveness",
			"type": "range",
			"instructions": "Not sortable at scale — wp_termmeta has no value index. See Key Concept 2.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"default_value": 5,
			"min": 1,
			"max": 10,
			"step": 1,
			"prepend": "",
			"append": "/10"
		},
		{
			"key": "field_scapegoat_first_blamed_on",
			"label": "First blamed on",
			"name": "first_blamed_on",
			"type": "date_picker",
			"instructions": "",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"display_format": "d/m/Y",
			"return_format": "Y-m-d",
			"first_day": 1
		},
		{
			"key": "field_scapegoat_official_excuse",
			"label": "Official excuse",
			"name": "official_excuse",
			"type": "textarea",
			"instructions": "Plain text. Escaped on output.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 500,
			"rows": 4,
			"new_lines": ""
		},
		{
			"key": "field_scapegoat_is_sentient",
			"label": "Is sentient",
			"name": "is_sentient",
			"type": "true_false",
			"instructions": "",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"message": "",
			"default_value": 0,
			"ui": 1,
			"ui_on_text": "Sentient",
			"ui_off_text": "Inert"
		}
	],
	"location": [
		[
			{ "param": "taxonomy", "operator": "==", "value": "scapegoat" }
		]
	],
	"menu_order": 0,
	"position": "normal",
	"style": "default",
	"label_placement": "top",
	"instruction_placement": "label",
	"hide_on_screen": "",
	"active": true,
	"description": "Editorial content for scapegoat terms. Values live in wp_termmeta.",
	"show_in_rest": 0,
	"show_in_graphql": 1,
	"graphql_field_name": "scapegoatProfile",
	"map_graphql_types_from_location_rules": 0,
	"graphql_types": "",
	"modified": 1730000000
}
```

**Verify §1:**

- [ ] `http://localhost:8080/wp-admin/edit-tags.php?taxonomy=scapegoat&post_type=incident` still
      lists ten terms, and the **Add New Scapegoat** form at the left now shows all six fields.
- [ ] Click **The Intern** to open the Edit Term screen. The fields are there too — the location
      rule applies to both forms.

### Step 2: The page template the HOBT location rule needs

This is the file that has to exist before WordPress will offer the template. It renders nothing;
the theme's `template_redirect` hook from Lesson 02.4 has already sent the visitor to Next before
any template is loaded.

```php
// wordpress-headless/wp-content/themes/btt-headless/templates/hobt.php
<?php
/**
 * Template Name: HOBT Landing
 * Template Post Type: page
 *
 * This template never renders for a visitor. It exists so that:
 *
 *   1. WordPress lists "HOBT Landing" in the Page Attributes box, which sets
 *      _wp_page_template to 'templates/hobt.php';
 *   2. the ACF location rule `page_template == templates/hobt.php` can match,
 *      which is what makes the HOBT Promo field group appear.
 *
 * Reaching this output means btt_headless_redirect() did not fire. Treat it as
 * a diagnostic, exactly like the theme's index.php.
 *
 * @package btt-headless
 */

defined( 'ABSPATH' ) || exit;

$btt_frontend = defined( 'BTT_FRONTEND_URL' ) ? BTT_FRONTEND_URL : '/';
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="robots" content="noindex, nofollow">
	<title><?php echo esc_html( get_the_title() ); ?></title>
</head>
<body>
	<p>This page is rendered by the Next.js application, not by WordPress.</p>
	<p><a href="<?php echo esc_url( $btt_frontend ); ?>"><?php echo esc_html( $btt_frontend ); ?></a></p>
</body>
</html>
```

Create the directory first, or the file lands somewhere WordPress will not scan:

```bash
cd wordpress-headless
mkdir -p wp-content/themes/btt-headless/templates
```

**Verify §2:**

- [ ] `docker compose exec wordpress php -l /var/www/html/wp-content/themes/btt-headless/templates/hobt.php`
      prints `No syntax errors detected`.
- [ ] `docker compose run --rm wpcli wp eval 'print_r( wp_get_theme()->get_page_templates() );'`
      lists `templates/hobt.php => HOBT Landing`. **If this is empty, stop here** — every symptom
      in the next two steps traces back to it.

### Step 3: The HOBT Promo field group

Nine fields including two repeaters, names fixed by
[appendix 03 §4.4](../appendix/03-content-model-reference.md#44-hobt-promo), at
`wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_hobt_promo.json`:

```json
{
	"key": "group_hobt_promo",
	"title": "HOBT Promo",
	"fields": [
		{
			"key": "field_hobt_headline",
			"label": "Headline",
			"name": "headline",
			"type": "text",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 120
		},
		{
			"key": "field_hobt_subheadline",
			"label": "Subheadline",
			"name": "subheadline",
			"type": "textarea",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 300,
			"rows": 3,
			"new_lines": ""
		},
		{
			"key": "field_hobt_hero_image",
			"label": "Hero image",
			"name": "hero_image",
			"type": "image",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"return_format": "id",
			"library": "all",
			"preview_size": "medium",
			"mime_types": "jpg,jpeg,png,webp"
		},
		{
			"key": "field_hobt_price_usd",
			"label": "Price (USD)",
			"name": "price_usd",
			"type": "number",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "33", "class": "", "id": "" },
			"default_value": "",
			"min": 0,
			"max": 100000,
			"step": 1,
			"prepend": "$",
			"append": ""
		},
		{
			"key": "field_hobt_seats_left",
			"label": "Seats left",
			"name": "seats_left",
			"type": "number",
			"instructions": "Drives the urgency badge, so /hobt gets a shorter revalidate in Module 18.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "33", "class": "", "id": "" },
			"default_value": "",
			"min": 0,
			"max": 1000,
			"step": 1,
			"prepend": "",
			"append": "seats"
		},
		{
			"key": "field_hobt_demo_booking_url",
			"label": "Demo booking URL",
			"name": "demo_booking_url",
			"type": "url",
			"instructions": "Where a successful lead submission redirects (Module 16).",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "34", "class": "", "id": "" },
			"default_value": ""
		},
		{
			"key": "field_hobt_start_now_url",
			"label": "Start now URL",
			"name": "start_now_url",
			"type": "url",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"default_value": ""
		},
		{
			"key": "field_hobt_modules",
			"label": "Modules",
			"name": "modules",
			"type": "repeater",
			"instructions": "Generates HobtPromoModules in the schema.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"layout": "block",
			"pagination": 0,
			"min": 0,
			"max": 30,
			"collapsed": "field_hobt_modules_title",
			"button_label": "Add module",
			"rows_per_page": 20,
			"sub_fields": [
				{
					"key": "field_hobt_modules_title",
					"label": "Title",
					"name": "title",
					"type": "text",
					"required": 1,
					"conditional_logic": 0,
					"wrapper": { "width": "60", "class": "", "id": "" },
					"default_value": "",
					"maxlength": 120,
					"parent_repeater": "field_hobt_modules"
				},
				{
					"key": "field_hobt_modules_duration_minutes",
					"label": "Duration (min)",
					"name": "duration_minutes",
					"type": "number",
					"required": 0,
					"conditional_logic": 0,
					"wrapper": { "width": "40", "class": "", "id": "" },
					"default_value": "",
					"min": 0,
					"max": 6000,
					"step": 5,
					"parent_repeater": "field_hobt_modules"
				},
				{
					"key": "field_hobt_modules_summary",
					"label": "Summary",
					"name": "summary",
					"type": "textarea",
					"required": 0,
					"conditional_logic": 0,
					"wrapper": { "width": "", "class": "", "id": "" },
					"default_value": "",
					"maxlength": 400,
					"rows": 3,
					"new_lines": "",
					"parent_repeater": "field_hobt_modules"
				}
			]
		},
		{
			"key": "field_hobt_testimonials",
			"label": "Testimonials",
			"name": "testimonials",
			"type": "repeater",
			"instructions": "Generates HobtPromoTestimonials in the schema.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"layout": "block",
			"pagination": 0,
			"min": 0,
			"max": 12,
			"collapsed": "field_hobt_testimonials_author",
			"button_label": "Add testimonial",
			"rows_per_page": 20,
			"sub_fields": [
				{
					"key": "field_hobt_testimonials_quote",
					"label": "Quote",
					"name": "quote",
					"type": "textarea",
					"required": 1,
					"conditional_logic": 0,
					"wrapper": { "width": "", "class": "", "id": "" },
					"default_value": "",
					"maxlength": 400,
					"rows": 3,
					"new_lines": "",
					"parent_repeater": "field_hobt_testimonials"
				},
				{
					"key": "field_hobt_testimonials_author",
					"label": "Author",
					"name": "author",
					"type": "text",
					"required": 1,
					"conditional_logic": 0,
					"wrapper": { "width": "40", "class": "", "id": "" },
					"default_value": "",
					"maxlength": 80,
					"parent_repeater": "field_hobt_testimonials"
				},
				{
					"key": "field_hobt_testimonials_role",
					"label": "Role",
					"name": "role",
					"type": "text",
					"required": 0,
					"conditional_logic": 0,
					"wrapper": { "width": "40", "class": "", "id": "" },
					"default_value": "",
					"maxlength": 80,
					"parent_repeater": "field_hobt_testimonials"
				},
				{
					"key": "field_hobt_testimonials_avatar",
					"label": "Avatar",
					"name": "avatar",
					"type": "image",
					"required": 0,
					"conditional_logic": 0,
					"wrapper": { "width": "20", "class": "", "id": "" },
					"return_format": "id",
					"library": "all",
					"preview_size": "thumbnail",
					"mime_types": "jpg,jpeg,png,webp",
					"parent_repeater": "field_hobt_testimonials"
				}
			]
		}
	],
	"location": [
		[
			{ "param": "post_type", "operator": "==", "value": "page" },
			{ "param": "page_template", "operator": "==", "value": "templates/hobt.php" }
		]
	],
	"menu_order": 0,
	"position": "normal",
	"style": "default",
	"label_placement": "top",
	"instruction_placement": "label",
	"hide_on_screen": "",
	"active": true,
	"description": "HOBT landing page promo data. Two AND-ed location rules — see Key Concept 6.",
	"show_in_rest": 0,
	"show_in_graphql": 1,
	"graphql_field_name": "hobtPromo",
	"map_graphql_types_from_location_rules": 0,
	"graphql_types": "",
	"modified": 1730000000
}
```

**Verify §3:**

- [ ] Create a page titled `HOBT`, slug `hobt`. Before you set the template, the **HOBT Promo**
      box is **absent**. That is the AND working.
- [ ] In **Page Attributes**, set Template to **HOBT Landing** and save. The box appears.
- [ ] Set the template back to Default and save. The box disappears again, and the values stay in
      `wp_postmeta` — a location rule controls the *form*, never the data.
- [ ] Set it back to **HOBT Landing** and leave it there.

### Step 4: Register the options page

Two additions to the ACF integration file from Lesson 04.1. The `use` of `acf/init` is not
optional — `acf_add_options_page()` does not exist until ACF has bootstrapped.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf.php
// Add these two lines to the block of add_filter/add_action calls near the top.
add_filter( 'acf/settings/autoload', '__return_false' );
add_action( 'acf/init', __NAMESPACE__ . '\\register_options_pages' );
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf.php
// Add this function at the end of the file.

/**
 * Register the Site Settings options page.
 *
 * `acf/init` rather than `init`: acf_add_options_page() is defined by ACF's own
 * bootstrap, and calling it on plain `init` is a race you sometimes win.
 *
 * Options pages are an ACF PRO feature, so the function is guarded. On free ACF
 * the screen is simply absent rather than fatal — see Lesson 04.1 Key Concept 8.
 */
function register_options_pages(): void {
	if ( ! function_exists( 'acf_add_options_page' ) ) {
		return;
	}

	acf_add_options_page(
		array(
			'page_title'         => __( 'Site Settings', 'blame-the-tech-core' ),
			'menu_title'         => __( 'Site Settings', 'blame-the-tech-core' ),
			// The slug the field group's location rule matches on. Changing it
			// orphans the field group, which then appears nowhere.
			'menu_slug'          => 'btt-site-settings',
			'capability'         => 'manage_options',
			'position'           => '59.5',
			'icon_url'           => 'dashicons-admin-settings',
			'redirect'           => false,
			'update_button'      => __( 'Save settings', 'blame-the-tech-core' ),
			'updated_message'    => __( 'Site settings saved.', 'blame-the-tech-core' ),
			// Read by WPGraphQL for ACF: puts this page on the ROOT query, so the
			// Next root layout can fetch it without a node. Key Concept 5.
			'show_in_graphql'    => true,
			'graphql_field_name' => 'siteSettings',
		)
	);
}
```

**Verify §4:**

- [ ] A **Site Settings** item appears in the wp-admin menu, below Settings.
- [ ] It is empty — no fields yet. An options page with no field group assigned to it is a blank
      screen with a Save button, which is the expected intermediate state.

### Step 5: The Site Settings field group

Six fields, names fixed by
[appendix 03 §4.5](../appendix/03-content-model-reference.md#45-site-settings-options-page), at
`wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_site_settings.json`:

```json
{
	"key": "group_site_settings",
	"title": "Site Settings",
	"fields": [
		{
			"key": "field_settings_site_tagline",
			"label": "Site tagline",
			"name": "site_tagline",
			"type": "text",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 160
		},
		{
			"key": "field_settings_primary_cta_label",
			"label": "Primary CTA label",
			"name": "primary_cta_label",
			"type": "text",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 40
		},
		{
			"key": "field_settings_primary_cta_url",
			"label": "Primary CTA URL",
			"name": "primary_cta_url",
			"type": "url",
			"instructions": "A campaign target, not navigation. Menus come from core — Key Concept 7.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"default_value": ""
		},
		{
			"key": "field_settings_footer_blurb",
			"label": "Footer blurb",
			"name": "footer_blurb",
			"type": "textarea",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 300,
			"rows": 3,
			"new_lines": ""
		},
		{
			"key": "field_settings_social_links",
			"label": "Social links",
			"name": "social_links",
			"type": "repeater",
			"instructions": "Generates SiteSettingsSocialLinks in the schema.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"layout": "table",
			"pagination": 0,
			"min": 0,
			"max": 8,
			"collapsed": "",
			"button_label": "Add link",
			"rows_per_page": 20,
			"sub_fields": [
				{
					"key": "field_settings_social_links_network",
					"label": "Network",
					"name": "network",
					"type": "select",
					"required": 1,
					"conditional_logic": 0,
					"wrapper": { "width": "40", "class": "", "id": "" },
					"choices": {
						"mastodon": "Mastodon",
						"bluesky": "Bluesky",
						"github": "GitHub",
						"linkedin": "LinkedIn",
						"youtube": "YouTube",
						"rss": "RSS"
					},
					"default_value": "mastodon",
					"allow_null": 0,
					"multiple": 0,
					"ui": 0,
					"ajax": 0,
					"return_format": "value",
					"parent_repeater": "field_settings_social_links"
				},
				{
					"key": "field_settings_social_links_url",
					"label": "URL",
					"name": "url",
					"type": "url",
					"required": 1,
					"conditional_logic": 0,
					"wrapper": { "width": "60", "class": "", "id": "" },
					"default_value": "",
					"parent_repeater": "field_settings_social_links"
				}
			]
		},
		{
			"key": "field_settings_incident_submission_open",
			"label": "Incident submissions open",
			"name": "incident_submission_open",
			"type": "true_false",
			"instructions": "Kill switch. Module 06's createIncident mutation is the authoritative check — Key Concept 8.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"message": "",
			"default_value": 1,
			"ui": 1,
			"ui_on_text": "Open",
			"ui_off_text": "Closed"
		}
	],
	"location": [
		[
			{ "param": "options_page", "operator": "==", "value": "btt-site-settings" }
		]
	],
	"menu_order": 0,
	"position": "normal",
	"style": "seamless",
	"label_placement": "top",
	"instruction_placement": "label",
	"hide_on_screen": "",
	"active": true,
	"description": "Global settings, fetched once on the GraphQL root query. NO navigation here.",
	"show_in_rest": 0,
	"show_in_graphql": 1,
	"graphql_field_name": "siteSettings",
	"map_graphql_types_from_location_rules": 0,
	"graphql_types": "",
	"modified": 1730000000
}
```

Note the location `param` is `options_page` and the `value` is the `menu_slug` from Step 4. That
string is the only thing tying the two together, and a mismatch produces an empty settings screen
with no error.

**Verify §5:**

- [ ] **Site Settings** in wp-admin now shows all six fields, with the submissions switch defaulting
      to **Open**.
- [ ] `git status` shows four new JSON files in `includes/acf-json/` and no changes elsewhere in
      that directory.

### Step 6: Put content in all three

One scapegoat by hand, so you see the term form; the rest from the command line, because typing
the same four fields ten times teaches nothing.

Open `http://localhost:8080/wp-admin/term.php?taxonomy=scapegoat&post_type=incident` from the term
list, edit **The Intern**, and fill in a tagline, an official excuse, a defensiveness value and the
sentience switch. Save.

Then the other nine, plus the settings:

```bash
cd wordpress-headless

# Terms — note the `term_<id>` identifier from Key Concept 1.
docker compose run --rm wpcli wp eval '
$i = 0;
foreach ( get_terms( array( "taxonomy" => "scapegoat", "hide_empty" => false, "orderby" => "slug" ) ) as $t ) {
	$id = "term_" . $t->term_id;
	if ( get_field( "tagline", $id ) ) { continue; }      // leave the hand-authored one alone
	update_field( "tagline", "It was " . $t->name . ". It is always " . $t->name . ".", $id );
	update_field( "official_excuse", "A ticket has been raised with " . $t->name . ".", $id );
	update_field( "defensiveness", 1 + ( $i % 10 ), $id );
	update_field( "is_sentient", 0, $id );
	$i++;
	WP_CLI::log( "profiled: " . $t->slug );
}'

# Options — note the literal string `option`.
docker compose run --rm wpcli wp eval '
update_field( "site_tagline", "Every outage has a scapegoat.", "option" );
update_field( "primary_cta_label", "Report an incident", "option" );
update_field( "primary_cta_url", "/incidents/submit", "option" );
update_field( "footer_blurb", "Blame The Tech is satire. The outages are real.", "option" );
update_field( "incident_submission_open", 1, "option" );
update_field( "social_links", array(
	array( "network" => "mastodon", "url" => "https://example.test/@blamethetech" ),
	array( "network" => "github",   "url" => "https://example.test/blamethetech" ),
), "option" );
WP_CLI::success( "site settings written" );'
```

Then fill the HOBT page in wp-admin: a headline, a subheadline, a price, seats left, two modules
and one testimonial. You do not need the images yet — Lesson 04.5 sideloads twelve media items and
attaches them.

**Verify §6:**

- [ ] Every one of the ten terms has a tagline:

```bash
docker compose run --rm wpcli wp eval '
$missing = 0;
foreach ( get_terms( array( "taxonomy" => "scapegoat", "hide_empty" => false ) ) as $t ) {
	if ( ! get_field( "tagline", "term_" . $t->term_id ) ) { $missing++; echo "MISSING: ", $t->slug, "\n"; }
}
echo $missing, " without a tagline", PHP_EOL;'
# Expected: 0 without a tagline
```

- [ ] The **Site Settings** screen in wp-admin shows the values you just wrote from the CLI. If it
      is blank, the `option` identifier is the thing to check.

### Step 7: Query all three shapes

```graphql
# queries.graphql — scratch. Lesson 05.4 develops each of these properly.
query ThreeLocations($scapegoat: ID!, $page: ID!) {
  siteSettings {
    siteTagline
    primaryCtaLabel
    primaryCtaUrl
    incidentSubmissionOpen
    socialLinks {
      network
      url
    }
  }
  scapegoat(id: $scapegoat, idType: SLUG) {
    name
    count
    scapegoatProfile {
      tagline
      officialExcuse
      defensiveness
      isSentient
    }
  }
  page(id: $page, idType: URI) {
    title
    hobtPromo {
      headline
      priceUsd
      seatsLeft
      modules {
        title
        durationMinutes
      }
    }
  }
}
```

With variables:

```json
{ "scapegoat": "the-intern", "page": "/hobt/" }
```

**Verify §7:**

- [ ] `siteSettings` is at the **top level** of the query, not inside a node. That is what "on the
      root query" means, and it is what lets Module 11 fetch it from the root layout.
- [ ] `socialLinks` and `modules` are lists of objects, exactly like Lesson 04.2's repeaters.
- [ ] `scapegoatProfile` is on a **term**, reached through the `scapegoat` root field.
- [ ] `hobtPromo` is non-null. If it is `null`, the page's template is not **HOBT Landing** — go
      back to Verify §2, not to the JSON.
- [ ] Check the docs pane for the type of `siteSettings`. If your version of WPGraphQL for ACF
      nests the field group inside the options page type rather than flattening it onto it, you
      will see one extra level; use the shape the schema shows you and carry it into Module 05.
      The schema is the authority, not this page.

### Step 8: Write the decision down

Add to `docs/adr/0005-scapegoat-is-a-taxonomy-with-term-fields.md`, the next free ADR number.

Six sentences: the decision (taxonomy plus a term field group, not a CPT with a Relationship
field), the evidence (the maintained `count` behind the leaderboard, the reverse query, the
indexed `tax_query`), the cost (no revisions on terms, no long-form editorial body, no editorial
ordering), and the trigger that would make you revisit it (a requirement for a curated, ordered
list of incidents per review). Name Key Concept 3's table as your source so the next reader can
check your reasoning.

---
## Verification

```bash
cd wordpress-headless

# 1. Four field groups, four files
ls wp-content/plugins/blame-the-tech-core/includes/acf-json/
# Expected: group_hobt_promo.json  group_incident_details.json
#           group_scapegoat_profile.json  group_site_settings.json  group_tech_review_fields.json

# 2. ACF loaded all five, with the GraphQL names the contract fixes
docker compose run --rm wpcli wp eval 'foreach ( acf_get_field_groups() as $g ) { echo $g["key"], " => ", ( $g["graphql_field_name"] ?? "-" ), "\n"; }' | sort
# Expected: group_hobt_promo => hobtPromo
#           group_incident_details => incidentDetails
#           group_scapegoat_profile => scapegoatProfile
#           group_site_settings => siteSettings
#           group_tech_review_fields => techReviewFields

# 3. WordPress can see the page template (the prerequisite for the AND rule)
docker compose run --rm wpcli wp eval 'echo implode( ",", array_keys( wp_get_theme()->get_page_templates() ) );'
# Expected: templates/hobt.php

# 4. The HOBT page exists and actually has that template assigned
HOBT=$(docker compose run --rm wpcli wp post list --post_type=page --name=hobt --field=ID | tr -d '\r')
docker compose run --rm wpcli wp post meta get "$HOBT" _wp_page_template
# Expected: templates/hobt.php

# 5. One helper for the GraphQL checks
gql() { curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' -d "$1"; }

# 6. siteSettings is a field on the ROOT query, not on a node
gql '{"query":"{ __type(name:\"RootQuery\"){ fields{ name } } }"}' | jq -r '.data.__type.fields[].name' | grep -x siteSettings
# Expected: siteSettings

# 7. The term field group landed on the Scapegoat type, via its own interface
gql '{"query":"{ __type(name:\"Scapegoat\"){ interfaces{ name } fields{ name } } }"}' | jq -r '.data.__type | (.interfaces[].name), (.fields[].name)' | grep -iE 'scapegoatprofile'
# Expected: WithAcfScapegoatProfile and scapegoatProfile

# 8. The HOBT group landed on Page — the page_template half of the rule contributes no type
gql '{"query":"{ __type(name:\"Page\"){ fields{ name } } }"}' | jq -r '.data.__type.fields[].name' | grep -x hobtPromo
# Expected: hobtPromo

# 9. Both new repeaters generated object row types
gql '{"query":"{ a: __type(name:\"SiteSettingsSocialLinks\"){ name fields{ name } } b: __type(name:\"HobtPromoModules\"){ name fields{ name } } c: __type(name:\"HobtPromoTestimonials\"){ name } }"}' | jq -c '.data'
# Expected: a has fields network and url; b has title, summary, durationMinutes; c is non-null

# 10. The data: root settings, a term profile, and the page promo, in ONE request
gql '{"query":"query($s:ID!,$p:ID!){ siteSettings{ siteTagline incidentSubmissionOpen socialLinks{ network url } } scapegoat(id:$s, idType:SLUG){ name scapegoatProfile{ tagline defensiveness isSentient } } page(id:$p, idType:URI){ title hobtPromo{ headline priceUsd seatsLeft modules{ title durationMinutes } } } }","variables":{"s":"the-intern","p":"/hobt/"}}' | jq '.data'
# Expected: all three populated. incidentSubmissionOpen is true. socialLinks and modules are
#           arrays of OBJECTS. hobtPromo.headline is the string you typed in Step 6.

# 11. ...and it was one request with no errors
gql '{"query":"{ siteSettings{ siteTagline } }"}' | jq 'has("errors")'
# Expected: false

# 12. NEGATIVE: the AND location rule really is an AND
PLAIN=$(docker compose run --rm wpcli wp post create --post_type=page \
  --post_title='Template negative test' --post_name=template-negative-test \
  --post_status=publish --porcelain | tr -d '\r')
gql '{"query":"{ page(id:\"/template-negative-test/\", idType:URI){ title hobtPromo{ headline } } }"}' | jq -c '.data.page'
# Expected: {"title":"Template negative test","hobtPromo":null}
#           The FIELD exists on Page (it is a type-level thing) but resolves to null
#           because this page has no HOBT template. That is the AND rule at work.
docker compose run --rm wpcli wp post delete "$PLAIN" --force

# 13. NEGATIVE: there is no navigation anywhere in siteSettings
gql '{"query":"{ __type(name:\"SiteSettings\"){ fields{ name } } }"}' | jq -r '.data.__type.fields[].name' | grep -iE 'nav|menuitem|primarymenu' || echo 'no navigation in siteSettings — correct'
# Expected: no navigation in siteSettings — correct
#           `socialLinks` is there and is not navigation. `navLinks`, `menu` and
#           `primaryNav` are not, and must never be. Navigation is menuItems — Key Concept 7.

# 14. NEGATIVE: the options rows are NOT autoloaded
docker compose run --rm wpcli wp db query \
  "SELECT option_name, autoload FROM wp_options WHERE option_name LIKE 'options\_%' LIMIT 6;"
# Expected: every row shows off (or "no" on MySQL 8.0 before WP 6.6 renamed the values).
#           An autoloaded settings page is a tax on every GraphQL request.

# 15. Term field values are in wp_termmeta, not wp_postmeta
TID=$(docker compose run --rm wpcli wp term list scapegoat --slug=the-intern --field=term_id | tr -d '\r')
docker compose run --rm wpcli wp db query \
  "SELECT meta_key FROM wp_termmeta WHERE term_id=$TID AND meta_key IN ('tagline','official_excuse','_tagline');"
# Expected: tagline, official_excuse, and ACF's _tagline reference row
docker compose run --rm wpcli wp db query \
  "SELECT COUNT(*) AS wrong_table FROM wp_postmeta WHERE meta_key='official_excuse';"
# Expected: 0

# 16. Nothing broke in the two groups from earlier lessons
gql '{"query":"{ incidents(first:1){ nodes{ incidentDetails{ downtimeMinutes } } } techReviews(first:1){ nodes{ techReviewFields{ pros{ item } } } } }"}' | jq 'has("errors")'
# Expected: false

# 17. No PHP notices from the options page registration
docker compose logs --tail=60 wordpress | grep -iE 'php (warning|notice|fatal)' || echo clean
# Expected: clean
```

Check 12 is the one worth understanding rather than just running. The field is on the type and the
*value* is null — a location rule filters data, never schema. Every ACF field group in a GraphQL
schema behaves that way, and expecting the field to disappear is how people conclude their setup is
broken when it is working exactly as designed.

## Control Questions

1. `get_field( 'tagline', 45 )` returns `null` for a scapegoat term whose tagline is definitely
   set. Give the correct call, say which table each of the two calls reads, and explain why the
   wrong one returns `null` instead of raising an error.
2. A stakeholder wants the three incidents shown on a review page to be chosen and ordered by an
   editor. Say which ACF field type you would add, then name the two things you lose relative to
   the `tech_stack` taxonomy and the one thing you gain.
3. The `hobtPromo` field is present on the `Page` type but resolves to `null` for the About page.
   Explain why the field is on the type at all, and say what would have to change for it to be
   absent from the schema instead.
4. `Site Settings` is exposed on the root query rather than as a field on `Page`. Describe the
   concrete failure mode of the alternative, using the diagram in Key Concept 5, and say how many
   GraphQL requests a five-component page chrome would make.
5. An editor sets **Incident submissions** to Closed. Name the four layers that must honour it,
   say which one is authoritative and why, and describe what an attacker holding a valid app token
   could do if only the Next.js layer checked.

## Learn More

- [ACF — `acf_add_options_page()`](https://www.advancedcustomfields.com/resources/acf_add_options_page/) —
  every argument used in Step 4, including the ones this course does not use
- [ACF — Options page](https://www.advancedcustomfields.com/resources/options-page/) — how values
  are stored as `options_<name>` rows, which is what check 14 inspects
- [ACF — `acf/settings/autoload`](https://www.advancedcustomfields.com/resources/acf-settings-autoload/) —
  the one-line filter behind Key Concept 5's table
- [ACF — Location rules](https://www.advancedcustomfields.com/resources/custom-location-rules/) —
  the array-of-arrays AND/OR structure, and how to add your own rule type
- [ACF — Term meta and the `$post_id` parameter](https://www.advancedcustomfields.com/resources/get_field/) —
  the `term_45` / `user_7` / `option` identifiers from Key Concept 1
- [ACF — Relationship field](https://www.advancedcustomfields.com/resources/relationship/) — read
  the "Bi-directional relationships" note, which is the honest version of Key Concept 3's table
- [Page Templates in the Theme Handbook](https://developer.wordpress.org/themes/templates/page-templates/) —
  the `Template Name` and `Template Post Type` headers, and the directory-scanning rules
- [WPGraphQL — menus and `menuItems`](https://www.wpgraphql.com/docs/menus/) — what Key Concept 7
  says you get for free, including `parentId` and menu locations
