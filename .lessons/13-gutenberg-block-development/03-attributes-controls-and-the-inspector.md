---
title: 'Attributes, Controls & the Inspector'
module: 13
lesson: 3
teaches: [inner-blocks, allowed-blocks, block-templates, inspector-controls, use-select, wordpress-core-data, storing-ids-not-copies]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/index.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/save.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/style.scss', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/index.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/save.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/editor.scss']
requires: [13.2]
---

# Lesson 13.3 — Attributes, Controls & the Inspector

## Quick Overview

Two blocks, two mechanisms neither of which `btt/incident-callout` needed. `btt/blame-quote`
uses **`InnerBlocks`**: instead of storing its content in attributes, it declares a region other
blocks can be placed inside, restricted with `allowedBlocks` and pre-populated with a
`template`. Children serialise themselves, so the block's own `save()` becomes a wrapper and
nothing else. `btt/scapegoat-picker` uses **`InspectorControls`** to put its settings in the
sidebar rather than inline, and **`useSelect`** to read the `scapegoat` taxonomy terms out of
WordPress's own data store so the editor picks from a real list.

The design decision buried in `scapegoat-picker` is the one worth arguing about: it stores the
**term ID and nothing else**. Not the name, not the slug, not the avatar URL. Copying those into
the block would make the front end's job trivially easy and would mean that renaming a scapegoat
term leaves stale names scattered through forty published posts, with no way to find them. Store
the reference; resolve it at read time. That is the same instinct that made `scapegoat` a
taxonomy rather than an SCF text field in the first place, and Lesson 14.4 is where it pays off.

By the end of this lesson you will have:

- `src/blame-quote/*` — an `InnerBlocks` block with `allowedBlocks`, a `template`, and `templateLock` considered and decided
- `src/scapegoat-picker/*` — an `InspectorControls` panel with a term selector and one numeric attribute
- A `useSelect` call against `@wordpress/core-data` that handles its own loading and empty states
- A single `termId` attribute stored on the block, with no denormalised term data
- A verified reload: renaming a scapegoat term in wp-admin changes what the block shows, with no post re-save

## Classic WP Analogy

Both mechanisms have Classic counterparts you have used, and the `InspectorControls` one is
almost exact:

| Classic WordPress | Block editor |
|---|---|
| `add_meta_box(…, 'side', …)` | `<InspectorControls>` |
| `wp_dropdown_categories(['taxonomy' => 'scapegoat'])` | `useSelect` + `getEntityRecords('taxonomy','scapegoat')` |
| `<select name="btt_scapegoat">` in a meta box | `<SelectControl>` in the inspector |
| `update_post_meta($id,'scapegoat_id',$v)` | `setAttributes({ termId: v })` |
| Nested shortcodes with `do_shortcode($content)` | `InnerBlocks` |
| `get_template_part()` with a `$content` argument | `<InnerBlocks.Content />` in `save()` |
| A meta box that queries terms server-side | an async subscription to a client store |

If you have built a meta box with a taxonomy dropdown — and you have — the shape is identical:
list the terms, let the editor pick one, store the choice. The inspector is simply that meta box
rendered by React inside the editor's own sidebar, which means it participates in undo, in block
duplication, and in copy-paste between posts for free.

The analogy breaks on **when the data arrives**, and this is the difference that generates the
bug. `wp_dropdown_categories()` runs on the server with the taxonomy already loaded, so by the
time your HTML exists the options exist. `useSelect` is a **subscription**: on the first render
it returns `undefined`, then WordPress fetches `/wp-json/wp/v2/scapegoat`, then your component
re-renders with the terms. A block whose `edit` assumes the array exists crashes the editor on
first paint, and the crash presents as a blank white block with an unhelpful console message.
Every `useSelect` in this codebase handles three states — loading, empty, loaded — and the empty
case is real, because a fresh install has no terms until activation seeds them.

The second break is a philosophical one that Classic WordPress lets you dodge.
`wp_dropdown_categories()` is a *rendering* concern, so it does not matter much where its data
comes from. `useSelect` reads the same normalised store the entire editor is built on — the same
store that knows about the current post, its autosave status, the user's capabilities and every
registered block. Learning `useSelect` is learning the editor's actual architecture, not just a
control.

> **This is the one place in the course where REST is the correct API.** The block editor is a
> REST client by construction, so `getEntityRecords` is right, idiomatic, and cheap. It does not
> contradict the rule that the front end never touches REST — those are two different clients
> with two different threat models. wp-admin is authenticated, same-origin and already trusted;
> the public front end is neither.

---

## Key Concepts

### 1. `InnerBlocks` or attributes: two places a block's content can live

`btt/incident-callout` put its prose in attributes. `btt/blame-quote` puts its prose in **other
blocks**. Both are correct; they are correct for different content.

```
ATTRIBUTES (13.2)                          INNER BLOCKS (this lesson)
─────────────────────────────────────      ──────────────────────────────────────────
<!-- wp:btt/incident-callout {…} -->       <!-- wp:btt/blame-quote {"attribution":"…"} -->
<div class="…">                            <blockquote class="…">
  <h3>headline</h3>   ← YOUR attribute       <!-- wp:paragraph -->
  <p>body</p>         ← YOUR attribute       <p>It worked on my machine.</p>
</div>                                       <!-- /wp:paragraph -->   ← A CHILD BLOCK
<!-- /wp:btt/incident-callout -->          </blockquote>
                                           <!-- /wp:btt/blame-quote -->
your save() emits the prose               your save() emits the WRAPPER only.
                                           The child serialises itself.
```

| | Attributes | `InnerBlocks` |
|---|---|---|
| Right when | the shape is fixed and small: a headline, a severity, a slug | the content is open-ended: paragraphs, lists, an image, in an order the editor chooses |
| Editor gets | the controls you wrote | the whole block editor, recursively |
| Your `save()` emits | the content | a wrapper, plus `<InnerBlocks.Content />` |
| GraphQL shape (Module 14) | typed attributes on one node | a **parent node plus child nodes**, related by `parentClientId` |
| Cost | you reimplement text editing badly | you cannot type or constrain the content, only the *set of allowed blocks* |
| Migration cost later | a `deprecated` entry | usually none — children are not your markup |

`btt/blame-quote` is `InnerBlocks` because a quote is a paragraph, or two paragraphs, or a
paragraph and a list, and there is no version of "type the quote into a `RichText`" that does
not eventually need the thing `core/paragraph` already does. `attribution` stays an attribute
because it is one line of plain text and a decision about provenance.

> **The Module 14 consequence is the one to hold on to.** An `InnerBlocks` block arrives from
> WPGraphQL as a **flat list** with parent pointers, not as a nested object, and
> `BlockRenderer.tsx` rebuilds the tree and passes each block's rendered children in as a
> `children` prop. So `BlameQuote.tsx` will render `{ children }` and the attribution, and will
> never know or care what the children are. Designing with `InnerBlocks` is designing for that.

### 2. `allowedBlocks`, `template`, `templateLock` — three different constraints

These three are routinely confused because they all sound like "restrict the inner area". They
constrain different things and live in different places.

| | What it constrains | Where it goes | This block |
|---|---|---|---|
| `allowedBlocks` | which block types may **ever** appear inside | `block.json` (static metadata, since WP 6.5) or a prop | `[ "core/paragraph", "core/list" ]` |
| `template` | what is **pre-inserted** when the block is first added | a prop on `<InnerBlocks>` — it is initial state, not a rule | one empty `core/paragraph` |
| `templateLock` | whether the editor may insert, remove or move children | a prop, or `block.json`'s `templateLock` | **`false`** |

`templateLock`'s values, and why the choice matters:

| Value | Insert | Remove | Move | Edit content |
|---|---|---|---|---|
| `'all'` | ✗ | ✗ | ✗ | ✓ |
| `'insert'` | ✗ | ✗ | ✓ | ✓ |
| `'contentOnly'` | ✗ | ✗ | ✗ | ✓ — and the child blocks' own settings disappear |
| `false` | ✓ | ✓ | ✓ | ✓ |
| *omitted* | **inherits from the nearest locked ancestor** | | | |

Choose **`false`, written explicitly**, and the reason is the last row rather than any of the
others. Omitting `templateLock` does not mean "unlocked"; it means "whatever my parent says". A
`blame-quote` dropped inside a locked pattern or a `contentOnly` group would silently refuse to
accept a second paragraph, and the editor's only feedback is a missing `+` button. Writing
`false` opts out of inheritance and makes the block behave the same wherever it is placed.

The cost of `false`, stated plainly: an editor can delete the paragraph and leave an empty
quote, and `save()` will happily serialise
`<blockquote class="wp-block-btt-blame-quote"></blockquote>`. Module 14's component therefore
has to render nothing rather than an empty decorated box. That is a cheaper problem than a lock
that fires in the wrong context.

### 3. `<InnerBlocks.Content />` — the one-line omission that eats content

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/save.js — (illustration)
<blockquote { ...useBlockProps.save() }>
	<InnerBlocks.Content />       {/* ← forget this and the children vanish */}
</blockquote>
```

`<InnerBlocks.Content />` is a placeholder the serialiser replaces with the serialised child
blocks. Leave it out and:

1. `save()` emits `<blockquote class="wp-block-btt-blame-quote"></blockquote>`.
2. On save, that is what goes into `post_content`. **The children are gone from the database.**
3. On reload, the block is valid — your `save()` and the storage agree perfectly.
4. There is no warning, no console message, and no undo. The content is simply not there.

This is the most destructive mistake in this lesson and it produces no error of any kind,
because from the validator's point of view nothing is wrong. It is also why the Verification
block below asserts `grep -c 'InnerBlocks.Content' src/blame-quote/save.js` is exactly `1`: a
mechanical check is the only defence against a silent one-line omission.

> **Where this breaks in the editor and not in `save()`:** the same shape exists on the `edit`
> side. If `edit` renders `<InnerBlocks />` **outside** the element that received
> `useBlockProps()`, the editor renders the children but the block's own toolbar, selection
> outline and appender attach to the wrong element. It looks almost right, which is worse than
> looking wrong.

### 4. `InspectorControls`, inline controls, `BlockControls` — a placement rule

Three places a control can go, and editors judge your block on whether you chose correctly.

```
 ┌─ BlockControls ────────────────────────────────────────────────┐
 │  the floating toolbar above the selected block                 │
 │  → verbs. Alignment, transforms, "replace image". Few, iconic. │
 └────────────────────────────────────────────────────────────────┘
 ┌─ the block itself (inline) ───────────┐ ┌─ InspectorControls ──┐
 │  content the editor reads while        │ │  the right sidebar  │
 │  writing: RichText, the thing being    │ │  → settings. Nouns. │
 │  edited                                │ │  Set once, forgotten│
 └────────────────────────────────────────┘ └─────────────────────┘
```

The rule, and it is not a matter of taste: **if the value is content, it goes inline; if it is
configuration, it goes in the inspector; if it is a verb, it goes in the toolbar.** Applied to
this lesson:

| Control | Placement | Why |
|---|---|---|
| the quote text | inline, as child blocks | it is the content |
| `attribution` | **inline**, under the quote | it reads as part of the quote. An attribution you cannot see while writing the quote is an attribution people forget to set |
| `severity` (13.2) | inspector | a classification, set once |
| `incidentSlug` (13.2) | inspector | a reference, set once |
| `termId` (this lesson) | **inspector** | configuration: which scapegoat this block points at. The canvas shows the *result* |
| `count`, `severities` (13.4) | inspector | query parameters |

`btt/blame-quote` and `btt/scapegoat-picker` land on opposite sides of that rule, which is why
they are in the same lesson.

### 5. `@wordpress/data` — four stores, and what each one knows

`@wordpress/data` is a Redux-shaped registry of independent stores. You read with `select`,
write with `dispatch`, and in React you use the `useSelect` / `useDispatch` hooks so your
component re-renders when what it read changes.

| Store descriptor | Import | Knows about |
|---|---|---|
| `core` | `import { store as coreStore } from '@wordpress/core-data'` | **entities**: posts, pages, terms, taxonomies, users, media, site settings. Everything that has a REST endpoint |
| `core/editor` | `@wordpress/editor` | the post *being edited*: `getCurrentPostId()`, `getEditedPostAttribute()`, `isSavingPost()`, dirty state |
| `core/block-editor` | `@wordpress/block-editor` | the **block tree**: `getBlocks()`, `getSelectedBlockClientId()`, `getBlockParents()`, `canInsertBlockType()` |
| `core/blocks` | `@wordpress/blocks` | the **block type registry**: what is registered, its attributes, its categories |

Use the **store descriptor object**, not the string `'core'`. Both work; the object is
importable, so a typo is a build error rather than `select` returning `undefined` and your
component crashing on `undefined.getEntityRecords`. That failure mode is common enough to be
worth the extra import line.

The mental correction most Classic developers need: `select( coreStore ).getEntityRecords(…)` is
**not a function call that fetches**. It is a synchronous read of a cache, plus a side effect
that starts a fetch if the cache is cold. It returns `undefined` immediately, the fetch
resolves, the store updates, and your component re-renders with data. Nothing is awaited and
there is no promise to hold.

### 6. `getEntityRecords` returns three different things, and two of them look the same

```
first render                fetch in flight              resolved, 10 terms
────────────────            ──────────────               ──────────────────
getEntityRecords → undefined                             → [ {…}, {…}, … ]
hasFinishedResolution → false                            → true

                            resolved, 0 terms
                            ──────────────────
                            getEntityRecords → []
                            hasFinishedResolution → true
```

Three states, and the bug this lesson exists to prevent is collapsing the first two into one:

| State | `getEntityRecords` | `hasFinishedResolution` | Render |
|---|---|---|---|
| **Loading** | `undefined` | `false` | a `<Spinner />` |
| **Genuinely empty** | `[]` | `true` | a `<Notice>` saying the taxonomy has no terms and how to fix it |
| **Loaded** | `Term[]` | `true` | the picker |

`undefined` and `[]` are both falsy, so `terms?.length ? picker : spinner` shows a spinner
forever on a site with no terms — and "forever loading" is the least diagnosable state a UI can
be in. The distinguishing read is the resolution status:

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/edit.js — (illustration)
const QUERY = { per_page: 100, orderby: 'name', order: 'asc' };
const ARGS = [ 'taxonomy', 'scapegoat', QUERY ];

const { terms, hasResolved } = useSelect( ( select ) => {
	const store = select( coreStore );
	return {
		terms: store.getEntityRecords( ...ARGS ),
		// 1. The selector NAME as a string, then that selector's arguments.
		hasResolved: store.hasFinishedResolution( 'getEntityRecords', ARGS ),
	};
}, [] );
```

`hasFinishedResolution` takes the selector's *name* and the *same arguments*, and matches on a
serialisation of those arguments. If the query object you pass to `getEntityRecords` is not the
same value you pass to `hasFinishedResolution`, the two calls describe different requests and
the flag is meaningless. Declaring both at module scope, once, removes the possibility.

The empty state is not hypothetical here. `scapegoat` terms are seeded by
`blame-the-tech-core`'s activation hook, so a site where that plugin was deactivated and
reactivated without the seed, or a fresh install someone is following along on, genuinely has
zero terms. A `<Notice>` that says which plugin creates them turns a mystery into a sentence.

### 7. `useSelect`'s dependency array, and the infinite re-render

`useSelect( mapSelect, deps )` behaves like `useMemo`: `mapSelect` is re-subscribed whenever
`deps` change by reference. Two things follow.

**The result is compared shallowly, so returning an object is fine.** `useSelect` runs
`mapSelect` when the store changes and only re-renders if the returned object differs by shallow
equality. Returning `{ terms, hasResolved }` is idiomatic and does not cause a render per store
event.

**A new object or array *in the deps* is a new dependency on every render.** This is the loop:

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/edit.js — (illustration of the bug; do not write this)
const query = { per_page: 100 };                    // 1. new object every render
const terms = useSelect(
	( select ) => select( coreStore ).getEntityRecords( 'taxonomy', 'scapegoat', query ),
	[ query ]                                        // 2. deps change every render
);                                                   // 3. re-subscribe → re-render → 1.
```

Symptom: the editor becomes unusable, the browser pins a core, and the console fills with
nothing in particular. Fix: hoist the object to module scope, or `useMemo` it. In this codebase
the query is a constant, so module scope is the honest answer and `useMemo` would be ceremony.

> **`[]` is the right dependency array here, and it is not laziness.** The query never changes,
> so there is nothing to depend on. If a control let the editor change the query, the changing
> value goes in `deps` — and the object it lives in gets memoised.

### 8. Store the ID, not a copy — the argument, with the walkthrough

`btt/scapegoat-picker` stores exactly one attribute: `termId`, a `number`. Not the name, not the
slug, not the tagline, not the avatar URL. The temptation to store more is strong, because
copying the name into the block would make Module 14's job a single field read.

Here is the walkthrough that settles it. Suppose the block stored
`{ termId: 4, termName: "The Intern" }`, and forty published posts use it. An editor renames the
term to "The Intern (2019–2024)".

```
STORING A REFERENCE                        STORING A COPY
──────────────────────────────────         ─────────────────────────────────────────
wp term update scapegoat 4 --name=…        wp term update scapegoat 4 --name=…
        │                                          │
        ▼                                          ▼
wp_terms.name changes                      wp_terms.name changes
        │                                          │
        ▼                                  post_content still says "The Intern" in
every consumer resolves 4 → the new        FORTY posts. Each one is a separate
name on its next read. Editor and          longtext column. There is no query that
front end agree immediately.               finds them, no way to know they are stale,
                                           and re-saving each post in wp-admin is the
                                           only fix — which regenerates the markup and
                                           risks the validator on every one of them.
```

The cost of the correct choice, stated plainly: **the front end now needs a second read.**
`ScapegoatPicker` in Lesson 14.4 gets a `termId` and has to ask WPGraphQL for that term's name,
tagline and avatar, which is an extra query with its own cache tag. That is a real cost, it is
paid once in one component, and it is bounded. The other choice's cost is unbounded and lands on
the editor who renamed a term innocently.

This is the same argument that made `scapegoat` a taxonomy rather than an SCF text field in
[appendix 03 §2](../appendix/03-content-model-reference.md#why-these-are-taxonomies-and-not-acf-fields):
classification belongs in one row that everything points at. A block that copies the label out
of that row re-introduces exactly the duplication the taxonomy decision removed.

> **The attribute is named `termId`, and that is fixed.** The seeder in Lesson 04.5 already
> writes `<!-- wp:btt/scapegoat-picker {"termId":4} /-->` into `blog-01`, `blog-02` and the
> `hobt` page, and Lesson 07.4's hand-written union already types
> `BlockOf<'BttScapegoatPicker', { readonly termId: number | null }>`. Two lessons and a fixture
> depend on the name. `termId` it is.

Storing an ID has one honest weakness worth naming, because Lesson 12.4 already named it: **IDs
are a property of a table's history, not of its content.** `termId: 4` means "The Intern" on
your machine and something else on a colleague's, which is why the seeder resolves the id from
the slug at seed time rather than hard-coding `4`. In application data an id reference is right;
in a *fixture* it is a hazard, and the seeder handles it.

### 9. Why REST is correct here and wrong on the front end

This block calls the WordPress REST API — `useSelect` on `core` is a REST client with a cache in
front of it — in a course whose whole architecture rests on the front end never touching REST.
Both are true, because they are two different clients.

| | The block editor (`useSelect` on `core`) | The public front end (`next-app`) |
|---|---|---|
| Who is asking | an authenticated `editor` or `administrator` | an anonymous visitor, or the Next server on their behalf |
| Origin | wp-admin, same-origin | a different origin entirely |
| Credentials | the WordPress auth cookie plus a REST nonce, already present | nothing that WordPress recognises |
| Surface exposed | REST, which the editor cannot function without | **none** — the browser never learns the WordPress origin exists |
| Cost of a new endpoint | zero; it is already there | a CORS policy, a rate limit and an auth story |
| Caching | the editor's own store, per session | Next's data cache with tags, shared across users |

So the rule is not "REST is bad". The rule is **"the browser on the public site never talks to
WordPress"**, which is why
[appendix 03 §8](../appendix/03-content-model-reference.md#8-plugin-inventory) deliberately does
*not* install WPGraphQL CORS: there is no GraphQL endpoint in the client bundle, therefore no
CORS policy to get wrong. wp-admin is not the public site. It is an authenticated administrative
application that WordPress ships, and reimplementing its data layer over GraphQL to satisfy a
rule about a different threat model would be dogma, not engineering.

### 10. `setAttributes` merges, and it writes to the undo stack

`setAttributes({ termId: 7 })` is a **shallow merge** into the block's attributes, not a
replace. The other attributes are untouched. So there is never a reason to spread the old
attributes in:

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/edit.js — (illustration)
setAttributes( { termId: 7 } );                        // ✅ merges
setAttributes( { ...attributes, termId: 7 } );         // ❌ works, and is noise
setAttributes( { severities: [ ...severities, s ] } ); // ✅ the ARRAY still needs a new array
```

The merge is shallow, which is the catch in the third line: replacing one element of an array
attribute means handing `setAttributes` a whole new array. Mutating the existing one and calling
`setAttributes` with it changes nothing the store can detect.

Every call also creates an entry in the editor's undo history, and the editor coalesces rapid
successive changes to the same attribute into one undo level so that typing does not produce one
undo step per keystroke. Two consequences worth knowing:

- **Ctrl-Z inside a block is a document-level undo.** It can undo an attribute change, a child
  block insertion, or a paragraph edit three blocks away, in strict chronological order. There
  is no per-block undo.
- **Never call `setAttributes` from an effect on mount.** A block that "fixes up" its own
  attributes when it loads marks a freshly-opened post as dirty, so the editor warns about
  unsaved changes on a post the user only looked at, and a `deprecated` migration (Lesson 13.5)
  is the correct mechanism instead. If you catch yourself normalising attributes in a
  `useEffect`, you are writing a migration in the wrong place.

---

## Task

### Step 1: Declare `btt/blame-quote`

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "btt/blame-quote",
  "version": "0.1.0",
  "title": "Blame Quote",
  "category": "btt",
  "description": "A quote from whoever was closest to the outage, with an attribution.",
  "keywords": ["quote", "blame", "blockquote"],
  "textdomain": "blame-the-tech-blocks",
  "attributes": {
    "attribution": {
      "type": "string",
      "default": ""
    }
  },
  "allowedBlocks": ["core/paragraph", "core/list"],
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

Path:
`wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/block.json`.
`allowedBlocks` lives here because it is static metadata about the block type; `template` and
`templateLock` are runtime props and go in `edit.js`. Two blocks are allowed, deliberately:
a quote is paragraphs, and occasionally a list. Not an image, not a heading, not a nested
`blame-quote`.

### Step 2: Write `btt/blame-quote`'s editor side

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/index.js
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';
import save from './save';
import './style.scss';

registerBlockType( metadata.name, { edit: Edit, save } );
```

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/edit.js
import { __ } from '@wordpress/i18n';
import { InnerBlocks, RichText, useBlockProps } from '@wordpress/block-editor';

// Module scope, not inline: a new array every render would reset the template.
// This is INITIAL STATE, not a constraint — the editor may delete it.
const TEMPLATE = [ [ 'core/paragraph', { placeholder: 'It worked on my machine.' } ] ];

export default function Edit( { attributes, setAttributes } ) {
	const { attribution } = attributes;
	const blockProps = useBlockProps();

	return (
		<div { ...blockProps }>
			<blockquote className="btt-blame-quote__quote">
				<InnerBlocks
					template={ TEMPLATE }
					// `false`, written out. Omitting it INHERITS the nearest
					// locked ancestor's lock, which is a silent failure inside a
					// locked pattern. Key Concept 2.
					templateLock={ false }
					// Shown when the inner area is empty, so the editor knows the
					// region is theirs.
					renderAppender={ InnerBlocks.ButtonBlockAppender }
				/>
			</blockquote>

			{ /* INLINE, not the inspector: an attribution you cannot see while
			     writing the quote is an attribution people forget. Key Concept 4. */ }
			<RichText
				identifier="attribution"
				tagName="figcaption"
				className="btt-blame-quote__attribution"
				value={ attribution }
				onChange={ ( value ) => setAttributes( { attribution: value } ) }
				allowedFormats={ [] }
				placeholder={ __( 'Who said it?', 'blame-the-tech-blocks' ) }
			/>
		</div>
	);
}
```

> **The `edit` tree and the `save` tree are different shapes here, on purpose.** `edit` wraps a
> `<div>` around the quote and an editable attribution so the editor can see and type both.
> `save()` emits a bare `<blockquote>` and no attribution at all. That is legal — only `save()`
> is compared against storage — and it is the frozen contract: the attribution is an attribute,
> and Module 14 renders it. Writing a `<cite>` into `save()` would put the same string in two
> places and break every seeded post.

### Step 3: Write `btt/blame-quote`'s `save()` and stylesheet

Match the seeded fixture exactly: a `<blockquote>` carrying only the generated class, containing
the serialised children and nothing else.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/save.js
import { InnerBlocks, useBlockProps } from '@wordpress/block-editor';

export default function save() {
	// NO <cite>, and no attribution anywhere in this markup. The attribution is
	// an attribute; Lesson 14.4's BlameQuote renders it. Emitting it here would
	// duplicate state AND invalidate blog-01, blog-02 and the hobt page.
	//
	// <InnerBlocks.Content /> is the placeholder the serialiser swaps for the
	// children. Omit it and the children are deleted from the database with no
	// warning of any kind. Key Concept 3.
	return (
		<blockquote { ...useBlockProps.save() }>
			<InnerBlocks.Content />
		</blockquote>
	);
}
```

```scss
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/style.scss
//
// Editor-facing. Next renders this block from `attribution` plus its children.
// The two BEM-ish class names below exist only in the editor tree, because
// save() emits neither of them — which is exactly why they are safe to rename.

.wp-block-btt-blame-quote {
	border-left: 4px solid #0f172a;
	padding-left: 1rem;

	.btt-blame-quote__quote {
		margin: 0;
		font-style: italic;
	}

	.btt-blame-quote__attribution {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: #475569;

		&::before {
			content: '— ';
		}
	}
}
```

### Step 4: Declare `btt/scapegoat-picker`

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "btt/scapegoat-picker",
  "version": "0.1.0",
  "title": "Scapegoat Picker",
  "category": "btt",
  "description": "Point at a scapegoat term. Stores the term ID only; the front end resolves the rest.",
  "keywords": ["scapegoat", "blame", "taxonomy"],
  "textdomain": "blame-the-tech-blocks",
  "attributes": {
    "termId": {
      "type": "number",
      "default": 0
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
    "reusable": false,
    "multiple": true
  },
  "editorScript": "file:./index.js",
  "editorStyle": "file:./index.css"
}
```

Two of those keys are different from the previous two blocks and each has a reason.
`editorStyle` rather than `style`, because there is no front-end markup to style, and
`editorStyle` is compiled from `editor.scss` into `index.css`. `reusable: false` because a
reusable block is a pointer to shared content, and a pointer to a pointer is a support ticket.

`className` stays **`true`**, and the reasoning is worth spelling out because the obvious answer
is wrong. `save()` returns `null`, so there is no saved element for a class to land on — which
makes `className: false` look tidy. But `useBlockProps()` in `edit` only emits
`wp-block-btt-scapegoat-picker` when the support is on, so turning it off silently unstyles the
block **in the editor**, which is the only place it is ever visible. The class is not front-end
presentation here; it is the hook `editorStyle` selects.

`default: 0` gives `edit` a defined value to work with; `0` is the "nothing chosen yet" state
and no real term ever has it.

### Step 5: Write `btt/scapegoat-picker`'s `edit.js`

This is the `useSelect` in the module, and every state in Key Concept 6 is handled.

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/index.js
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';
import save from './save';
import './editor.scss';

registerBlockType( metadata.name, { edit: Edit, save } );
```

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/edit.js
import { __, sprintf } from '@wordpress/i18n';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { Notice, PanelBody, SelectControl, Spinner } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

// MODULE SCOPE. A new object literal per render would be a new dependency per
// render, and useSelect would re-subscribe forever. Key Concept 7.
const QUERY = { per_page: 100, orderby: 'name', order: 'asc' };

// The SAME value goes to getEntityRecords and to hasFinishedResolution.
// Different values describe different requests and the flag becomes a lie.
const ARGS = [ 'taxonomy', 'scapegoat', QUERY ];

export default function Edit( { attributes, setAttributes } ) {
	const { termId } = attributes;
	const blockProps = useBlockProps();

	const { terms, hasResolved } = useSelect( ( select ) => {
		const store = select( coreStore );

		return {
			// Synchronous read of a cache. Returns undefined and STARTS a fetch.
			terms: store.getEntityRecords( ...ARGS ),
			// The selector's NAME, then its arguments.
			hasResolved: store.hasFinishedResolution( 'getEntityRecords', ARGS ),
		};
	}, [] );

	// 1. LOADING — undefined and unresolved. Distinguishable from empty only
	//    because of hasResolved.
	if ( ! hasResolved && undefined === terms ) {
		return (
			<div { ...blockProps }>
				<Spinner />
				{ __( 'Loading scapegoats…', 'blame-the-tech-blocks' ) }
			</div>
		);
	}

	// 2. GENUINELY EMPTY — resolved, and there is nothing. Say which plugin
	//    creates the terms; "no options" with no explanation is a dead end.
	if ( hasResolved && 0 === ( terms?.length ?? 0 ) ) {
		return (
			<div { ...blockProps }>
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'No scapegoat terms exist. They are seeded by blame-the-tech-core on activation — see appendix 03 §2.',
						'blame-the-tech-blocks'
					) }
				</Notice>
			</div>
		);
	}

	// 3. LOADED.
	const selected = terms.find( ( term ) => term.id === termId );

	const options = [
		{ value: 0, label: __( '— Choose a scapegoat —', 'blame-the-tech-blocks' ) },
		...terms.map( ( term ) => ( { value: term.id, label: term.name } ) ),
	];

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Scapegoat', 'blame-the-tech-blocks' ) }>
					<SelectControl
						__nextHasNoMarginBottom
						label={ __( 'Blame', 'blame-the-tech-blocks' ) }
						value={ termId }
						options={ options }
						// SelectControl hands back a string. The attribute is
						// declared `number`, and nothing coerces for you.
						onChange={ ( value ) => setAttributes( { termId: Number( value ) } ) }
						help={ __(
							'Only the term ID is stored. Renaming the term updates every post that points at it.',
							'blame-the-tech-blocks'
						) }
					/>
				</PanelBody>
			</InspectorControls>

			{ /* save() returns null, so this is the ONLY visible representation of
			     the block anywhere in WordPress. It has to be readable, or the
			     block is an invisible thing an editor cannot select. */ }
			<div { ...blockProps }>
				{ selected
					? sprintf(
							/* translators: 1: term name, 2: number of incidents. */
							__( 'Blaming %1$s (%2$d incidents)', 'blame-the-tech-blocks' ),
							selected.name,
							selected.count ?? 0
						)
					: __( 'No scapegoat chosen — pick one in the sidebar.', 'blame-the-tech-blocks' ) }
			</div>
		</>
	);
}
```

**Verify §5:**

- [ ] The watcher rebuilt with no ESLint error. `wp-scripts` lints on build; an unused import
      here fails the Lesson 13.5 lint gate later, so fix it now.
- [ ] `build/scapegoat-picker/index.asset.php` lists `wp-core-data` and `wp-data` among its
      dependencies. Those handles appeared because of the two new imports, automatically. That
      is the dependency extraction plugin from Lesson 13.1 Key Concept 6 doing its job.

### Step 6: Write the `save()` that returns `null`, then build

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/save.js
//
// Returning null means: serialise the comment with its attributes, and emit NO
// markup. The stored form is the self-closing
//     <!-- wp:btt/scapegoat-picker {"termId":4} /-->
//
// This is NOT the same thing as a "dynamic block". Dynamic means PHP runs at
// render time, and this block has no render.php and no render_callback — so
// `the_content()` prints nothing for it at all. That is exactly right when a
// React front end owns the rendering: the block is a piece of structured data
// in the document, and Lesson 14.4 is what turns it into pixels.
//
// Lesson 13.4 builds btt/incident-ticker, which ALSO returns null and DOES have
// a render.php, and contrasts the two.
export default function save() {
	return null;
}
```

```scss
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/editor.scss
//
// `editor.scss` compiles to index.css and is enqueued by block.json's
// `editorStyle`. It is the right file here because there is no saved markup at
// all — a `style` stylesheet would have nothing to select.

.wp-block-btt-scapegoat-picker {
	padding: 0.5rem 0.75rem;
	border: 1px dashed #94a3b8;
	border-radius: 0.25rem;
	font-size: 0.875rem;
	color: #334155;
}
```

Then rebuild if the watcher is not running:

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks
npm run build
```

### Step 7: Insert both, then prove the reference resolves

Open the `block-scratchpad` draft from Lesson 13.2 in wp-admin and:

1. Insert **Blame Quote**. A paragraph is pre-inserted by the template — type into it. Try to
   insert an image inside the quote: the inserter offers only paragraph and list.
2. Add a second paragraph inside the quote. Then type an attribution under it.
3. Insert **Scapegoat Picker**. It shows "No scapegoat chosen". Open the sidebar and choose
   **The Intern**. The canvas now reads `Blaming The Intern (N incidents)`.
4. Save the draft.

Now the payoff. Rename the term **without touching any post**:

```bash
cd wordpress-headless
TERM_ID=$(docker compose run --rm -T wpcli wp term list scapegoat \
  --slug=the-intern --field=term_id | tr -d '\r')
echo "the-intern is term $TERM_ID"

docker compose run --rm wpcli wp term update scapegoat "$TERM_ID" \
  --name='The Intern (Redacted)'
```

**Verify §7:**

- [ ] Hard-reload the editor. The block now reads `Blaming The Intern (Redacted) (N incidents)`.
      **You did not re-save the post.** `post_content` still says `{"termId":N}` and always did.
- [ ] Open `blog-01` in the editor. Its `scapegoat-picker` — seeded in Lesson 04.5, pointing at
      the same term — shows the new name too. One rename, every consumer correct. This is Key
      Concept 8 as a thing you watched happen.
- [ ] Put it back, because later lessons and the E2E specs assert the seeded name:

```bash
docker compose run --rm wpcli wp term update scapegoat "$TERM_ID" --name='The Intern'
docker compose run --rm -T wpcli wp term list scapegoat --format=count
```

- [ ] The count is **10**. A rename creates nothing and deletes nothing.

### Step 8: Record the attribute inventory

Append to the section Lesson 13.2 started in `docs/content-model.md`:

```markdown
<!-- docs/content-model.md -->

### `btt/blame-quote` — GraphQL type `BttBlameQuote`

| Attribute | Type | Default | `source` | Lives in | Notes |
|---|---|---|---|---|---|
| `attribution` | `string` | `""` | — | the block comment | plain text. **The front end renders it** — `save()` emits no `<cite>` |

Content is **inner blocks**, not attributes: `core/paragraph` and `core/list` only
(`allowedBlocks`). `save()` emits `<blockquote>` + `<InnerBlocks.Content />`, so the children
serialise themselves and arrive in Module 14 as sibling nodes with a `parentClientId`.
`templateLock: false`, written explicitly, so the block does not inherit an ancestor's lock.

### `btt/scapegoat-picker` — GraphQL type `BttScapegoatPicker`

| Attribute | Type | Default | `source` | Lives in | Notes |
|---|---|---|---|---|---|
| `termId` | `number` | `0` | — | the block comment | a `scapegoat` term ID. `0` means "not chosen" |

`save()` returns `null`, so the serialised form is the self-closing comment and the block
contributes **no HTML** to `post_content`. It is not a dynamic block: no `render.php`, no
`render_callback`, so `the_content()` prints nothing for it.

**No denormalised term data is stored** — no name, no slug, no avatar. Lesson 14.4 resolves
`termId` to a term through WPGraphQL and pays one extra query for it. Renaming the term is
therefore correct everywhere immediately; see the walkthrough in Lesson 13.3 Key Concept 8.
```

---

## Verification

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks

# 1. Both blocks compiled
test -f build/blame-quote/block.json && test -f build/scapegoat-picker/block.json && echo "both built"
# Expected: both built

# 2. NEGATIVE — the children placeholder is present exactly once. Omitting it
#    deletes inner blocks from the database with no error, no warning and no undo.
grep -c 'InnerBlocks.Content' src/blame-quote/save.js
# Expected: 1

# 3. NEGATIVE — and save() emits no <cite> and no attribution
grep -cE 'cite|attribution' src/blame-quote/save.js
# Expected: 0
#           A hit here invalidates blog-01, blog-02 and the hobt page at once.

# 4. The inner area is constrained, and the lock is explicit rather than inherited
grep -c 'allowedBlocks' src/blame-quote/block.json
# Expected: 1
grep -c 'templateLock={ false }' src/blame-quote/edit.js
# Expected: 1

# 5. NEGATIVE — scapegoat-picker stores a REFERENCE and nothing else. No copy of
#    the term's name, slug, tagline or avatar anywhere in its declaration.
grep -cE 'termName|termSlug|termLabel|avatar|tagline' src/scapegoat-picker/block.json
# Expected: 0
grep -c '"termId"' src/scapegoat-picker/block.json
# Expected: 1

# 6. NEGATIVE — its save() returns null and touches no block props
grep -c 'return null' src/scapegoat-picker/save.js
# Expected: 1
grep -c 'useBlockProps' src/scapegoat-picker/save.js
# Expected: 0

# 7. All three useSelect states are handled, and the resolution status is read
grep -cE 'hasFinishedResolution' src/scapegoat-picker/edit.js
# Expected: 1
grep -cE 'Spinner|Notice' src/scapegoat-picker/edit.js
# Expected: 2 or more
#           Loading and empty must be distinguishable. `terms?.length ? x : spinner`
#           spins forever on a site with no terms. Key Concept 6.

# 8. NEGATIVE — no unstable dependency in the useSelect deps array
grep -cE 'useSelect\(.*\[ *\{' src/scapegoat-picker/edit.js
# Expected: 0
grep -c 'const QUERY' src/scapegoat-picker/edit.js
# Expected: 1   (module scope — Key Concept 7)

# 9. The data-module handles were extracted automatically
grep -oE 'wp-(core-)?data' build/scapegoat-picker/index.asset.php | sort -u | tr '\n' ' '
# Expected: wp-core-data wp-data

cd ../../../..
cd wordpress-headless

# 10. Three btt/ blocks are registered now
docker compose run --rm -T wpcli wp eval '
$n = array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() );
$b = array_values( array_filter( $n, static fn( $x ) => str_starts_with( $x, "btt/" ) ) );
sort( $b );
echo implode( ",", $b ), PHP_EOL;'
# Expected: btt/blame-quote,btt/incident-callout,btt/scapegoat-picker

# 11. THE INNER-BLOCKS PROOF: the seeded quote contains a nested core/paragraph,
#     which means the child serialised ITSELF inside your wrapper.
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' \
  | grep -c '<blockquote class="wp-block-btt-blame-quote"><!-- wp:paragraph -->'
# Expected: 1

# 12. THE NULL-SAVE PROOF: the picker serialises self-closing, with its attribute
#     in the comment and no markup at all.
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' \
  | grep -cE 'wp:btt/scapegoat-picker \{"termId":[0-9]+\} /-->'
# Expected: 1

# 13. The stored ID resolves to a real term — the reference has integrity
docker compose run --rm -T wpcli wp eval '
$c = get_page_by_path( "blog-01", OBJECT, "post" )->post_content;
preg_match( "/scapegoat-picker \{\"termId\":(\d+)\}/", $c, $m );
$t = get_term( (int) ( $m[1] ?? 0 ), "scapegoat" );
echo $t instanceof WP_Term ? $t->slug : "UNRESOLVED", PHP_EOL;'
# Expected: the-intern

# 14. NEGATIVE — a rename created nothing. Ten terms before, ten terms after.
docker compose run --rm -T wpcli wp term list scapegoat --format=count
# Expected: 10
docker compose run --rm -T wpcli wp term list scapegoat --slug=the-intern --field=name
# Expected: The Intern
#           "The Intern (Redacted)" means you skipped the restore in Step 7. Fix it
#           now: Module 12's Playwright specs assert the seeded name.

# 15. NEGATIVE — nothing in post_content changed while the term was renamed
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' \
  | grep -c 'The Intern'
# Expected: 0
#           The term's NAME appears nowhere in any post. That is the whole point of
#           Key Concept 8, and this is the check that proves it.

# 16. NEGATIVE — the front end still has no idea, and still consumes no REST
cd ../next-app
grep -rc 'wp-json\|blame-quote\|scapegoat-picker' src/ 2>/dev/null | grep -v ':0' | head
# Expected: no output. Module 13 changes nothing in next-app, and the front end's
#           REST usage remains zero even though the editor's is now non-zero.
```

Check 15 is the one worth pausing on. The term name is not in `post_content` — not once, in any
post, anywhere. That is why a rename is a one-row update and not a forty-post migration, and it
is the entire argument of Key Concept 8 reduced to a `grep` that returns nothing.

## Control Questions

1. `btt/blame-quote` stores its quote as inner blocks and its attribution as an attribute.
   Explain what would go wrong if you swapped both decisions — quote as a `RichText` attribute,
   attribution as a child `core/paragraph` — naming one concrete failure for each.
2. `templateLock` is written as `false` rather than omitted. Describe the situation in which
   omitting it produces different behaviour, and say what the editor sees when that happens.
3. A colleague writes `terms?.length ? <Picker /> : <Spinner />` and it works on their machine.
   Name the two distinct site states that render a spinner under that code, say which one is a
   bug, and give the one selector call that separates them.
4. `scapegoat-picker` stores `termId` and not `termName`. State the cost this imposes on Lesson
   14.4, and then state the cost the other choice would impose on an editor who renames a term
   that forty published posts point at. Say which cost is bounded.
5. This block reads the WordPress REST API, in a course whose front end never does. Give the
   property of the *caller* — not of REST — that makes one correct and the other not, and name
   the plugin appendix 03 §8 deliberately does not install because of it.

## Learn More

- [`InnerBlocks`](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-edit-save/#innerblocks) — the `template`, `templateLock`, `allowedBlocks` and `renderAppender` props in one place
- [Nested blocks and `useInnerBlocksProps`](https://developer.wordpress.org/block-editor/how-to-guides/block-tutorial/nested-blocks-inner-blocks/) — the hook form, which you will meet in other people's blocks even though this course uses the component form
- [`@wordpress/data`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-data/) — `useSelect`, `useDispatch`, and the argument for store descriptors over strings
- [`@wordpress/core-data`](https://developer.wordpress.org/block-editor/reference-guides/data/data-core/) — every entity selector, including `getEntityRecords`, `hasFinishedResolution` and `isResolving`
- [Entity records and the resolution lifecycle](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-core-data/) — read this before you write your second `useSelect`; it is the page that explains the `undefined`-then-data pattern
- [`InspectorControls` and control placement](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-block-editor/#inspectorcontrols) — the slot itself, plus `BlockControls` for comparison
- [`@wordpress/components` control gallery](https://wordpress.github.io/gutenberg/?path=/docs/components-selectcontrol--docs) — `SelectControl`'s real props and the `__next*` opt-ins, rendered so you can click them
- [WordPress REST API: terms](https://developer.wordpress.org/rest-api/reference/categories/) — the endpoint `getEntityRecords( 'taxonomy', 'scapegoat', … )` is actually calling, including `per_page`'s ceiling of 100
- [Undo, redo and persistent changes](https://developer.wordpress.org/block-editor/reference-guides/data/data-core-block-editor/) — the block-editor store's history selectors, for when Key Concept 10's "do not `setAttributes` in an effect" stops being enough
