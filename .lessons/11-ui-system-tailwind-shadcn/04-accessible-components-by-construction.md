---
title: 'Accessible Components by Construction'
module: 11
lesson: 4
teaches: [semantic-html, landmarks, heading-order, focus-management, keyboard-navigation, skip-link, focus-visible, reduced-motion, aria-last-resort]
produces: ['next-app/src/components/layout/SkipLink.tsx', 'next-app/src/components/ui/visually-hidden.tsx']
requires: [11.3]
---

# Lesson 11.4 — Accessible Components by Construction

## Quick Overview

Accessibility retrofitted is accessibility half-done. This is a full lesson, not a coda, and it
sits here — after the shell exists and before forty more components get written — because every
pattern you establish now is a pattern you will not have to fix in Module 22. The work is
concrete: correct semantic elements, one `<main>` and one `<h1>` per page, a heading order with
no skipped levels, a visible focus ring that survives a designer's opinion, keyboard operation
of every interactive control, focus moved deliberately when the UI changes underneath the user,
a skip link that actually works, and `prefers-reduced-motion` respected by every transition you
added in Lesson 11.1.

The rule that organises all of it: **semantics first, ARIA last.** A `<button>` is focusable,
activates on `Enter` and `Space`, announces itself as a button, and participates in forms — for
free, in every browser, forever. A `<div role="button" tabIndex={0}>` needs two key handlers, a
focus style, and a maintainer who remembers all of it. Every `aria-*` attribute in this codebase
must justify itself against "could a native element have done this?", and most cannot answer.
The other rule, and it is the one this lesson exists to teach: **client-side navigation breaks
focus, and only you can fix it.**

By the end of this lesson you will have:

- `next-app/src/components/layout/SkipLink.tsx` — visually hidden until focused, targeting a real `<main id>`
- `next-app/src/components/ui/visually-hidden.tsx` — the correct clip-rect technique, not `display: none`
- A `focus-visible` ring token applied through the `ui/` primitives, verified with the keyboard on every route
- Landmark and heading-order fixes across `Header`, `Footer`, `MobileNav` and every Module 09 route
- `prefers-reduced-motion` honoured by every transition, and a written list of every `aria-*` attribute in the codebase with its justification

## Classic WP Analogy

WordPress takes accessibility seriously and has trained you in more of this than you probably
credit yourself for:

| Classic WordPress | Here |
|---|---|
| The **accessibility-ready** theme requirements | the checklist this lesson works through |
| `.screen-reader-text` in every starter theme | `VisuallyHidden`, same clip-rect technique |
| The skip link Underscores ships in `header.php` | `SkipLink.tsx`, same idea, harder to keep working |
| `the_title_attribute()` and `esc_attr()` on labels | accessible names via visible text or `aria-label` |
| `wp.a11y.speak()` in wp-admin | an `aria-live` region, used sparingly |
| `add_theme_support('html5', ['search-form'])` | using `<form role="search">` and native inputs |
| Core's own `<nav>` / `<main>` landmark markup | your landmarks, which nothing adds for you |

The transferable instinct is real: if you have shipped an accessibility-ready theme you already
know that `.screen-reader-text` uses a clip rectangle rather than `display: none` because
screen readers skip hidden content, and you already know the skip link has to be the first
focusable element in the document. None of that changes.

Here is the break, and it is the single most important sentence in this lesson: **Classic
WordPress cannot break focus management, and a React app breaks it by default.** Every
navigation in a PHP theme is a full document load, so the browser resets focus to the top,
re-announces the page title, and returns the user to a known state — for free, on every link
click, without anyone thinking about it. Client-side navigation does none of that. The
`<Link>` you wrote in Lesson 09.4 swaps the page's DOM while leaving focus wherever it was, on
an element that may no longer exist, with no announcement that anything changed. A screen-reader
user hears silence; a keyboard user's next `Tab` starts from an unpredictable place. Nothing in
Next.js fixes this, no linter catches it, and it does not show up in a mouse-based click-through
of the site. It is the accessibility bug that Classic WordPress developers have never had to
think about, and it is now yours.

The second break is smaller and more insidious: the components from Lesson 11.2 *look*
accessible because Radix genuinely is, which makes it easy to assume the whole page is. Radix
gives you a correct dialog. It cannot give you a sensible heading order, a meaningful accessible
name on your icon-only button, or a `<main>` landmark you never added. Lesson 12.3's Playwright
locators are the enforcement mechanism — a test that finds a button by its accessible role and
name fails the moment the accessible name disappears, which turns accessibility into something
CI notices.

---

## Key Concepts

### 1. Semantics first, ARIA last

The first rule of ARIA is not to use ARIA. That is not a slogan — it is the first rule in the
W3C's own authoring practices, and the reason is that a native element carries behaviour no
attribute can add.

| | `<button onClick>` | `<div role="button" tabIndex={0} onClick>` |
|---|---|---|
| Focusable | ✅ free | ⚠️ only because of `tabIndex` |
| `Enter` activates | ✅ free | ❌ you write a `keydown` handler |
| `Space` activates | ✅ free | ❌ a **second** handler, with `preventDefault` |
| Announced as a button | ✅ free | ⚠️ only because of `role` |
| Disabled state | ✅ `disabled` | ❌ `aria-disabled` plus your own guard |
| Participates in a `<form>` | ✅ free | ❌ never |
| Default focus ring | ✅ free | ❌ you supply one |
| Works with a `<button>`-shaped browser extension, voice control, switch access | ✅ | ⚠️ maybe |

Every `aria-*` attribute in this codebase must answer one question: **could a native element
have done this?** Most cannot answer it. The ones that can survive the audit in Step 8, and the
ones that cannot get deleted along with the `<div>` they were propping up.

The corollary is a positive rule, not just a prohibition. Reach for the element that already
means what you mean: `<nav>`, `<main>`, `<article>`, `<time dateTime>`, `<dl>`/`<dt>`/`<dd>` for
the incident meta row, `<button type="submit">` inside a form, `<a href>` for anything that
navigates. `IncidentCard` already uses four of those, which is why it needs no ARIA at all.

### 2. Landmarks, and what a screen reader actually does with them

A landmark is a region a screen-reader user can jump to directly. VoiceOver has a rotor,
NVDA has `D` to cycle regions, JAWS has `R`. Getting them right converts "read the whole page"
into "go to the main content".

| Element | Implicit role | How many per page | Needs a name? |
|---|---|---|---|
| `<header>` (page level) | `banner` | one | no |
| `<nav>` | `navigation` | as many as you like | **yes, once there are two** |
| `<main>` | `main` | **exactly one** | no |
| `<footer>` (page level) | `contentinfo` | one | no |
| `<aside>` | `complementary` | any | if there are two |
| `<section>` | `region` — **only if it has an accessible name** | any | yes, or it is not a landmark |

Two details that catch people. `<header>` and `<footer>` are only `banner` and `contentinfo`
when they are **not** inside `<article>`, `<section>`, `<main>` or `<aside>` — nested ones are
generic. And a `<section>` with no `aria-label` or `aria-labelledby` is not announced as a
region at all, which means the `<section>` wrappers Lesson 11.5 adds around the HOBT bands are
decorative unless they get names.

This app after Lesson 11.3 has three navigation landmarks — `Primary`, `Mobile`, `Social` —
which is exactly why each one carries an `aria-label`. Two unnamed `<nav>` elements announce as
"navigation, navigation" and the user has to enter each one to find out which is which.

### 3. Heading level is document structure, not font size

A screen-reader user navigates a page by heading: `H` to move, `1`–`6` to jump to a level. That
only works if the levels describe the document's nesting. The rules are boring and absolute:

- **Exactly one `<h1>` per page**, and it names what the page is about.
- **No skipped levels going down.** `<h2>` may follow `<h1>`; `<h3>` may not.
- Going back up is fine. `<h4>` followed by `<h2>` starts a new section.
- A heading with no content, or a heading used for visual emphasis, is a bug.

Tailwind makes exactly one of these easy to get wrong, and it is worth naming precisely:
`text-2xl` is available on any tag, so **the visual size and the semantic level are now
completely independent**. That is a feature — a `<h2>` that needs to look small is one class —
and it is also the trap, because the fastest way to get the design you want is to pick the tag
whose default size is closest, which is picking a heading level for a font-size reason.

```
❌ chosen for size                    ✅ chosen for structure
<h1>Incidents</h1>                   <h1>Incidents</h1>
<h3>Filters</h3>   ← skips h2         <h2 className="text-sm">Filters</h2>
<h2>Results</h2>                      <h2>Results</h2>
<h4>DNS ate …</h4> ← skips h3          <h3 className="text-lg">DNS ate …</h3>
```

Step 6 audits every Module 09 route against this. The `IncidentCard` title is an `<h3>` because
it sits under the list's `<h2>`, which sits under the page's `<h1>` — and if the same card is
ever rendered on a page where it is the top-level content, that is when it should take a level
prop rather than being changed in place.

### 4. `focus-visible` versus `focus`, and the regression that ships most often

`:focus` matches whenever an element has focus, including a mouse click. `:focus-visible`
matches when the browser judges a focus indicator to be useful — keyboard navigation, yes;
clicking a button, no. That distinction is the entire reason designers ever asked for
`outline: none`.

| Selector | Matches on click | Matches on `Tab` | Use for |
|---|---|---|---|
| `:focus` | ✅ | ✅ | the rare case where any focus must be visible — see below |
| `:focus-visible` | ❌ (for buttons) | ✅ | **everything else** |
| `:focus-within` | — | — | styling a container when a descendant has focus |

**`outline: none` with no replacement is the single most common accessibility regression in a
designed application.** It is one line, it makes the design look right in the screenshot, and
it makes the app unusable by keyboard. Tailwind's preflight already removes the browser default,
so Lesson 11.1 put a token-driven ring back at the base layer and every `ui/` primitive pairs
`focus-visible:outline-none` with `focus-visible:ring-2 focus-visible:ring-ring`. The rule for
this codebase: **`outline-none` never appears without a `focus-visible:` replacement on the same
element.** Check 6 of `## Verification` enforces it with `grep`.

There is exactly one place in this lesson where plain `focus:` is correct, and it is the skip
link. A skip link must become visible for *any* focus, including focus moved programmatically
by JavaScript — and `:focus-visible` does not reliably match a programmatic `.focus()` call,
because the browser's heuristic is about the user's last input modality. A skip link styled with
`focus-visible:` can be focused and still invisible, which is worse than not having one.

### 5. The clip-rect technique, which WordPress has shipped for a decade

"Visually hidden but available to assistive technology" has exactly one correct implementation,
and you already have it in every starter theme you have ever touched:

```css
/* (illustration) the .screen-reader-text rule from a WordPress starter theme */
.screen-reader-text {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

Tailwind's `sr-only` utility is that rule, generated once. So `VisuallyHidden` is a thin
component over `sr-only`, and the reason it is a component rather than a class you remember is
that Step 8's audit needs one place to look.

The four wrong techniques, and why each is wrong:

| Technique | Why it fails |
|---|---|
| `display: none` / `visibility: hidden` / `hidden` | removed from the accessibility tree — **screen readers skip it entirely**, which is the opposite of the goal |
| `text-indent: -9999px` | breaks in RTL, where `-9999px` pushes the text *into* the viewport. Module 20 adds locales, so this is a real concern, not a theoretical one |
| `opacity: 0` | still occupies layout, still a click target, still focusable |
| `font-size: 0` | inconsistently ignored by screen readers, and breaks any child with its own size |

`sr-only` is the answer. `not-sr-only` is its inverse, which is what makes
`sr-only focus:not-sr-only` a skip link.

### 6. The skip link, and the detail everyone misses

Three requirements, all of which the Underscores `header.php` version satisfies:

1. It is the **first focusable element in the document** — so it must be the first child of
   `<body>`, before the header.
2. It is visually hidden until focused, then visible with enough contrast to read.
3. Its `href` targets a real `id` on a real element.

The detail that gets missed is the fourth: **the target needs `tabIndex={-1}`.** Following
`href="#main"` scrolls the page and updates the URL fragment, but in several browsers it does
*not* move keyboard focus unless the target is focusable. Without `tabIndex={-1}` on `<main>`,
the user activates the skip link, the page scrolls, and their next `Tab` continues from the skip
link — straight back into the navigation they were trying to skip.

`tabIndex={-1}` means "not in the tab order, but focusable programmatically", which is exactly
the semantics needed. It does not make `<main>` reachable by `Tab`, so it costs nothing.

> **Yes, this puts a focus ring around the entire main region when the skip link is used.**
> That is deliberate feedback, not a bug: focus moved somewhere, and a keyboard user is
> entitled to see where. Suppressing it with `focus:outline-none` on `<main>` is the same
> mistake as Key Concept 4, one element larger.

### 7. Client-side navigation breaks focus, and only you can fix it

This is the most important subsection in the lesson, because it is the one bug in the module
that a Classic WordPress developer has never had to think about — and could not have, because
the platform made it impossible.

```
CLASSIC WORDPRESS                      THIS APP
click a link                           click a <Link>
  ▼                                      ▼
full document unload + load            React swaps the page subtree
  ▼                                      ▼
browser: focus → document root         focus stays on the clicked element…
browser: announce new <title>          …which may no longer be in the DOM
browser: scroll to top                 no announcement, no focus change
  ▼                                      ▼
user is in a KNOWN state               user is nowhere in particular
  (for free, every time)                 (and nothing warned you)
```

Concretely: a keyboard user tabs to "Blog" in the header, presses `Enter`, and the blog page
renders. Their next `Tab` starts from wherever React left focus — often `<body>`, which means
tabbing from the very top again, or an element that was unmounted, which means the browser has
to guess. A screen-reader user hears nothing at all: no title, no heading, no confirmation that
the activation did anything.

What Next does and does not do for you, stated exactly:

| | Next App Router | You |
|---|---|---|
| Announces the new page title | ✅ it injects a route announcer element | — |
| Moves focus to the new content | ❌ | **yes** |
| Resets scroll position | ✅ by default | — |
| Warns you about any of this | ❌ | — |

So half the problem is solved and it is the half that is easier to notice. The focus half looks
like this:

```tsx
// (illustration) src/components/layout/RouteFocus.tsx — Module 22 Lesson 22.2 builds the real one
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function RouteFocus() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    // Do NOT steal focus on the initial load — the user may already be typing.
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('main')?.focus();
  }, [pathname]);

  return null;
}
```

And here are its limits, because pretending it is finished is worse than not shipping it:

- It fires on **every** pathname change, including a filter that pushes a query string via
  `useRouter` — which would yank focus out of the control the user is operating.
- Focusing `<main>` makes a screen reader start reading from there, which is usually right and
  is wrong on a page whose first meaningful content is above `<main>`.
- The back button is a pathname change too, and moving focus on a back navigation is more
  disorienting than helpful.
- Nothing about this is standardised. Every SPA framework has an open issue about it, and the
  accessibility community has not converged.

That is why this lesson establishes the skip link — which lets a keyboard user recover in one
keystroke from *any* focus position, including a broken one — and leaves the announcer and the
focus-move policy to Module 22, where there is a screen reader in the loop to judge it.

### 8. Keyboard operation, and the honest division of labour with Radix

Everything Lesson 11.2 and Lesson 11.3 built has to be operable without a mouse. Here is who
supplies what:

| Behaviour | Radix | You |
|---|---|---|
| `Tab` order follows the DOM | — | keep the DOM order matching the visual order |
| Focus trapped inside an open dialog or sheet | ✅ | — |
| `Escape` closes an overlay | ✅ | — |
| Focus returns to the trigger on close | ✅ | — |
| Arrow keys move through a `Select`'s options | ✅ | — |
| Typeahead in a `Select` | ✅ | — |
| An icon-only button has an accessible name | ❌ | **`<VisuallyHidden>` inside it** |
| A `<main>` landmark exists | ❌ | **you add it** |
| Heading levels nest correctly | ❌ | **you audit them** |
| A visible focus ring | ❌ (unstyled by design) | **the `ring` token** |
| The drawer closes on navigation | ❌ | **Lesson 11.3 Step 4** |
| Focus moves after a route change | ❌ | Key Concept 7, Module 22 |

Read the right-hand column as the lesson's actual scope. Radix's guarantees are real and worth
the dependency; they are also all *within* a component, and every remaining problem is about
the page.

The trap here is confidence. The components from Lesson 11.2 *feel* accessible, because the
interactive ones genuinely are — so a click-through with a mouse, or even a `Tab`-through of one
dialog, suggests the page is fine. It is not the components that are usually broken.

### 9. `prefers-reduced-motion` means reduce, not remove

Some users get motion sickness, migraines or vertigo from screen animation. The OS setting
exists, the browser exposes it, and `motion-reduce:` is Tailwind's variant for it.

What "reduce" means is more specific than "turn everything off":

| Animation | Under `reduce` | Why |
|---|---|---|
| A large element sliding across the viewport | ❌ remove | vestibular trigger — apparent self-motion |
| Parallax, zoom, spin, bounce | ❌ remove | same |
| A looping pulse (`animate-pulse` on a skeleton) | ❌ remove | continuous motion in peripheral vision |
| A 150 ms colour or opacity fade | ✅ keep | no apparent motion; removing it makes state changes harder to perceive |
| An instant state change with no transition | ✅ fine | — |

So the pattern is `transition-colors motion-reduce:transition-none` on things that move, and
leaving short colour fades alone where they carry meaning. This module added transitions in
three places — `Button`, `Badge` and `IncidentCard` — plus `Skeleton`'s `animate-pulse` and the
`Sheet`'s slide-in, and Step 7 covers all five.

> **Test it, do not assume it.** macOS: System Settings → Accessibility → Display → Reduce
> motion. Chrome DevTools: the Rendering panel has an "Emulate CSS `prefers-reduced-motion`"
> dropdown, which is faster and does not change your whole machine.

**The enforcement mechanism, and why this lesson pays for itself in Module 12.** Lesson 12.3's
Playwright locators find controls by **accessible role and name** —
`page.getByRole('button', { name: 'Open main menu' })`. That is not a stylistic preference in
the test suite: it means a test fails the moment an accessible name disappears. Delete the
`<VisuallyHidden>` from the hamburger and the E2E spec goes red, in CI, on the pull request that
did it. Module 22 then runs axe over these same components and adds the WCAG 2.2 AA sweep. The
work in this lesson is what makes both of those cheap.

---

## Task

### Step 1: Add `eslint-plugin-jsx-a11y`

```bash
cd next-app

npm view eslint-plugin-jsx-a11y license
# Expected: MIT

npm install --save-dev eslint-plugin-jsx-a11y
```

Add a flat-config block. This is an **edit** to the file Lesson 07.5 created and Lessons 08.1
and 09.1 have already extended.

```js
// next-app/eslint.config.mjs — add the import at the top, and the block below
import jsxA11y from 'eslint-plugin-jsx-a11y';

// …existing config array…
  {
    files: ['src/**/*.tsx'],
    // `flatConfigs` (plural) is the flat-config export; the older `configs`
    // key is the eslintrc shape and will not work in eslint.config.mjs.
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Three upgrades over `recommended`, each because this app has the pattern:
      // an icon-only trigger (MobileNav), next/link everywhere, and headings
      // whose content comes from WordPress and can be empty.
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/heading-has-content': 'error',
      'jsx-a11y/anchor-is-valid': ['error', { components: ['Link'], aspects: ['invalidHref'] }],
    },
  },
```

**Verify §1:**

- [ ] `npm run lint` still passes, or reports real findings you are about to fix.
- [ ] The plugin is genuinely running — Step 8 of `## Verification` proves it by breaking
      something on purpose. A linter you have not seen fail is a linter you have not installed.

### Step 2: Write `VisuallyHidden`

```tsx
// next-app/src/components/ui/visually-hidden.tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

/**
 * Visually hidden, available to assistive technology.
 *
 * `sr-only` is Tailwind's name for the clip-rectangle rule WordPress starter
 * themes have shipped as `.screen-reader-text` for a decade:
 *   position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden;
 *   clip:rect(0,0,0,0); white-space:nowrap; border-width:0
 *
 * It is NOT `display:none` (removed from the accessibility tree, so screen
 * readers skip it) and NOT `text-indent:-9999px` (which pushes the text into
 * the viewport in an RTL locale — Module 20 adds locales). See Key Concept 5.
 *
 * `asChild` exists so an existing element can be hidden without adding a
 * wrapper: <VisuallyHidden asChild><h2>Filters</h2></VisuallyHidden>.
 */
function VisuallyHidden({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp data-slot="visually-hidden" className={cn('sr-only', className)} {...props} />
  );
}

export { VisuallyHidden };
```

### Step 3: Write `SkipLink`

```tsx
// next-app/src/components/layout/SkipLink.tsx
/**
 * The first focusable element in the document. Must be the first child of
 * <body>, and its href must target a real, focusable element — see Step 4.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      // `focus:`, NOT `focus-visible:`. A skip link must appear for ANY focus,
      // including focus moved programmatically by JavaScript, and
      // :focus-visible does not reliably match a .focus() call. Key Concept 4.
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      Skip to main content
    </a>
  );
}
```

### Step 4: Add the landmark the skip link targets

Two changes to the root layout: the skip link first, and the `<div>` wrapper from Lesson 11.3
promoted to a real `<main>`.

```tsx
// next-app/src/app/[locale]/layout.tsx — inside <body>
      <body className="min-h-dvh bg-background text-foreground">
        {/* FIRST child of <body>, before the header — so it is the first thing
            Tab reaches. Anything above it makes it useless. */}
        <SkipLink />

        <Header locale={locale} siteTitle={chrome.generalSettings?.title ?? 'Blame The Tech'} />

        {/* tabIndex={-1} is the detail everyone misses. Without it, following
            href="#main" scrolls the page but does NOT move keyboard focus in
            several browsers, so the next Tab continues from the skip link —
            straight back into the nav the user was skipping. Key Concept 6. */}
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>

        <Footer />
      </body>
```

Add the import alongside `Header` and `Footer`:

```tsx
// next-app/src/app/[locale]/layout.tsx — add to the imports
import { SkipLink } from '@/components/layout/SkipLink';
```

**Now delete the `<main>` that every route file opens for itself.** Until this moment each page
had to provide its own, because there was no landmark above it — Lesson 09.1 wrote the first one
and every route since has copied it. The layout owns it from here, and two `main` landmarks is
invalid HTML: a screen-reader user gets a landmarks list with two entries called "main content"
and no way to tell which is the page.

Eleven files. In each, delete the opening `<main …>` and its closing `</main>`, and return a
fragment (`<>` … `</>`) instead — the layout supplies the padding and the max-width now, so the
`className` goes with it:

| File | Lesson that wrote it |
|---|---|
| `src/app/[locale]/page.tsx` | 09.1, rewritten 09.3 |
| `src/app/[locale]/incidents/page.tsx` | 09.2 |
| `src/app/[locale]/incidents/[slug]/page.tsx` | 09.3 |
| `src/app/[locale]/blog/page.tsx`, `blog/[slug]/page.tsx` | 09.4 |
| `src/app/[locale]/reviews/page.tsx`, `reviews/[slug]/page.tsx` | 09.4 |
| `src/app/[locale]/scapegoats/page.tsx` | 09.4 |
| `src/app/[locale]/error.tsx`, `not-found.tsx`, `loading.tsx` | 10.4 |

`loading.tsx` is the one worth a second look: it carries `<main aria-busy="true">`, and
`aria-busy` is doing real work. Move the attribute onto the wrapper you keep — a `<div
aria-busy="true">` is fine, because `aria-busy` is not a landmark role. `/hobt` needs no change:
Lesson 11.5 composes it from `<section>` elements with no `<main>` of its own, which is why it
was written that way.

> **Why this was not a mistake in Module 09.** A page that is the whole document needs a `main`
> landmark, and in Module 09 each page *was* the whole document. The duplication appears the
> moment a shared layout grows one, which is this step. The general rule is worth keeping:
> **a landmark belongs to whichever component owns the whole of it**, and when ownership moves
> up the tree the old owner has to let go. Nothing in the type system tells you that.

**Verify §4:**

- [ ] There is exactly one `<main>` in the rendered HTML, and exactly one `id="main"`. If you
      see two, a route file still opens its own — `grep -rln '<main' 'src/app/[locale]'` names
      it, and the answer is always to delete it, never to delete the layout's.
- [ ] Load `http://localhost:3000/en`, press `Tab` once. "Skip to main content" appears at the
      top left. Press `Enter`. Press `Tab` again — focus is now inside the page content, not
      back in the header.

### Step 5: Give the icon-only controls real names, and the primitives a real ring

Two sweeps through `src/components/`.

First, accessible names. `MobileNav`'s trigger currently uses a raw `sr-only` span; swap it for
the component so Step 8's audit has one place to look:

```tsx
// next-app/src/components/layout/MobileNav.tsx — replace the raw span
        <Button variant="ghost" size="icon">
          {/* aria-hidden on the icon: it is decoration, and without this the
              accessibility tree may announce the SVG's title as well. */}
          <Menu aria-hidden="true" />
          <VisuallyHidden>Open main menu</VisuallyHidden>
        </Button>
```

Second, the focus ring. Every interactive primitive from Lesson 11.2 must pair
`focus-visible:outline-none` with a `focus-visible:ring-*` replacement on the same element.
`Button` and `Badge` already do — you wrote them. Check the six you did not:

```bash
grep -rn 'outline-none\|outline-0' src/components/ui/ | grep -v 'focus-visible:ring'
# Expected: no output.
# Every hit is an element whose focus ring was removed and not replaced. Add
# `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
# to that element's class string.
```

```bash
grep -rn 'focus-visible:ring-ring' src/components/ui/
# Expected: at least one hit in each of button, badge, input, select, dialog,
#           sheet. `card` and `skeleton` are not focusable and need none.
```

### Step 6: Audit heading order and landmarks on every Module 09 route

Open each route, read the outline, fix it. One line each — this is the whole list:

| Route | Heading structure it must have | The fix, if any |
|---|---|---|
| `/en` | `h1` "Blame The Tech" → `h2` "Latest incidents" → card titles `h3` | card titles were `h2`; drop them to `h3` |
| `/en/incidents` | `h1` "Incidents" → `h2` "Filters" → `h2` "Results" → card titles `h3` | "Filters" had no heading at all; add one, hidden with `VisuallyHidden asChild` if the design has no room |
| `/en/incidents/[slug]` | `h1` the incident title → `h2` "Stack trace", `h2` "Blame" | the title was an `h2` under a decorative `h1`; the incident **is** the page |
| `/en/blog` | `h1` "Blog" → post titles `h2` | fine already |
| `/en/blog/[slug]` | `h1` the post title, then whatever `content` contains | ⚠️ see the note below |
| `/en/reviews` | `h1` "Tech Reviews" → review titles `h2` | fine already |
| `/en/reviews/[slug]` | `h1` the company name → `h2` "Pros", `h2` "Cons" | pros/cons were `h3` with no `h2` above them |
| `/en/scapegoats` | `h1` "The Blame Leaderboard" → `h2` per scapegoat, or a table with `<th scope>` | a leaderboard is tabular data; a `<table>` with real headers beats a styled list |

> ⚠️ **`/en/blog/[slug]` cannot be fully fixed in this lesson, and you should know why.** The
> body is WordPress's `content` string rendered with `dangerouslySetInnerHTML` — a named, dated
> debt from Lesson 09.3, paid off in Module 14. Whatever heading levels the editor used are in
> that blob, and you cannot audit or adjust them from React. The most you can do now is make
> sure the page's own `h1` is the post title, so the editor's `h2` headings nest under
> something. When Module 14 renders blocks as data, `BlockRenderer` can shift a heading level.

Landmarks, at the same time:

- One `<header>`, one `<footer>`, one `<main>` — all in the layout, all done in Step 4,
  **including the eleven route files that had to give theirs up**.
- Three `<nav>` elements, each named: `Primary`, `Mobile`, `Social`. Done in Lesson 11.3.
- `IncidentCard` is an `<article>`. A list of them is a `<ul>` of `<li>` — a list of things
  should announce its length, and "list, 40 items" is genuinely useful.

### Step 7: Honour `prefers-reduced-motion` on all five animations

```tsx
// next-app/src/components/ui/skeleton.tsx — add the motion-reduce variant
      className={cn('animate-pulse rounded-md bg-accent motion-reduce:animate-none', className)}
```

`Button` and `Badge` already carry `motion-reduce:transition-none` from Lesson 11.2, and
`IncidentCard` from Lesson 11.1. That leaves `Sheet`, whose slide-in is exactly the
large-element-moving-across-the-viewport case from Key Concept 9:

```tsx
// next-app/src/components/ui/sheet.tsx — on SheetContent's class string
        'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none motion-reduce:transition-none',
```

**Verify §7:**

- [ ] In Chrome DevTools → Rendering → "Emulate CSS `prefers-reduced-motion`", set `reduce`.
- [ ] The skeleton on a `loading.tsx` boundary is a static grey block, not a pulse.
- [ ] The mobile drawer appears without sliding.
- [ ] Button hover still changes colour. That is correct — a colour fade is not a vestibular
      trigger and removing it makes state harder to perceive.

### Step 8: Audit every `aria-*` in the codebase and justify each one

```bash
grep -rho 'aria-[a-z]*' src/components/ src/app/ | sort | uniq -c | sort -rn
```

Write the result up with a justification per attribute. This file is new, and Module 22 extends
it rather than starting over.

```markdown
<!-- docs/accessibility.md -->
# Accessibility notes

Established in Lesson 11.4. Extended in Module 22. The rule this file exists to enforce:
**every `aria-*` attribute must answer "could a native element have done this?"** If it can,
the attribute is deleted and the element is changed.

## Landmarks

| Landmark | Element | Where | Named? |
|---|---|---|---|
| `banner` | `<header>` | `layout/Header.tsx` | no — one per page |
| `navigation` | `<nav aria-label="Primary">` | `layout/Header.tsx` | yes — three navs exist |
| `navigation` | `<nav aria-label="Mobile">` | `layout/MobileNav.tsx` | yes |
| `navigation` | `<nav aria-label="Social">` | `layout/Footer.tsx` | yes |
| `main` | `<main id="main" tabIndex={-1}>` | `app/[locale]/layout.tsx` | no — exactly one |
| `contentinfo` | `<footer>` | `layout/Footer.tsx` | no — one per page |

## Every `aria-*` in `src/`, and why

| Attribute | Where | Justification | Could a native element do it? |
|---|---|---|---|
| `aria-current="page"` | `layout/NavLink.tsx` | marks the active nav item; a colour change announces nothing | no — there is no native "current" state for a link |
| `aria-label` on `<nav>` | Header, MobileNav, Footer | three navigation landmarks must be distinguishable | no — `<nav>` has no native naming mechanism without visible text |
| `aria-hidden="true"` | every decorative `lucide-react` icon | the icon duplicates adjacent text, or is decoration next to a `VisuallyHidden` name | no — this is the sanctioned way to remove decoration from the tree |

Three attributes, three justifications. Every lesson that adds a fourth adds a row.

**Generated by Radix, not present in our source.** `dialog.tsx`, `sheet.tsx` and `select.tsx`
emit `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, `aria-expanded`,
`aria-controls` and matching `id`s at render time. They will not appear in a `grep` of `src/`.
They are audited by reading the rendered DOM, and by Module 22's axe run.

## Deliberately NOT used

| Not used | Why |
|---|---|
| `role="button"` | there is no non-`<button>` control in this app |
| `role="navigation"` | `<nav>` already has it |
| `tabIndex` > 0 | a positive tabindex overrides DOM order and is always a bug |
| `aria-live` | nothing announces yet. Module 22 Lesson 22.2 adds one for filter results |
| `autoFocus` | banned by lint rule — it moves focus before the user asked |

## Known gaps, owned by a later module

| Gap | Owner |
|---|---|
| Focus is not moved after a client-side navigation | Module 22 (Lesson 11.4 Key Concept 7 describes the fix and its limits) |
| Heading levels inside `dangerouslySetInnerHTML` content cannot be audited | Module 14 makes them auditable by parsing the blocks; controlling them stays with Module 22 |
| No colour-contrast measurement of the severity tokens against their backgrounds | Module 22 |
| No screen-reader pass with VoiceOver or NVDA | Module 22 |
```

---

## Verification

```bash
cd next-app

# 1. Lint passes with jsx-a11y active
npm run lint
# Expected: no errors

# 2. Types and build
npm run type-check
# Expected: no errors
npm run build
# Expected: success

# 3. Exactly one <main>, with the id the skip link targets — on EVERY route,
#    not just the home page. One route file keeping its own is the whole failure.
grep -c 'id="main"' 'src/app/[locale]/layout.tsx'
# Expected: 1
for route in /en /en/incidents /en/incidents/incident-01 /en/blog /en/blog/blog-01 \
             /en/reviews /en/reviews/review-01 /en/scapegoats /en/hobt; do
  printf '%-32s ' "$route"
  curl -s "http://localhost:3000$route" | grep -o '<main' | wc -l
done
# Expected: 1 on every line. A 2 means that route file still opens its own <main>.

# 3b. NEGATIVE — no route file declares a <main> any more
grep -rn '<main' 'src/app/[locale]' | grep -v 'layout.tsx'
# Expected: no output

# 4. The skip link is the FIRST focusable element in the document. Its markup must
#    appear before the <header> in the HTML source.
curl -s http://localhost:3000/en | grep -o 'Skip to main content\|<header' | head -2
# Expected: "Skip to main content" on the first line, "<header" on the second.
#           Reversed means SkipLink is not the first child of <body>.

# 5. The main landmark is programmatically focusable. React lowercases tabIndex
#    in the HTML output, and nothing else in the app carries a negative one.
curl -s http://localhost:3000/en | grep -o 'tabindex="-1"' | wc -l
# Expected: 1

# 6. NEGATIVE — no focus ring was removed without a replacement
grep -rn 'outline-none\|outline-0' src/components/ | grep -v 'focus-visible:ring\|focus:ring'
# Expected: no output. A hit is only a real finding if the element genuinely has
#           no ring — Prettier sometimes wraps a long class string across lines,
#           so read the whole string before fixing anything. The requirement is
#           same ELEMENT, not same line.

# 7. Exactly one <h1> on every one of the eight Module 09 routes. Detail-route
#    slugs are read from the index pages so they are not guesses.
INC=$(curl -s http://localhost:3000/en/incidents | grep -o '/en/incidents/[a-z0-9-]\+' | head -1)
POST=$(curl -s http://localhost:3000/en/blog | grep -o '/en/blog/[a-z0-9-]\+' | head -1)
REV=$(curl -s http://localhost:3000/en/reviews | grep -o '/en/reviews/[a-z0-9-]\+' | head -1)
for route in /en /en/incidents /en/blog /en/reviews /en/scapegoats "$INC" "$POST" "$REV"; do
  printf '%-42s ' "$route"
  curl -s "http://localhost:3000$route" | grep -o '<h1' | wc -l
done
# Expected: 1 on every one of the eight lines

# 8. NEGATIVE that tests the LINTER, not the code. Break it on purpose and watch
#    jsx-a11y fail — a linter you have never seen fail is not installed.
sed -i.bak 's|<SkipLink />|<SkipLink /><img src="/x.png" />|' 'src/app/[locale]/layout.tsx'
npm run lint; echo "lint exit=$?"
# Expected: lint exit=1, with jsx-a11y/alt-text: "img elements must have an alt prop"
mv 'src/app/[locale]/layout.tsx.bak' 'src/app/[locale]/layout.tsx'
npm run lint
# Expected: no errors

# 9. NEGATIVE — VisuallyHidden uses the clip rectangle, not display:none
grep -nE 'display:[[:space:]]*none|text-indent|invisible|opacity-0' \
  src/components/ui/visually-hidden.tsx
# Expected: no output
grep -c 'sr-only' src/components/ui/visually-hidden.tsx
# Expected: 1 or more

# 10. The clip rectangle really is what `sr-only` compiles to
grep -o 'clip:[[:space:]]*rect([^)]*)' .next/static/css/*.css | head -1
# Expected: clip:rect(0,0,0,0) — the same rule WordPress ships as
#           .screen-reader-text. Whitespace may differ with the minifier.

# 11. The icon-only trigger has an accessible name
curl -s http://localhost:3000/en | grep -o 'Open main menu' | wc -l
# Expected: 1

# 12. Every aria-* attribute in the source is accounted for in docs/accessibility.md
grep -rho 'aria-[a-z]*' src/components/ src/app/ | sort -u
# Expected: aria-current, aria-hidden, aria-label — three, and three rows in
#           docs/accessibility.md. Any attribute here that is NOT a row there is
#           either undocumented or unjustified. Both are findings. Lesson 11.5
#           adds two more and must add two rows.

# 13. Reduced motion is honoured by the two looping animations
grep -c 'motion-reduce' src/components/ui/skeleton.tsx src/components/ui/sheet.tsx \
  src/components/ui/button.tsx src/components/ui/badge.tsx
# Expected: 1 or more for each of the four files

# 14. NEGATIVE — no positive tabindex anywhere. A positive tabindex overrides DOM
#     order and is always a bug.
grep -rn 'tabIndex={[1-9]' src/
# Expected: no output

# 15. Keyboard, by hand, in the browser. There is no substitute for this.
#     - Tab once on /en: the skip link appears. Enter: focus lands in <main>.
#     - Tab through the header: every link is reached, in visual order, ring visible.
#     - Narrow the window. Enter on the hamburger: drawer opens, focus inside.
#     - Tab repeatedly: focus never leaves the open drawer.
#     - Escape: drawer closes, focus is back on the hamburger.
#     - On /en/incidents: the severity Select opens with Enter, moves with arrows,
#       closes with Escape, and the chosen value is announced.
```

## Control Questions

1. `<main>` carries `tabIndex={-1}`. Describe the exact user-visible failure if you remove it,
   and explain why the URL fragment still changes even in the broken version.
2. `SkipLink` uses `focus:` and every `ui/` primitive uses `focus-visible:`. State the rule that
   decides which to use, and name the one property of `:focus-visible` that makes it wrong for a
   skip link.
3. Check 8 of `## Verification` deliberately introduces an `<img>` with no `alt`, then removes
   it. Explain what that check proves that check 1 does not, and why testing the linter is the
   right thing to test at that point in the lesson.
4. Next's App Router announces the new page title after a client-side navigation but does not
   move focus. Explain why the announcement alone leaves a keyboard user in a worse position
   than a full page load would, and name two ways the naive fix (focus `<main>` on every
   pathname change) makes things worse.
5. `VisuallyHidden` uses `sr-only` rather than `display: none`, and `text-indent: -9999px` is
   rejected for a reason that has nothing to do with screen readers. Give both reasons, and say
   which module makes the second one a live concern rather than a theoretical one.

## Learn More

- [WAI-ARIA Authoring Practices: read me first](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/)
  — the five rules of ARIA, including "no ARIA is better than bad ARIA"
- [WAI: page structure and landmarks](https://www.w3.org/WAI/tutorials/page-structure/regions/)
  — the landmark table in Key Concept 2, from the people who define them
- [WAI: headings](https://www.w3.org/WAI/tutorials/page-structure/headings/) — why heading order
  is navigation and not typography
- [MDN: `:focus-visible`](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible) — the
  browser heuristic Key Concept 4 depends on, including its behaviour with `.focus()`
- [MDN: `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
  — the media feature behind `motion-reduce:`, and what "reduce" is specified to mean
- [WCAG 2.2: Bypass Blocks (2.4.1)](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html)
  — the success criterion the skip link satisfies, and the alternatives that also satisfy it
- [WordPress: accessibility-ready theme requirements](https://make.wordpress.org/themes/handbook/review/accessibility/)
  — the checklist you already know, including `.screen-reader-text` and skip links
- [`eslint-plugin-jsx-a11y` rules](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y#supported-rules)
  — every rule in `recommended`, and what each one cannot see
- [Playwright: locating by role](https://playwright.dev/docs/locators#locate-by-role) — the
  `getByRole` API that turns an accessible name into a test assertion in Lesson 12.3
