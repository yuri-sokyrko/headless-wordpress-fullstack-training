---
title: 'Accessibility Foundations for Components'
module: 22
lesson: 1
teaches: [wcag-2-2-aa, semantic-html, landmarks, accessible-name, form-labeling, color-contrast, target-size]
produces: ['next-app/src/app/[locale]/layout.tsx', 'next-app/src/components/layout/Footer.tsx', 'next-app/src/app/[locale]/globals.css', 'next-app/tailwind.config.ts', 'next-app/src/components/ui/form.tsx']
requires: [11.4, 20.3]
---

# Lesson 22.1 — Accessibility Foundations for Components

## Quick Overview

Assistive technology does not read your JSX. It reads the **accessibility tree** — a parallel
structure the browser derives from your DOM, where every node has a role, an accessible name, a
value and a set of states. `<div onClick>` produces a node with role `generic`, no name and no
state, which is why it is invisible to a screen reader and unreachable by keyboard even though
it looks and behaves like a button to you. `<button>` produces role `button`, a name taken from
its content, and focusability for free. Almost all of accessibility is choosing elements whose
default tree node already says the right thing, and reaching for ARIA only when no element does.

This lesson works through the site with WCAG 2.2 AA as the checklist: landmarks so a screen
reader user can jump to `<main>` instead of tabbing through the nav; a heading outline that
reads like a table of contents rather than a list of font sizes; an accessible name on every
icon-only control (the locale switcher, the mobile menu toggle, the sort control); form fields
associated with real `<label>` elements and error messages wired with `aria-describedby` and
`aria-invalid`; the satirical palette measured against 4.5:1 for text and 3:1 for UI components,
with the severity badges being the likely casualty; and the WCAG 2.2 additions that are easy to
miss — 24×24 CSS pixel target sizes, and focus indicators that are not obscured by a sticky header.

By the end of this lesson you will have:

- A landmark structure with exactly one `<main>`, a labelled `<nav>` per navigation region, and a
  `<footer>` that is a real `contentinfo`
- A heading outline per route with no skipped levels, including a documented rule for editor
  content rendered by `RichText`
- An accessible name on every interactive element, verified in the browser's accessibility panel
  rather than assumed from the JSX
- Form fields with associated labels, `aria-describedby` help text, `aria-invalid` on error, and
  a `role="alert"` error summary
- A contrast audit of the palette with the failures listed, the severity-badge pairing corrected in
  `src/app/[locale]/globals.css`, and the `@tailwindcss/typography` prose colours corrected in
  `tailwind.config.ts`
- Target sizes and focus visibility checked against WCAG 2.2 AA, with the sticky-header
  obscuring case fixed

## Classic WP Analogy

You have met most of this before, from the other side of the fence. WordPress has a genuinely
serious accessibility culture — the core Accessibility Coding Standards require WCAG 2.1 AA,
themes in the directory can carry an `accessibility-ready` tag with a real review behind it, and
you have almost certainly used `screen-reader-text` as a utility class or written
`esc_attr__( 'Search for:', 'domain' )` for a label you then visually hid.

| Classic WordPress | React / Next.js |
|---|---|
| `.screen-reader-text` in the theme's CSS | `sr-only` in Tailwind — the same technique, same trap |
| `<label for="s">` in `searchform.php` | `<label htmlFor>` or a shadcn `<FormLabel>` bound by `id` |
| `wp_nav_menu( ['container_aria_label' => …] )` | `aria-label` on `<nav>`, written by you |
| Theme Review's `accessibility-ready` checklist | WCAG 2.2 AA, run by axe and by hand |
| `the_content()` output, heading order out of your hands | `RichText` output, heading order still out of your hands |
| `bloginfo('language')` on `<html lang>` | `params.locale` on `<html lang>` and `dir` |

The knowledge transfers almost completely, and that is genuinely good news. Where it breaks is
**dynamic state**, and it breaks because Classic WordPress barely had any. A PHP-rendered page is
a static document: the accessibility tree is built once from the HTML you printed and never
changes. Almost every accessibility bug you could ship was a markup bug, and markup bugs are the
kind axe catches.

React re-renders. A filter changes the list underneath the user, a dialog appears above
everything else, an inline error replaces a field's help text, a route transition swaps the page
without a page load. Every one of those is a state change the accessibility tree reflects but
**nothing announces** — a screen reader user gets silence, and a keyboard user may find their
focus has been destroyed along with the element it was on. There is no Classic analogue for
"focus was on a button that no longer exists", because in Classic WordPress the page would have
reloaded and focus would have gone to the top of the document by definition. That entire class of
problem is Lesson 22.2, and it is where a React site is genuinely harder to get right than a PHP one.

---

## Key Concepts

### 1. The accessibility tree is the artifact, and it is not your JSX

The browser builds two trees from your markup. The DOM tree is what you inspect in the Elements
panel. The **accessibility tree** is a parallel structure the browser derives from it, and it is
the only one assistive technology ever sees. Every node in it has exactly four things:

| Property | Answers | Comes from |
|---|---|---|
| **Role** | "what kind of thing is this?" | the element name, or an explicit `role=` |
| **Accessible name** | "what is it called?" | a computation — see Key Concept 2 |
| **Value** | "what does it currently hold?" | `value`, `aria-valuenow`, the text content |
| **State** | "checked? expanded? invalid? disabled? current?" | native attributes, or `aria-*` |

Nodes with no useful role and no name are pruned or flattened. That is the whole reason
`<div onClick>` is invisible: it produces a node with role `generic`, no name, no state and no
focusability, so a screen reader has nothing to announce and a keyboard has nothing to reach.
`<button>` produces role `button`, a name from its content, `disabled` as a state, and a place
in the tab order — for free, in every browser, permanently.

```
   YOUR JSX                    DOM                   ACCESSIBILITY TREE
   ────────────────            ──────────            ──────────────────────────────
   <button>                    <button>              button "Get Demo"
     Get Demo                    "Get Demo"            focusable: yes
   </button>                   </button>               state: —

   <div onClick={…}>           <div>                 generic
     Get Demo                    "Get Demo"            focusable: NO
   </div>                      </div>                  name: NONE
                                                        ← identical on screen
```

This is why Step 1's audit happens in the browser's accessibility panel and **not** by reading
components. The panel shows the tree; the JSX shows your intentions. Here those two *mostly*
agree, because Lesson 11.4 chose native elements deliberately — and "mostly" is the word this
lesson exists to replace with a measurement.

### 2. The accessible-name computation, in order — and the one that silently replaces

The accessible name is not "the text inside". It is the result of an algorithm (accname), and
the first source that yields a non-empty string wins:

| Priority | Source | Notes |
|---|---|---|
| 1 | `aria-labelledby` | follows the id references and concatenates their text |
| 2 | `aria-label` | **replaces everything below it, including visible text** |
| 3 | a native labelling mechanism | `<label for>`, `<caption>`, `<figcaption>`, `alt` on `<img>` |
| 4 | the element's own text content | with `aria-hidden` descendants removed |
| 5 | `title` | a tooltip, and a name of last resort |
| 6 | nothing | the control has no name, and is announced as its role alone |

Row 2 is the trap, and it is worth being blunt: **`aria-label` on an element that already has
text content deletes that text from the accessibility tree.** A sighted user reads "Deutsch"; a
screen-reader user hears whatever you wrote in the attribute; a voice-control user says
"click Deutsch" and nothing happens unless the attribute contains that word. That last
consequence is a success criterion in its own right — **2.5.3 Label in Name**, which requires
the accessible name to contain the visible label text.

This app has exactly one `aria-label` on an element with text content, in `LocaleSwitcher`
(Lesson 20.3): a disabled locale button whose visible text is `Deutsch` and whose accessible name
is `Deutsch — not available for this page`. That satisfies 2.5.3 because the visible string is a
prefix of the accessible one. Step 1 records it as **audited and allowed** — a different outcome
from "no hits", and the distinction is the point of auditing at all.

### 3. Landmarks and headings are the two navigation surfaces you cannot see

Lesson 11.4 built both, and Lesson 12.3 pinned them: `getByRole('main')` has count 1 and
`getByRole('heading', { level: 1 })` has count 1, on every route, in CI. So this lesson does not
re-derive the rules — [Lesson 11.4](../11-ui-system-tailwind-shadcn/04-accessible-components-by-construction.md)
Key Concepts 2 and 3 own them. What it does is check the two things a role-based locator cannot
see, because they are about *relationships* rather than presence:

| Already asserted by 12.3 | Not asserted by anything, and this lesson's job |
|---|---|
| exactly one `main` | the heading **order** inside it has no skipped levels |
| exactly one `h1` | the `h1` is the thing the page is *about*, not a decorative banner |
| `banner` and `contentinfo` are visible | the three `nav` landmarks have **distinct, translated** names |
| the `Primary` nav exists | a `<section>` without an accessible name is not a landmark at all |

The last row catches people twice here. `IncidentBrowser` and `IncidentTicker` render bare
`<section>` wrappers and neither is announced as a region — correct, because they are layout
containers. Lesson 11.5's four `hobt/` sections carry `aria-labelledby` because they *are*
regions. Same element, two intentions, and the accessible name is the only thing separating them.

### 4. WCAG 2.2 AA as testable criteria, and the four things that are new since 2.1

WCAG is not a compliance PDF, it is a list of sentences you can each answer yes or no to. That
is what makes it usable: "is this accessible?" has no answer, and "does every non-decorative
image have a text alternative?" has exactly one. Level AA is the conformance target this course
adopts because it is the level regulation almost universally references.

WCAG 2.2 added nine criteria and removed one. Four are at level AA, and two of those four bite
this application:

| New in 2.2 | Level | Does it bite here? |
|---|---|---|
| **2.4.11 Focus Not Obscured (Minimum)** | AA | **Yes.** Lesson 11.3's header is `sticky top-0`, and a focused element that scrolls under it is obscured. Step 5 |
| **2.5.8 Target Size (Minimum)**, 24×24 CSS px | AA | **Yes.** Step 6 measures every target, and one fails on a technicality worth understanding |
| 3.3.8 Accessible Authentication (Minimum) | AA | No. `/login` is a username and password form with `autoComplete` set; nothing requires a cognitive test |
| 3.3.7 Redundant Entry | A | No. No flow asks for the same information twice |
| 2.4.13 Focus Appearance | AAA | Out of scope at AA, and Step 4 fixes the underlying problem anyway |
| 4.1.1 Parsing | **removed** | Duplicate ids are still a bug; they are now failures of 1.3.1 or 4.1.2 instead |

Both criteria that bite are *invisible from a mouse*: a mouse user never scrolls a focused element
under the header, because they never move focus by scrolling. That is the recurring shape of every
finding in this module.

### 5. Contrast is arithmetic on relative luminance, and `oklch` lightness is not that number

Every contrast ratio in WCAG 2.x is `(L1 + 0.05) / (L2 + 0.05)`, where `L` is **relative
luminance**: linearise each sRGB channel, then weight them `0.2126 R + 0.7152 G + 0.0722 B`. The
green weight is more than three times the red one, which is why a mid-green looks bright to the
formula and a mid-blue does not.

`oklch(L C H)` also has a channel called lightness, and it is **not** relative luminance. OKLCh
lightness is perceptual and roughly uniform across hues by design; relative luminance is
photometric and wildly non-uniform. So two tokens with identical `L` can have very different
contrast:

```
   oklch(0.66 0.16  55)   orange   →  #da720d  →  3.27 : 1 on white
   oklch(0.66 0.16 145)   green    →  a much brighter luminance, lower ratio
        ^^^^ same L, and the formula does not care
```

There is a second step almost everyone skips, and it is the one that matters here. The severity
badges do not put the token on white — they put it on `bg-severity-sN/15`, a **15 %-alpha wash of
the same colour over the surface**. You must composite the alpha first and measure the text
against the *result*, not against `--background`. Compositing a colour over white always raises
the background's luminance, so it always makes the ratio worse than the naive reading suggests.

**Which is exactly why Step 2 has you read the numbers out of DevTools rather than trust ours.**
The arithmetic in this lesson was computed, not measured, and an `oklch()`-to-luminance
conversion is not something to assert from a lesson.

### 6. Three criteria people collapse into the word "contrast"

They have different thresholds, different subjects, and different exemptions. Getting them apart
is what turns a vague "the badges look faint" into a decision.

| Criterion | Applies to | Threshold | Key exemption |
|---|---|---|---|
| **1.4.3 Contrast (Minimum)** | **text** and images of text | 4.5:1, or **3:1** for large text (≥ 24 px, or ≥ 18.66 px bold) | disabled controls, pure decoration, logotypes |
| **1.4.11 Non-text Contrast** | UI component boundaries needed to identify it, **focus indicators**, meaningful graphics | 3:1 | a boundary that is not needed to perceive the component |
| **1.4.1 Use of Colour** | any information conveyed by colour | — (no ratio) | satisfied by any additional non-colour cue |

Now apply all three to one badge. `text-xs` is 12 px, so it is normal text and needs **4.5:1** —
the 3:1 large-text allowance does not apply, and assuming it does is the single most common way a
badge audit reaches the wrong answer. The `border-severity-sN/30` outline measures ≈1.3–1.7:1 and
that is **fine**: 1.4.11 requires 3:1 only for a boundary you need in order to perceive the
component, and the badge is perceivable from its text. 1.4.1 is satisfied whatever the ratios
turn out to be, because the badge contains the severity **label** — not a bare red dot.

### 7. Target size 2.5.8, and the Spacing exception that decides the footer

Every pointer target is at least **24×24 CSS px** unless one of five exceptions applies, and the
exception that does the real work is **Spacing**:

> If a 24 px-diameter circle is centred on the bounding box of each undersized target, no circle
> may intersect another target or another undersized target's circle.

So two 20 px links stacked with an 8 px gap have their centres 28 px apart, and two circles of
radius 12 centred 28 px apart do not intersect. They pass. Shrink the gap to 2 px and they fail.

```
       ── 20px link ──                   centre-to-centre = 20 + 8 = 28px
            ● centre                     circle radius    = 12px
       ── 8px gap ────                   12 + 12 = 24  <  28  → no intersection → PASS
       ── 20px link ──
            ● centre
```

The other four retire whole categories of finding: **Inline** (a link inside a sentence),
**Equivalent** (another control on the page does the same job at full size), **Essential** (a map
pin), and **User agent control** (a native `<select>`'s own chrome). Step 6 measures every
control in the app and finds exactly one that survives only on the Spacing exception — a pass you
should not be relying on, and Step 6 says why.

### 8. ARIA is a last resort, and the first four rules of ARIA are all "don't"

Lesson 11.4 established the rule; this is the restatement that makes it actionable during an
audit, because the WAI's own five rules read as a checklist you can run against every attribute:

1. **Don't** use ARIA if a native element with the semantics you need exists.
2. **Don't** change native semantics unless you have no choice.
3. **Don't** make an interactive ARIA control unreachable by keyboard.
4. **Don't** use `role="presentation"` or `aria-hidden="true"` on a focusable element.
5. Every interactive element must have an accessible name.

Four prohibitions and one obligation. The practical consequence for an audit is a bias: a
finding whose fix **adds** an `aria-*` attribute should be viewed with suspicion, and a finding
whose fix **changes an element** should be preferred. That bias is why this lesson's Verification
carries a negative check on new `role=` attributes: an audit that ends with more ARIA than it
started with has usually papered over a markup problem instead of fixing it.

Rule 4 has one live instance here. Lesson 16.3's honeypot is a `<div aria-hidden="true">`
containing an `<input tabIndex={-1}>`, and it is compliant *because* of the `tabIndex={-1}`:
hiding a focusable element from the accessibility tree while leaving it in the tab order is the
exact failure rule 4 names.

### 9. An accessible name is a translated string, and no lint rule can see it

Lesson 20.3 moved every user-visible literal into the message catalogues and added
`react/jsx-no-literals` to stop the next one. Then it named the hole in that rule, precisely, and
handed it to this lesson:

```
   react/jsx-no-literals with ignoreProps: true
   ─────────────────────────────────────────────
   <p>Skip to main content</p>          ← CAUGHT: a JSX text node
   <a aria-label="Skip to main">        ← NOT CAUGHT: it is a prop
   <img alt="A server on fire">         ← NOT CAUGHT: it is a prop
   <button title="Dismiss">             ← NOT CAUGHT: it is a prop
```

`ignoreProps: true` is not negotiable — without it every `className` in the project is a lint
error — so `aria-label`, `alt` and `title` are invisible to the linter *and* they are strings a
screen-reader user hears. Nothing but review enforces that they come from `t()`.

This is a real, measurable gap and not a theoretical one: `Footer.tsx` still hard-codes
`aria-label="Social"` in all three locales, and there is no `nav.social` key in any catalogue for
it to have used. Step 6 fixes it. Two more cases are recorded as **accepted** rather than fixed,
both already in `docs/accessibility.md` from Lesson 20.4: `global-error.tsx` is English-only
because it renders outside the `[locale]` segment and has no request locale, and `alt` text is
English in every locale because media is deliberately untranslated (Lesson 20.1). An accepted
gap with a written reason is a decision; the same gap undocumented is a bug nobody has found yet.

---

## Task

### Step 1: Audit before you change anything, out of the browser and not out of the JSX

Six routes. Not the same six as Module 21's budgets — `/en/blog/blog-01` is swapped for
`/en/incidents/submit`, because a form is where the hard accessibility problems live and a blog
post is where the hard performance ones do.

```bash
# Run the dev server in another terminal: `cd next-app && npm run dev`
# Then open each of these and use the browser's ACCESSIBILITY panel, not Elements.
#   Chrome:   Elements → Accessibility side pane → "Full-page accessibility tree" checkbox
#   Firefox:  the Accessibility tab, "Check for issues → All Issues"
#
#   /en                          /en/incidents/submit
#   /en/incidents                /en/hobt
#   /en/incidents/incident-01    /en/reviews/review-01
```

For each route, write down three things and nothing else. Landmarks, in tree order. Headings,
with their levels. And every interactive node whose accessible name is empty. Here is the table
this codebase should produce, so you can compare rather than guess — **your column is the one
that counts, because it came from a browser and this one came from reading source**:

| Route | Landmarks expected | Heading outline expected | Unnamed controls expected |
|---|---|---|---|
| `/en` | banner, navigation "Primary", main, contentinfo, navigation "Social" | h1 → h2 → h3 × n | none |
| `/en/incidents` | + the filter `<section>`, **not** a region | h1 → h2 "Filters" → h2 "Results" → h3 × n | none |
| `/en/incidents/incident-01` | as `/en` | h1 → h2 × n, plus editor `h2`–`h6` from `RichText` | none |
| `/en/incidents/submit` | as `/en` | h1 "Submit an incident" | none |
| `/en/hobt` | + four `complementary`-free named regions (11.5) | h1 → h2 × 4 → h3 × n | none |
| `/en/reviews/review-01` | as `/en` | h1 → h2 "Pros", h2 "Cons" | none |

Three findings will not show up in that table, and they are the ones worth recording separately.

**The heading outline inside `RichText` is not yours.** Lesson 14.3's `CoreHeading` clamps an
editor's H1 to `<h2>`, so the single-`h1` rule holds — but nothing stops an editor going `h2` →
`h4`, because the renderer sees one block at a time and has no view of the outline. There is no
lint on content available to you, so Step 8 records it as **accepted, owned by the editor**, with
`theme.json`'s level control named as the fix if it ever earns the constraint. Lesson 14.3 Step 7
already replaced Lesson 11.4's stale row with one that names this module as owner.

**`/en/reviews/review-01` does not render a star row.** The module README predicts "a visual star
row that says nothing to a screen reader"; read the route and you find Lesson 09.4's `<dl>` of
four `<dt>`/`<dd>` pairs printing `8.5/10` as text, which already announce. The honest finding is
smaller: the `<dl>` has no accessible name, so a rotor lists four definition pairs with no group
identity, and `/` is read aloud as "slash". Record it as a **minor** — an audit that inflates a
minor into a fix is an audit nobody trusts the second time.

**Two i18n gaps are already written down.** `global-error.tsx` is English-only and `alt` text is
English in every locale, both recorded by Lesson 20.4 with reasons. You are picking them up, not
discovering them: confirm the reason still holds and leave the row.

**Verify §1:**

- [ ] Every route's landmark list has exactly one `main` and exactly one `banner`. Lesson 12.3
      asserts this in CI already — you are confirming it, not proving it.
- [ ] Your "unnamed controls" column is empty on all six routes. One entry here is the most
      serious class of finding in the module, and it stops the rest of this lesson.
- [ ] Repeat on `/de/incidents` and `/uk/incidents`. German compound nouns break a truncated
      accessible name, and there is no other way to find out.

### Step 2: Measure the palette, including the alpha composite everyone skips

The severity badge is `border-severity-sN/30 bg-severity-sN/15 text-severity-sN` at `text-xs`
(Lesson 11.2). Full-strength colour as **text**, on a 15 %-alpha wash of itself. Measure it:

```bash
# Chrome DevTools: inspect a severity badge, click the colour swatch next to `color`
# in the Styles pane, and read the "Contrast ratio" line. It composites the alpha
# background for you, which is the step hand arithmetic gets wrong.
#
# Record YOUR readings. The table below was computed, not measured — Key Concept 5.
```

| Token | Text on the 15 % tint | 4.5:1 for `text-xs`? |
|---|---|---|
| `--color-severity-s1` `oklch(0.52 0.19 25)` | ≈ **4.75 : 1** | **passes**, with 0.25 of headroom |
| `--color-severity-s2` `oklch(0.66 0.16 55)` | ≈ **2.78 : 1** | fails |
| `--color-severity-s3` `oklch(0.75 0.13 90)` | ≈ **2.00 : 1** | fails |
| `--color-severity-s4` `oklch(0.62 0.05 250)` | ≈ **3.09 : 1** | fails |

Three of four, not four of four — and the one that passes does so by a margin an anti-aliased
12 px glyph does not comfortably carry. One more reading, because it changes what Step 3 does:
**the dark palette passes.** The four `.dark` overrides measure roughly 4.8, 6.9, 8.7 and 6.5 : 1
against `oklch(0.145 0 0)`, so the failure is light-mode only. Nothing sets `.dark` on `<html>`
yet (Lesson 11.1 said so deliberately), which makes that a latent pass rather than a reason to
relax.

### Step 3: Pair the badge instead of changing the token

**The four `--color-severity-s1`…`s4` values must not change.** Module 13's `theme.json` mirrors
all four into `settings.color.palette`, Lesson 11.1's Verification greps for them, and Lesson
13.5's greps for the literal `oklch()` strings. Changing one to fix a contrast ratio would create
exactly the front-end/editor drift this course spends Module 13 warning about.

So fix the **pairing**: keep the tint and the border as decoration, and give the text its own ink
token. Four new tokens, in the same **plain** `@theme` block, because Key Concept 3 of Lesson 11.1
is the reason the severity block is plain rather than `inline` — a plain token is emitted, and an
emitted token is readable from a hand-written rule.

```css
/* next-app/src/app/[locale]/globals.css — inside the EXISTING plain @theme block
   from Lesson 11.1 Step 4, appended below the four severity tokens. Do not add a
   second @theme block and do not touch the four values above these. */
  /* Badge INK. Same hue, same chroma, lightness dropped to 0.45 so the text
     clears 4.5:1 against its own 15% tint (Lesson 22.1 §5-§6). The decorative
     tint and border keep the vivid token; only the glyph changes. theme.json
     mirrors s1..s4 and MUST NOT gain these — an ink colour is a front-end
     pairing decision, not an editor palette entry. */
  --color-severity-s1-ink: oklch(0.45 0.19 25); /* ≈ 6.3 : 1 on the s1 tint */
  --color-severity-s2-ink: oklch(0.45 0.16 55); /* ≈ 6.6 : 1 */
  --color-severity-s3-ink: oklch(0.45 0.13 90); /* ≈ 6.7 : 1 */
  --color-severity-s4-ink: oklch(0.45 0.05 250); /* ≈ 6.3 : 1 */
```

```css
/* next-app/src/app/[locale]/globals.css — inside the EXISTING .dark block, below
   the four dark severity overrides. In dark mode the base tokens already measure
   4.8-8.7:1 on their tints, so the ink IS the token and dark mode is unchanged.
   A var() reference resolves on the element that declares both, which is <html>. */
  --color-severity-s1-ink: var(--color-severity-s1);
  --color-severity-s2-ink: var(--color-severity-s2);
  --color-severity-s3-ink: var(--color-severity-s3);
  --color-severity-s4-ink: var(--color-severity-s4);
```

Then one word per variant in `Badge`. This is a four-token edit to Lesson 11.2's file, not a
rewrite of it:

```tsx
// next-app/src/components/ui/badge.tsx — the severityVariants map, text class only
const severityVariants = {
  's1-catastrophic': 'border-severity-s1/30 bg-severity-s1/15 text-severity-s1-ink',
  's2-major': 'border-severity-s2/30 bg-severity-s2/15 text-severity-s2-ink',
  's3-minor': 'border-severity-s3/30 bg-severity-s3/15 text-severity-s3-ink',
  's4-cosmetic': 'border-severity-s4/30 bg-severity-s4/15 text-severity-s4-ink',
} satisfies Record<SeverityLevel, string>;
```

> **State the design cost out loud, because it is real.** The badges get less vivid: a
> catastrophic label was alarm red and is now dark oxide red on a pink wash. Dark neutral ink
> for all four is also defensible and loses the hue signal entirely; leaving it alone loses three
> of your four severity labels to anyone with moderate low vision. This course keeps the hue and
> gives up the vibrance. If a designer reverses that, the thing that must not come back is
> `text-severity-sN` on `bg-severity-sN/15`.

**Verify §3:**

- [ ] `npm run build`, then `grep -c -- '--color-severity-s1-ink' .next/static/css/*.css` is 1 or
      more. Zero means you put the ink tokens in an `@theme inline` block, which registers the
      utility and emits nothing (Lesson 11.1 §3).
- [ ] The four base values are byte-identical. Verification check 5 is the one that catches you.

### Step 4: Fix the focus indicator, which fails 1.4.11 app-wide

The focus ring is a UI component under 1.4.11 and needs **3:1** against what is next to it.
Lesson 11.1's `--ring: oklch(0.708 0 0)` composites to roughly `#a1a1a1`, which measures about
**2.59 : 1** against `--background`. Every `focus-visible:ring-ring` in the project inherits that.

```css
/* next-app/src/app/[locale]/globals.css — the :root block from Lesson 11.1 Step 4 */
  /* Was oklch(0.708 0 0) ≈ 2.59:1 against --background, which fails 1.4.11's 3:1
     for a focus indicator. 0.60 measures ≈ 3.95:1 on --background and ≈ 3.62:1 on
     --muted, the darkest surface a ring ever lands on. The NAME is canonical for
     shadcn's generated components (Lesson 11.1 §5); only the value moves.
     The .dark value oklch(0.556 0 0) measures ≈ 4.18:1 and is left alone. */
  --ring: oklch(0.6 0 0);
```

The cost, named: `IncidentCard`'s `hover:border-ring` gets slightly darker. That is the whole
blast radius, and it is worth it for a focus ring that a partially sighted keyboard user can see.

Then the two elements that opted out of the token entirely. Lesson 11.4's Verification check 6
greps for `outline-none` without a `focus-visible:ring` on the same element — and it passes here,
because the string *does* contain `focus-visible:ring`. The grep proves a replacement exists; it
cannot prove the replacement is visible. At 50 % alpha the ring measures about **1.54 : 1**.

```tsx
// next-app/src/components/incidents/IncidentSubmitForm.tsx — BOTH raw <textarea>
// elements (the `body` field and the `stackTrace` field). Same ring as every other
// focusable control in the app, at full opacity.
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

### Step 5: SC 2.4.11 — stop the sticky header eating the focus ring

Lesson 11.3's `Header` is `sticky top-0 z-40` with an `h-16` inner row and a `border-b`: 65 CSS px
of chrome permanently over the top of the viewport. `focus-visible:ring-offset-2` does nothing
when the focused element is underneath it. Tab down `/en/incidents` and watch a card link's ring
disappear behind the header — that is 2.4.11 failing, and it is invisible from a mouse.

```css
/* next-app/src/app/[locale]/globals.css — inside the EXISTING @layer base block
   from Lesson 11.1 Step 4, beside the :focus-visible rule it already holds. The
   app-wide scroll policy belongs next to the app-wide focus policy. */
  html {
    /* 65px of sticky chrome (h-16 + border-b) plus 15px of breathing room. Every
       scroll-into-view honours this: a #fragment link, the skip link's focus()
       call, and Element.scrollIntoView(). Reasoned from the header's own classes,
       not measured — remeasure if Header's height changes. */
    scroll-padding-top: 5rem;
  }
```

`scroll-padding-top` is set on the **scroll container**, which is `html`, and it applies to every
scroll-into-view the browser performs — including the implicit one that `.focus()` triggers. Belt
and braces on the one target that matters most:

```tsx
// next-app/src/app/[locale]/layout.tsx — the <main> landmark from Lesson 11.4 Step 4.
// The file already holds 09.1's <html>/<body>, 11.1's stylesheet import, 11.3's
// Header and Footer, 11.4's SkipLink, 17.2's PreviewBanner, 19.2's metadata, and
// 20.3's provider with lang/dir. This lesson's key is scroll-mt-20 and nothing else.
        <main id="main" tabIndex={-1} className="scroll-mt-20 mx-auto max-w-6xl px-4 py-8">
```

Two mechanisms for one problem is a decision, so: `scroll-padding-top` covers everything in one
line, and `scroll-mt-20` guarantees the **skip link's** target specifically even if a future
ancestor gains `overflow` and becomes the scroll container instead of `html`. The skip link is
the recovery path for every broken focus position in the app, so it is the one worth doubling.

> **The known limitation, recorded rather than hidden.** In draft mode Lesson 17.2's
> `PreviewBanner` is *also* `sticky top-0`, so the chrome grows by roughly 37 px and `5rem` is
> then short. Both elements stick to the same offset and overlap rather than stacking, which is a
> layout defect in its own right. Step 8 writes it down; editors previewing drafts are the only
> people affected, and a fixed `scroll-padding-top` cannot answer a variable header.

### Step 6: SC 2.5.8 — measure every target, then fix the one that fails

Measure, do not assume. Read the heights off the class strings and confirm with the DevTools
box model:

| Control | Classes | Box | 24×24? |
|---|---|---|---|
| `Button` `sm` / `default` / `lg` / `xl` | `h-8` / `h-9` / `h-11` / `h-14` | 32 / 36 / 44 / 56 px | pass |
| `Button` `icon` — the menu toggle | `size-9` | 36 × 36 | pass |
| `NavLink`, `MobileNav` links | `px-3 py-2 text-sm` | 36 px tall | pass |
| `LocaleSwitcher` links | `px-2 py-1 text-sm` | 28 px tall | pass |
| `UntranslatedNotice` dismiss | `px-2 py-1` | 28 px tall | pass |
| `Badge` | `px-2 py-0.5 text-xs` | ≈ 22 px | **not a target** — see below |
| `Footer` social links | no padding, inside a `text-sm` row | **20 px tall** | **fails on size** |

```bash
cd next-app

# Is any Badge ever a pointer target? `asChild` is the only way a <span> becomes
# a <button> or an <a>, and 2.5.8 does not apply to a non-interactive element.
grep -rn 'Badge asChild\|<Badge[^>]*asChild' src/
# Expected: no output. Every call site is `<Badge variant={…}>label</Badge>`, so the
#           22px box is decoration and 2.5.8 is not engaged. Record the measurement
#           anyway — "we checked and it holds" is a result, and the day somebody
#           wraps a Badge round a Link it becomes a finding.
```

The footer links are 20 px and technically pass, via the **Spacing** exception from Key Concept 7:
`gap-y-2` is 8 px, so wrapped rows sit 28 px centre to centre and two 24 px circles centred 28 px
apart do not intersect. Passing on a geometric technicality that a one-word spacing change would
destroy is not a pass worth keeping. Fix the size, and fix the two other things wrong with these
links while you are in the file:

```tsx
// next-app/src/components/layout/Footer.tsx
import { getTranslations } from 'next-intl/server';

import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { SiteChromeDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { siteTag } from '@/lib/graphql/tags';

export async function Footer() {
  const data = await fetchGraphQL(SiteChromeDocument, {}, { revalidate: 3600, tags: [siteTag()] });
  // Lesson 20.3 Step 7 swept this file for literals and made it async. The
  // `Social` landmark name was missed, because `react/jsx-no-literals` runs with
  // ignoreProps: true and an aria-label is a prop (Lesson 22.1 §9).
  const t = await getTranslations('nav');

  const settings = data.siteSettings;
  const social = settings?.socialLinks ?? [];

  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">
        {settings?.footerBlurb != null && settings.footerBlurb !== '' ? (
          <p className="max-w-prose">{settings.footerBlurb}</p>
        ) : null}

        {social.length > 0 ? (
          // TRANSLATED landmark name. Three navigation landmarks exist and a
          // German-speaking screen-reader user was hearing "Social" for one of them.
          <nav aria-label={t('social')} className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            {social.map((link) =>
              link?.url != null && link.url !== '' ? (
                <a
                  key={link.url}
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  // `-my-1 py-1` grows the TARGET to 28px without moving anything
                  // on screen: the padding enlarges the border box, the negative
                  // margin pulls the layout box back. SC 2.5.8 is now met on size
                  // rather than on the Spacing exception (§7).
                  className="-my-1 rounded-sm py-1 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.network ?? link.url}
                  {/* target="_blank" with no warning is a 2.4.4 problem, not a
                      2.5.8 one: a screen-reader user gets a new tab and no back
                      button and no explanation. The name now carries the reason,
                      and it AUGMENTS the visible text rather than replacing it,
                      which is why this is a VisuallyHidden child and not an
                      aria-label (§2). */}
                  <VisuallyHidden> {t('opensInNewTab')}</VisuallyHidden>
                </a>
              ) : null
            )}
          </nav>
        ) : null}

        <p className="mt-6">{data.generalSettings?.title ?? 'Blame The Tech'}</p>
      </div>
    </footer>
  );
}
```

Two keys, in all three catalogues. `en.json` is a **test contract** (Lesson 20.3) — nothing
locates the footer by name yet, but keep the English values stable anyway:

```json
{
  "nav": {
    "primary": "Primary",
    "openMenu": "Open main menu",
    "closeMenu": "Close menu",
    "social": "Social",
    "opensInNewTab": "(opens in a new tab)"
  }
}
```

`uk.json` gets `"social": "Соцмережі"` and `"opensInNewTab": "(відкривається в новій вкладці)"`;
`de.json` gets `"social": "Soziale Netzwerke"` and `"opensInNewTab": "(öffnet in einem neuen Tab)"`.
Every catalogue needs both keys or one locale throws `MISSING_MESSAGE` at runtime on one page.

**Verify §6:**

- [ ] `node -e "['en','uk','de'].forEach(l=>{const m=require('./src/messages/'+l+'.json');console.log(l,m.nav.social,m.nav.opensInNewTab)})"`
      prints three non-empty pairs.
- [ ] In DevTools, a footer social link's box model reads 28 px high and the page did not move.
- [ ] `/de` renders the German landmark name. `curl -s http://localhost:3000/de | grep -c 'Soziale Netzwerke'` is 1 or more.

### Step 7: The error summary, which is the one genuinely missing form mechanism

Lesson 16.1 already ships the per-field mechanism through `ui/form.tsx`: `aria-describedby`,
`aria-invalid`, a `role="alert"` message that is **always rendered** so the live region exists
before its content does, and `useId()` against id collisions. Do not re-describe it. What is
missing is one summary at the top of the form saying *what* is wrong, in one place, announced once.

```tsx
// next-app/src/components/ui/form.tsx — a new export beside FormMessage. This file
// is OURS per ADR 0008 (Lesson 11.2 §5): re-running `npx shadcn@latest add form`
// overwrites it, so that command must not be run casually.
function FormErrorSummary({
  heading,
  className,
  ...props
}: React.ComponentProps<'div'> & { readonly heading: string }) {
  const { formState } = useFormContext();
  const ref = React.useRef<HTMLDivElement>(null);

  // Field order is react-hook-form's registration order, which is DOM order,
  // which is reading order. Not Object.keys ordering by luck — errors is built
  // by register() calls, and that is the order the fields appear in.
  const messages = Object.entries(formState.errors).flatMap(([name, error]) => {
    const message = error?.message;
    return typeof message === 'string' && message !== '' ? [{ name, message }] : [];
  });

  // Keyed on submitCount, NOT on the message list: re-focusing the summary every
  // time a blur validation changes one message would fight the user while they
  // are still typing. One submit, one announcement, one focus move.
  React.useEffect(() => {
    if (formState.submitCount > 0 && messages.length > 0) {
      ref.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: submit only
  }, [formState.submitCount]);

  // ALWAYS RENDERED, empty when the form is clean — the same reasoning as
  // FormMessage in Lesson 16.1 §7. `tabIndex={-1}` makes it focusable
  // programmatically without adding a tab stop, exactly as <main> does.
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-slot="form-error-summary"
      className={cn(
        'rounded-md border border-destructive/50 p-4 text-sm empty:hidden',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      {...props}
    >
      {messages.length > 0 ? (
        <>
          <p className="font-medium text-destructive">{heading}</p>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {messages.map((entry) => (
              <li key={entry.name}>{entry.message}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
```

Mount it first inside the `<form>` in `IncidentSubmitForm` (eleven fields) and `RegisterForm`
(two), and **delete the competing `setFocus` call** from each. The heading string comes from the
catalogues, so it is a prop rather than a literal:

```tsx
// next-app/src/components/incidents/IncidentSubmitForm.tsx — two edits
//
// 1. In the effect that feeds server errors back in, delete these three lines.
//    Two things moving focus after one submit is a bug, not redundancy:
//      const first = entries.find(([, messages]) => Boolean(messages?.[0]));
//      if (first) { form.setFocus(first[0]); }
//
// 2. First child of the <form>:
        <FormErrorSummary heading={t('errorSummary')} />
```

One key each in the two form namespaces Lesson 20.3 created from the components themselves.
`incidentForm.errorSummary` and `auth.errorSummary`, same English value in both, translated in
`uk.json` and `de.json` alongside the rest of those namespaces:

```json
{
  "incidentForm": { "errorSummary": "Check these fields before submitting." },
  "auth": { "errorSummary": "Check these fields before submitting." }
}
```

No count in the string, deliberately: it would need an ICU plural, a `count` the caller cannot
compute, and a function prop to thread it. The `<ul>` announces its own length — "list, 3 items"
— for free, in every screen reader.

> **This reverses Lesson 16.1 §8's verdict, for a stated reason.** 16.1's table chose "focus the
> first invalid field" and called the summary "correct for a 40-field government form". The
> incident form has **eleven** fields across two columns, and on a phone the first invalid one is
> frequently the only error the user ever learns about — the other three are below the fold with
> nothing to announce them. So: the summary takes focus, the count and every message are
> announced together, and the cost is one extra keystroke to reach the field. 16.1's choice was
> right for a two-field login form and it is still right there; this is a form-size threshold,
> not a correction.

### Step 8: The typography config, and the rows

`tailwind.config.ts` exists for exactly one reason (Lesson 11.1 §2) and this is a legitimate
second visit. The finding here is not a contrast failure — it is that **nothing renders `prose`**.
Lesson 14.3 §10 declined it for block content and argued why, and Module 14 removed the HTML blob
`prose` was bought for. So this config is currently inert.

```ts
// next-app/tailwind.config.ts — inside theme.extend.typography.DEFAULT.css, added
// below Lesson 11.1's --tw-prose-* block. Nothing in src/ carries `prose` today
// (Lesson 14.3 §10 declined it for block content), so this is a GUARD on a future
// adoption, not a fix to a live failure. If you would rather not carry speculative
// configuration, the honest alternative is to drop @tailwindcss/typography and this
// file together — a bytes decision, and therefore Module 21's, not this lesson's.
            // Pin the underline. It is the plugin's default AND it is the only
            // non-colour cue distinguishing a prose link, because --tw-prose-links
            // resolves to var(--primary) — near-black, ≈1.15:1 against the body
            // text beside it. Colour alone would fail 1.4.1; the underline is what
            // satisfies it, so a future `prose-a:no-underline` must be a decision.
            a: { textDecoration: 'underline', textUnderlineOffset: '2px' },
```

```bash
cd next-app

# The trap that makes this config silently dead. A `prose-*` COLOUR MODIFIER sets
# every --tw-prose-* variable itself, from Tailwind's neutral/slate/stone palettes,
# and its rules come after `prose` in the generated stylesheet — so a modifier
# overrides everything above, without an error, and the DevTools readout stops
# matching the tokens you set. Lesson 11.1 §8's illustration shows
# `prose prose-neutral dark:prose-invert`; that is an illustration, not a call site.
grep -rn 'prose-neutral\|prose-slate\|prose-stone\|prose-gray\|prose-invert' src/
# Expected: no output. If a future lesson adopts `prose`, it uses `prose` alone and
#           lets .dark flip --foreground and --border, which is what Lesson 11.1's
#           comment claimed the config was for.
```

Then the rows. `docs/accessibility.md` is Lesson 11.4's file with a standing rule: every lesson
that adds an `aria-*` attribute or a role adds a row. This lesson adds no new `aria-*` at all —
which is itself the result Key Concept 8 predicts — so what it adds is the audit.

```markdown
<!-- docs/accessibility.md — append one section -->
## WCAG 2.2 AA audit of the six key routes (Lesson 22.1)

Audited: `/[locale]`, `/[locale]/incidents`, `/[locale]/incidents/[slug]`,
`/[locale]/incidents/submit`, `/[locale]/hobt`, `/[locale]/reviews/[slug]` — in `en`, `uk`
and `de`. Read out of the browser accessibility tree, not out of the JSX.

| Finding | SC | Verdict |
|---|---|---|
| Severity badge text on its own 15 % tint: ≈2.0–3.1 : 1 for s2, s3, s4 | 1.4.3 | **fixed** — paired `--color-severity-sN-ink`; the four base tokens are unchanged and `theme.json` is untouched |
| `--ring` measured ≈2.59 : 1 on `--background` | 1.4.11 | **fixed** — `oklch(0.6 0 0)`, ≈3.95 : 1 |
| Two `<textarea>` rings at `ring-ring/50`, ≈1.54 : 1 | 1.4.11 | **fixed** — full-opacity `ring-ring`, matching every other control |
| Focused elements scroll under the sticky header | 2.4.11 | **fixed** — `scroll-padding-top: 5rem` on `html`, `scroll-mt-20` on `<main>` |
| Footer social links 20 px tall, passing only on the Spacing exception | 2.5.8 | **fixed** — `-my-1 py-1`, 28 px, no visual change |
| `target="_blank"` on footer social links with no warning | 2.4.4 | **fixed** — a `VisuallyHidden` suffix, translated |
| `aria-label="Social"` hard-coded English in three locales | 1.3.1 / i18n | **fixed** — `nav.social` in all three catalogues |
| No error summary on either form | 3.3.1 | **fixed** — `FormErrorSummary`, focused on submit-with-errors; supersedes 16.1 §8's field focus on these two forms |
| `Badge` at ≈22 px | 2.5.8 | **not engaged** — never a pointer target; `grep` for `asChild` is empty and Verification asserts it |
| Ratings `<dl>` on `/reviews/[slug]` has no group name; `8.5/10` reads as "slash" | 1.3.1 | **minor, accepted** — the four pairs already announce as text. There is no star row |
| Heading order inside `RichText` is not controllable | 1.3.1 | **accepted, owned by the editor** — `CoreHeading` clamps H1 to `h2` (14.3); an editor can still go `h2` → `h4`. Remove H1 and H4+ from the level control in `theme.json` if this ever earns the constraint |
| `sticky top-0` on both `PreviewBanner` and `Header` — they overlap, and `scroll-padding-top` is then ~37 px short | 2.4.11 | **accepted in draft mode only** — affects editors previewing, not visitors. A fixed scroll offset cannot answer a variable header |
| `global-error.tsx` is English-only | 3.1.1 | **accepted** — recorded by 20.4; it renders outside `[locale]` and has no request locale |
| `alt` text is English in every locale | 1.1.1 | **accepted** — recorded by 20.4; media is deliberately untranslated (20.1) |
| Forced-`rtl` layout check | 1.3.2 | **manual, documented** — 20.4's DevTools instruction stands. The house rule forbids snapshot tests of rendered markup, so this stays a human check |

`aria-*` attributes added by this lesson: **none.** The fixes are a token, two class strings, a
scroll property and one new component built from `<div role="alert">`, `<p>` and `<ul>`. Key
Concept 8's bias in action — an audit that ends with more ARIA than it started with has usually
papered over a markup problem.
```

---

## Verification

```bash
cd next-app

# 1. The three toolchains agree. `verify` is type-check + lint + format:check.
npm run verify
# Expected: exit 0, silent
npm run build
# Expected: success, and the [locale] routes still listed as pre-rendered

# 2. The ink tokens compiled as EMITTED custom properties, not inline ones.
#    Zero here means they landed in an `@theme inline` block (Lesson 11.1 §3).
for n in 1 2 3 4; do
  printf 's%s-ink: ' "$n"
  grep -c -- "--color-severity-s$n-ink" .next/static/css/*.css
done
# Expected: 1 or more on every line

# 3. All four ink UTILITIES are present, because Badge references all four.
for n in 1 2 3 4; do
  printf 's%s: ' "$n"
  grep -o -- "severity-s$n-ink" .next/static/css/*.css | head -1
done
# Expected: severity-s1-ink … severity-s4-ink, one per line

# 4. Badge uses the ink token for TEXT and the base token for the decoration.
grep -c 'text-severity-s[1-4]-ink' src/components/ui/badge.tsx
# Expected: 4
grep -c 'bg-severity-s[1-4]/15' src/components/ui/badge.tsx
# Expected: 4 — the tint and the border keep the vivid token, on purpose

# 5. NEGATIVE — the four severity VALUES did not move. Module 13's theme.json
#    mirrors these into settings.color.palette and Lesson 13.5 greps the literals;
#    changing one would create the front-end/editor drift Module 13 warns about.
for v in '0.52 0.19 25' '0.66 0.16 55' '0.75 0.13 90' '0.62 0.05 250'; do
  printf '%-18s ' "$v"
  grep -c "oklch($v)" 'src/app/[locale]/globals.css'
done
# Expected: 1 on every line. A 0 means you edited a frozen token — put it back.
grep -oE -- '--color-severity-s[1-4]:' 'src/app/[locale]/globals.css' | sort -u | wc -l
# Expected: 4 — four base tokens, no fifth, and the ink tokens are a separate name

# 6. NEGATIVE — theme.json was not touched. The editor palette is Module 13's.
git status --short ../wordpress-headless/wp-content/themes/btt-headless/theme.json
# Expected: no output
cd ../wordpress-headless && grep -o 'oklch([^)]*)' \
  wp-content/themes/btt-headless/theme.json \
  | grep -cE '0\.52 0\.19 25|0\.66 0\.16 55|0\.75 0\.13 90|0\.62 0\.05 250'
# Expected: 4 — Lesson 13.5's own check, re-run. The editor palette still
#           declares the same four values the front end does.
cd ../next-app
grep -c 'ink' ../wordpress-headless/wp-content/themes/btt-headless/theme.json
# Expected: 0 — an ink colour is a front-end pairing decision and has no place
#           in an editor palette. Adding it there is how you get five "severity"
#           swatches in the block editor for four severity terms.

# 7. The focus ring token moved, and only the value.
grep -c 'oklch(0.6 0 0)' 'src/app/[locale]/globals.css'
# Expected: 1 — the :root --ring
grep -c '\-\-ring: oklch(0.556 0 0)' 'src/app/[locale]/globals.css'
# Expected: 1 — the .dark value, left alone at ≈4.18:1
grep -c '\-\-color-ring: var(--ring)' 'src/app/[locale]/globals.css'
# Expected: 1 — the @theme inline bridge is untouched, so every
#           focus-visible:ring-ring in the project picks the new value up

# 8. NEGATIVE — no alpha-reduced focus ring survives anywhere. Lesson 11.4's
#    check 6 passes on these lines because the string DOES contain
#    `focus-visible:ring` — it proves a replacement exists, not that it is visible.
grep -rn 'ring-ring/' src/
# Expected: no output. Any hit is a focus indicator below 1.4.11's 3:1.

# 9. NEGATIVE — no focus ring was removed without a replacement (11.4's check,
#    re-run because this lesson edited class strings on three files).
grep -rn 'outline-none\|outline-0' src/components/ src/app/ \
  | grep -v 'focus-visible:ring\|focus:ring'
# Expected: no output

# 10. The 2.4.11 fix is present in both places, with one number.
grep -c 'scroll-padding-top: 5rem' 'src/app/[locale]/globals.css'
# Expected: 1
grep -c 'scroll-mt-20' 'src/app/[locale]/layout.tsx'
# Expected: 1

# 11. Still exactly one main and one h1 per route — Lesson 12.3 asserts this in
#     CI and this lesson edited the layout, so re-assert it by hand once.
#     `npm run dev` in another terminal.
for r in /en /en/incidents /en/incidents/incident-01 /en/incidents/submit \
         /en/hobt /en/reviews/review-01; do
  printf '%-32s main=%s h1=%s\n' "$r" \
    "$(curl -s "http://localhost:3000$r" | grep -o '<main' | wc -l | tr -d ' ')" \
    "$(curl -s "http://localhost:3000$r" | grep -o '<h1' | wc -l | tr -d ' ')"
done
# Expected: main=1 h1=1 on all six lines. /en/incidents/submit answers only when
#           you are signed in as `reporter`; a redirect to /en/login prints 0 0,
#           which is Lesson 15.5 working and not a finding.

# 12. Every interactive element has a non-empty accessible name. The icon-only
#     controls are the only ones that can lose it silently, so check them by
#     construction: an icon Button must have a VisuallyHidden or an aria-label
#     within four lines of itself.
grep -rn -A4 'size="icon"' src/components/ | grep -c 'VisuallyHidden\|aria-label'
# Expected: 1 or more, and equal to the number of `size="icon"` call sites
grep -rc 'size="icon"' src/components/ | grep -v ':0$'
# Expected: exactly one file — layout/MobileNav.tsx — with 1
curl -s http://localhost:3000/en | grep -o 'Open main menu' | wc -l
# Expected: 1

# 13. NEGATIVE — aria-label appears ONLY where §2 allows it. Every hit must be on
#     a <nav> (which has no native naming mechanism), on an <svg role="img">, or
#     on LocaleSwitcher's disabled button (where it augments the visible text and
#     2.5.3 holds because the visible label is a prefix of the accessible name).
grep -rn 'aria-label=' src/components/ src/app/
# Expected: 6 hits — Header's Primary nav, MobileNav's nav, Footer's social nav,
#           LocaleSwitcher's nav, LocaleSwitcher's disabled locale button, and
#           src/app/icon.svg (Lesson 19.4). A SEVENTH hit is either an unnamed
#           native element you should have changed instead, or a name that
#           replaced visible text. Both are findings.

# 14. NEGATIVE — no new role= where a native element existed. This lesson's new
#     component is the only addition, and role="alert" has no native equivalent.
grep -rho 'role="[a-z]*"' src/components/ src/app/ | sort | uniq -c
# Expected: three values and nothing else.
#           role="alert"  — ui/form.tsx (FormMessage, FormErrorSummary), two
#                           LeadForm fields, RegisterForm's form-level message
#           role="status" — RegisterForm, LeadForm, incidents/page.tsx,
#                           blog/page.tsx, UntranslatedNotice
#           role="img"    — src/app/icon.svg, the sanctioned pattern for an
#                           <svg> that carries meaning (Lesson 19.4)
#           NO role="button", no role="navigation", no role="main". Radix emits
#           role="dialog" and aria-modal at RENDER time, so neither appears in a
#           grep of src/ — they are audited in the rendered DOM and by Lesson
#           22.3's axe run.

# 15. NEGATIVE — no positive tabindex. A positive tabindex overrides DOM order,
#     which means it overrides reading order, which is always a bug.
grep -rn 'tabIndex={[1-9]' src/
# Expected: no output

# 16. NEGATIVE — no prose colour modifier, which would silently override every
#     --tw-prose-* variable tailwind.config.ts sets (Step 8).
grep -rn 'prose-neutral\|prose-slate\|prose-stone\|prose-gray\|prose-invert' src/
# Expected: no output

# 17. The error summary is always rendered and empty when the form is clean.
#     `empty:hidden` is what keeps an empty div from taking layout.
grep -c 'FormErrorSummary' src/components/ui/form.tsx
# Expected: 2 — the declaration and the export
grep -c 'return null' src/components/ui/form.tsx
# Expected: 0 — an unmounted live region is the failure 16.1 §7 describes
grep -c 'setFocus' src/components/incidents/IncidentSubmitForm.tsx \
  src/components/auth/RegisterForm.tsx
# Expected: 0 for both. Two things moving focus after one submit is a bug.
curl -s http://localhost:3000/en/register | grep -c 'data-slot="form-error-summary"'
# Expected: 1 — present in the SERVER HTML, before any error exists

# 18. The three new message keys exist in all three catalogues.
node -e "for (const l of ['en','uk','de']) { const m = require('./src/messages/'+l+'.json'); console.log(l, !!m.nav.social, !!m.nav.opensInNewTab, !!m.incidentForm.errorSummary, !!m.auth.errorSummary); }"
# Expected: three lines of `true true true true`. A false is a MISSING_MESSAGE
#           waiting to happen in one locale, on one page.
curl -s http://localhost:3000/de | grep -c 'Soziale Netzwerke'
# Expected: 1 or more

# 19. Measure it in a browser, because none of the above measures a ratio.
#     - Inspect an s3-minor badge on /en/incidents. DevTools contrast readout ≥ 4.5.
#     - Tab to a card link near the top of the list: the ring is fully visible and
#       nothing is under the header.
#     - Tab to a footer social link: the ring is visible, the box is 28px, and
#       VoiceOver reads "…, opens in a new tab, link".
#     - Submit /en/incidents/submit empty: focus lands on the summary, and the
#       summary lists one line per invalid field in field order.
```

Checks 5, 6, 8, 13 and 14 are the five that define this lesson. The frozen tokens did not move,
the editor palette did not move, no focus indicator is invisible, no accessible name replaced
visible text, and the audit added no ARIA.

## Control Questions

1. The fix for the severity badges pairs a new ink token with the existing tint instead of
   changing `--color-severity-s2`. Name the two artifacts outside `next-app/` that would have
   disagreed with the front end if you had changed the token, say which of them a `grep` would
   have caught and which would have failed silently, and explain why the *border* at ≈1.4 : 1 is
   not a finding while the *text* at ≈2.8 : 1 is.
2. `LocaleSwitcher` puts `aria-label` on a `<button>` that already contains the text `Deutsch`,
   and this lesson records that as allowed rather than as a defect. State the success criterion
   that decides it, say exactly what property of the attribute's value makes it pass, and
   describe the one-word change to the message catalogue that would turn it into a failure
   without changing a line of TypeScript.
3. Lesson 11.4's Verification greps for `outline-none` that is not paired with a
   `focus-visible:ring` on the same element, and the two `ring-ring/50` textareas pass that grep.
   Explain what the grep actually proves, name the property of a focus indicator it cannot see,
   and propose a check that would have caught it without a browser — then say why your check is
   still not sufficient.
4. `scroll-padding-top: 5rem` is derived from the header's own `h-16` plus its border plus
   breathing room, and it is wrong in draft mode. Explain why the draft-mode case is accepted
   rather than fixed, describe what a correct variable-height solution would have to know that
   CSS alone cannot tell it, and say which of Lesson 17.2's decisions you would revisit first.
5. This lesson moves focus to the error summary and deletes the `setFocus(firstInvalidField)`
   call that Lesson 16.1 §8 argued for. Give the property of the form that makes the reversal
   correct here, name the form in this application where 16.1's original choice is still the
   better one, and describe the user-visible symptom you would see if you had added the summary
   and left `setFocus` in place.

## Learn More

- [What's New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) — the nine
  additions and the one removal, in one short page; the two AA criteria this lesson fixes are
  2.4.11 and 2.5.8
- [Understanding 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
  — read the sticky-header example, which is this application exactly
- [Understanding 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  — the five exceptions, with the Spacing one drawn as circles; Key Concept 7 is a summary of this page
- [Understanding 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  — why a focus indicator is a UI component, and which boundaries are exempt
- [Understanding 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
  — the criterion the severity **label** satisfies regardless of what the ratio turns out to be
- [Accessible Name and Description Computation 1.2](https://www.w3.org/TR/accname-1.2/) — the
  actual algorithm behind Key Concept 2, including the step where `aria-label` wins
- [Understanding 2.5.3 Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html)
  — why an `aria-label` that omits the visible text breaks voice control specifically
- [MDN: `scroll-padding`](https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-padding) — set on
  the scroll container, honoured by every scroll-into-view including the one `.focus()` triggers
- [WebAIM: contrast and colour accessibility](https://webaim.org/articles/contrast/) — the
  relative-luminance formula, the large-text threshold, and why alpha must be composited first
