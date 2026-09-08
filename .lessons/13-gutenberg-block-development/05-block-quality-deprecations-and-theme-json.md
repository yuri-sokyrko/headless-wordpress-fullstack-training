---
title: 'Block Quality, Deprecations & theme.json'
module: 13
lesson: 5
teaches: [block-deprecations, block-supports, theme-json, block-bindings, block-uses-context, block-i18n, wp-scripts-lint]
produces: ['wordpress-headless/wp-content/themes/btt-headless/theme.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/deprecated.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/languages/blame-the-tech-blocks.pot', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/index.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/save.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/style.scss']
requires: [13.4]
---

# Lesson 13.5 — Block Quality, Deprecations & theme.json

## Quick Overview

Five blocks work. This lesson makes them maintainable. You will add a real `deprecated` entry to
`btt/incident-callout` — changing its saved markup and providing a migration so the forty posts
already using it keep loading — audit `supports` across all five blocks so editors get the
controls they should and none of the ones they should not, add translation functions so the
editor UI is localisable before Module 20 needs it, and get `wp-scripts lint-js` clean.

Then `theme.json`, which in a headless build does something narrower and more interesting than
usual: it configures the **editor**, not the site. The palette, type scale and spacing presets
you declare there are the options an editor sees in Gutenberg, and they are deliberately the
same tokens Lesson 11.1 defined in Tailwind — so when someone picks "S1 Catastrophic red" in
wp-admin, they pick a value your front end already has a class for. The lesson closes with an
**optional stretch block**, `btt/tech-verdict-card`, using `usesContext` and Block Bindings to
read an ACF field from the surrounding post. It is genuinely useful and genuinely newer API
surface than the rest of the module, so skipping it costs you nothing in Module 14.

By the end of this lesson you will have:

- A working `deprecated` array on `btt/incident-callout`, with an old post loading without a validation warning
- An audited `supports` set across all five blocks, with `color`, `spacing` and `align` decided per block rather than by default
- `__()` / `_x()` around every editor-facing string, with a text domain matching the plugin
- `wordpress-headless/wp-content/themes/btt-headless/theme.json` declaring the same tokens as Lesson 11.1
- `btt/tech-verdict-card` **(optional)** reading `techReviewFields.verdict` through Block Bindings, with `usesContext` for the post ID

## Classic WP Analogy

Two of the three topics have close Classic counterparts, and one is genuinely new:

| Classic WordPress | Here |
|---|---|
| `add_theme_support('editor-color-palette', …)` | `theme.json` → `settings.color.palette` |
| `add_theme_support('editor-font-sizes', …)` | `settings.typography.fontSizes` |
| A plugin update that must not break old data | a `deprecated` entry with a `migrate` function |
| `dbDelta()` plus a version-gated upgrade routine | the same idea, but lazy and per-block |
| `load_plugin_textdomain()` + `__()` in PHP | `__()` from `@wordpress/i18n` + `wp i18n make-json` |
| `get_the_ID()` available ambiently in a template | `usesContext: ['postId']`, declared explicitly |

The `theme.json` comparison is exact enough to be reassuring: it is the same list of colours and
font sizes you used to register with `add_theme_support`, moved into a JSON file with a schema
and a much larger surface. If you have configured an editor palette before, you already know
what this file is for.

Deprecations are where the analogy breaks, and the break is worth understanding properly because
it is unlike any migration you have written. A WordPress plugin upgrade routine is **eager and
central**: it bumps a version option, runs once, rewrites the data, done. A block deprecation is
**lazy and per-instance**. It does not touch the database at all. It sits in an array, and each
time the editor loads a post containing an old-format block, the parser tries your current
`save()`, fails validation, walks the `deprecated` entries until one matches, runs its `migrate`
function, and hands the editor the modernised attributes. The stored `post_content` is still the
old markup until somebody re-saves that post — which they may never do.

Two consequences follow, and both matter for Module 14. Old deprecations can essentially never be
deleted, because there may always be an unopened 2019 post relying on one. And the front end must
tolerate both shapes: a block queried through WPGraphQL Content Blocks returns whatever
attributes are actually stored, which for an un-re-saved post is the old set. Lesson 14.4's block
components handle a missing attribute by rendering a sensible default rather than crashing, and
this is why.

The second break is smaller but sharper: **`theme.json`'s `styles` section does nothing for your
site.** In a Classic block theme, `theme.json` generates the front-end CSS — that is most of its
value. Here, Next.js renders every page and never loads a WordPress stylesheet, so the `styles`
half of the file affects only wp-admin and the WordPress-rendered preview. The `settings` half is
what matters, because it constrains what editors can choose. Spending an afternoon perfecting
front-end styles in `theme.json` is the same mistake as perfecting `style.scss` in Lesson 13.2,
and it is an easy one to make because every tutorial you will find assumes a Classic front end.

---

## Key Concepts

### 1. The deprecation mechanism, and the walk it performs

`deprecated` is an array of *previous versions of the block*, each entry complete enough for the
parser to recognise its output and translate it forward.

```
LOAD a post containing <!-- wp:btt/incident-callout … --><div class="…"><h3>…</h3><p>…</p></div>
  │
  ├─ 1. run the CURRENT save()   →  <aside class="…"><h3>…</h3><p>…</p></aside>
  │        compare against storage  →  MISMATCH (div vs aside)
  │
  ├─ 2. try deprecated[0]
  │        parse the stored markup with deprecated[0].attributes
  │           → { severity: 's1-catastrophic', incidentSlug: 'incident-01',
  │               headline: 'Production…', body: 'The DNS…' }
  │        run deprecated[0].save() with those attributes
  │           → <div class="…"><h3>…</h3><p>…</p></div>
  │        compare against storage  →  MATCH ✅
  │
  ├─ 3. run deprecated[0].migrate( attributes )
  │        → { …the same four, plus tone: 'warning' }
  │
  └─ 4. hand the editor the MODERN attribute set. The block is valid.
         `edit` renders v2. `post_content` is UNTOUCHED.
```

The five keys of an entry:

| Key | Required | Gotcha |
|---|---|---|
| `attributes` | **yes** | the schema **as it was then**. Copy it — referencing the current schema is the commonest deprecation bug, because the old markup then gets parsed with new rules |
| `save` | **yes** | the real old function, not an approximation. Its output is what the comparison runs |
| `supports` | if it changed | `useBlockProps.save()` output depends on `supports`, so a changed support silently changes what the old markup looked like |
| `migrate` | no | `( attributes, innerBlocks ) => newAttributes`. Omit it and the parsed old attributes are used as-is, correct only if the schema did not change |
| `isEligible` | no | `( attributes, innerBlocks, { blockNode } ) => boolean`. Key Concept 3 |

The v2 change here is deliberately two changes at once, because that is what real version bumps
look like: the root element becomes `<aside>` (markup, so the validator fires) **and** a `tone`
attribute appears (schema, so a `migrate` is needed).

### 2. Lazy and per-instance, versus eager and central

You have written the other kind of migration. This one differs in every respect.

| | A WordPress upgrade routine | A block deprecation |
|---|---|---|
| Trigger | activation, or a version option check on `admin_init` | **a post being opened in the editor** |
| Runs | once, for the whole site | once **per block instance**, on every load, forever |
| Writes to the database | yes — that is the point | **never**, and there is no record of what has been "migrated" |
| Can you delete the old code | yes, two releases later | **essentially never** |

Two consequences, and both of them are Module 14's problem as much as yours.

**Old entries can essentially never be deleted**, because there may always be an unopened 2019
post relying on `deprecated[3]`. The array only grows — the honest cost of storing rendered
output, and why "get `save()` roughly right before forty posts use it" was real advice in Lesson
13.2 rather than a platitude.

**The front end must tolerate both attribute shapes, forever.** A deprecation never rewrites
`post_content`, so a post nobody re-saves returns the **old** attribute set over GraphQL —
`severity`, `incidentSlug`, `headline`, `body`, and **no `tone`**. The two seeded showcase posts
are exactly that.

```
    the editor                                    WPGraphQL Content Blocks
    ──────────────────────────────                ───────────────────────────────
    reads post_content, runs the                  reads post_content, parses the
    deprecation walk, hands `edit`                COMMENT JSON. No JavaScript, no
    { …, tone: 'warning' }                        deprecations, no migrate.
                                                  → { severity: 's1-catastrophic' }
                                                    and tone is UNDEFINED
```

So Lesson 14.4's `IncidentCallout` derives `tone` from `severity` when the attribute is absent —
the same expression `migrate` uses, in TypeScript. Not duplication by accident: the only correct
design, because the database will still be holding v1 markup in five years.

> **Write the `migrate` expression down where both implementations can read it.**
> `docs/content-model.md` gets the rule: `tone` is `'warning'` for `s1-catastrophic` and
> `s2-major`, `'neutral'` otherwise. One sentence, two implementations, no drift.

### 3. Walking the array: order, and `isEligible`

The array is walked **in order**, and the first entry whose `save()` output matches wins. So it
is ordered **newest deprecation first**:

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/deprecated.js — (illustration)
export default [ v3, v2, v1 ];   // ✅ newest first
export default [ v1, v2, v3 ];   // ❌ v1 is tried first
```

"Oldest first" is not merely inefficient — it is wrong whenever an older entry's markup also
matches a newer one's, which happens the moment a version bump only *added* an element. The
older entry matches, its `migrate` runs, and the attributes the newer version added are silently
discarded. Newest-first also matches how you write them: a new entry goes at the **front** every
time `save()` changes, so the array reads as a reverse-chronological changelog of the markup.

`isEligible` is the other half of the walk, and it exists for one situation: **two deprecations whose `save()` output is
indistinguishable.** v1 and v2 both emit `<div class="…"><h3>…</h3></div>` and differ only in
what the attributes *mean*.

```
without isEligible                          with isEligible
──────────────────────────────              ────────────────────────────────────
try deprecated[0] → markup matches          try deprecated[0]
run its migrate. Wrong one: the post          isEligible( attrs ) → false  (no `theme` key)
was v2 and it was migrated as if v1.        try deprecated[1]
Silent data corruption.                       isEligible( attrs ) → true
                                              markup matches → migrate. Correct.
```

`isEligible` runs **before** the markup comparison, and `false` skips the entry entirely. Typical
implementations check a key's presence (`'tone' in attributes`), a value's old shape (a string
where an array is now expected), or `blockNode.attrs`.

This block needs none: v1 emits `<div>`, v2 emits `<aside>`, and the markup discriminates. Write
`isEligible` when it does not — and be suspicious the second time you need it, because it usually
means an earlier bump changed meaning without changing markup, which is the change to avoid.

### 4. The `supports` audit

`supports` is the block's contract with the editor about which controls exist, and every key you
omit takes a WordPress default written for a Classic block theme — in this build, roughly half of
those defaults produce controls whose effect is invisible.

The audit is nine keys × five blocks, and every cell comes out the same: **`className` on,
everything else off.** A grid of identical answers is not an audit, so the useful form is one row
per key — the variation is in the reasoning.

| Key | Decision | Reason |
|---|---|---|
| `className` | **on, everywhere** | It generates `wp-block-btt-*`. On the two static blocks it is part of the frozen stored markup, so turning it off invalidates every seeded post. On the three null-save blocks it appears only on the editor wrapper, which is the hook `editorStyle` selects — turning it off unstyles them in the only place they are visible |
| `customClassName`, `html` | **off, everywhere** | "Additional CSS class(es)" lets an editor type a class Tailwind never compiled, and "Edit as HTML" hands them a text area over markup the validator will reject. A control with no effect is worse than a missing one, because it invites bug reports |
| `anchor`, `align` | **off, everywhere** | Both change the saved wrapper — an `id`, or an `alignwide` class — so enabling either is a markup change and therefore a future deprecation. Deep links and layout are the Next route's, on the React side |
| `color`, `spacing`, `typography` | **off, everywhere** | All three write classes or inline `style` into `post_content` that only wp-admin reads. On `incident-callout` colour is derived from `severity` anyway, and two ways to set one colour is one too many |
| `renaming` | **off, everywhere** | The audit's one genuine finding. See below |

**`renaming` is the finding.** WordPress 6.5 let editors rename a block in the list view, storing
the new name as a `metadata` key **inside the block comment**:

```
<!-- wp:btt/scapegoat-picker {"termId":4,"metadata":{"name":"Blame the intern"}} /-->
                                        └──────────────┬─────────────────────┘
                              an attribute you did not declare, in your data,
                              which Module 14 will receive and must ignore
```

Not harmful, and not free: unschematised state in the serialised block, visible in the GraphQL
`attributes` payload, describing the editing experience rather than the content.
`supports.renaming: false` removes the control. One real change across five blocks is what a good
audit looks like — the value is in the eight keys you confirmed, not the one you altered.

> **A `supports` change can be a markup change.** Turning `anchor` or `align` **off** on a block
> where an editor already used it removes an attribute from `useBlockProps.save()`'s output and
> invalidates those posts. `customClassName`, `html` and `renaming` never touch the saved
> wrapper, which is why those are the safe ones to change late. Audit `supports` **before**
> publishing, or budget a deprecation.

### 5. i18n: `__()`, the text domain, and what is actually translated

Three functions, from `@wordpress/i18n`, identical in signature to their PHP namesakes:

| Function | Use for | Example (domain elided) |
|---|---|---|
| `__( text, domain )` | the ordinary case | `__( 'Severity', d )` |
| `_x( text, context, domain )` | a short string whose meaning is ambiguous | `_x( 'Blame', 'verb, on a button', d )` |
| `_n( one, many, n, domain )` · `sprintf` | a count · interpolation, **always outside** `__()` | `_n( '%d incident', '%d incidents', n, d )` · `sprintf( __( 'Blaming %s', d ), name )` |

Two rules that lint enforces and that are worth understanding rather than obeying. **Never
interpolate into the string passed to `__()`** — ``__( `Blaming ${ name }` )`` produces a
different msgid per name, so nothing is ever translated; translate the template, then `sprintf`
it. And **use positional placeholders (`%1$s`, `%2$d`) whenever there are two or more**, with a
`/* translators: */` comment above the call, because word order differs between languages and a
translator holding two bare `%s` cannot reorder them.

The text domain is declared **once**, in `block.json`'s `textdomain` key — one of the better
arguments for `block.json` existing, because `register_block_type()` reads it and calls
`wp_set_script_translations()` for the block's scripts on your behalf. No handle to keep in sync.

Then two WP-CLI commands. `wp i18n make-pot` writes `languages/<domain>.pot` — every
translatable string with its source location — and you re-run it after any string change and
commit the result. `wp i18n make-json` converts translated `.po` files into
`languages/<domain>-<locale>-<md5>.json`, because **the editor loads JSON, not `.mo`**.

**And now the honest limit: none of this translates your site.** It translates the *editor UI* —
panel titles, labels, placeholders, help text — for an editor whose wp-admin language is not
English. The strings a visitor reads live in `next-app/src/messages/` and are Module 20's
subject. Do the work anyway: a plugin whose strings are not wrapped cannot be translated later
without touching every file, and wrapping them costs nothing today.

> **`render.php` has no translatable strings, so this plugin calls no
> `load_plugin_textdomain()`.** The call is only needed once a PHP string needs translating.
> Adding it "just in case" is a line that does nothing and that a reader has to reason about.
> Add it in the commit that adds the first PHP string.

### 6. `theme.json`: `settings` matters, `styles` barely does

`theme.json` is one declarative file at the theme root, in two halves. **`settings`** declares
what the editor *offers* — the palette, the type scale, the spacing presets, whether custom
values are allowed at all — and generates the `--wp--preset--*` custom properties. **`styles`**
declares what things *look like*, expressed against those presets, and generates a front-end
stylesheet plus the canvas's styles.

Every `add_theme_support()` call you have written for the editor has a `settings` equivalent, and
the theme's `functions.php` (Lesson 02.4) already says a real `theme.json` replaces it:

| `add_theme_support( … )` | `theme.json` |
|---|---|
| `'editor-color-palette'` / `'disable-custom-colors'` | `settings.color.palette` / `settings.color.custom: false` |
| `'editor-font-sizes'` / `'disable-custom-font-sizes'` | `settings.typography.fontSizes` / `settings.typography.customFontSize: false` |
| `'editor-gradient-presets'`, `'custom-line-height'`, `'custom-spacing'`, `'custom-units'`, `'align-wide'`, `'appearance-tools'` | `settings.color.gradients`, `settings.typography.lineHeight`, `settings.spacing.padding`, `settings.spacing.units`, `settings.layout.wideSize`, `settings.appearanceTools` |
| `'editor-styles'`, `'wp-block-styles'`, `'title-tag'` | **no equivalent** — these stay in `functions.php` |

`"version": 3` is the current schema version and is not optional; the `$schema` URL is, and you
should include it anyway so a JSON-aware editor validates the file as you type.

> **`theme.json` does not make `btt-headless` a block theme.** A theme becomes a block theme by
> having `templates/index.html`. This one has `index.php` and a `template_redirect` hook, so it
> stays a classic theme with a `theme.json` — a supported and common combination. Nothing about
> the redirect changes.

And now the inversion, which is the reason the file you write is lopsided.

```
        theme.json
        ├── settings ──▶ the editor's controls          ──▶ AN EDITOR USES THESE
        │            └─▶ --wp--preset--* custom properties  (in wp-admin)
        │
        └── styles ──▶ a generated <style> block in the
                       front-end <head> ──▶ served by the btt-headless theme
                                        ──▶ which 302s every front-end request to Next
                                        ──▶ NOBODY RECEIVES IT
```

Next renders every page and never loads a WordPress stylesheet, so `styles` reaches two
audiences: the editor canvas, and Module 17's WordPress-rendered preview. Not zero — but small
enough that perfecting it is the same mistake as perfecting `style.scss` in Lesson 13.2, and an
easy mistake to make because every `theme.json` tutorial assumes a Classic front end.

So write `settings` carefully, and write the smallest `styles` block that stops the canvas
looking obviously wrong. The reason to write any at all is one sentence worth remembering:
**the editor should not lie to the editor.** If wp-admin renders body text at 16px on white and
the site renders 18px on off-white, every editorial judgement about length and emphasis is made
against the wrong picture.

### 7. Token parity: one value, two design systems

Lesson 11.1 emitted four severity colours from a **plain `@theme` block** — plain, not
`@theme inline`, so the custom properties are really emitted and readable:

```css
/* next-app/src/app/[locale]/globals.css — (illustration; Lesson 11.1 already wrote this) */
@theme {
  --color-severity-s1: oklch(0.52 0.19 25);  /* s1-catastrophic — red */
  --color-severity-s2: oklch(0.66 0.16 55);  /* s2-major        — orange */
  --color-severity-s3: oklch(0.75 0.13 90);  /* s3-minor        — amber */
  --color-severity-s4: oklch(0.62 0.05 250); /* s4-cosmetic     — slate blue */
}
```

`theme.json` declares the **same four values** as palette entries with slugs
`severity-s1` … `severity-s4`. The payoff:

```
Lesson 11.1  --color-severity-s1: oklch(0.52 0.19 25)
                     │                    │
                     │  same value        │
                     ▼                    ▼
Lesson 13.5  theme.json palette slug `severity-s1`
                     │
                     ▼
WordPress emits  --wp--preset--color--severity-s1: oklch(0.52 0.19 25)
and the editor's colour picker shows a swatch called "S1 — Catastrophic"
                     │
                     ▼
An editor picks it. The stored value is the SLUG (`severity-s1`), and
`<Badge variant="s1-catastrophic">` already knows what that colour is.
```

Then four settings turn the presets from a suggestion into a constraint.
`settings.color.custom: false` removes the custom colour picker;
`settings.color.defaultPalette: false` removes WordPress's own twenty-odd colours, which are not
in your design system and produce hex values Tailwind has no class for; and
`settings.typography.customFontSize: false` plus `settings.spacing.customSpacingSize: false` do
the same for the type scale and the rhythm. Without `defaultPalette: false` your four colours sit
*next to* WordPress's defaults in one picker and the constraint is decorative.

**Be honest about `oklch()` in `theme.json`.** WordPress does not parse the colour; it treats it
as an opaque CSS string and emits it into `--wp--preset--color--severity-s1` unchanged. A current
browser renders the swatch correctly; an older one that does not support `oklch()` renders it
**empty**, because the value is invalid CSS to it. That is the price of one source of truth, and
it is the right price: the alternative is a hex approximation that drifts from the oklch original
the first time someone tweaks the lightness. wp-admin is used by a handful of people on machines
you can influence; the site is used by everyone.

### 8. Block Bindings, and why binding beats copying

The stretch block wants to show a `tech_review`'s ACF `verdict`. Three ways to get it there:

| Approach | Verdict |
|---|---|
| Copy the value into an attribute when the editor picks the review | ❌ the denormalisation Lesson 13.3 argued against: edit the review, and forty cards are stale |
| Fetch it in `edit` with `useSelect`, storing only `reviewSlug` | ✅ correct, and what Module 14 does on the front end anyway |
| **Bind the attribute to a source** | ✅ the WordPress-native mechanism, and the one worth learning |

A **binding source** is a named PHP function that supplies the value of a block attribute at
render time. The block comment records the intent, not the value:

```
<!-- wp:btt/tech-verdict-card {"reviewSlug":"review-01","metadata":{"bindings":{
       "verdict":{"source":"btt/review-field","args":{"key":"verdict"}}}}} -->
```

Registered like this:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php — (illustration; the Task writes the real edit)
register_block_bindings_source(
	'btt/review-field',
	array(
		'label'              => __( 'Tech review field', 'blame-the-tech-blocks' ),
		'get_value_callback' => __NAMESPACE__ . '\\resolve_review_field',
		'uses_context'       => array( 'postId' ),
	)
);
```

`get_value_callback( array $source_args, WP_Block $block, string $attribute_name )` receives the
`args` from the comment, the block instance — including `$block->context['postId']`, which is why
`usesContext` and bindings belong together — and the attribute being resolved.

**The allowlist is not optional.** A `get_value_callback` that calls
`get_field( $source_args['key'], $post_id )` with no restriction is a general-purpose "read any
ACF field on any post" primitive, reachable by anyone who can write a block comment — which is
every user with `edit_posts`. Restrict `key` to an explicit list, and return `null` otherwise.

Two honest caveats, and they are why this block is optional:

- **Core will not substitute a bound value on a custom block — not on 6.8, and not yet on any
  shipped version.** `WP_Block::process_block_bindings()` opens with a hard-coded literal
  (paragraph, heading, image, button on 6.8; seven core blocks on 6.9 and 7.0) and returns
  immediately for any block name outside it. `"role": "content"` is an **editor** hint, for
  content-only locking, and core's binding code never reads it. 6.9 adds a
  `block_bindings_supported_attributes` filter — that, not the role, is the supported opt-in.
- **In this architecture the payoff is small.** Bindings resolve on the WordPress render path,
  and Module 14 reads `reviewSlug` and queries the review over GraphQL regardless. The binding
  improves wp-admin and Module 17's preview and changes nothing a visitor sees. Learn the
  mechanism; do not build the front end on it.

---

## Task

### Step 1: Write the deprecation, then change `save()`

Write the deprecation **first**. Change `save()` first and you open a window in which every
published callout is invalid, lasting as long as the next distraction.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/deprecated.js
import { RichText, useBlockProps } from '@wordpress/block-editor';

// COPIED, not imported from block.json. The whole point of this object is that it
// describes the schema AS IT WAS. Importing the live schema means the old markup
// gets parsed with new rules, which is the most common deprecation bug there is.
const v1Attributes = {
	severity: { type: 'string', default: 's3-minor' },
	incidentSlug: { type: 'string', default: '' },
	headline: { type: 'string', source: 'html', selector: 'h3' },
	body: { type: 'string', source: 'html', selector: 'p' },
};

// Also copied. useBlockProps.save()'s output depends on `supports`, so a support
// that changed between versions changes what the old markup looked like.
const v1Supports = {
	className: true,
	customClassName: false,
	html: false,
	anchor: false,
	align: false,
	color: false,
	spacing: false,
	typography: false,
	reusable: true,
	multiple: true,
};

const v1 = {
	attributes: v1Attributes,
	supports: v1Supports,

	// The REAL v1 save(), byte for byte. This function's output is what the
	// parser compares against post_content, so an approximation does not match
	// and the deprecation silently never fires.
	save( { attributes } ) {
		const { headline, body } = attributes;

		return (
			<div { ...useBlockProps.save() }>
				<RichText.Content tagName="h3" value={ headline } />
				<RichText.Content tagName="p" value={ body } />
			</div>
		);
	},

	// v2 added `tone`, so the parsed v1 attributes need one more key. The rule
	// below is written down in docs/content-model.md because Lesson 14.4's
	// IncidentCallout implements the SAME expression in TypeScript, for posts
	// nobody ever re-saves.
	migrate: ( attributes ) => ( {
		...attributes,
		tone: [ 's1-catastrophic', 's2-major' ].includes( attributes.severity ) ? 'warning' : 'neutral',
	} ),
};

// NEWEST FIRST. Add each new entry at the FRONT. The array reads as a
// reverse-chronological changelog of this block's markup. Key Concept 3.
export default [ v1 ];
```

Now add `tone` to the live schema — an anchored edit to `src/incident-callout/block.json`, with
the other three attributes left exactly as they are:

```json
    "body": {
      "type": "string",
      "source": "html",
      "selector": "p"
    },
    "tone": {
      "type": "string",
      "default": "neutral",
      "enum": ["warning", "neutral"]
    }
```

Change the root element in `save.js` — one word, and the reason the deprecation exists.
`<aside>` is the honest element for a callout: a note related to, but separable from, the prose
around it.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/save.js
import { RichText, useBlockProps } from '@wordpress/block-editor';

export default function save( { attributes } ) {
	const { headline, body } = attributes;

	// v2. `<aside>` rather than `<div>`: an incident callout is tangentially
	// related content, and <aside> is what a screen reader's landmark list
	// should show. `tone` is NOT in the markup — it is a comment attribute, and
	// putting it here would be a second deprecation on the first day.
	return (
		<aside { ...useBlockProps.save() }>
			<RichText.Content tagName="h3" value={ headline } />
			<RichText.Content tagName="p" value={ body } />
		</aside>
	);
}
```

Register the deprecation and add a `tone` control — anchored edits to `index.js` and `edit.js`:

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/index.js
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';
import save from './save';
import deprecated from './deprecated';
import './style.scss';

registerBlockType( metadata.name, { edit: Edit, save, deprecated } );
```

In `edit.js`, change the wrapper to `<aside>` so the editor matches, and add this below the
existing severity `SelectControl`:

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/edit.js (fragment — inside <PanelBody>)
					<SelectControl
						__nextHasNoMarginBottom
						label={ __( 'Tone', 'blame-the-tech-blocks' ) }
						value={ tone }
						options={ [
							{ value: 'neutral', label: __( 'Neutral', 'blame-the-tech-blocks' ) },
							{ value: 'warning', label: __( 'Warning', 'blame-the-tech-blocks' ) },
						] }
						onChange={ ( value ) => setAttributes( { tone: value } ) }
						help={ __(
							'Defaults from severity on old posts. Set it explicitly to override.',
							'blame-the-tech-blocks'
						) }
					/>
```

Destructure `tone` alongside the other three, and pass `'data-tone': tone` to `useBlockProps`
next to `data-severity`. Both are editor-only; neither goes near `save()`.

**Verify §1:**

- [ ] `deprecated.js` **copies** the v1 attribute schema rather than importing `block.json`.
- [ ] `save.js` contains `<aside` and no `<div`; `deprecated.js` contains `<div` and no `<aside`.
      If the two agree, nothing changed and the deprecation can never fire.
- [ ] Neither file mentions `tone` inside the returned JSX.

### Step 2: Prove an already-published post still loads

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks
npm run build
```

Hard-reload `blog-01` in wp-admin (`http://localhost:8080/wp-admin/edit.php`, then **Blaming the
tech, part 1**).

**Verify §2:**

- [ ] The `Incident Callout` block renders normally. **No** "unexpected or invalid content"
      warning. The deprecation walked, matched and migrated in the time it took the page to
      paint.
- [ ] Open the sidebar for that block. **Tone is `Warning`** — not `Neutral`, the declared
      default. `migrate` computed it from `severity: 's1-catastrophic'`. An attribute that does
      not exist in the database has the right value in the editor.
- [ ] Now check the database, from a second terminal, **without saving the post**:

```bash
cd wordpress-headless
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' | grep -c '<aside'
```

- [ ] **0.** The stored markup is still v1's `<div>`. Deprecations never write to the database.
      Now comment out `deprecated` in `index.js`, rebuild, hard-reload, confirm the warning
      appears, and put it back. Warning without, silence with, identical database either way —
      that pair is the whole mechanism.

### Step 3: Audit `supports`, then make the one edit it finds

Work Key Concept 4's table against your five `block.json` files. Eight of the nine keys are
already correct on all five, because Lessons 13.2 to 13.4 decided them deliberately; confirming
that is the point of an audit, not a waste of one. The finding is `renaming` — add this line to
the `supports` object of **all five** blocks:

```json
    "renaming": false
```

`btt/incident-callout`'s `deprecated[0].supports` does **not** get it: that object describes v1,
and v1 did not have it. Because `renaming` never touches `useBlockProps.save()`'s output, the
deprecation still matches.

**Verify §3:**

- [ ] `grep -h '"renaming": false' src/*/block.json | wc -l` prints `5`.
- [ ] `grep -c 'renaming' src/incident-callout/deprecated.js` prints `0`.
- [ ] In wp-admin, the block toolbar's **Options → Rename** item is gone.

### Step 4: Wrap every string, and generate the template

Every editor-facing string in the five blocks should already be inside `__()`. Sweep for the ones
that escaped: `PanelBody` titles, `SelectControl` labels, every `help`, every `placeholder`.
`block.json`'s `title` and `description` stay plain strings, because WordPress translates them
from the `textdomain` key — confirm all five files declare
`"textdomain": "blame-the-tech-blocks"`.

```bash
cd wordpress-headless
mkdir -p wp-content/plugins/blame-the-tech-blocks/languages

docker compose run --rm wpcli wp i18n make-pot \
  wp-content/plugins/blame-the-tech-blocks \
  wp-content/plugins/blame-the-tech-blocks/languages/blame-the-tech-blocks.pot \
  --domain=blame-the-tech-blocks \
  --exclude=node_modules,build
```

`--exclude=node_modules,build` matters twice over: `node_modules` is tens of thousands of files,
and `build/` is a compiled copy of `src/`, so without it every string is extracted twice with a
minified source reference.

Then the command that produces nothing today:

```bash
docker compose run --rm wpcli wp i18n make-json \
  wp-content/plugins/blame-the-tech-blocks/languages --no-purge
```

It converts translated `.po` files into the JSON the editor loads at runtime. There are none yet,
so it does nothing — the correct outcome, and you now know the command exists and where its output
goes. `--no-purge` keeps the `.po` files after conversion, which is what you want in a repository.

**Verify §4:**

- [ ] `languages/blame-the-tech-blocks.pot` exists, and `grep -c '^msgid'` on it prints a number
      in the twenties or thirties. Zero means `--exclude` swallowed `src/`.
- [ ] `grep -c 'src/incident-callout/edit.js'` on the `.pot` is non-zero and
      `grep -c 'node_modules'` is `0` — the source references point at `src/`, not `build/`.

### Step 5: Write `theme.json`

```json
{
  "$schema": "https://schemas.wp.org/wp/6.8/theme.json",
  "version": 3,
  "settings": {
    "appearanceTools": false,
    "useRootPaddingAwareAlignments": false,
    "color": {
      "custom": false,
      "customDuotone": false,
      "customGradient": false,
      "defaultDuotone": false,
      "defaultGradients": false,
      "defaultPalette": false,
      "palette": [
        { "slug": "severity-s1", "name": "S1 — Catastrophic", "color": "oklch(0.52 0.19 25)" },
        { "slug": "severity-s2", "name": "S2 — Major", "color": "oklch(0.66 0.16 55)" },
        { "slug": "severity-s3", "name": "S3 — Minor", "color": "oklch(0.75 0.13 90)" },
        { "slug": "severity-s4", "name": "S4 — Cosmetic", "color": "oklch(0.62 0.05 250)" },
        { "slug": "background", "name": "Background", "color": "oklch(1 0 0)" },
        { "slug": "foreground", "name": "Foreground", "color": "oklch(0.145 0 0)" }
      ]
    },
    "typography": {
      "customFontSize": false,
      "fluid": false,
      "lineHeight": false,
      "dropCap": false,
      "fontSizes": [
        { "slug": "sm", "name": "Small", "size": "0.875rem" },
        { "slug": "base", "name": "Base", "size": "1rem" },
        { "slug": "lg", "name": "Large", "size": "1.125rem" },
        { "slug": "xl", "name": "Extra large", "size": "1.25rem" },
        { "slug": "2xl", "name": "2XL", "size": "1.5rem" },
        { "slug": "3xl", "name": "3XL", "size": "1.875rem" }
      ]
    },
    "spacing": {
      "customSpacingSize": false,
      "padding": false,
      "margin": false,
      "units": ["rem"],
      "spacingSizes": [
        { "slug": "1", "name": "1", "size": "0.25rem" },
        { "slug": "2", "name": "2", "size": "0.5rem" },
        { "slug": "3", "name": "3", "size": "0.75rem" },
        { "slug": "4", "name": "4", "size": "1rem" },
        { "slug": "6", "name": "6", "size": "1.5rem" },
        { "slug": "8", "name": "8", "size": "2rem" }
      ]
    },
    "layout": {
      "contentSize": "48rem",
      "wideSize": "72rem"
    }
  },
  "styles": {
    "color": {
      "background": "var(--wp--preset--color--background)",
      "text": "var(--wp--preset--color--foreground)"
    },
    "typography": {
      "fontSize": "var(--wp--preset--font-size--base)"
    }
  }
}
```

Path: `wordpress-headless/wp-content/themes/btt-headless/theme.json`. JSON has no comments, so
the decisions live here.

The four severity colours are the **same oklch values** Lesson 11.1 emitted from its plain
`@theme` block. Copy them; do not eyeball them. The slugs are `severity-s1` … `severity-s4`, one
per term in the closed set, so a colour an editor picks in Gutenberg is a colour the front end
already has a name for. `background` and `foreground` come from the shadcn pair in the same file.

`custom: false` plus `defaultPalette: false` is the pair that turns the palette into a
constraint. Either alone leaves a way to pick a colour Tailwind never compiled: without the
first there is a colour picker, and without the second WordPress's own twenty-odd colours sit in
the same panel as your six.

The type scale mirrors Tailwind's rem values with Tailwind's slugs, so `base` means `1rem` on
both sides. `fluid: false` because Tailwind's scale is not fluid and a fluid canvas would show
line lengths the site will not produce; `dropCap: false` because a drop cap is a `::first-letter`
rule the front end does not have. `spacing.padding` and `spacing.margin` are `false` for
consistency with `supports.spacing: false` — the presets exist so any *core* block an editor
reaches for lands on the same 0.25rem rhythm. `layout.contentSize` and `wideSize` set the canvas
width, and getting them near the front end's containers is most of what makes the canvas honest.

And the `styles` block is **four lines on purpose.** Key Concept 6: it generates CSS the
`btt-headless` theme serves to a front end that 302s every request to Next, so it reaches the
editor canvas and Module 17's preview and nobody else. Base colours and a base font size stop the
canvas lying about contrast and line length; past that it is decoration for an audience of one.

**Verify §5:**

- [ ] Hard-reload the editor. Open a paragraph's colour panel: **six swatches**, named
      `S1 — Catastrophic` through `Foreground`, and **no custom colour picker**. The font-size
      control shows `Small` through `3XL` and no numeric input.
- [ ] `functions.php` still has `add_theme_support( 'editor-styles' )` and
      `register_nav_menus()`. Neither has a `theme.json` equivalent, and removing
      `register_nav_menus()` would break `menuItems(where: { location: PRIMARY })` in Lessons
      05.4 and 11.3.

### Step 6: Get the linter clean

```bash
cd wp-content/plugins/blame-the-tech-blocks
npm run lint:js
```

`wp-scripts lint-js` is ESLint with `@wordpress/eslint-plugin`. The rules most likely to fire on
the code you have written:

| Rule | Fires when | Fix |
|---|---|---|
| `@wordpress/i18n-translator-comments` | a `sprintf` has two or more placeholders and no `/* translators: */` comment | add the comment; describe each placeholder in order |
| `@wordpress/i18n-no-variables` | a variable or template literal is passed to `__()` | translate the template, `sprintf` the values in |
| `@wordpress/no-unused-vars-before-return` · `jsx-a11y/*` | a `const` sits above an early `return` that ignores it · a control has no accessible name | move it below the guard · give it a `label`, not a `placeholder` |

Fix, do not disable. An `eslint-disable` in a five-block plugin is a decision you will not
remember making a month later.

**Verify §6:**

- [ ] `npm run lint:js; echo "exit=$?"` prints `exit=0`.
- [ ] `grep -rc 'eslint-disable' src/ | grep -v ':0'` prints nothing.

### Step 7: Record the editor-side accessibility decisions

`docs/accessibility.md` was created in Lesson 11.4 with a standing rule: **every lesson that adds
an `aria-*` attribute adds a row.** This lesson adds none, and that is the finding worth
recording, because it is not an accident.

```markdown
<!-- docs/accessibility.md -->

## Editor-side accessibility (Lesson 13.5)

The block editor is an application editors use every day, and it is inside wp-admin, which means
none of Module 22's Playwright `a11y` project ever visits it. So the decisions get written down
instead of asserted.

| Decision | Where | Why, and what the alternative would have cost |
|---|---|---|
| Every control has a `label`, never a bare `placeholder` | all five blocks' `edit.js` | `@wordpress/components` renders `label` as a real `<label>`; a placeholder is announced once and disappears on focus |
| `help` text on every non-obvious control | `severity`, `incidentSlug`, `variant`, `leadSource`, `tone` | `SelectControl` wires `help` up with `aria-describedby`. A tooltip would not be reachable by keyboard |
| `RichText` for content, `TextControl` for configuration | 13.2, 13.3, 13.4 | `RichText` is a `contenteditable` with the editor's own toolbar and announcements; a `TextControl` pretending to be content loses all of it |
| `<aside>` as `btt/incident-callout`'s root, from v2 | 13.5's deprecation | A real landmark in the WordPress-rendered document and in Module 17's preview. `<div>` announced nothing. **Module 14's `IncidentCallout` must emit `<aside>` too** — the semantics are the block's, not the renderer's |
| Colour is never the only signal | `severity` and `tone` | `theme.json`'s palette names carry the meaning (`S1 — Catastrophic`), and the block always shows the severity as text as well as a border colour |
| **Zero `aria-*` attributes added** | — | Every control came from `@wordpress/components`, which owns its own ARIA. A hand-written `aria-label` on a component that already has a `label` produces a double announcement, which is the most common way to make a form worse while trying to help |

Module 22 extends this file for the public site. Nothing here is covered by an automated check,
which is why it is a table.
```

### Step 8 (optional): `btt/tech-verdict-card` and a binding source

**This step is optional and skipping it costs you nothing in Module 14.** The block's inline
fragment simply never gets added to `editorBlocks.graphql`, so Lesson 14.2's `blockRegistry`
never needs an entry, and the instance the seeder wrote into `blog-01`, `blog-02` and the `hobt`
page renders through `UnknownBlock` — a red warning box in development, nothing in production. A
designed outcome, not a broken one.

If you are doing it: `verdict` is sourced from the block's **root** element, with no `selector`.

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "btt/tech-verdict-card",
  "version": "0.1.0",
  "title": "Tech Verdict Card",
  "category": "btt",
  "description": "A tech review's verdict, bound to the review's ACF field rather than copied from it.",
  "keywords": ["review", "verdict", "adopt", "hold"],
  "textdomain": "blame-the-tech-blocks",
  "attributes": {
    "reviewSlug": {
      "type": "string",
      "default": ""
    },
    "verdict": {
      "type": "string",
      "source": "html",
      "role": "content"
    }
  },
  "usesContext": ["postId"],
  "supports": {
    "className": true,
    "customClassName": false,
    "html": false,
    "anchor": false,
    "align": false,
    "color": false,
    "spacing": false,
    "typography": false,
    "reusable": false,
    "renaming": false,
    "multiple": true
  },
  "editorScript": "file:./index.js",
  "style": "file:./style-index.css"
}
```

`"source": "html"` with **no `selector`** means "the innerHTML of the block's root element", which
is what makes the fixture's `<div class="wp-block-btt-tech-verdict-card">Trial.</div>` parse back
to `verdict: 'Trial.'`. `"role": "content"` declares the attribute *editable content* for the
editor's content-only mode; it is not a server-side binding switch — Key Concept 8's first caveat.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/save.js
import { RichText, useBlockProps } from '@wordpress/block-editor';

export default function save( { attributes } ) {
	// RichText.Content with NO tagName renders the raw value with no wrapping
	// element, so the root <div> is the element `source: 'html'` reads back from.
	// Adding a tagName here would nest an element inside the root and the
	// selector-less source would then include that element's tag in the value.
	return (
		<div { ...useBlockProps.save() }>
			<RichText.Content value={ attributes.verdict } />
		</div>
	);
}
```

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/edit.js
import { __, sprintf } from '@wordpress/i18n';
import { InspectorControls, RichText, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, TextControl } from '@wordpress/components';

export default function Edit( { attributes, setAttributes, context } ) {
	const { reviewSlug, verdict } = attributes;
	const blockProps = useBlockProps();

	// `context.postId` arrives because block.json declares usesContext: ['postId'].
	// It is the post this block SITS IN — not the review it points at. The binding
	// source in the plugin bootstrap uses both. Lesson 13.4 Key Concept 8.
	const postId = context?.postId ?? 0;

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Tech review', 'blame-the-tech-blocks' ) }>
					<TextControl
						__nextHasNoMarginBottom
						label={ __( 'Review slug', 'blame-the-tech-blocks' ) }
						value={ reviewSlug }
						onChange={ ( value ) => setAttributes( { reviewSlug: value } ) }
						placeholder="review-01"
						help={ sprintf(
							/* translators: %d: the ID of the post this block is placed in. */
							__( 'Placed in post %d.', 'blame-the-tech-blocks' ),
							postId
						) }
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				<RichText
					identifier="verdict"
					value={ verdict }
					onChange={ ( value ) => setAttributes( { verdict: value } ) }
					allowedFormats={ [] }
					placeholder={ __( 'Adopt, Trial, Assess or Hold', 'blame-the-tech-blocks' ) }
				/>
			</div>
		</>
	);
}
```

Write `index.js` in the same shape as the others and `style.scss` with two or three rules, then
register the binding source — an anchored edit to Lesson 13.1's bootstrap, **below**
`register_category()`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php (fragment — append below register_category())

/**
 * Resolve one allowlisted ACF field on a `tech_review`.
 *
 * @param array<string, mixed> $source_args    `args` from the block comment's metadata.bindings.
 * @param \WP_Block            $block          The block instance.
 * @param string               $attribute_name The attribute being resolved.
 * @return string|null The value, or null to leave the attribute alone.
 */
function resolve_review_field( array $source_args, \WP_Block $block, string $attribute_name ): ?string {
	// ALLOWLIST, and it is not optional. Without it this source is a
	// general-purpose "read any ACF field on any post" primitive, callable by
	// anyone who can write a block comment — which is every user with
	// `edit_posts`. Publish the fields you meant to publish.
	$btt_allowed = array( 'verdict', 'company_name', 'rating_overall' );

	$btt_key = (string) ( $source_args['key'] ?? '' );

	if ( ! in_array( $btt_key, $btt_allowed, true ) ) {
		return null;
	}

	// Prefer the review this block points at; fall back to the surrounding post,
	// which is what usesContext: ['postId'] provides.
	$btt_slug = (string) ( $block->attributes['reviewSlug'] ?? '' );
	$btt_post = '' !== $btt_slug ? get_page_by_path( $btt_slug, OBJECT, 'tech_review' ) : null;
	$btt_id   = $btt_post instanceof \WP_Post ? $btt_post->ID : (int) ( $block->context['postId'] ?? 0 );

	if ( 0 === $btt_id || ! function_exists( 'get_field' ) ) {
		return null;
	}

	$btt_value = get_field( $btt_key, $btt_id );

	// Scalars only. Returning an array or an object here would be substituted
	// into an attribute declared `string`, and the failure would surface in
	// Module 14 as a type that does not match the schema.
	return is_scalar( $btt_value ) ? (string) $btt_value : null;
}

/**
 * Register the binding source. `init`, like every other registration here.
 */
function register_bindings(): void {
	// Guard: the function is WordPress 6.5+. An older core should degrade to
	// "no bindings", not to a fatal.
	if ( ! function_exists( 'register_block_bindings_source' ) ) {
		return;
	}

	register_block_bindings_source(
		'btt/review-field',
		array(
			'label'              => __( 'Tech review field', 'blame-the-tech-blocks' ),
			'get_value_callback' => __NAMESPACE__ . '\\resolve_review_field',
			'uses_context'       => array( 'postId' ),
		)
	);
}
add_action( 'init', __NAMESPACE__ . '\\register_bindings' );
```

Confirm `'tech-verdict-card'` is already in the `BLOCKS` const: Lesson 13.1 listed all six slugs
from the start precisely so that this step is a build and not an edit.

**Verify §8:**

- [ ] `docker compose run --rm -T wpcli wp eval 'echo count( get_all_registered_block_bindings_sources() ), PHP_EOL;'`
      prints at least 2 — core registers `core/post-meta` and `core/pattern-overrides`, and yours
      is on top.
- [ ] `blog-01` in the editor shows the verdict card reading `Trial.` with no validation warning,
      which proves the selector-less `source: 'html'` round-trips against the frozen fixture.
- [ ] The rendered card shows the **saved** text, not the bound value — core's allowlist has no
      entry for `btt/tech-verdict-card`, so `get_value_callback` never runs. That is the expected
      result on 6.8, and Key Concept 8's first caveat says why. Record in
      `docs/content-model.md` that the binding serves the editor, not the output.
- [ ] Nothing on the Next side changed, with or without this step.

---

## Verification

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks

# 1. THE PAIR THAT IS THE WHOLE PROOF, half one: save() emits v2's <aside>
grep -c '<aside' src/incident-callout/save.js
# Expected: 1
grep -c '<div' src/incident-callout/save.js
# Expected: 0

# 2. ...and the deprecation still holds v1's <div>
grep -c '<div' src/incident-callout/deprecated.js
# Expected: 1
grep -c '<aside' src/incident-callout/deprecated.js
# Expected: 0
#           If both files agree, nothing changed and the deprecation is dead code.

# 3. The deprecation copies the old schema rather than importing the live one
grep -c "from './block.json'" src/incident-callout/deprecated.js
# Expected: 0
grep -c 'source:' src/incident-callout/deprecated.js
# Expected: 2   (headline and body, as they were in v1)

# 4. It is registered, and the array is newest-first
grep -c "deprecated" src/incident-callout/index.js
# Expected: 2   (the import and the registerBlockType key)
grep -c 'export default \[ v1 \]' src/incident-callout/deprecated.js
# Expected: 1

# 5. The migrate rule is present and matches the one Lesson 14.4 implements in TS
grep -c "'s1-catastrophic', 's2-major'" src/incident-callout/deprecated.js
# Expected: 1

# 6. The audit landed on all five blocks
grep -h '"renaming": false' src/*/block.json | wc -l
# Expected: 5     (6 if you did the optional stretch block)

# 7. NEGATIVE — no block anywhere allows hand-editing its HTML
grep -h '"html": true' src/*/block.json | wc -l
# Expected: 0
grep -h '"html": false' src/*/block.json | wc -l
# Expected: 5     (6 with the stretch block)

# 8. NEGATIVE — and no block quietly acquired a presentation control
grep -hE '"(align|color|spacing|typography|customClassName)": true' src/*/block.json | wc -l
# Expected: 0

# 9. The linter is clean, with nothing silenced
npm run lint:js; echo "exit=$?"
# Expected: exit=0
grep -rc 'eslint-disable' src/ | grep -v ':0'
# Expected: no output

# 10. The translation template was generated from src/, not build/
grep -c '^msgid' languages/blame-the-tech-blocks.pot
# Expected: 20 or more
grep -c 'node_modules' languages/blame-the-tech-blocks.pot
# Expected: 0

cd ../../../..
cd wordpress-headless

# 11. NEGATIVE — the stored markup is STILL v1. A deprecation never writes.
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' \
  | grep -c '<div class="wp-block-btt-incident-callout"><h3>'
# Expected: 1
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' | grep -c '<aside'
# Expected: 0
#           Together with check 1 this is the lesson: your save() emits <aside>,
#           the database holds <div>, and the editor shows no warning.

# 12. NEGATIVE — the SERVER knows nothing about the deprecation, and neither will
#     GraphQL. This is why Lesson 14.4 derives `tone` from `severity`.
docker compose run --rm -T wpcli wp eval '
$t = WP_Block_Type_Registry::get_instance()->get_registered( "btt/incident-callout" );
echo isset( $t->deprecated ) ? "SERVER KNOWS" : "server does not know — correct", PHP_EOL;
echo implode( ",", array_keys( $t->attributes ) ), PHP_EOL;'
# Expected: server does not know — correct
#           then a list CONTAINING tone — the live schema has it, the database
#           does not, and no PHP will ever run the migrate.

# 13. ...and parse_blocks() confirms it: no `tone` in the stored attributes
docker compose run --rm -T wpcli wp eval '
foreach ( parse_blocks( get_page_by_path( "blog-01", OBJECT, "post" )->post_content ) as $b ) {
	if ( "btt/incident-callout" === $b["blockName"] ) {
		echo array_key_exists( "tone", $b["attrs"] ) ? "tone present" : "tone ABSENT — as expected", PHP_EOL;
	}
}'
# Expected: tone ABSENT — as expected

# 14. theme.json is valid and reached the global settings
docker compose run --rm -T wpcli wp eval '
$p = wp_get_global_settings( array( "color", "palette" ) );
echo implode( ",", array_column( $p["theme"] ?? array(), "slug" ) ), PHP_EOL;'
# Expected: severity-s1,severity-s2,severity-s3,severity-s4,background,foreground
#           An empty line means theme.json is invalid JSON or is in the wrong
#           directory. It belongs at the THEME root, beside style.css.

# 15. NEGATIVE — editors cannot invent a fifth colour, a size or a spacing step
docker compose run --rm -T wpcli wp eval '
foreach ( array( array( "color", "custom" ), array( "color", "defaultPalette" ),
                 array( "typography", "customFontSize" ), array( "spacing", "customSpacingSize" ) ) as $path ) {
	var_export( wp_get_global_settings( $path ) );
	echo PHP_EOL;
}'
# Expected: false, four times.
#           `custom: false` without `defaultPalette: false` leaves WordPress's own
#           twenty colours in the picker and the constraint is decorative.

# 16. The four severity values are byte-identical to Lesson 11.1's tokens
grep -o 'oklch([^)]*)' wp-content/themes/btt-headless/theme.json | head -4
cd ../next-app && grep -o 'oklch([^)]*)' 'src/app/[locale]/globals.css' | grep -E '0\.52 0\.19 25|0\.66 0\.16 55|0\.75 0\.13 90|0\.62 0\.05 250'
# Expected: the same four values from both files. A mismatch means somebody
#           tweaked one design system and not the other, which is the exact
#           failure token parity exists to prevent.

# 17. NEGATIVE — theme.json emits nothing into the front end
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'wp--preset--color--severity-s1'
# Expected: 0
#           WordPress generates --wp--preset--color--severity-s1 into wp-admin and
#           into the front end IT serves. Next serves this page, so the variable
#           never appears. Key Concept 6, as a number.

# 18. NEGATIVE — and the front end is otherwise exactly as it was in Lesson 13.2
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'wp-block-btt-incident-callout'
# Expected: 1 or more — the same HTML blob, unchanged.
#           Five blocks, a deprecation, a supports audit, a translation template
#           and a design-token bridge, and the site a visitor sees is byte-for-byte
#           what it was before Module 13 started. That is not a failure. It is the
#           setup for Module 14, which is where every one of these attributes
#           finally becomes a React component.

# 19. Nothing stray is staged
cd .. && git status --short wordpress-headless/
# Expected: the new plugin files, theme.json and the .pot — and no build/, no
#           node_modules, no .env
```

Checks 1, 2 and 11 are three lines of one sentence: the code says `<aside>`, the database says
`<div>`, and the editor says nothing at all. Understand why all three are correct at once and you
understand block deprecations.

## Control Questions

1. `deprecated[0].attributes` duplicates four definitions that also exist in `block.json`.
   Explain why importing them instead would break the deprecation, and what a learner observes
   when it breaks.
2. `blog-01` holds v1 markup and nobody re-saves it. State what `tone` equals in the editor, what
   it equals in the `attributes` WPGraphQL Content Blocks returns, and what Lesson 14.4's
   component must therefore do.
3. This deprecation needs no `isEligible`. Describe a v2-to-v3 change to `btt/incident-callout`
   that *would* require one, and say what the corruption looks like if you omit it.
4. The audit turned `renaming` off on all five blocks but left `anchor` alone even though it is
   already `false`. Explain why turning `anchor` off would have been the riskier edit, in terms
   of what `useBlockProps.save()` emits.
5. `theme.json`'s `settings` half is load-bearing and its `styles` half nearly pointless here.
   Name the two audiences `styles` does reach, give the one-sentence reason to write any of it,
   and say what would have to change architecturally for `styles` to matter as much as it does
   in a Classic block theme.

## Learn More

- [Block deprecation](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-deprecation/) — the authoritative page for all five keys, with worked examples of `migrate` returning inner blocks
- [Block validation, in the architecture docs](https://developer.wordpress.org/block-editor/explanations/architecture/key-concepts/) — the comparison a deprecation is trying to satisfy, described by the people who implemented it
- [`supports` reference](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-supports/) — every key, including `renaming`, `lock` and the ones this audit did not need
- [`theme.json` reference](https://developer.wordpress.org/block-editor/reference-guides/theme-json-reference/) — the full `settings` and `styles` trees for schema version 3; the one page to keep open while writing the file in Step 5
- [Global settings and styles](https://developer.wordpress.org/block-editor/how-to-guides/themes/global-settings-and-styles/) — how `settings` becomes `--wp--preset--*` custom properties, which is what Key Concept 7 depends on
- [`wp i18n make-pot`](https://developer.wordpress.org/cli/commands/i18n/make-pot/) — every flag, including the `--exclude` behaviour that keeps `build/` out of your template
- [`wp i18n make-json`](https://developer.wordpress.org/cli/commands/i18n/make-json/) — why the editor needs JSON rather than `.mo`, and the hashed filename convention
- [`@wordpress/i18n`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-i18n/) — `__`, `_x`, `_n`, `sprintf` and `setLocaleData`, with the placeholder rules spelled out
- [Block Bindings API](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-bindings/) — `register_block_bindings_source()`, `get_value_callback`'s signature, and the allowlist of attributes core will substitute. Read it next to `wp-includes/class-wp-block.php`, where the list is a literal: the source is shorter than the docs and settles Key Concept 8's caveat in one screen
