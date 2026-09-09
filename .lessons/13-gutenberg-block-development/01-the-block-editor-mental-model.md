---
title: 'The Block Editor Mental Model'
module: 13
lesson: 1
teaches: [block-serialization, block-api-v3, wp-scripts, block-registration, editor-as-react-app]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/package.json']
requires: [12.4, 9.2]
---

# Lesson 13.1 — The Block Editor Mental Model

## Quick Overview

Before you write a block, it is worth knowing exactly what one is, because the answer explains
every strange thing the block editor does. A block is **markup already serialised into
`post_content`**, wrapped in an HTML comment that names the block and carries its attributes as
JSON. The post content is still the source of truth, still one `longtext` column, and still what
`the_content()` prints. The editor is a React application that parses those comments into a
normalised JavaScript store, renders a component per block, and re-serialises the whole document
on save.

Two consequences worth internalising now. First, `edit.js` **is a React component** — it takes
props, uses hooks, returns JSX, and obeys everything you learned in Module 08. That is precisely
why this module sits at 13 and not next to Module 03: writing your first React component inside
WordPress's build tooling, with WordPress's data layer, in a plugin, would have been three new
things at once. Second, the toolchain is not the Next.js toolchain. `@wordpress/scripts` owns
the bundler config, resolves `@wordpress/*` imports to the `wp-` globals WordPress already
enqueues, and expects a `src/<block-name>/` layout. Do not try to share code between this
plugin and `next-app`.

By the end of this lesson you will have:

- `wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php` — plugin header registering blocks from the build directory
- `wordpress-headless/wp-content/plugins/blame-the-tech-blocks/package.json` with `@wordpress/scripts`, `build`, `start` and `lint` scripts
- The plugin activated, `npm run start` watching, and an empty `btt` block category visible in the inserter
- A hand-read example of block serialisation: a paragraph and a group inspected as raw `post_content`
- A written note of which WordPress packages are externals rather than bundled dependencies, and why that matters for bundle size

## Classic WP Analogy

You have solved the "structured content inside a post" problem twice before, and blocks are the
third attempt:

| Approach | Where the data lives | Editor UI | Front-end rendering |
|---|---|---|---|
| **Shortcodes** | `[btt_callout source="dns"]` in `post_content` | none — raw text | a PHP callback, at render time |
| **Meta boxes + post meta** | `wp_postmeta` rows | a form beside the editor | template reads `get_post_meta()` |
| **Blocks** | an HTML comment plus markup in `post_content` | a React component, in place | the saved markup, or a PHP callback |

Blocks are closest to shortcodes: both live inline in `post_content`, both carry attributes as
part of the content, and both can be reordered by moving text. The difference is that a
shortcode is opaque until render, while a block stores both the attributes *and* the resulting
markup, which is why a block renders instantly in the editor and a shortcode shows you
`[btt_callout source="dns"]`.

The analogy breaks in three ways that will each cost you an hour if you meet them unprepared.

**Attributes are stored twice, and the copies must agree.** A shortcode has exactly one
representation. A block has the JSON in the comment *and* the rendered markup below it, and on
load WordPress re-runs your `save()` function and compares its output to the stored markup. If
they differ by so much as a class name, you get "this block contains unexpected content"
and the editor offers to convert it to HTML. Nothing in Classic WordPress validates your output
against previously-saved output, and this validator is the single most common source of block
development frustration.

**The editor is a client of the REST API, not of your PHP.** The block editor loads a post over
`/wp-json/wp/v2/…`, holds it in a JavaScript store, and saves it back the same way — which is
why [the content model contract](../appendix/03-content-model-reference.md#1-post-types)
requires `show_in_rest => true` on every post type even though this is a headless build. A post
type with REST disabled has no working editor, and the symptom is a white screen rather than a
useful error.

**Nothing here renders your front end.** This is the headless-specific break, and it is the one
to keep in mind for the next five lessons. In a Classic build, the markup `save()` produces
*is* what visitors see, so `style.scss` matters and getting the class names right matters. Here,
Next.js will read the **attributes** and render its own components — Module 14 — so `save()`'s
markup exists only to keep the editor and `the_content()` happy. That is not a reason to be
sloppy with it, but it does change what you optimise for.

---

## Key Concepts

### 1. A block is `post_content` you can read with your eyes

Open the database, look at `wp_posts.post_content`, and every block is right there in plain
text. No join, no serialised PHP array, no separate table. This is the single fact that makes
the rest of the block editor comprehensible, so spend a minute on it before you write anything.

Here is one block from the seeded `blog-01`, annotated:

```
<!-- wp:btt/incident-callout {"incidentSlug":"incident-01","severity":"s1-catastrophic"} -->
└─────┬────┘ └───────┬───────┘ └──────────────────────────┬──────────────────────────────┘
      │              │                                    │
      │              │                                    └─ attributes, as a JSON object
      │              └─ the block name: namespace `btt`, block slug `incident-callout`
      └─ an ordinary HTML comment. To every parser that is not WordPress, this is nothing.

<div class="wp-block-btt-incident-callout"><h3>Production is a smoking crater</h3><p>The DNS change was fine in staging.</p></div>
└─ the markup your `save()` function produced, stored verbatim, byte for byte

<!-- /wp:btt/incident-callout -->
└─ the closing delimiter. Everything between the two comments belongs to this block.
```

And here is the other shape a block can take — the **self-closing** form, which is what you get
when `save()` returns `null`:

```
<!-- wp:btt/incident-ticker {"count":5,"severities":["s1-catastrophic","s2-major"]} /-->
                                                                                   └┬┘
   no closing delimiter, no markup, nothing between ────────────────────────────────┘
   The comment IS the entire block. All of its state is the JSON.
```

Three things follow from this, and each one saves you a wrong assumption later:

| Observation | Consequence |
|---|---|
| The comment is an HTML comment | Deactivate the plugin and the *markup* still renders; only the editor loses the ability to edit it |
| Attributes live in the JSON **or** in the markup | Lesson 13.2's `source` key is the choice between those two, and it is a real design decision |
| There is no schema enforcement in the storage layer | `post_content` is a `longtext`. Nothing stops a corrupt attribute value existing. Validation happens at parse time, in JavaScript |

> **This is why blocks are not a database migration.** Adding a block type, renaming an
> attribute, changing markup — none of it touches a table. Every existing post keeps whatever
> string it already had, and your new code has to cope. Lesson 13.5 is the whole lesson on
> coping.

### 2. The five-phase cycle, and the validator that ends it

Everything strange about block development is downstream of this loop.

```
   ┌── 1. PARSE ─────────────────────────────────────────────────────┐
   │  post_content (a string) → the block grammar parser → an array  │
   │  of { name, attributes, innerBlocks, innerHTML } objects        │
   └────────────────────────────┬────────────────────────────────────┘
                                ▼
   ┌── 2. STORE ─────────────────────────────────────────────────────┐
   │  Those objects go into the `core/block-editor` Redux-like store │
   │  keyed by a generated `clientId`. THIS is what the editor edits │
   └────────────────────────────┬────────────────────────────────────┘
                                ▼
   ┌── 3. RENDER ────────────────────────────────────────────────────┐
   │  For each block, run its `edit` React component with the        │
   │  attributes from the store                                      │
   └────────────────────────────┬────────────────────────────────────┘
                                ▼
   ┌── 4. VALIDATE ──────────────────────────────────────────────────┐
   │  Also run its `save()` function. Compare the result against the │
   │  innerHTML that came out of the parser. Differ? → the block is  │
   │  marked invalid and the editor shows a recovery prompt          │
   └────────────────────────────┬────────────────────────────────────┘
                                ▼
   ┌── 5. RE-SERIALISE ──────────────────────────────────────────────┐
   │  On save, walk the store, run every `save()`, wrap each result  │
   │  in its comment delimiters, join, and PUT the whole string back │
   │  over the REST API                                              │
   └─────────────────────────────────────────────────────────────────┘
```

Phase 4 is the one with no Classic WordPress analogue, and it is the source of most block
development frustration. Nothing else in WordPress re-runs your rendering code against
previously-saved output and declares your code wrong when they disagree. The validator is not
being difficult; it is protecting the fact that `post_content` is the source of truth. If your
`save()` has changed and the stored markup has not, one of the two is stale and WordPress
cannot know which.

Two practical rules fall straight out of the diagram:

- **Phase 5 rewrites the whole document, not the block you touched.** Open a post in the editor,
  change one paragraph, save — and every block in that post is re-serialised. A block that is
  invalid at phase 4 and gets "converted to HTML" is now permanently a `core/html` block.
- **Phase 4 runs on load, not on save.** The warning appears when you *open* an old post. You
  will always discover a `save()` change by opening something you wrote last week.

### 3. `block.json` is the one description that both runtimes read

Block API v3 is declarative. `block.json` is metadata, PHP reads it to populate the server-side
registry and the REST/GraphQL schema, JavaScript reads it to know what to register in the
editor, and `@wordpress/scripts` reads it to decide what to compile.

| Key | Type | What it does | Notes for this course |
|---|---|---|---|
| `$schema` | string | Points at the JSON Schema so your editor autocompletes | Always include it. Free correctness. |
| `apiVersion` | number | Which block API contract you are writing against | **`3`** for every block here. Key Concept 4. |
| `name` | string | `namespace/slug`. Globally unique | Always `btt/…`. The namespace becomes `Btt…` in the GraphQL type name. |
| `title` | string | Inserter label | Wrapped in `__()` from Lesson 13.5 onward |
| `category` | string | Inserter grouping | **`btt`** — registered by the filter in Key Concept 8 |
| `description` | string | Inserter tooltip and the block card | Write a real sentence. Editors read it. |
| `keywords` | string[] | Inserter search terms | Cheap discoverability |
| `textdomain` | string | i18n domain for the strings in this block | **`blame-the-tech-blocks`** |
| `attributes` | object | The typed state schema | Lesson 13.2's main subject |
| `supports` | object | Which editor-provided features are on | Lesson 13.5 audits every one |
| `providesContext` / `usesContext` | object / string[] | Implicit data passed down the block tree | Introduced in Lesson 13.4, used in 13.5 |
| `editorScript` | string | Script loaded **only in the editor** | `file:./index.js` — always |
| `script` / `viewScript` | string | Script loaded on the **front end** | Never used in this course. Key Concept 9. |
| `style` / `editorStyle` | string | Stylesheets | `file:./style-index.css` — editor-facing in practice |
| `render` | string | A PHP file executed at render time | Only `btt/incident-ticker` has one |

The `file:./…` prefix is doing something worth noticing: it tells WordPress "this is a path
relative to *this* `block.json`, register the handle for me". Without it you are back to
`wp_enqueue_script()` with a hand-written handle and a hand-maintained dependency array, which
is exactly the ceremony Block API v3 exists to delete.

> **The paths inside `block.json` are relative to the built copy, not the source.**
> `@wordpress/scripts` copies `block.json` from `src/incident-callout/` into
> `build/incident-callout/` alongside the compiled `index.js`, so `file:./index.js` resolves
> correctly *there* and would resolve to nothing in `src/`. This is the mechanical reason the
> plugin registers from `build/`. See [appendix 06 §6](../appendix/06-troubleshooting.md#6-blocks).

### 4. `apiVersion: 3` puts your block inside an iframe

`apiVersion` is not a version number of the block editor. It is which contract your block's
JavaScript is written against, and the practical difference between 2 and 3 is one word:
**iframe**. From v3 the editor canvas is an `<iframe>` with its own `document`.

| | `apiVersion: 2` | `apiVersion: 3` |
|---|---|---|
| Canvas | same document as wp-admin | **a separate iframed document** |
| Editor styles | leak in from wp-admin's stylesheet | must be enqueued into the iframe, which `block.json`'s `style` key handles |
| `document.querySelector` in `edit` | finds admin chrome | finds nothing outside the iframe |
| `window.matchMedia`, `getBoundingClientRect` | measured against the admin viewport | measured against the **iframe** viewport |
| CSS relying on `body.wp-admin` | works | **breaks** |

Choose **`3`**, for every block, without hesitation. It is the current contract, block themes
require it, and the isolation is genuinely better: the canvas renders closer to how the content
will actually render, and admin CSS cannot accidentally style your block. The cost, stated
plainly: any `edit` component that reaches out of its own subtree — a hand-rolled portal, a
global keydown listener, a third-party library that assumes one `document` — stops working, and
the failure is silent rather than loud. Nothing in this module does any of those things, which
is partly why the module is safe to teach at v3 from lesson one.

### 5. `@wordpress/scripts` is an opinionated webpack config with a WordPress-shaped plugin

`wp-scripts` is not a new bundler. It is one npm package that ships:

- a webpack configuration with the loaders a WordPress block needs (Babel with the WordPress
  preset, SCSS, asset handling) already wired;
- `@wordpress/dependency-extraction-webpack-plugin`, which is the interesting part (Key
  Concept 6);
- ESLint, Prettier and Jest configurations, exposed as `lint-js`, `format` and `test-unit-js`;
- an entry-point discovery convention: **every `src/<name>/block.json` is an entry point.**

That last bullet is the whole layout rule:

```
blame-the-tech-blocks/
├── blame-the-tech-blocks.php     ← the only file WordPress finds by itself
├── package.json                  ← @wordpress/scripts, five scripts
├── src/                          ← YOU write here. In git.
│   └── incident-callout/
│       ├── block.json            ← discovered as an entry point
│       ├── index.js              ← calls registerBlockType()
│       ├── edit.js
│       ├── save.js
│       └── style.scss
└── build/                        ← wp-scripts writes here. GITIGNORED.
    └── incident-callout/
        ├── block.json            ← copied across, unchanged
        ├── index.js              ← compiled bundle
        ├── index.asset.php       ← generated dependency manifest
        └── style-index.css       ← compiled from style.scss
```

`build/` being gitignored is a deliberate choice with a cost. The benefit: no compiled artefacts
in review diffs, no merge conflicts in minified JavaScript, and no possibility of a build and a
source disagreeing in a commit. The cost, stated plainly: **a fresh clone has no blocks until
someone runs `npm run build`**, and the symptom is "the plugin is active and the inserter is
empty", which looks like a registration bug and is not. That is why the bootstrap in this
lesson guards `register_block_type()` with `is_dir()` — an unbuilt plugin degrades to "no
blocks" instead of a fatal error, and Module 24's deploy runs the build as a step.

### 6. Externals: your bundle is kilobytes, and that is why sharing code with `next-app` is a category error

Write this in `edit.js`:

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/edit.js — (illustration)
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
```

and `@wordpress/dependency-extraction-webpack-plugin` compiles it to roughly this:

```js
// build/incident-callout/index.js — (illustration of the compiled output)
const { registerBlockType } = wp.blocks;
const { useBlockProps } = wp.blockEditor;
```

The packages are **not bundled**. They are rewritten to the `wp.*` globals that WordPress
already enqueues, and the plugin emits a manifest naming the script handles it now depends on:

```php
// build/incident-callout/index.asset.php — (illustration; generated, never hand-written)
<?php return array(
	'dependencies' => array( 'wp-block-editor', 'wp-blocks', 'wp-components', 'wp-element', 'wp-i18n' ),
	'version'      => 'a1b2c3d4e5f6',
);
```

`register_block_type()` reads that file and passes the array straight to
`wp_enqueue_script()`'s `$deps`. Two consequences:

| Consequence | Why it matters |
|---|---|
| Your bundle is a few kilobytes, not 140 KB | React, the editor components and the data layer are already on the page. Bundling a second React would break hooks outright. |
| The React on the page is **WordPress's** React | Its version is whatever WordPress core ships. You do not choose it, you cannot upgrade it independently, and `wp.element` is not literally the `react` package. |
| `version` is a content hash | Cache-busting for free; no `filemtime()` and no manual bump. |

Now the argument the module README makes twice. `next-app` resolves `react` from its own
`node_modules`, on its own version, bundled by Turbopack, with `@/…` path aliases, TypeScript,
its own ESLint config and Vitest. `blame-the-tech-blocks` resolves `@wordpress/*` to globals
that only exist inside wp-admin, bundled by webpack, in JavaScript, with the WordPress ESLint
config and Jest. A module imported into both would need to satisfy both dependency graphs at
once, and the moment it touches React it is running against two different Reacts. **This is not
a "we chose not to" — it is a category error.** Share *data shapes* by writing them down (that
is what `docs/content-model.md` and appendix 03 are for), never by importing.

> **`teaches: editor-as-react-app` cuts both ways.** `edit.js` is a React component and every
> hook rule from Module 08 applies to it. It is not a *Next.js* React component, and nothing
> you learned about Server Components, `async` components or `next/link` applies inside
> wp-admin. Two React applications, one skill, zero shared code.

### 7. Two registries, two registration calls, one description

A block has to be registered twice, in two languages, and learners routinely do one and wonder
why half of it works.

| | `register_block_type()` (PHP) | `registerBlockType()` (JS) |
|---|---|---|
| Runs on | `init`, every request | editor load only |
| Populates | `WP_Block_Type_Registry` | the editor's client-side block type store |
| Gives you | the block in the REST/GraphQL schema, server-side `render` execution, `the_content()` rendering, `parse_blocks()` metadata | the inserter entry, the `edit` component, the `save` function, the icon |
| If you skip it | the editor shows the block but WPGraphQL Content Blocks cannot type it, and `render.php` never executes | `WP_Block_Type_Registry` knows the block, the editor does not, and every instance renders as "your site does not include support for this block" |
| Reads | `block.json` | `block.json` (imported from `./block.json`) |

The healthy mental model: `block.json` is the contract, and the two calls are two runtimes
subscribing to it. In this plugin the PHP call is a loop over one constant array, written once,
in this lesson; the JS call lives in each block's `index.js` and gets written per block from
Lesson 13.2 onward. Since PHP registers from `build/` and each `build/<slug>/index.js` is the
compiled JS that calls `registerBlockType()`, both halves are driven by the same directory.

> **Where this breaks:** `wp eval` and WP-CLI bootstrap PHP only. A `wp eval` check can
> therefore prove the PHP registry is correct while the editor is still completely broken. Both
> halves need their own check, and the Verification block below has one of each.

### 8. Block categories, and the editor as a REST client

The inserter groups blocks into categories, and the list of categories is a filterable PHP
array. Registering `btt` costs four lines and buys you every custom block in one labelled group
instead of scattered through "Widgets":

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php — (illustration; the Task writes the real file)
add_filter(
	'block_categories_all',
	static function ( array $categories ): array {
		array_unshift( $categories, array( 'slug' => 'btt', 'title' => 'Blame The Tech', 'icon' => null ) );
		return $categories;
	}
);
```

`array_unshift` rather than `array_push` because the inserter shows categories in array order,
and the blocks an editor of this site reaches for most often are ours. `icon => null` is
deliberate: a category icon is decoration, and a wrong one is worse than none.

The filter is `block_categories_all` and not the older `block_categories`, which was deprecated
in WordPress 5.8 because it only received a `WP_Post` and therefore could not describe
categories for the site editor. If you find a tutorial using `block_categories`, it predates
that and is probably wrong about other things too.

The reason a *PHP* filter changes what a *JavaScript* inserter shows is the mechanism worth
carrying forward: **the block editor is a REST client.** It boots by fetching
`/wp-json/wp/v2/block-types`, `/wp-json/wp/v2/posts/<id>?context=edit`, taxonomy collections,
the current user's capabilities — all of it over REST, all of it into a normalised client store.
Categories arrive in the editor settings payload that wp-admin prints for it.

This is also the concrete reason
[the content model contract](../appendix/03-content-model-reference.md#1-post-types) requires
`show_in_rest => true` on every post type in a build that never consumes REST from the front
end. Turn REST off for `incident` and the editor for incidents is a white screen. The rule is
not "REST is bad"; the rule is "the browser on the public site never talks to WordPress", and
wp-admin is not the public site.

### 9. What a headless build changes about every one of the above

Everything so far is standard block development. Here is the delta, in one table, and it is the
framing to carry through all five lessons:

| `block.json` key | Classic build | This build |
|---|---|---|
| `editorScript` | matters | **matters exactly as much** — the editing experience is the whole deliverable |
| `editorStyle` / `style` | `style` is your site's appearance | `style` reaches wp-admin and the WordPress-rendered preview. Next never loads it. |
| `viewScript` | front-end interactivity | **never used.** Front-end interactivity is a React client component in `next-app` |
| `render` | the visitor-facing HTML | executes, and no visitor ever sees the output. Lesson 13.4 is honest about the cost |
| `attributes` | input to your markup | **the deliverable.** Module 14 reads these and renders its own components |
| `supports` | which controls editors get | identical — and Lesson 13.5 audits it, because a control that produces CSS Next ignores is a lie to the editor |

Say the consequence out loud once, because it inverts a Classic instinct: **the markup `save()`
produces is not a deliverable, it is a validator obligation.** You still have to get it right —
the validator compares against it, `the_content()` prints it, and the Module 17 preview route
renders it — but no amount of polish there improves the site a visitor sees. The polish belongs
in the attributes: name them well, type them tightly, keep them free of presentation. That is
the work Module 14 consumes.

---

## Task

> **The first line of every code fence is the destination path, not a line of the file.** PHP
> files start at their `<?php`. Paste from there down.

### Step 1: Create the plugin directory and its bootstrap

This is a **second, separate plugin**. It does not go into `blame-the-tech-core`, and
`blame-the-tech-core`'s `Plugin::INCLUDES` array must not learn about it. Two plugins because
they have different lifecycles: the core plugin is PHP that must be active for the schema to
exist, and this one is a build artefact that can be absent without breaking the API.

```bash
cd wordpress-headless/wp-content/plugins
mkdir -p blame-the-tech-blocks/src
cd blame-the-tech-blocks
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php
<?php
/**
 * Plugin Name:       Blame The Tech — Blocks
 * Description:       Six Gutenberg blocks for Blame The Tech. Built with @wordpress/scripts; registers from build/.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            Blame The Tech
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       blame-the-tech-blocks
 * Domain Path:       /languages
 *
 * @package Blame\Blocks
 */

declare( strict_types=1 );

namespace Blame\Blocks;

// Direct access to a PHP file inside wp-content must not execute anything.
defined( 'ABSPATH' ) || exit;

const VERSION    = '0.1.0';
const PLUGIN_DIR = __DIR__;

/**
 * Every block this plugin owns, in inserter order.
 *
 * One entry per directory under src/. `tech-verdict-card` is Lesson 13.5's
 * optional stretch block and is listed from the start on purpose: the is_dir()
 * guard below means an unbuilt block is silently skipped rather than fatal, so
 * a learner who skips the stretch gets no error and no missing-file notice.
 *
 * @var string[]
 */
const BLOCKS = array(
	'incident-callout',  // Lesson 13.2
	'blame-quote',       // Lesson 13.3
	'scapegoat-picker',  // Lesson 13.3
	'incident-ticker',   // Lesson 13.4
	'hobt-cta',          // Lesson 13.4
	'tech-verdict-card', // Lesson 13.5 — optional
);

/**
 * Register every built block with the server-side registry.
 *
 * `init` is the correct hook: earlier and the block type registry does not
 * exist yet, later and REST/GraphQL schema building has already run.
 */
function register_blocks(): void {
	foreach ( BLOCKS as $slug ) {
		// build/, NEVER src/. wp-scripts copies block.json into build/ next to
		// the compiled index.js, so `file:./index.js` only resolves there.
		// Registering src/ makes the block appear and every rebuild invisible.
		$dir = PLUGIN_DIR . '/build/' . $slug;

		// A fresh clone has no build/ at all — it is gitignored. Degrade to
		// "no blocks", never to a fatal, and never to an admin notice storm.
		if ( ! is_dir( $dir ) ) {
			continue;
		}

		register_block_type( $dir );
	}
}
add_action( 'init', __NAMESPACE__ . '\\register_blocks' );

/**
 * Add the `btt` inserter category.
 *
 * `block_categories_all`, not the 5.8-deprecated `block_categories`: the newer
 * filter also runs for the site editor, which receives a block editor context
 * rather than a WP_Post.
 *
 * @param array<int, array<string, mixed>> $categories Registered categories.
 * @return array<int, array<string, mixed>>
 */
function register_category( array $categories ): array {
	// unshift, not push: the inserter renders categories in array order and
	// these are the blocks an editor of THIS site reaches for first.
	array_unshift(
		$categories,
		array(
			'slug'  => 'btt',
			'title' => 'Blame The Tech',
			'icon'  => null, // A wrong category icon is worse than none.
		)
	);

	return $categories;
}
add_filter( 'block_categories_all', __NAMESPACE__ . '\\register_category' );
```

**Verify §1:**

- [ ] `docker compose exec wordpress php -l /var/www/html/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php`
      prints `No syntax errors detected`. Run it from `wordpress-headless`.
- [ ] `declare( strict_types=1 )` is the first **statement**. The docblock above it is fine; a
      `namespace` above it is a fatal error.
- [ ] The string `/src/` does not appear anywhere in the file.

### Step 2: Write `package.json`

One devDependency. That is not minimalism for its own sake — `@wordpress/scripts` is a
metapackage that already brings webpack, Babel, ESLint, Prettier, Jest and the dependency
extraction plugin, and adding any of them yourself means two versions of a config resolving
against each other.

```json
{
  "name": "blame-the-tech-blocks",
  "version": "0.1.0",
  "private": true,
  "description": "Gutenberg blocks for Blame The Tech. Not related to next-app; see docs/architecture.md.",
  "license": "GPL-2.0-or-later",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "wp-scripts build",
    "start": "wp-scripts start",
    "lint:js": "wp-scripts lint-js",
    "test": "wp-scripts test-unit-js",
    "format": "wp-scripts format"
  },
  "devDependencies": {
    "@wordpress/scripts": "^30.0.0"
  }
}
```

`"private": true` because this is never published to npm, and it stops `npm publish` working by
accident. `engines.node` documents the floor; the repo's `.nvmrc` pins `22`, which satisfies it.
`@wordpress/scripts` needs a currently-supported Node — an old Node 18 produces a webpack
crash whose message says nothing about Node.

`lint:js` rather than `lint` matches the `next-app` convention of a scoped lint script, and
`format` is `wp-scripts format`, which is Prettier with the WordPress config (tabs, WordPress
brace style). Do not fight it; the whole point of a shipped config is that nobody argues.

> **The `test` script is declared and this course never runs it.** `wp-scripts test-unit-js` is
> Jest, configured for the editor's globals. It is here so the toolchain is complete and so you
> can reach for it in your own work. The tests this project actually relies on for blocks are
> Module 14's component tests in `next-app` and the Playwright spec that opens `blog-01` — the
> two seeded showcase posts exist for exactly that. There are **no snapshot tests of rendered
> markup** anywhere in this course, here included.

### Step 3: Install, then build nothing

```bash
npm install
npm run build
```

`npm install` writes `package-lock.json` (commit it) and a `node_modules/` that has nothing to
do with `next-app`'s. `npm run build` then does almost nothing, and that is the informative
part: `wp-scripts` discovers entry points by looking for `src/*/block.json`, `src/` is empty, so
depending on your `@wordpress/scripts` minor you get either a warning about no entry points or a
webpack error and a non-zero exit. Either is correct. **The build is driven entirely by what is
in `src/`**, which is a fact worth learning now rather than while debugging a missing block.

**Verify §3:**

- [ ] `node_modules/.bin/wp-scripts` exists.
- [ ] `node_modules/.bin/next` does **not** exist. This is a different dependency tree, in a
      different directory, with a different React. Key Concept 6.
- [ ] `git status --short` from the repo root shows `package.json` and `package-lock.json` as
      new, and shows **no** `node_modules` and **no** `build`.

### Step 4: Start the watcher, in a second terminal, and leave it there

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks
npm run start
```

`wp-scripts start` is a watch build: it recompiles on save, writes to `build/`, and keeps
running. It is not a dev server, there is no HMR, and it does not reload your browser. The
workflow for the next four lessons is: save the file, glance at the terminal for a green
rebuild, **hard-reload wp-admin**.

> **Leave this running for the rest of the module.** The number one report in block development
> is "my block disappeared". The number one cause is a stopped watcher, so `build/` still holds
> the previous compile and wp-admin is faithfully showing you code you deleted twenty minutes
> ago. If a block ever behaves impossibly, check this terminal before you check your code.

Note where this runs: on your **host**, in this directory. Nothing about the block build goes
through Docker. The `wordpress` container sees `build/` because
`./wp-content/plugins` is bind-mounted into it (Lesson 02.2), so the compiled output is visible
to WordPress the instant webpack writes it. There is no `npm` in any container and there does
not need to be.

### Step 5: Activate the plugin

```bash
cd ../../..                      # back to wordpress-headless
docker compose run --rm wpcli wp plugin activate blame-the-tech-blocks
docker compose run --rm wpcli wp plugin list --status=active --field=name
```

**Verify §5:**

- [ ] The second command lists `blame-the-tech-blocks` alongside `blame-the-tech-core`,
      `wp-graphql` and `advanced-custom-fields-pro` (Pro, not free ACF — Lesson 04.2 swapped
      them).
- [ ] `docker compose logs --tail=20 wordpress` shows no new PHP notice. A notice here is
      almost always a typo in the plugin header docblock or a missing `defined( 'ABSPATH' )`.
- [ ] `http://localhost:8080/wp-admin/post-new.php?post_type=post` still loads the editor. The
      inserter has **no** `Blame The Tech` group yet, because a category with zero blocks in it
      is not rendered. That is correct at this point.

### Step 6: Read a real block by hand

This is the exercise, not a formality. `blog-01` was seeded in Lesson 04.5 with markup for all
six of the blocks you are about to write, which means the fixture already tells you exactly what
your `save()` functions have to produce.

```bash
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' | head -c 900
```

Read the output against Key Concept 1 and answer these four by eye, without running anything:

1. Which blocks are **self-closing** (`/-->` and no markup)? There are three.
2. Which block has another block *nested inside it*, and what is that inner block's name?
3. `btt/incident-callout` stores `incidentSlug` and `severity` in the comment, but its headline
   text is in an `<h3>` in the markup. Why would anyone choose that split? (Lesson 13.2 answers
   it; guess first.)
4. `btt/scapegoat-picker` stores `{"termId":N}`. What breaks if you move that fixture to a
   different machine, and why does Lesson 12.4 call that out as a determinism rule?

Now count them:

```bash
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' | grep -c '<!-- wp:btt/'
```

**Verify §6:**

- [ ] The count is **6**. The seeder writes one instance of every block in `BLOCKS`, including
      `tech-verdict-card`.
- [ ] The nested block in question 2 is `core/paragraph`, inside `btt/blame-quote`.
- [ ] Opening `blog-01` in wp-admin right now shows six "your site does not include support for
      this block" placeholders. **That is the correct state at the end of Lesson 13.1** — the
      content exists and the code does not yet. Do not fix it. Lessons 13.2 to 13.5 fix it one
      block at a time.

### Step 7: Write down the two-toolchain boundary

Append this to `docs/architecture.md`, which Lesson 01.2 created. You are writing it down
because you will be tempted, at least twice in Module 14, to import something from one side into
the other.

```markdown
<!-- docs/architecture.md -->

## The two JavaScript toolchains (Lesson 13.1)

`blame-the-tech-blocks` and `next-app` are both JavaScript projects in this repository and they
share **nothing**. Not a dependency, not a config, not a module.

| | `blame-the-tech-blocks` | `next-app` |
|---|---|---|
| Bundler | webpack, via `@wordpress/scripts` | Turbopack / webpack, via Next 15 |
| Language | JavaScript | TypeScript, `strict` |
| React resolution | `wp.element`, a global enqueued by WordPress core | `react` from its own `node_modules` |
| React version | whatever WordPress core ships | whatever `package.json` pins |
| Module resolution | `@wordpress/*` rewritten to `wp.*` externals | `@/…` alias to `src/` |
| Lint config | `wp-scripts lint-js` (WordPress ESLint) | `next lint` / the repo ESLint config |
| Formatting | `wp-scripts format` — tabs, WordPress brace style | Prettier — spaces |
| Test runner | Jest (`wp-scripts test-unit-js`, unused here) | Vitest + Playwright |
| Output | `build/`, gitignored, one directory per block | `.next/`, gitignored |
| Runs in | wp-admin only | the Next server and the browser |
| **Can they share code?** | **No.** A shared module would have to satisfy two dependency graphs, and anything touching React would run against two Reacts. | |

What crosses the boundary instead: **block attribute names and types**, written down in
`docs/content-model.md` and fixed by appendix 03. Module 14 reads attributes over GraphQL. It
never imports from this plugin, and this plugin never imports from `next-app`.
```

---

## Verification

```bash
cd wordpress-headless

# 1. The plugin is active
docker compose run --rm -T wpcli wp plugin list --status=active --field=name | grep -c 'blame-the-tech-blocks'
# Expected: 1

# 2. PHP parses. A header typo here shows up as a blank plugins screen, not an error.
docker compose exec wordpress php -l \
  /var/www/html/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php
# Expected: No syntax errors detected in .../blame-the-tech-blocks.php

# 3. NEGATIVE — the server-side registry contains ZERO btt/ blocks, and that is correct.
#    The bootstrap loops over six slugs and is_dir() skips all six, because src/ is
#    empty so build/ does not exist. An unbuilt plugin must be inert, not fatal.
docker compose run --rm -T wpcli wp eval '
$names = array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() );
echo count( array_filter( $names, static fn( $n ) => str_starts_with( $n, "btt/" ) ) ), PHP_EOL;'
# Expected: 0
#           A fatal here instead of a 0 means the is_dir() guard is missing.

# 4. ...while core blocks ARE registered, proving the check above measured the right thing
docker compose run --rm -T wpcli wp eval '
echo count( WP_Block_Type_Registry::get_instance()->get_all_registered() ), PHP_EOL;'
# Expected: a number well over 50. If this is 0, `init` has not fired and check 3
#           proved nothing at all.

# 5. The `btt` inserter category is registered by the filter
docker compose run --rm -T wpcli wp eval '
$post = get_page_by_path( "blog-01", OBJECT, "post" );
echo implode( ",", array_column( get_block_categories( $post ), "slug" ) ), PHP_EOL;'
# Expected: a comma-separated list BEGINNING with btt — e.g.
#           btt,text,media,design,widgets,theme,embed
#           `btt` first is the array_unshift; `btt` last means you used array_push.

# 6. The seeded fixture holds one instance of all six blocks
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' | grep -c '<!-- wp:btt/'
# Expected: 6

# 7. Three of those six are self-closing — save() will return null for them (Lesson 13.4)
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' | grep -c '} /-->'
# Expected: 3   (scapegoat-picker, incident-ticker, hobt-cta)

# 8. blog-02 and the hobt page carry the same fixture
for slug in blog-02 hobt; do
  docker compose run --rm -T wpcli wp eval \
    "echo get_page_by_path( \"$slug\", OBJECT, \"\" )->post_content;" | grep -c '<!-- wp:btt/'
done
# Expected: 6 then 6

# 9. NEGATIVE — the wordpress container still has no `wp` binary. Every WP-CLI
#    command in this course goes through the wpcli service; this is not negotiable.
docker compose exec wordpress sh -c 'command -v wp || echo "no wp binary — correct"'
# Expected: no wp binary — correct

cd wp-content/plugins/blame-the-tech-blocks

# 10. The toolchain installed, and it is the WordPress one
ls node_modules/.bin/ | grep -c '^wp-scripts$'
# Expected: 1

# 11. NEGATIVE — this is NOT the next-app dependency tree
ls node_modules/.bin/ | grep -cE '^(next|vitest|playwright)$'
# Expected: 0
#           A non-zero here means you ran npm install in the wrong directory,
#           or added a dependency that should live in next-app. Key Concept 6.

# 12. NEGATIVE — the plugin registers from build/, never src/
grep -c "/src/" blame-the-tech-blocks.php
# Expected: 0
#           Registering src/ is appendix 06 §6's named failure: the block appears
#           once and every rebuild after that is invisible.
grep -c "/build/" blame-the-tech-blocks.php
# Expected: 1

# 13. All six block slugs are declared, and none of them is misspelled
grep -oE "'(incident-callout|blame-quote|scapegoat-picker|incident-ticker|hobt-cta|tech-verdict-card)'" \
  blame-the-tech-blocks.php | sort -u | wc -l
# Expected: 6

cd ../../../..

# 14. build/ is gitignored, by a rule that already existed before this lesson
git check-ignore -v \
  wordpress-headless/wp-content/plugins/blame-the-tech-blocks/build/incident-callout/index.js
# Expected: a .gitignore line number and the pattern
#           wordpress-headless/wp-content/plugins/blame-the-tech-blocks/build/

# 15. ...and the plugin directory itself is NOT ignored, thanks to the `!` negation
git check-ignore -v wordpress-headless/wp-content/plugins/blame-the-tech-blocks/package.json
# Expected: no output, exit 1. No output means "not ignored", which is what you want
#           for a file you are about to commit.

# 16. NEGATIVE — nothing build-shaped or vendored is staged
git status --short wordpress-headless/wp-content/plugins/blame-the-tech-blocks/ | grep -cE 'node_modules|/build/'
# Expected: 0

# 17. NEGATIVE — the core plugin has not learned about this one. Two plugins, two
#     bootstraps. A require_once across plugin boundaries is a load-order bug
#     waiting for the day someone deactivates one of them.
grep -c 'blame-the-tech-blocks' \
  wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
# Expected: 0

# 18. The architecture note landed
grep -c 'two JavaScript toolchains\|The two JavaScript toolchains' docs/architecture.md
# Expected: 1
```

Checks 3 and 4 are a pair and only mean something together: 3 says "no `btt/` blocks", 4 says
"but blocks were being counted". A verification that can pass because the thing it measures does
not exist is not a verification.

## Control Questions

1. `post_content` for `blog-01` contains `<!-- wp:btt/hobt-cta {"label":"Stop blaming the
   tech","href":"/hobt"} /-->` with no closing delimiter and no markup. Explain what `save()`
   must return for that to be the serialised form, and name one thing the front end can still do
   with this block despite it contributing zero HTML.
2. You change a block's `save()` and reload a post that was published last week. Describe, in
   terms of the five-phase cycle, exactly which phase fails and why the failure appears on
   *load* rather than on *save*.
3. The plugin registers `PLUGIN_DIR . '/build/' . $slug`. State two distinct things that break if
   you change that to `'/src/' . $slug`, and say which of the two you would notice first.
4. `@wordpress/dependency-extraction-webpack-plugin` rewrites `import { useBlockProps } from
   '@wordpress/block-editor'` into a reference to a global. Given that, explain why a
   hypothetical `shared/severity.ts` imported by both `edit.js` and a Next.js component is a
   problem even if the file contains nothing but a string union.
5. `show_in_rest => true` is required on every post type in this project even though the front
   end never calls REST. Name the component that requires it, the symptom when it is missing,
   and why "just disable Gutenberg" is the wrong fix here specifically.

## Learn More

- [Block metadata (`block.json`) reference](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/) — the authoritative key list; the one page to keep open for the next four lessons
- [`block.json` fundamentals](https://developer.wordpress.org/block-editor/getting-started/fundamentals/block-json/) — the same material as a narrative, useful if the reference table reads as too dense
- [Block registration on both sides](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-registration/) — WordPress's own statement of the two-registry model in Key Concept 7
- [`register_block_type()`](https://developer.wordpress.org/reference/functions/register_block_type/) — read the "passing a directory" signature, which is the form this plugin uses
- [`@wordpress/scripts`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-scripts/) — every command the five `package.json` scripts wrap, including the ones this course does not use
- [`@wordpress/dependency-extraction-webpack-plugin`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-dependency-extraction-webpack-plugin/) — the externals mechanism and the `.asset.php` format, in the plugin's own words
- [Block editor architecture: key concepts](https://developer.wordpress.org/block-editor/explanations/architecture/key-concepts/) — parsing, serialisation and the store, from the people who wrote it; the best single explanation of phase 1 and 2
- [`block_categories_all`](https://developer.wordpress.org/reference/hooks/block_categories_all/) — the filter signature and why the older `block_categories` was deprecated
- [Blocks in an iframed editor](https://make.wordpress.org/core/2021/06/29/blocks-in-an-iframed-template-editor/) — the original Make/Core post behind Key Concept 4, including the list of things that broke
