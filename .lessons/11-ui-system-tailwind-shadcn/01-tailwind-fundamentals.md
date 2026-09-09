---
title: 'Tailwind Fundamentals'
module: 11
lesson: 1
teaches: [tailwind, utility-first-css, design-tokens, css-custom-properties, responsive-variants]
produces: ['next-app/tailwind.config.ts', 'next-app/postcss.config.mjs', 'next-app/src/app/[locale]/globals.css']
requires: [10.5]
---

# Lesson 11.1 — Tailwind Fundamentals

## Quick Overview

Tailwind is a CSS framework with no components in it. You get a large, fixed set of small
classes — `flex`, `gap-4`, `text-sm`, `bg-surface`, `md:grid-cols-3` — and you compose them in
the markup. There is no stylesheet to maintain, no class names to invent, and no cascade to
reason about. It is the styling approach that makes component-based UI pleasant, and it is
genuinely uncomfortable for about two hours if you have spent a decade writing well-organised
CSS files.

You will configure the Blame The Tech design tokens — the severity colour scale, the surface
and text colours, the type scale, the spacing rhythm — as CSS custom properties in a `@theme`
block, then restyle `IncidentCard` with them. Tailwind 4 is CSS-first, so most of what used to
live in `tailwind.config.ts` is now CSS, and the tokens you define are real custom properties
readable from devtools and from any component. That matters for Module 13: `theme.json` will
declare the same palette to the block editor, so a colour an editor picks in Gutenberg is a
colour your front end already knows the name of.

By the end of this lesson you will have:

- `next-app/postcss.config.mjs` and `next-app/tailwind.config.ts` wired into the build
- A `@theme` block in the global stylesheet defining the severity scale, surface and text colours, type scale and spacing tokens
- `IncidentCard` restyled entirely with utilities, and its old class names deleted
- A responsive incident grid using `sm:` / `md:` / `lg:` variants and no media query you wrote by hand
- A dark-mode variant driven by the same tokens, and a written answer to "why is this not just inline styles?"

## Classic WP Analogy

WordPress has always shipped class-name hooks for you to style against — `body_class()`,
`post_class()`, `.wp-block-quote`, `.screen-reader-text` — and the workflow is: WordPress emits
semantic classes, you write CSS rules that target them, and the cascade sorts out conflicts.

| Classic WordPress | Tailwind |
|---|---|
| `body_class()` / `post_class()` semantic hooks | no hooks needed — styling lives on the element |
| `style.css` with `.incident-card__meta { … }` | `className="flex gap-2 text-sm text-muted"` |
| `@media (min-width: 768px) { … }` | `md:` prefix on the utility itself |
| SCSS variables or CSS custom properties in `:root` | `@theme` tokens, which *are* custom properties |
| `wp_enqueue_style()` dependency graph | one generated stylesheet, no handles |
| Specificity battles and `!important` | class order resolved by a merge function |
| `theme.json` presets for the editor | the same tokens, declared once (Lesson 13.5) |

The habit that transfers is the constraint. A good WordPress theme has a `_variables.scss`
with eight colours and six spacing steps, and the discipline is to use only those. Tailwind
makes that discipline the default: `p-4` exists, `p-[17px]` requires you to type brackets and
feel bad about it. If you have ever inherited a theme with `#3c3c3c`, `#3d3d3d` and `#3b3b3c`
all in use, you already understand the value.

The analogy breaks in the place that generates the loudest objection, so it is worth meeting
head-on. **This is not inline styles, and the difference is not cosmetic.** Inline styles cannot
express `:hover`, `:focus-visible`, media queries, dark mode or `prefers-reduced-motion`;
utilities can, because they compile to real rules with real selectors. Inline styles are
unconstrained; utilities come from a token set. And inline styles are per-element bytes that
never compress, whereas Tailwind emits each rule once no matter how often you use it.

The deeper break is architectural, and it is the reason this works here and would not have
worked in your Classic theme: **the component, not the class name, is the unit of reuse.** In
PHP, if the incident meta row appears in four templates you must give it a class name so four
stylesheets can agree. In React it appears in one file, `IncidentCard.tsx`, and the four call
sites reuse the component. The abstraction moved from CSS to JavaScript, which is why the CSS
no longer needs names — and why writing a `.btn-primary` class here is a signal that you should
have written a `<Button variant="primary">` instead. Lesson 11.2 builds exactly that.

---

## Key Concepts

### 1. Utility-first is a constraint system, not a shorthand

A utility class does one thing and its name says which: `p-4` is `padding: 1rem`, `gap-2` is
`gap: 0.5rem`, `text-sm` is a font-size and a line-height together. There are a few thousand of
them and they are generated from a **token set**, which is the part that matters. `p-4` exists
because `--spacing` exists and `4` is a step on it. `p-[17px]` also works — Tailwind will
compile an arbitrary value if you bracket it — and the friction of typing those brackets is
deliberate. It is the same friction a good theme's `_variables.scss` gave you, except the
linter is now the syntax.

That is the whole ergonomic argument, so it is worth stating in the terms you already use:

| Problem in a hand-written stylesheet | What utilities do about it |
|---|---|
| Naming. `.incident-card__meta--compact` took four minutes to decide | there is no name to decide |
| Dead CSS. Nobody dares delete a rule because nobody knows the call sites | delete the component, the CSS goes with it |
| Drift. `#3c3c3c`, `#3d3d3d` and `#3b3b3c` all shipped | one token, one value, referenced everywhere |
| Specificity. `!important` as a negotiating tactic | one flat layer, resolved by a merge function |
| "What does this rule affect?" | the answer is on the element |

The cost, stated plainly: your markup gets long, and a component with fourteen classes on a
`<div>` reads badly in a code review until you stop reading the classes and start reading the
component. That adjustment takes about two hours and then it is permanent.

### 2. Tailwind 4 is CSS-first, and that changes where configuration lives

If you have used Tailwind 3, the muscle memory to unlearn is `tailwind.config.js`. In Tailwind 4
the stylesheet is the configuration. You `@import "tailwindcss"` and then use CSS at-rules for
everything the JavaScript object used to hold:

| Tailwind 3 config key | Tailwind 4 |
|---|---|
| `theme.colors`, `theme.spacing`, `theme.fontSize` | `@theme { --color-*: …; --spacing: …; }` |
| `content: ['./src/**/*.tsx']` | automatic source detection, or `@import "tailwindcss" source("…")` |
| `darkMode: 'class'` | `@custom-variant dark (&:where(.dark, .dark *));` |
| `plugins: [require('…')]` | `@plugin "…";` |
| `presets: […]` | `@import` another stylesheet |
| a JS config file at all | `@config "…";` — only when a plugin still needs one |

There is one thing left that a JS object does better, and this project hits it: a plugin whose
configuration is a nested object of CSS-in-JS. `@tailwindcss/typography` is exactly that, so
`tailwind.config.ts` survives here for one reason and one reason only, loaded from CSS with
`@config`. Key Concept 8 covers what is in it.

> **A learner who has read the v4 docs should not conclude this project is stuck in v3.**
> `tailwind.config.ts` exists in this repo for the typography plugin's `typography` theme key,
> nothing else. Every colour, every radius, every variant is CSS. If you delete the
> `@tailwindcss/typography` plugin one day, delete the config file with it.

### 3. `@theme` tokens are real CSS custom properties — and `@theme inline` ones are not

This distinction is small, invisible in the docs until it bites, and it decides how this
project's stylesheet is structured, so it gets its own subsection.

A plain `@theme` block does two things at once. It registers a token with Tailwind, so
`--color-severity-s1` generates `bg-severity-s1`, `text-severity-s1`, `border-severity-s1` and
`ring-severity-s1`. And it **emits that custom property into the compiled CSS**, so
`--color-severity-s1` is readable in devtools, readable from a hand-written rule, and
overridable by a `.dark` block further down the file.

`@theme inline` registers the token but does **not** emit it. Utilities compiled from an inline
token reference whatever the token's value was — typically `var(--something-else)` — directly.
That is the right choice when the token is a *bridge* to another variable you already declare,
which is precisely shadcn's pattern: the palette lives in `:root`/`.dark` under short names,
and `@theme inline` maps those names into Tailwind's namespace without duplicating them.

```
:root {  --background: oklch(1 0 0);  }        ← the value, emitted, overridable in .dark
@theme inline {  --color-background: var(--background);  }
                                    ↑ registers `bg-background`, emits nothing extra

@theme {  --color-severity-s1: oklch(0.52 0.19 25);  }
             ↑ registers `bg-severity-s1` AND emits --color-severity-s1 into :root
```

Both appear in this project's `globals.css` on purpose. The shadcn palette uses the bridge form
because the CLI's own output expects those names in Lesson 11.2. The four Blame The Tech
severity tokens use the plain form because Module 13 wants them **emitted**: `theme.json` will
declare the same four colours to the block editor, and an editor's colour choice is only useful
if the front end already has a custom property with that value in it. Same file, two forms, two
reasons.

Colours are written in `oklch()` because that is what Tailwind 4 and shadcn both emit, and
because `oklch` separates perceptual lightness from hue — which is what makes
`bg-severity-s1/15` a predictable pale wash rather than a muddy surprise.

### 4. Why this is not inline styles

This is the loudest objection to utility CSS and it deserves a full answer rather than a
dismissal, because the person raising it is usually right about something adjacent.

| | `style={{ … }}` | Utility classes |
|---|---|---|
| `:hover`, `:focus-visible`, `:disabled` | ❌ impossible | ✅ `hover:`, `focus-visible:`, `disabled:` |
| Media queries | ❌ impossible | ✅ `md:`, `lg:` |
| Dark mode | ❌ impossible without JavaScript | ✅ `dark:` |
| `prefers-reduced-motion` | ❌ impossible | ✅ `motion-reduce:` |
| Constrained to a token set | ❌ any value, any time | ✅ the theme, or brackets and shame |
| Bytes | per element, every element, uncompressible | one rule per utility, no matter how often used |
| Cascade participation | outside it entirely, at specificity 1000 | a normal rule in a normal layer |
| Verdict | ❌ a last resort for genuinely dynamic values | ✅ the default |

The last row matters. Inline styles are not banned in this project — a computed
`style={{ width: percent + '%' }}` on a blame-confidence bar is the correct tool, because the
value comes from data and no class set can enumerate 101 widths. What is banned is using inline
styles for things that have a `:hover` state.

### 5. The component is the unit of reuse, not the class name

The reason utilities work here and would not have worked in your Classic theme is an
architectural one, and it has nothing to do with CSS.

```
CLASSIC THEME                             THIS APP
  single-incident.php  ─┐                   /incidents        ─┐
  archive-incident.php ─┤                   /incidents/[slug] ─┤
  front-page.php       ─┼─▶ .incident-meta  /                 ─┼─▶ <IncidentCard/>
  search.php           ─┘    (one CSS rule) /scapegoats        ─┘   (one .tsx file)

  the CLASS is the shared thing             the COMPONENT is the shared thing
  → it must be named, and agreed on         → the CSS needs no name at all
```

Four PHP templates that each render an incident meta row need a class name so four places can
agree on one rule. One React component rendered from four routes needs nothing: the markup and
the styling live together, once. The abstraction moved from CSS to JavaScript.

The corollary is a rule for this module. **If you find yourself writing `.btn-primary`, you have
discovered that you need a `Button` component with a `primary` variant.** Write the component.
Lesson 11.2 does exactly that, with `cva` supplying the variant API.

### 6. Variants are prefixes, and they compose left to right

Every state, breakpoint and media query is a prefix on the utility, and prefixes stack:

| Prefix | Compiles to | Used in this module |
|---|---|---|
| `sm:` `md:` `lg:` | `@media (min-width: …)` | the incident grid, Step 7 |
| `hover:` | `&:hover` | cards, buttons |
| `focus-visible:` | `&:focus-visible` | the ring token, Lesson 11.4 |
| `dark:` | `&:where(.dark, .dark *)` — your `@custom-variant` | the whole palette |
| `motion-reduce:` | `@media (prefers-reduced-motion: reduce)` | every transition, Lesson 11.4 |
| `group-hover:` | `.group:hover &` | the card's title on card hover |
| `has-[…]:` | `&:has(…)` | a fieldset that reacts to a checked child |
| `[&_svg]:` | `& svg` | icon sizing inside `Button`, Lesson 11.2 |

`dark:md:hover:bg-card` is a real class and means what you would guess. Two things to internalise:
breakpoints are **min-width only**, so you write mobile styles unprefixed and layer larger
screens on top; and a variant is not a cascade, it is a selector, so `md:grid-cols-3` does not
"override" `grid-cols-1` — both rules exist and the media query decides.

### 7. Conflicting utilities resolve by stylesheet order, not by the order you typed them

This is the one that costs people an afternoon.

```html
<!-- (illustration) both classes are real; one wins, and it is not "the last one" -->
<div class="px-8 px-4">…</div>
```

Two utilities that set the same property are two rules in one stylesheet. Which one applies is
decided by **their order in the generated CSS**, which Tailwind controls, not by the order of
the strings in your `class` attribute, which you control. In practice `px-4` and `px-8` sit
next to each other in the output and the later one wins every time, regardless of what you
wrote.

Now put that in a component:

```tsx
// (illustration) IncidentCard.tsx — the override that does not override
function Card({ className }: { className?: string }) {
  return <div className={`rounded-lg border px-4 ${className ?? ''}`}>…</div>;
}

// The caller asks for more padding and does not get it:
<Card className="px-8" />
```

The caller's intent is unambiguous and the result is `px-4`. This is the most common Tailwind
support question in existence, and the fix is not "try `!important`" — it is to **remove the
losing class from the string before it reaches the DOM**. That is what `tailwind-merge` does,
and it is why Lesson 11.2's `cn()` helper is infrastructure rather than sugar. Nothing in this
lesson needs it yet, because nothing here takes a `className` prop. Everything from 11.2 onward
does.

### 8. `prose` is the only sane answer to the Module 09 HTML blob, and it is not the real fix

Lesson 09.3 rendered page and post bodies by handing WordPress's `content` string to
`dangerouslySetInnerHTML`. That is a named, dated debt — Module 14 pays it off by rendering
blocks as data — and until then the markup inside that blob is `<p>`, `<h2>`, `<ul>`,
`<blockquote>` and `<figure>` that Tailwind has never seen and cannot style, because there is no
class attribute on any of it and Tailwind's preflight has already removed the browser defaults.

`@tailwindcss/typography` adds one class, `prose`, which styles descendant elements by tag:

```html
<!-- (illustration) one class, sensible defaults for markup you do not control -->
<article class="prose prose-neutral dark:prose-invert max-w-none">
  <!-- WordPress's `content` goes here -->
</article>
```

The honest caveat, and it is the reason Module 14 exists: `prose` styles **standard HTML**. It
knows nothing about `wp-block-columns`, `wp-block-gallery`, `wp-block-embed` or any of the
`wp-block-*` classes the block editor emits, and it cannot know about the six custom blocks
Module 13 adds. So `prose` makes a paragraph look like a paragraph and leaves a columns block
looking like two stacked divs. It is a good floor, not a ceiling.

---

## Task

### Step 1: Check the licences, then install

```bash
cd next-app

npm view tailwindcss license
npm view @tailwindcss/postcss license
npm view @tailwindcss/typography license
# Expected: MIT for all three — permissive, so they are allowed in next-app,
#           which is MIT itself (Lesson 07.1 Key Concept 9)

npm install --save-dev tailwindcss@^4 @tailwindcss/postcss @tailwindcss/typography
```

All three are **devDependencies**. Tailwind runs at build time and ships no runtime, so nothing
here belongs in `dependencies`.

### Step 2: Write the PostCSS configuration

Tailwind 4 is a PostCSS plugin, and Next discovers it through a config file at the app root.

```js
// next-app/postcss.config.mjs
const config = {
  plugins: {
    // The ONLY plugin this project needs. Tailwind 4 handles nesting and
    // vendor prefixing itself, so there is no `postcss-nested` and no
    // `autoprefixer` here — adding them is the most common v3 habit to drop.
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

**Verify §2:**

- [ ] The file is `postcss.config.mjs`, not `.js`. A `.mjs` file is an ES module whatever
      `package.json` says, which is why Module 07 spelled `eslint.config.mjs` the same way.
      `postcss.config.js` would in fact work *today*, because Lesson 07.1 set
      `"type": "module"` — and it would break silently the day someone removes that field.
      Pick the extension that does not depend on a setting three directories up.
- [ ] There is no `autoprefixer` and no `postcss-nested` in the plugin list.

### Step 3: Write `tailwind.config.ts` — the typography plugin's object, and nothing else

```ts
// next-app/tailwind.config.ts
// This file exists for ONE reason: @tailwindcss/typography reads its configuration
// from the `typography` theme key, and that key is a nested CSS-in-JS object with no
// CSS at-rule equivalent. Everything else in this project's design system lives in
// src/app/[locale]/globals.css. Loaded from there with `@config`.
//
// Deliberately NOT typed with `satisfies Config`: Tailwind's exported Config type
// still requires the v3 `content` key, and adding `content: []` here to satisfy a
// type would be a lie about how source files are detected. A plain object is what
// `@config` needs.
export default {
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            // Drive prose colours from the same tokens as the rest of the app,
            // so a dark-mode switch does not need a second palette.
            '--tw-prose-body': 'var(--foreground)',
            '--tw-prose-headings': 'var(--foreground)',
            '--tw-prose-links': 'var(--primary)',
            '--tw-prose-bold': 'var(--foreground)',
            '--tw-prose-quotes': 'var(--muted-foreground)',
            '--tw-prose-quote-borders': 'var(--border)',
            '--tw-prose-code': 'var(--foreground)',
            '--tw-prose-hr': 'var(--border)',
            maxWidth: '68ch',
            // The plugin wraps inline <code> in typographic quotes by default.
            // WordPress content is full of inline code and it looks wrong.
            'code::before': { content: '""' },
            'code::after': { content: '""' },
          },
        },
      },
    },
  },
};
```

### Step 4: Write the design system

This is the artifact of the lesson. Read the comments — every block is doing something
different.

```css
/* next-app/src/app/[locale]/globals.css */

/* 1. Tailwind itself. `source(...)` pins automatic source detection to next-app/src.
      Tailwind 4 has no `content` array; left to itself it would walk up out of this
      directory and, in this repository, start reading the PHP in wordpress-headless/.
      Pinning it keeps the scan deterministic and the build honest about what it saw. */
@import 'tailwindcss' source('../../../src');

/* 2. The typography plugin, and the JS object it reads its own config from. */
@plugin "@tailwindcss/typography";
@config "../../../tailwind.config.ts";

/* 3. Dark mode is CLASS-driven, not media-driven. `.dark` on <html> switches the
      palette. The cost, stated plainly: until something sets that class nothing in
      this file's dark section is reachable, and nothing in Module 11 sets it. That
      is deliberate — Module 20's locale switcher establishes the pattern for a
      user-controlled toggle on <html>, and a theme toggle is the same shape. Module
      21 is not going to be asked to retrofit it. */
@custom-variant dark (&:where(.dark, .dark *));

/* 4. Blame The Tech severity scale. PLAIN @theme, so these four ARE emitted as
      custom properties into the compiled CSS (Key Concept 3). Module 13's theme.json
      declares the same four colours to the block editor and needs them readable here.
      One token per severity term in the closed set — appendix 03 §2. There is no
      fifth, and there is not going to be one. */
@theme {
  --color-severity-s1: oklch(0.52 0.19 25); /* s1-catastrophic — red */
  --color-severity-s2: oklch(0.66 0.16 55); /* s2-major        — orange */
  --color-severity-s3: oklch(0.75 0.13 90); /* s3-minor        — amber */
  --color-severity-s4: oklch(0.62 0.05 250); /* s4-cosmetic     — slate blue */
}

/* 5. The shadcn canonical palette, light. These names are not a suggestion: the CLI
      in Lesson 11.2 generates components that reference exactly these, so declaring
      them now means the generated output needs no edits to look right. */
:root {
  --radius: 0.625rem;

  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0); /* the focus ring — Lesson 11.4 depends on this */
}

/* 6. Dark overrides. The severity tokens are overridden here too, because a colour
      that reads as "alarming" on white is muddy on near-black. */
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 18%);
  --ring: oklch(0.556 0 0);

  --color-severity-s1: oklch(0.65 0.2 25);
  --color-severity-s2: oklch(0.75 0.16 55);
  --color-severity-s3: oklch(0.82 0.13 90);
  --color-severity-s4: oklch(0.72 0.06 250);
}

/* 7. The bridge. @theme INLINE, so these register `bg-background`, `text-foreground`,
      `ring-ring`, `rounded-lg` and friends without emitting a second copy of every
      value. Utilities compiled from these reference var(--background) directly, which
      is what makes the .dark block above work at all. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

/* 8. Two base rules, and no more. Everything else is a utility on an element.
      Note there is NOT ONE hand-written @media query in this file — that is a
      verification check, not a stylistic boast. */
@layer base {
  body {
    background-color: var(--background);
    color: var(--foreground);
    -webkit-font-smoothing: antialiased;
  }

  /* Tailwind's preflight removes the default focus ring. Putting a token-driven one
      back at the base layer means an element that nobody styled is still keyboard-
      visible. Lesson 11.4 audits every place this is overridden. */
  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
}
```

**Verify §4:**

- [ ] The `@config` path resolves. `globals.css` is three directories below `next-app/`, so
      `../../../tailwind.config.ts` is `next-app/tailwind.config.ts`. A wrong path here fails
      the build with a module-not-found error, which is the good outcome.
- [ ] The four severity tokens are inside a plain `@theme`, not `@theme inline`. Check 3 of
      `## Verification` depends on it.

### Step 5: Import the stylesheet once, in the root layout

`src/app/[locale]/layout.tsx` is the root layout — it renders `<html>` and `<body>`, and there
is no layout above it. One import, at the top, and every route inherits it.

```tsx
// next-app/src/app/[locale]/layout.tsx — add this import at the top of the file
import './globals.css';
```

> **Import it exactly once, and here.** A stylesheet imported from a leaf page is still global
> once it loads, but its load order becomes route-dependent, which turns Key Concept 7's
> "conflicts resolve by stylesheet order" into "conflicts resolve by which page you navigated
> from". Root layout, one import, no exceptions.

### Step 6: Restyle `IncidentCard`

Delete every class name the Module 08 version invented and replace them with utilities. The
severity badge is the interesting part: its colour comes from a lookup keyed on `SeverityLevel`,
so a fifth severity term would be a compile error rather than an unstyled badge.

```tsx
// next-app/src/components/incidents/IncidentCard.tsx
import Link from 'next/link';
import { SEVERITY_LABEL, type SeverityLevel } from '@/types/content';
import type { IncidentCardFieldsFragment } from '@/gql/graphql';

// Total over SeverityLevel. `satisfies` rejects a missing key AND an extra one, so
// this map cannot drift from the closed term set in appendix 03 §2. Lesson 11.2
// lifts this exact shape into a `cva` variant map on Badge — build it in the shape
// that will be absorbed.
const SEVERITY_BADGE = {
  's1-catastrophic': 'border-severity-s1/30 bg-severity-s1/15 text-severity-s1',
  's2-major': 'border-severity-s2/30 bg-severity-s2/15 text-severity-s2',
  's3-minor': 'border-severity-s3/30 bg-severity-s3/15 text-severity-s3',
  's4-cosmetic': 'border-severity-s4/30 bg-severity-s4/15 text-severity-s4',
} satisfies Record<SeverityLevel, string>;

// WPGraphQL types a term's `slug` as String, so codegen cannot narrow it to the
// closed set — the plugin enforces the set in wp-admin, and the front end asserts
// it here, once, at the boundary. This guard is the whole reason SeverityLevel is
// hand-maintained instead of generated.
function asSeverityLevel(slug: string | null | undefined): SeverityLevel | null {
  return slug != null && slug in SEVERITY_LABEL ? (slug as SeverityLevel) : null;
}

export function IncidentCard({ incident }: { readonly incident: IncidentCardFieldsFragment }) {
  const severity = asSeverityLevel(incident.severities?.nodes?.[0]?.slug);
  const scapegoat = incident.scapegoats?.nodes?.[0];
  const downtime = incident.incidentDetails?.downtimeMinutes;

  return (
    // `group` lets the title react to a hover anywhere on the card (Key Concept 6).
    // `transition-colors motion-reduce:transition-none` is the reduced-motion habit
    // Lesson 11.4 audits — start it here rather than retrofitting it there.
    <article className="group rounded-lg border border-border bg-card p-5 text-card-foreground transition-colors motion-reduce:transition-none hover:border-ring">
      <div className="flex items-center gap-2">
        {severity !== null ? (
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE[severity]}`}
          >
            {SEVERITY_LABEL[severity]}
          </span>
        ) : null}
        {typeof downtime === 'number' ? (
          <span className="text-xs text-muted-foreground">{downtime} min down</span>
        ) : null}
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug">
        <Link
          // The locale is hard-coded because there is exactly one, and
          // NEXT_PUBLIC_DEFAULT_LOCALE is `en` (appendix 04 §3.2). Module 20
          // replaces every literal like this with next-intl's navigation
          // helpers; do not invent a mapper for it now.
          href={`/en/incidents/${incident.slug}`}
          className="underline-offset-4 group-hover:underline focus-visible:underline"
        >
          {incident.title}
        </Link>
      </h3>

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {scapegoat ? (
          <div className="flex gap-1">
            <dt>Blamed:</dt>
            <dd className="font-medium text-foreground">{scapegoat.name}</dd>
          </div>
        ) : null}
        {incident.date !== null && incident.date !== undefined ? (
          <div className="flex gap-1">
            <dt>Reported:</dt>
            <dd>
              <time dateTime={incident.date}>{incident.date.slice(0, 10)}</time>
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}
```

`IncidentCardFieldsFragment` is codegen's name for the fragment you wrote in Lesson 10.5 — the
client preset appends `Fragment` to the fragment name, and Lesson 10.2 deleted the hand-written
`Incident` type this component used to take. If `src/gql/graphql.ts` spells it differently, that
file is right and this line changes.

Look at those two imports together, because they are the honest shape of the whole design. The
component's **data type** comes from codegen, generated from the schema, and it can never drift
from what WordPress actually returns. Its **closed-set domain constants** come from a
hand-maintained file, because WPGraphQL types a term's `slug` as `String` and no amount of
codegen will narrow it — the set is enforced by the plugin (appendix 03 §2 locks the severity
term UI to radio buttons) and asserted here, once, at the boundary. Knowing which is which is
what stops you hand-writing a type codegen would have given you, and stops you waiting for
codegen to produce a union it cannot produce.

**Verify §6:**

- [ ] No `className` in this file contains an underscore, a `__` or a `--`. Those are the
      fingerprints of the old hand-written class names.
- [ ] `npm run type-check` passes. If you removed a severity from `SEVERITY_BADGE`, it does not.

### Step 7: Make the incident grid responsive without writing a media query

`IncidentList.tsx` is the only place the card's layout is decided. One class attribute, three
breakpoints.

```tsx
// next-app/src/components/incidents/IncidentList.tsx — replace the list wrapper
<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-6">
  {incidents.map((incident) => (
    <li key={incident.id}>
      <IncidentCard incident={incident} />
    </li>
  ))}
</ul>
```

Mobile first: `grid-cols-1` is unprefixed and therefore the default, and each larger breakpoint
adds a column. Read the class list left to right and it describes the layout at every width,
which is the payoff for giving up the media query — the information is in one place instead of
split between the markup and a stylesheet three directories away.

### Step 8: Write the design-token decision down

The tokens are now a contract that Module 13 has to match, so record them where Module 13 will
look.

```markdown
<!-- docs/architecture.md — append -->
## Design tokens (Lesson 11.1)

Tailwind 4, CSS-first. `src/app/[locale]/globals.css` is the single entry point, imported
once from the root layout.

| Token group | Form | Emitted? | Why |
|---|---|---|---|
| `--background` … `--ring`, `--radius` | `:root` + `@theme inline` | value in `:root`, no duplicate | shadcn's canonical names, so the CLI's output needs no edits |
| `--color-severity-s1` … `-s4` | plain `@theme` | yes | Module 13's `theme.json` declares the same four to the editor |

Dark mode is class-driven (`@custom-variant dark`). Nothing sets `.dark` on `<html>` yet;
that is deliberate and is not a Module 21 task.

`tailwind.config.ts` exists only for `@tailwindcss/typography`'s `typography` theme key.
If the plugin goes, the file goes.
```

---

## Verification

```bash
cd next-app

# 1. Everything compiles and lints
npm run type-check
# Expected: no errors
npm run lint
# Expected: no errors

# 2. A production build succeeds and emits a stylesheet
npm run build
ls .next/static/css/*.css
# Expected: at least one .css file listed

# 3. The severity tokens actually compiled into that stylesheet.
#    This is the check that proves `@theme` (not `@theme inline`) was used — an
#    inline token registers utilities but emits no custom property.
grep -c -- '--color-severity-s1' .next/static/css/*.css
# Expected: 1 or more. ZERO means the token is in an `@theme inline` block.

# 4. All four severity utilities are present, because IncidentCard references all four
for n in 1 2 3 4; do
  printf 's%s: ' "$n"
  grep -o -- "severity-s$n" .next/static/css/*.css | head -1
done
# Expected: severity-s1, severity-s2, severity-s3, severity-s4 — one per line

# 5. The dark palette compiled, even though nothing sets the class yet
grep -c '\.dark' .next/static/css/*.css
# Expected: 1 or more

# 6. The typography plugin is loaded — `prose` exists as a real rule
grep -c 'prose' .next/static/css/*.css
# Expected: 1 or more

# 7. The site still renders, styled. (`npm run dev` in another terminal.)
curl -s http://localhost:3000/en/incidents | grep -o 'stylesheet' | wc -l
# Expected: 1 or more — Next injected the compiled CSS

# 8. NEGATIVE — the old hand-written class names are gone from the whole tree
grep -rn 'incident-card__\|\.btn-\|btn-primary' src/
# Expected: no output. Any hit is a class name that no longer has a rule behind it.

# 9. NEGATIVE — no hand-written media query survived in the stylesheet
grep -n '@media' 'src/app/[locale]/globals.css'
# Expected: no output. Breakpoints are `sm:`/`md:`/`lg:` prefixes, nothing else.

# 10. NEGATIVE — an invented utility class produces NO CSS and NO warning.
#     `bg-severity-s9` is not a class; there is no fifth severity term.
grep -c 'severity-s9' .next/static/css/*.css
# Expected: 0

# 11. NEGATIVE — and to prove check 10 is not a tautology, prove the typo is silent.
#     Add the fake class, rebuild, and confirm the build still SUCCEEDS.
sed -i.bak 's/className="group rounded-lg/className="group bg-severity-s9 rounded-lg/' \
  src/components/incidents/IncidentCard.tsx
npm run build > /tmp/btt-typo-build.log 2>&1; echo "build exit=$?"
# Expected: build exit=0 — a nonexistent utility is not an error anywhere
grep -c 'severity-s9' .next/static/css/*.css
# Expected: 0 — the class is in your markup and in no stylesheet
mv src/components/incidents/IncidentCard.tsx.bak src/components/incidents/IncidentCard.tsx

# 12. Clean up and confirm you are back to a good build
npm run build
# Expected: success, and check 10 still returns 0

# 13. Nothing runtime-only was installed by mistake
node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies ?? {}).filter(d=>d.includes('tailwind')).length)"
# Expected: 0 — Tailwind is a devDependency, it ships no runtime
```

> ⚠️ **An invented utility class fails silently, and that is the single biggest ergonomic cost
> of utility CSS.** Check 11 is the proof: `bg-severity-s9` compiles, builds, deploys and
> renders an unstyled element. There is no error, no warning, and no failed build — the same
> typo in a stylesheet would at least have left a rule you could grep for. Three mitigations,
> in order of how much they help: the Tailwind IntelliSense editor extension, which autocompletes
> from your real token set and flags unknown classes; the visual smoke checks in Lesson 12.3;
> and code review by someone who knows the token names. None of them is a compiler. This is
> also the strongest argument for the `Record<SeverityLevel, string>` map in Step 6 — it moves
> the four class strings that matter most into a place where TypeScript *can* check them.

## Control Questions

1. `--color-severity-s1` is declared in a plain `@theme` block and `--color-background` in an
   `@theme inline` block. Describe what each one puts in the compiled stylesheet, and explain
   why moving the severity tokens into the `inline` block would break both check 3 of
   `## Verification` and Module 13.
2. `tailwind.config.ts` exists in a version of Tailwind that does not need a config file. Name
   the one thing in it that has no CSS equivalent, and say what would have to be true for the
   file to be deleted.
3. A caller writes `<Card className="px-8" />` on a component whose base string is `px-4`, and
   gets `px-4`. Explain why, without using the word "specificity", and name the mechanism
   Lesson 11.2 introduces to fix it.
4. `.dark` overrides eight tokens and nothing in this module ever sets that class on `<html>`.
   Argue that this is correct rather than unfinished, and say what a theme toggle would have to
   do that a `dark:` prefix does not already handle.
5. You add `bg-severity-s9` to a component. Nothing fails: not `type-check`, not `lint`, not
   `build`. Explain why each of those three tools is blind to it, and name the one place in
   Step 6's code where the same class of mistake *would* have been caught.

## Learn More

- [Tailwind CSS v4: theme variables](https://tailwindcss.com/docs/theme) — the authoritative
  description of `@theme`, the namespaces, and the `inline` option Key Concept 3 turns on
- [Tailwind CSS: detecting classes in source files](https://tailwindcss.com/docs/detecting-classes-in-source-files)
  — what automatic detection actually scans, and the `source()` and `@source` escape hatches
  Step 4 uses
- [Tailwind CSS: dark mode](https://tailwindcss.com/docs/dark-mode) — the `@custom-variant`
  recipe for class-based dark mode, including the `:where()` trick that keeps specificity flat
- [Tailwind CSS: functions and directives](https://tailwindcss.com/docs/functions-and-directives)
  — `@plugin`, `@config`, `@custom-variant`, `@source`, `@apply`, in one page
- [`@tailwindcss/typography`](https://github.com/tailwindlabs/tailwindcss-typography) — the
  `prose` class, every `--tw-prose-*` variable Step 3 sets, and the modifier list
- [MDN: `oklch()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch) — why
  perceptual lightness makes `bg-severity-s1/15` predictable and `#c0392b` at 15% opacity not
- [MDN: CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)
  — the cascade rules that make the `.dark` block in Step 4 work
- [WordPress: `theme.json` presets](https://developer.wordpress.org/block-editor/how-to-guides/themes/global-settings-and-styles/)
  — the other end of the token contract, which Lesson 13.5 writes against these same four colours
