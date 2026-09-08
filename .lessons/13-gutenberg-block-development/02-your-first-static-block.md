---
title: 'Your First Static Block'
module: 13
lesson: 2
teaches: [block-json, block-attributes, attribute-source, rich-text, save-function, block-validation]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/index.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/save.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/style.scss', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/severities.js']
requires: [13.1]
---

# Lesson 13.2 — Your First Static Block

## Quick Overview

`btt/incident-callout` is the block an editor drops into a blog post to flag a live incident: a
severity level, a short headline, and a body they can make bold and add links to. It is a
**static** block, meaning everything it needs is serialised into `post_content` at save time
and no PHP runs at render time. Static is the right default for most blocks and the right place
to start, because it forces you to meet `block.json`, `attributes`, `edit`, `save` and the block
validator in one sitting.

The concept with the most depth here is the `attributes` schema, and specifically `source`. An
attribute with no `source` is stored as JSON in the block's HTML comment. An attribute with
`source: 'html'` or `source: 'attribute'` is **parsed back out of the saved markup** — so the
headline text lives in the `<h3>` where it belongs, not duplicated into the comment. Choosing
correctly between the two is what makes a block's serialised output readable, migratable, and
still meaningful if the plugin is ever deactivated. You will also use `RichText`, which is the
one editor component that genuinely has no Classic WordPress equivalent: an inline
contenteditable surface producing a constrained subset of HTML, and the reason Lesson 14.3 needs
a sanitizer at all.

By the end of this lesson you will have:

- `src/incident-callout/block.json` — `apiVersion: 3`, the `btt` category, a typed `attributes` schema and a declared `supports` set
- A `severity` attribute constrained to the four-term closed set, and `headline` / `body` attributes sourced from the saved markup
- `src/incident-callout/edit.js` — a React component using `useBlockProps` and two `RichText` fields
- `src/incident-callout/save.js` producing markup that the block validator accepts on reload
- The block used in a real blog post, its serialised `post_content` read by eye, and one deliberate validation failure triggered and fixed

## Classic WP Analogy

A static block is a shortcode with a visual editor and a compiler:

```
Classic: a shortcode                        Blocks: a static block
─────────────────────────────────────────   ──────────────────────────────────────────
add_shortcode('btt_callout', function($a){  // block.json
  $a = shortcode_atts([                     "attributes": {
    'severity' => 's3-minor',                 "severity": { "type": "string",
    'headline' => '',                                       "default": "s3-minor" },
  ], $a);                                     "headline": { "type": "string",
  return sprintf(                                          "source": "html",
    '<div class="callout %s"><h3>%s</h3>…',                "selector": "h3" }
    esc_attr($a['severity']),               }
    esc_html($a['headline'])                // save.js  → the markup, once, at save time
  );                                        // edit.js  → the same markup, editable
});
```

`shortcode_atts()` and the `attributes` schema are doing the same job: declaring the parameters,
their types and their defaults. The `save()` function is doing the same job as your shortcode's
`return`: producing the markup. And `RichText` with `allowedFormats` is the same instinct as
running the body through `wp_kses_post()` — deciding which HTML a user may produce.

There are two real breaks, and the first is the one that will actually bite you today.

**A shortcode renders on every request; `save()` renders once, forever.** Change your
shortcode's output and every existing post updates on the next page load. Change `save()` and
every already-published post still contains the old markup — and now the validator compares your
new output against that old markup and declares the block broken. This is not a bug; it is the
consequence of storing rendered output. It is why Lesson 13.5 teaches `deprecated`, and it is
why you should get `save()` roughly right before an editor publishes forty posts with it.

**Escaping is not yours to do.** In PHP you write `esc_html()` and `esc_attr()` because
forgetting means an XSS hole. In JSX, `{headline}` is escaped automatically, and the only way to
inject raw HTML is to ask for it explicitly. `RichText` is the exception that proves the rule:
its value genuinely is HTML, it is stored as HTML, and it is the one attribute in the entire
block set that needs sanitizing before a React front end renders it. Lesson 14.3 handles that in
exactly one file.

The headless break, worth restating because it inverts a Classic instinct: **`style.scss` styles
the editor, not your site.** In a Classic build the block's stylesheet is the block's
appearance. Here Next.js renders the block from its attributes using Tailwind, so `style.scss`
exists to make the block look right *to the editor*, and nothing more. Effort spent perfecting
front-end CSS in this file is effort thrown away in Module 14.

---

## Key Concepts

### 1. `attributes` is a typed contract, and the types are load-bearing

Every attribute declares a `type`, and that type is not decoration. It is the JSON Schema type
WordPress validates against when it parses the block, it is what the REST API advertises, and
from Module 14 it is what WPGraphQL Content Blocks turns into a GraphQL field.

| `type` | Serialised as | Use it for | What a wrong value does |
|---|---|---|---|
| `string` | a JSON string | slugs, enum-ish values, rich text | a number arrives as a number and your JSX renders it; no error |
| `number` | a JSON number | counts, IDs, ratings | a string `"5"` stays a string. `=== 5` is false. This is a real bug source |
| `integer` | a JSON number | IDs, counts you will never fraction | same as `number` — nothing rounds for you |
| `boolean` | `true` / `false` | flags | `"false"` is truthy. Never store a boolean as a string |
| `array` | a JSON array | closed multi-select, ordered lists | a bare string is not coerced to a one-element array |
| `object` | a JSON object | grouped settings | avoid. An object attribute is a schema you did not write down |
| `null` | `null` | almost never | use a `default` instead |

Two rules for the whole module. **Declare a `default` for every attribute whose absence would
mean "broken".** An attribute with no `default` and no stored value is `undefined` in `edit`,
and `undefined` in `save` — which for a sourced attribute means the selector's element is not
emitted at all. And **never use `object`**: `btt/incident-ticker`'s `severities` is
`array` of `string`, not an object with four booleans, precisely so that Module 14 gets
`string[]` and not a shape it has to guess at.

> **A `default` is not stored.** Gutenberg omits any attribute whose value equals its default
> from the serialised comment. That is why the frozen fixture for `btt/hobt-cta` reads
> `{"label":"Stop blaming the tech","href":"/hobt"}` with no `variant` and no `leadSource` —
> both are at their defaults. The consumer in Module 14 therefore has to apply the same
> defaults itself, from the same source of truth: `docs/content-model.md`.

### 2. `source` — where the value actually lives

This is the deepest idea in the lesson. An attribute's value has to come from somewhere when
WordPress re-parses `post_content`, and `source` names where.

| `source` | Value is read from | Also needs | Serialised where | If the selector stops matching |
|---|---|---|---|---|
| *(omitted)* | the JSON in the block comment | — | the comment | n/a — there is no selector |
| `'html'` | the **innerHTML** of the matched element | `selector` (omit it to mean the block's root) | the markup | the attribute is `undefined`; the block usually fails validation too |
| `'attribute'` | one HTML attribute of the matched element | `selector` + `attribute` | the markup | `undefined`, silently |
| `'text'` | the **textContent** of the matched element | `selector` | the markup | `undefined`; any inline formatting is discarded on the way in |
| `'query'` | an array, one entry per match of `selector`, each with its own sub-`source` map | `selector` + `query` | the markup | an empty array, silently |

`'html'` versus `'text'` is the choice you will actually make: `'html'` keeps `<strong>` and
`<a>`, `'text'` throws them away. `RichText` requires `'html'`, because that is what `RichText`
produces.

`btt/incident-callout` uses three of the five columns at once, which is why it is the right
first block:

```
<!-- wp:btt/incident-callout {"incidentSlug":"incident-01","severity":"s1-catastrophic"} -->
                              └──────────┬───────────────────────────────────────────┘
                                         │  no `source` → JSON in the comment
                                         │  These are DECISIONS, not prose.
<div class="wp-block-btt-incident-callout">
  <h3>Production is a smoking crater</h3>      ← headline: source 'html', selector 'h3'
  <p>The DNS change was fine in staging.</p>   ← body:     source 'html', selector 'p'
</div>                                            These are CONTENT. They live in the markup.
<!-- /wp:btt/incident-callout -->
```

### 3. Why source the prose out of the markup, and what it costs

You could give `headline` and `body` no `source` and store them as JSON in the comment. It
works, it is simpler, and it is what a lot of plugins do. This course sources them, for three
reasons and one cost.

| Reason | Detail |
|---|---|
| **Readable serialisation** | `post_content` stays a document. A human, `grep`, a migration script or a database restore can all read the headline of every callout on the site with no JSON parsing. |
| **Survives deactivation** | Deactivate this plugin and the comment becomes an inert comment, but the `<h3>` and `<p>` still render through `the_content()`. Comment-only storage renders nothing at all. |
| **Migratable** | Sourced content is addressable by CSS selector, so a future "move the body into a `<div>`" is a DOM transform. Comment-only content is addressable only by re-serialising every block. |
| **The cost, stated plainly** | **The selector is now part of your public contract.** Change `<p>` to `<div>` and every published post fails validation. Lesson 13.5 is the bill for exactly this, on exactly this block. |

The rule that falls out: **decisions in the comment, content in the markup.** `severity` and
`incidentSlug` are decisions — a closed-set choice and a foreign key. `headline` and `body` are
content. Apply the same test to every attribute in the next three lessons and you will get the
same answers this course got.

> **Duplicating a value into both places is always wrong.** If `headline` were both a comment
> attribute *and* sourced from the `<h3>`, you would have two copies that can disagree, no rule
> about which wins, and a validator that only checks one of them. Pick a side per attribute.

### 4. `useBlockProps` and `useBlockProps.save()` — what has to agree, and what does not

Both hooks return the props for the block's **root element**: the generated class name, and
anything `supports` contributes (an `id` from `anchor`, alignment classes, colour classes,
inline styles). Spread them onto your wrapper and you get every editor feature for free; forget
them and half the `supports` you declared silently do nothing.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/edit.js — (illustration)
const blockProps = useBlockProps( { 'data-severity': severity } ); // editor tree only
// …
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/save.js — (illustration)
<div { ...useBlockProps.save() }>   // ← THIS output is compared against storage
```

The precise rule is narrower than "they must be identical", and getting it right saves you an
afternoon:

| | `useBlockProps()` in `edit` | `useBlockProps.save()` in `save` |
|---|---|---|
| Output goes into | the editor's React tree | `post_content` |
| Is it compared to storage? | **no** | **yes, on every load** |
| Extra props are | fine, and useful — this is how you preview state | **a change to the stored markup** |
| Root element must be | whatever you like | the same element `save()` always emitted |

So passing `{ 'data-severity': severity }` to `useBlockProps()` is safe and is how the editor
shows severity at a glance. Passing the same thing to `useBlockProps.save()` would add
`data-severity="s1-catastrophic"` to the stored `<div>` — which does not match the frozen
fixture in `blog-01`, and every seeded post would fail validation the moment you rebuilt.

> **This is the trap, so meet it deliberately.** The severity is already in the comment JSON.
> Putting it in the markup as well would be the duplication Key Concept 3 forbids, *and* a
> validation break. The editor preview and the saved markup are allowed to differ; that is not
> a bug, it is the separation the two hooks exist to express.

### 5. `RichText` is the one component with no Classic equivalent

`RichText` renders a `contenteditable` element whose value is a constrained HTML string. Not
plain text, and not arbitrary HTML — a subset you declare.

| Prop | Does |
|---|---|
| `tagName` | which element to render. Must match the `selector` of the attribute it is bound to |
| `value` / `onChange` | the controlled pair. `value` is an HTML string |
| `allowedFormats` | the whitelist of format names, e.g. `[ 'core/bold', 'core/italic', 'core/link' ]`. **`[]` means "plain text, no toolbar"** |
| `placeholder` | shown when empty. This is the block's only in-place documentation, so write a real sentence |
| `identifier` | the attribute name, so the editor can wire up split/merge behaviour on Enter and Backspace |
| `withoutInteractiveFormatting` | drops link, footnote and other interactive formats without listing the survivors |

Two things about it that matter more than the API:

**Its value genuinely is HTML.** `body` will hold `The DNS change was <strong>fine</strong> in
staging.` — an editor-authored HTML string, and therefore an untrusted HTML string. That is the
entire reason Lesson 14.3 installs `isomorphic-dompurify` and puts the only
`dangerouslySetInnerHTML` in `next-app` behind a strict allowlist. `allowedFormats` here is a
**UI** constraint, not a security boundary: it decides which buttons the toolbar shows, and an
editor pasting from Word, or a colleague with database access, is not constrained by it at all.
Constrain the input for the editor's sake; sanitize on the way out for everyone else's.

**Empty rich text still emits its element.** `<RichText.Content tagName="h3" value="" />`
serialises to `<h3></h3>`, not to nothing. That is what you want: the `selector: 'h3'` contract
survives an empty headline, and a block that conditionally omitted the element would parse back
with `headline: undefined` and immediately fail validation.

### 6. The validator, and the three ways out of it

```
LOAD a post
  │
  ├─ parser reads:  innerHTML  = '<div class="…"><h3>Production…</h3><p>The DNS…</p></div>'
  │                 attributes = { incidentSlug: 'incident-01', severity: 's1-catastrophic',
  │                                headline: 'Production…', body: 'The DNS…' }
  │
  ├─ editor runs:   save( { attributes } )  →  a fresh HTML string
  │
  └─ COMPARE the two
        │
        ├── identical ──▶ block is valid. `edit` renders. Nothing is shown to the user.
        │
        └── different ─▶ "This block contains unexpected or invalid content."
                          and three buttons:
                            ┌──────────────────────────────────────────────────────┐
                            │ Attempt Block Recovery                               │
                            │   re-serialise from the PARSED attributes, discard   │
                            │   the stored markup. Loses anything the parser could │
                            │   not read back — usually correct for this block.    │
                            ├──────────────────────────────────────────────────────┤
                            │ Convert to HTML                                      │
                            │   becomes a core/html block, permanently. The btt/   │
                            │   comment and its attributes are GONE, so Module 14  │
                            │   sees a CoreHtml block with no data. Worst option.  │
                            ├──────────────────────────────────────────────────────┤
                            │ Convert to Blocks (Resolve → Convert to Blocks)      │
                            │   re-parse the markup as generic core blocks. Also   │
                            │   destroys the btt/ block. Worst option, differently.│
                            └──────────────────────────────────────────────────────┘
```

The comparison is not a raw string compare — the editor tokenises both sides first — but treat
it as one, because everything you are likely to change **does** fail it: a different tag name, a
different class list, an added or removed wrapper element, different text content, a new HTML
attribute.

The important consequence is what happens if a learner clicks the wrong button: nothing warns
them, the post saves happily, and the data loss surfaces in Module 14 as a block that renders as
plain HTML with no attributes. **The correct response to an invalid block is almost never a
button.** It is either "fix `save()` back to what it was" or "write a `deprecated` entry" —
Lesson 13.5.

### 7. `supports`, decided rather than defaulted

Every `supports` key you leave out takes a WordPress default, and the defaults are written for a
Classic block theme. Decide each one, and write the decision down.

| Key | Default | This block | Why |
|---|---|---|---|
| `className` | `true` | **`true`** | This is what produces `wp-block-btt-incident-callout`, which the frozen fixture contains. Turning it off changes stored markup. |
| `customClassName` | `true` | **`false`** | The "Additional CSS class(es)" field lets an editor type a class that means nothing to a Tailwind front end. A control whose effect is invisible is a lie. |
| `html` | `true` | **`false`** | "Edit as HTML" invites an editor to hand-edit markup the validator will then reject. This is `false` on every block in this plugin. |
| `anchor` | `false` | **`false`** | An `id` on the wrapper is a markup change. If deep links into callouts are ever wanted, that is a Module 14 concern on the React side. |
| `align` | `false` | **`false`** | Alignment is layout, layout is Next's, and an `alignwide` class Tailwind never compiled is decoration that does nothing. |
| `color` | `false` | **`false`** | Colour comes from `severity`. Two ways to set the colour of one block is one way too many. |
| `spacing` | `false` | **`false`** | Emits inline `style` into stored markup that only wp-admin will ever read. |
| `typography` | `false` | **`false`** | Same argument as `spacing`. |
| `reusable` | `true` | **`true`** | Harmless, occasionally useful, and turning it off surprises editors. |
| `multiple` | `true` | **`true`** | A post can legitimately reference two incidents. |

The pattern: **anything that writes presentation into `post_content` is off; anything that
writes meaning is on.** Lesson 13.5 turns this into a table across all five blocks and defends
every cell.

### 8. Escaping: JSX does it, PHP does not, and `RichText.Content` opts out

In the shortcode you wrote for years, forgetting `esc_html()` was an XSS hole. In JSX, the
default is inverted:

| | PHP | JSX |
|---|---|---|
| `<h3><?php echo $headline; ?></h3>` | **raw. A hole.** | — |
| `<h3><?php echo esc_html( $headline ); ?></h3>` | safe, and you had to remember | — |
| `<h3>{ headline }</h3>` | — | **escaped automatically.** `<script>` renders as text |
| `<RichText.Content tagName="h3" value={ headline } />` | — | **raw HTML, on purpose** |

So there is no `esc_html()` in a `save.js`, and if you find one you have found either a
misunderstanding or someone double-escaping. The one place raw HTML enters is
`RichText.Content`, and that is not a hole *here* — the string was authored in wp-admin by a
user with `edit_posts`, and WordPress's own `wp_kses_post()` runs on the way into the database.
It becomes a hole the moment a different application renders it without checking, which is why
Lesson 14.3's sanitizer exists and why appendix 03 marks `stack_trace` as escaped text rather
than HTML.

`render.php` in Lesson 13.4 is PHP again, and every escaping rule you know comes straight back.
Knowing which file you are in is the whole skill.

### 9. `severity` is a closed set of four slugs, and it is typed once

The four values are fixed by
[the content model contract](../appendix/03-content-model-reference.md#2-taxonomies):
`s1-catastrophic`, `s2-major`, `s3-minor`, `s4-cosmetic`. There is no fifth and there is not
going to be one — the `severity` taxonomy's term UI is locked for exactly this reason.

A `string` attribute cannot express that, so the constraint has to live somewhere:

| Where you could put it | Verdict |
|---|---|
| An `enum` key in `block.json` | ❌ `block.json`'s attribute schema does not validate `enum` at parse time. It documents; it does not enforce |
| Hard-coded options inline in the `SelectControl` | ❌ works, and duplicates the list into `btt/incident-ticker` in Lesson 13.4 |
| **One exported array, imported by every block that needs it** | ✅ `src/severities.js`. One place to read, one place to change, one place to grep |
| Fetched from the taxonomy with `useSelect` | ❌ correct for `scapegoat` in Lesson 13.3, wrong here: the list is closed and known at build time, so a network round trip buys nothing and adds a loading state |

Note the difference between that last row and Lesson 13.3. `scapegoat` is **open** — ten seeded
terms and editors can add more — so its options must come from the store at runtime.
`severity` is **closed** — four terms, locked UI — so its options are a constant. The mechanism
follows the model, not the other way round.

> **Sharing a module between blocks in this plugin is fine.** `src/severities.js` is imported by
> two blocks and webpack bundles it into both. That is not the boundary Lesson 13.1 warned
> about — the forbidden thing is sharing across the **toolchain** boundary, into `next-app`.
> Inside one webpack build, ordinary modules are ordinary modules.

---

## Task

### Step 1: Declare the block

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "btt/incident-callout",
  "version": "0.1.0",
  "title": "Incident Callout",
  "category": "btt",
  "description": "Flag a live incident inside a post: a severity, a linked incident, a headline and a short body.",
  "keywords": ["incident", "callout", "severity", "outage"],
  "textdomain": "blame-the-tech-blocks",
  "attributes": {
    "severity": {
      "type": "string",
      "default": "s3-minor"
    },
    "incidentSlug": {
      "type": "string",
      "default": ""
    },
    "headline": {
      "type": "string",
      "source": "html",
      "selector": "h3"
    },
    "body": {
      "type": "string",
      "source": "html",
      "selector": "p"
    }
  },
  "supports": {
    "className": true,
    "customClassName": false,
    "html": false,
    "anchor": false,
    "align": false,
    "color": false,
    "spacing": false,
    "typography": false,
    "reusable": true,
    "multiple": true
  },
  "editorScript": "file:./index.js",
  "style": "file:./style-index.css"
}
```

The path is
`wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/block.json`.
JSON has no comment syntax, so the decisions behind it are Key Concepts 1, 2 and 7 rather than
inline notes — which is a good reason to keep `docs/content-model.md` current.

Two things to notice. `headline` and `body` have **no `default`**, on purpose: their default is
"whatever the markup says", and a `default` would fight the `source`. And `style` points at
`style-index.css` — a file you never write. `wp-scripts` compiles `src/incident-callout/
style.scss` into `build/incident-callout/style-index.css`, and the name is the toolchain's
convention, not a choice.

### Step 2: Write the shared severity list

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/severities.js
import { __ } from '@wordpress/i18n';

/**
 * The `severity` taxonomy is a CLOSED set of four terms — appendix 03 §2.
 * The term UI in wp-admin is locked to these four, so this list is a constant
 * and not something to fetch. `btt/incident-ticker` (Lesson 13.4) imports it too.
 *
 * Slugs, never labels: the slug is what goes into the attribute, what Module 14
 * narrows on, and what `<Badge variant="s1-catastrophic">` already expects.
 */
export const SEVERITY_SLUGS = [ 's1-catastrophic', 's2-major', 's3-minor', 's4-cosmetic' ];

/** Shape `SelectControl` wants: `[ { label, value } ]`. */
export const SEVERITY_OPTIONS = [
	{ value: 's1-catastrophic', label: __( 'S1 — Catastrophic', 'blame-the-tech-blocks' ) },
	{ value: 's2-major', label: __( 'S2 — Major', 'blame-the-tech-blocks' ) },
	{ value: 's3-minor', label: __( 'S3 — Minor', 'blame-the-tech-blocks' ) },
	{ value: 's4-cosmetic', label: __( 'S4 — Cosmetic', 'blame-the-tech-blocks' ) },
];
```

### Step 3: Write the editor entry point

`index.js` is the file `editorScript` points at, and its only job is registration.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/index.js
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';
import save from './save';

// The stylesheet is imported here, not in edit.js. wp-scripts routes a file named
// `style.scss` to `style-index.css`, which block.json's `style` key then enqueues.
import './style.scss';

// The FIRST argument is metadata.name. Passing the whole `metadata` object as the
// second argument means block.json stays the single description (Lesson 13.1 §7),
// and `edit`/`save` are the only two things JavaScript adds to it.
registerBlockType( metadata.name, {
	edit: Edit,
	save,
} );
```

### Step 4: Write `edit.js`

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/edit.js
import { __ } from '@wordpress/i18n';
import { InspectorControls, RichText, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, SelectControl, TextControl } from '@wordpress/components';

import { SEVERITY_OPTIONS } from '../severities';

export default function Edit( { attributes, setAttributes } ) {
	const { severity, incidentSlug, headline, body } = attributes;

	// `data-severity` is EDITOR ONLY. It is not in save(), so it never reaches
	// post_content and cannot break validation. style.scss keys off it so the
	// editor shows severity at a glance. Key Concept 4.
	const blockProps = useBlockProps( { 'data-severity': severity } );

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Incident', 'blame-the-tech-blocks' ) }>
					<SelectControl
						__nextHasNoMarginBottom
						label={ __( 'Severity', 'blame-the-tech-blocks' ) }
						value={ severity }
						options={ SEVERITY_OPTIONS }
						// setAttributes MERGES. This call leaves the other three alone.
						onChange={ ( value ) => setAttributes( { severity: value } ) }
						help={ __( 'Four terms, closed set. There is no S5.', 'blame-the-tech-blocks' ) }
					/>
					<TextControl
						__nextHasNoMarginBottom
						label={ __( 'Incident slug', 'blame-the-tech-blocks' ) }
						value={ incidentSlug }
						onChange={ ( value ) => setAttributes( { incidentSlug: value } ) }
						placeholder="incident-01"
						help={ __(
							'The incident this callout refers to. Nothing validates it here — see the note in the lesson.',
							'blame-the-tech-blocks'
						) }
					/>
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				<RichText
					identifier="headline"
					tagName="h3"
					value={ headline }
					onChange={ ( value ) => setAttributes( { headline: value } ) }
					// [] = no formatting toolbar at all. A headline is a headline.
					allowedFormats={ [] }
					placeholder={ __( 'What broke?', 'blame-the-tech-blocks' ) }
				/>
				<RichText
					identifier="body"
					tagName="p"
					value={ body }
					onChange={ ( value ) => setAttributes( { body: value } ) }
					// Three formats, chosen. Every one of them survives Lesson 14.3's
					// DOMPurify allowlist; anything else would be stripped there anyway.
					allowedFormats={ [ 'core/bold', 'core/italic', 'core/link' ] }
					placeholder={ __( 'One sentence. Blame something.', 'blame-the-tech-blocks' ) }
				/>
			</div>
		</>
	);
}
```

> **`incidentSlug` is a foreign key with no integrity, and that is a real defect.** Nothing here
> checks that `incident-01` exists, so an editor can typo it, or someone can delete the
> incident, and the block keeps looking fine in wp-admin. The honest fix is the mechanism Lesson
> 13.3 introduces: read the real list with `useSelect` and make the control a picker. It stays a
> `TextControl` here so that this lesson is about `source` and the validator and nothing else,
> and Module 14's component renders no link at all when the slug does not resolve rather than
> rendering a broken one.

### Step 5: Write `save.js` and `style.scss`

This is the file the validator compares against `post_content`. Match
[the seeded fixture](../04-acf-content-modeling-and-seeding/05-seed-data-and-migrations.md)
exactly: a `<div>` with only the generated class, an `<h3>`, then a `<p>`.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/save.js
import { RichText, useBlockProps } from '@wordpress/block-editor';

export default function save( { attributes } ) {
	const { headline, body } = attributes;

	// NOTHING derived from `severity` or `incidentSlug` goes in here. Both are
	// already in the comment JSON, and adding either to the markup would (a)
	// duplicate state and (b) invalidate every already-published callout.
	//
	// No esc_html(). JSX escapes; RichText.Content deliberately does not.
	return (
		<div { ...useBlockProps.save() }>
			<RichText.Content tagName="h3" value={ headline } />
			<RichText.Content tagName="p" value={ body } />
		</div>
	);
}
```

```scss
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/style.scss
//
// EDITOR-FACING ONLY, in practice. Next.js renders this block from its attributes
// with Tailwind and never loads a WordPress stylesheet, so every rule here exists
// to stop the editor lying to the editor. Keep it small. Effort spent here on
// front-end fidelity is effort thrown away in Module 14.
//
// The `[data-severity]` hooks only ever match in the editor: edit.js adds the
// attribute, save.js does not. That is deliberate — see Key Concept 4.

.wp-block-btt-incident-callout {
	border-left: 4px solid #64748b;
	padding: 0.75rem 1rem;
	background: #f8fafc;

	h3 {
		margin: 0 0 0.25rem;
		font-size: 1.05rem;
	}

	p {
		margin: 0;
	}

	&[data-severity='s1-catastrophic'] { border-left-color: #dc2626; }
	&[data-severity='s2-major']        { border-left-color: #ea580c; }
	&[data-severity='s3-minor']        { border-left-color: #ca8a04; }
	&[data-severity='s4-cosmetic']     { border-left-color: #475569; }
}
```

**Verify §5:**

- [ ] The watcher terminal from Lesson 13.1 shows a completed rebuild. If it shows a SCSS error,
      fix that first — a failed compile leaves the previous `style-index.css` in place and the
      block will look stale rather than broken.
- [ ] `build/incident-callout/` now exists and contains `block.json`, `index.js`,
      `index.asset.php` and `style-index.css`.

### Step 6: Use it, then read what it wrote

If the watcher is not running, `npm run build` once. Then create a throwaway draft to
experiment in — you will reuse it for the rest of the module, and because it is never published
the Next front end never sees it:

```bash
cd wordpress-headless
docker compose run --rm -T wpcli wp post create \
  --post_type=post --post_title='Block scratchpad' --post_name=block-scratchpad \
  --post_status=draft --porcelain
```

Open it in wp-admin (`http://localhost:8080/wp-admin/edit.php`, then the draft), and:

1. Insert **Incident Callout** from the `Blame The Tech` inserter group. It is there now; the
   group was invisible in Lesson 13.1 because it was empty.
2. Type a headline and a body. Make one word in the body bold, and add a link.
3. In the sidebar, set Severity to `S1 — Catastrophic` and Incident slug to `incident-01`.
4. Save the draft.

Now read the serialisation back:

```bash
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "block-scratchpad", OBJECT, "post" )->post_content;'
```

**Verify §6:**

- [ ] The comment JSON contains `severity` and `incidentSlug` and **not** `headline` or `body`.
- [ ] The `<h3>` and `<p>` hold your text, and the `<p>` contains a literal `<strong>` and
      `<a href=…>`. That HTML string is what Lesson 14.3 sanitizes.
- [ ] If you left severity at `S3 — Minor`, `severity` is **absent** from the JSON. It equals
      the default, so Gutenberg omits it. Key Concept 1.
- [ ] Reload the editor page. No warning. `save()` and storage agree.

### Step 7: Break validation on purpose, then recover

This is the point of the lesson. Do it, do not read it.

Take a copy first, so recovery is a `cp` and not a memory test. **Do not reach for
`git checkout`** — `save.js` is new in this lesson and is not in a commit yet.

```bash
cd wp-content/plugins/blame-the-tech-blocks
cp src/incident-callout/save.js /tmp/save.js.good
```

Now change one character's worth of meaning: in `src/incident-callout/save.js`, change the
second `RichText.Content`'s `tagName="p"` to `tagName="div"`. Let the watcher rebuild.
**Hard-reload** the scratchpad post in wp-admin (a normal reload may serve the cached bundle).

**Verify §7:**

- [ ] The block shows **"This block contains unexpected or invalid content."**
- [ ] Open the browser console. There is a `Block validation failed` warning naming the block
      and printing the expected and actual markup side by side. Read it. That message is the
      single most useful debugging tool in block development and almost nobody looks at it.
- [ ] The three recovery buttons are the three from Key Concept 6. **Click none of them.**
      `Convert to HTML` is irreversible and destroys the attributes.
- [ ] Now put it back and confirm recovery:

```bash
cp /tmp/save.js.good src/incident-callout/save.js && rm /tmp/save.js.good
```

- [ ] After the rebuild and a hard reload, the block renders normally again with no warning and
      nothing lost. **Nothing was ever written to the database during any of this** — the
      invalid state existed only in the editor's memory, which is exactly why a `deprecated`
      entry (Lesson 13.5) can fix an old post without a migration.

Then record what you now know in `docs/content-model.md`, which Lesson 01.1 created:

```markdown
<!-- docs/content-model.md -->

## Block attributes (Lesson 13.2)

Module 14 reads these over GraphQL. Attribute names, types and defaults are the contract
between the two toolchains; nothing is imported across it (`docs/architecture.md`).

### `btt/incident-callout` — GraphQL type `BttIncidentCallout`

| Attribute | Type | Default | `source` | Lives in | Notes |
|---|---|---|---|---|---|
| `severity` | `string` | `s3-minor` | — | the block comment | one of the four `severity` term slugs (appendix 03 §2) |
| `incidentSlug` | `string` | `""` | — | the block comment | slug of an `incident` post. **Not validated.** A dangling slug renders no link |
| `headline` | `string` | — | `html`, selector `h3` | the markup | plain text; `allowedFormats: []` |
| `body` | `string` | — | `html`, selector `p` | the markup | HTML. Bold, italic and link only. **Sanitize before rendering** (Lesson 14.3) |

An attribute at its default is **omitted** from the serialised comment, so a consumer must
apply these defaults itself.
```

---

## Verification

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks

# 1. The block compiled, and block.json was copied across unchanged
test -f build/incident-callout/block.json && echo "built"
# Expected: built
#           Missing? The watcher is not running, or you wrote src/incident-callout/
#           with a typo. wp-scripts discovers entry points from src/*/block.json only.

# 2. The built copy points at the built script, and at API version 3
grep -c '"editorScript": "file:./index.js"' build/incident-callout/block.json
# Expected: 1
grep -c '"apiVersion": 3' build/incident-callout/block.json
# Expected: 1

# 3. The generated dependency manifest names the wp- handles, not a bundled React
grep -oE "wp-[a-z-]+" build/incident-callout/index.asset.php | sort -u | tr '\n' ' '
# Expected: something like  wp-block-editor wp-blocks wp-components wp-i18n wp-primitives
#           This is Lesson 13.1 Key Concept 6, on disk.

# 4. Exactly two attributes are sourced out of the markup, and each has a selector
grep -c '"source"' src/incident-callout/block.json
# Expected: 2
grep -c '"selector"' src/incident-callout/block.json
# Expected: 2

# 5. NEGATIVE — no `esc_html`, `esc_attr` or `dangerouslySetInnerHTML` in save.js.
#    All three would be wrong here: JSX escapes, and RichText.Content is the one
#    sanctioned raw-HTML path. In render.php (Lesson 13.4) the opposite is true.
grep -cE 'esc_html|esc_attr|dangerouslySetInnerHTML' src/incident-callout/save.js
# Expected: 0

# 6. NEGATIVE — nothing derived from severity reaches the saved markup
grep -c 'severity' src/incident-callout/save.js
# Expected: 0
#           A hit means you put it on useBlockProps.save() and every seeded post
#           is now invalid. Key Concept 4.

# 7. NEGATIVE — exactly four severities are selectable, and no fifth exists anywhere
grep -c "value: 's" src/severities.js
# Expected: 4
grep -cE "s5-|s0-|'critical'|'low'" src/severities.js
# Expected: 0

# 8. NEGATIVE — hand-editing the block's HTML is disabled
grep -c '"html": false' src/incident-callout/block.json
# Expected: 1

cd ../../../..
cd wordpress-headless

# 9. The server-side registry has the block, with exactly the four expected attributes
docker compose run --rm -T wpcli wp eval '
$t = WP_Block_Type_Registry::get_instance()->get_registered( "btt/incident-callout" );
if ( ! $t ) { echo "NOT REGISTERED", PHP_EOL; exit; }
$keys = array_keys( $t->attributes );
sort( $keys );
echo implode( ",", $keys ), PHP_EOL;'
# Expected: body,headline,incidentSlug,severity
#           NOT REGISTERED means build/incident-callout/ is missing, or the plugin
#           is inactive, or `incident-callout` is misspelled in the BLOCKS const.

# 10. ...and the count of btt/ blocks in the registry is now exactly 1
docker compose run --rm -T wpcli wp eval '
$n = array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() );
echo count( array_filter( $n, static fn( $x ) => str_starts_with( $x, "btt/" ) ) ), PHP_EOL;'
# Expected: 1   (five to go)

# 11. THE PROOF: the seeded fixture's stored markup is byte-identical in shape to
#     what save() now emits. If this is 0, your save() disagrees with blog-01 and
#     every seeded post shows a validation warning.
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' \
  | grep -c '<div class="wp-block-btt-incident-callout"><h3>'
# Expected: 1

# 12. ...and the sourced attributes parse back out of that markup correctly
docker compose run --rm -T wpcli wp eval '
$p = get_page_by_path( "blog-01", OBJECT, "post" );
foreach ( parse_blocks( $p->post_content ) as $b ) {
	if ( "btt/incident-callout" === $b["blockName"] ) {
		echo $b["attrs"]["severity"], "|", $b["attrs"]["incidentSlug"], PHP_EOL;
	}
}'
# Expected: s1-catastrophic|incident-01
#           Note what is NOT here: `headline` and `body`. parse_blocks() reads the
#           comment JSON only. The `source` attributes are resolved by the
#           JavaScript parser in the editor, and by WPGraphQL Content Blocks in
#           Module 14 — never by parse_blocks().

# 13. The scratchpad draft round-tripped
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "block-scratchpad", OBJECT, "post" )->post_content;' \
  | grep -c 'wp:btt/incident-callout'
# Expected: 1

# 14. NEGATIVE — the draft is not visible to the front end, so this experiment
#     cannot leak into anything you assert on later
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/blog/block-scratchpad
# Expected: 404

# 15. The block is in the front end's output, and NOT as a React component
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'wp-block-btt-incident-callout'
# Expected: 1 or more — and the number is not the point.
#           What you are looking at is the stored markup arriving inside `content`
#           and going through the one `dangerouslySetInnerHTML` that Lesson 09.4
#           left in blog/[slug]/page.tsx. No component of yours ran. Tailwind
#           compiled no style for that class. `severity` and `incidentSlug` are
#           nowhere in this HTML, because the comment is stripped by the_content().
#           THAT is the whole problem Module 14 exists to solve.

# 16. NEGATIVE — and nothing in next-app knows this block exists yet
cd ../next-app
grep -rc 'incident-callout\|IncidentCallout' src/ 2>/dev/null | grep -v ':0' | head
# Expected: no output. Module 13 changes nothing on the front end.
```

Checks 11 and 15 are the two to sit with, together. Eleven says your `save()` matches content
that was seeded before you wrote a line of JavaScript. Fifteen says the front end is completely
indifferent to that achievement. Both are supposed to be true at the end of this lesson.

## Control Questions

1. `headline` uses `source: 'html'` with `selector: 'h3'`. Describe what the `headline`
   attribute equals, immediately after parsing, for a post whose stored markup has no `<h3>` at
   all — and say what the editor shows the user in that situation.
2. You add `data-severity` to `useBlockProps.save()` instead of `useBlockProps()`. Nothing
   appears to break in the editor. Name the two posts in the seed data that break, when the
   breakage becomes visible, and why the editor rather than the database is where you see it.
3. `allowedFormats={ [ 'core/bold', 'core/italic', 'core/link' ] }` is described in Key Concept
   5 as a UI constraint and not a security boundary. Give one concrete way a `<script>` tag could
   end up in the `body` attribute despite that prop, and name the file in Module 14 that is
   therefore load-bearing.
4. An editor clicks **Convert to HTML** on an invalid `btt/incident-callout`. State what
   `post_content` holds afterwards, what `parse_blocks()` reports for that block, and what
   Module 14's `BlockRenderer` will render for it.
5. `severity` is a constant list in `src/severities.js` while Lesson 13.3's `scapegoat` options
   come from `useSelect`. Both are taxonomies. State the property of the *content model* that
   makes the two mechanisms different, and say what would have to change about `severity` for
   the `useSelect` approach to become correct.

## Learn More

- [Attributes reference](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-attributes/) — the authoritative table for `source`, `selector`, `attribute` and `query`; the one page behind Key Concept 2
- [`RichText`](https://developer.wordpress.org/block-editor/reference-guides/richtext/) — every prop, including `identifier` and the split/merge behaviour it enables
- [`useBlockProps` and the block wrapper](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-edit-save/) — `edit` and `save` side by side, from the people who wrote the validator
- [`supports` reference](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-supports/) — read it once with Key Concept 7's table open and decide your own defaults
- [Block validation and deprecation](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-deprecation/) — the mechanics of the comparison in Key Concept 6, and a preview of Lesson 13.5
- [`@wordpress/components` reference](https://developer.wordpress.org/block-editor/reference-guides/components/) — `SelectControl`, `TextControl`, `PanelBody` and the `__next*` props that opt into the current visual style
- [The block grammar](https://developer.wordpress.org/block-editor/explanations/architecture/key-concepts/#blocks) — how the comment delimiters are actually parsed, which explains why a self-closing block exists at all
- [`wp_kses_post()`](https://developer.wordpress.org/reference/functions/wp_kses_post/) — what WordPress already strips on the way into the database, so you know exactly what Lesson 14.3's sanitizer is and is not duplicating
