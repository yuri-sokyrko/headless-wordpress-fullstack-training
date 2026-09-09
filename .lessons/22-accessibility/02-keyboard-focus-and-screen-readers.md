---
title: 'Keyboard, Focus & Screen Readers'
module: 22
lesson: 2
teaches: [keyboard-navigation, focus-order, focus-trap, focus-restoration, skip-link, aria-live, reduced-motion, screen-reader-testing]
produces: ['next-app/src/components/layout/SkipLink.tsx', 'next-app/src/components/layout/RouteFocus.tsx', 'next-app/src/components/hobt/GetDemoDialog.tsx', 'next-app/src/components/incidents/IncidentFilters.tsx']
requires: [22.1, 16.3]
---

# Lesson 22.2 — Keyboard, Focus & Screen Readers

## Quick Overview

Put your mouse out of reach and use the site. That instruction is the lesson: `Tab` forward,
`Shift+Tab` back, `Enter` and `Space` to activate, `Escape` to dismiss, arrow keys inside
composite widgets. You will find things a scan cannot find — a focus ring hidden behind the
sticky header, a card whose entire body is clickable but only the title is focusable, a dialog
that opens while focus stays on the page behind it, a filter that replaces forty results and
tells nobody.

Four disciplines fix almost all of it. **Focus order** must follow visual order, which means DOM
order must follow visual order, which means `order-*` and absolute positioning in Tailwind are
accessibility decisions. **Focus must be visible** — and the `:focus-visible` ring that survives
a design review is a negotiation you should have now rather than after launch. **Focus must be
managed across state changes**: a dialog moves focus in, traps it, returns it to the trigger on
close; a route change moves focus to the heading; a submitted form with errors moves focus to
the error summary. **Changes the user did not initiate must be announced**, which is what
`aria-live` is for — the incident filter's result count is the canonical example, and getting it
right means a polite region that exists before the update, not one created by the update. Then
`prefers-reduced-motion`, and finally an actual screen reader: VoiceOver on macOS, NVDA on
Windows, twenty minutes, once. Reading about screen readers is not a substitute for the moment
you hear your own site say "link, link, link, link".

By the end of this lesson you will have:

- `SkipLink.tsx` — visually hidden until focused, first in the DOM, moving focus into `<main>` —
  plus a focus-visible style that is consistent and not obscured by the sticky header
- A DOM order that matches visual order on every route, with any `order-*` overrides justified
- `GetDemoDialog.tsx` trapping focus, closing on `Escape`, restoring focus to its trigger, and
  marked `aria-modal` with a labelled dialog
- `IncidentFilters.tsx` with a polite `aria-live` region announcing the result count and the
  empty state
- Route-change focus handling so a client-side navigation does not strand focus, and
  `prefers-reduced-motion` audited across every transition — including the one component
  Lesson 11.4's count missed, and the one block that turns out to have nothing to reduce
- A written VoiceOver/NVDA smoke script and the findings from running it once

## Classic WP Analogy

Classic WordPress gave you keyboard accessibility largely by accident, and it is worth being
honest about why: **full page loads reset everything.** Click a link, the browser navigates,
focus goes to the top of a fresh document. There is no stale focus, no trapped focus, no
announcement problem, because there is no state to change — the page either exists or is being
replaced. The one place Classic WordPress did make you manage focus was a jQuery modal or an
accordion, and that is exactly where Classic themes had their accessibility bugs.

| Classic WordPress | React |
|---|---|
| Skip link in `header.php` + `.screen-reader-text:focus` | `SkipLink.tsx`, identical technique |
| Full page load resets focus | Client navigation preserves focus — usually in the wrong place |
| `wp_die()` / a fresh page for form errors | Errors render in place; you move focus to them |
| jQuery UI dialog, focus usually not trapped | Radix `Dialog` traps focus — verify it, don't assume it |
| `aria-live` on an admin notice, if you were thorough | `aria-live` on any async result region, mandatory |
| No animation to speak of | `prefers-reduced-motion` on every transition |

Where the analogy breaks is the direction of the difficulty, and it breaks against you. A single
page application removes the browser's free reset and hands you the responsibility. Every
interaction that changes content without a navigation — filtering, opening a dialog, submitting
a form, changing locale — is a moment where you must decide where focus goes and what gets
announced. Nobody decides that for you, and if you decide nothing, focus stays where it was or
falls to `<body>`, which for a screen reader user means the page silently reverts to the top.

There is one compensation, and it is real: **Radix**, which the design system in Module 11
already uses, implements the WAI-ARIA authoring patterns properly. The dialog trap, the roving
tabindex, the correct `aria-*` wiring — that is done, tested, and better than what you would
write. Your job is not to reimplement it; it is to verify it survived your styling, and to
handle the three things Radix cannot know about: route-change focus, live regions for your own
async data, and reduced motion.

---

## Key Concepts

### 1. Focus order is DOM order, so layout classes are accessibility decisions

The tab order is the DOM order of focusable elements, filtered by visibility and modified only by
`tabindex`. Nothing about how an element is *painted* enters into it. Which means every Tailwind
utility that moves an element visually without moving it in the document is a decision about
whether a keyboard user's focus jumps around the screen:

| Utility | Moves it on screen | Moves it in the tab order |
|---|---|---|
| `order-1`, `order-last` | yes | **no** |
| `flex-row-reverse`, `flex-col-reverse` | yes | **no** |
| `absolute`, `fixed` with `top`/`start` | yes | **no** |
| `grid` with explicit `col-start`/`row-start` | yes | **no** |
| `ms-auto` / `ml-auto` pushing an item to the end | yes | **no** |
| moving the JSX | yes | **yes** — the only one that does |

So the rule is short: **if you need an element to be visually last, put it last.** Reach for
`order-*` only when two breakpoints genuinely need different visual orders and the DOM order is
right for one of them — and then know that the other breakpoint has a mismatched tab order and
say so in a comment.

This codebase has one deliberate instance and it is worth recognising as the acceptable case.
Lesson 17.2's `PreviewBanner` uses `ml-auto` on its "Exit preview" link: the link is last in the
DOM *and* last visually, and `ml-auto` only decides how much space sits before it. That is not
an order override, it is alignment. The audit in Step 1 is looking for the other kind.

### 2. Focus visibility, and the grep that is necessary but not sufficient

Lesson 11.4 established the rule — `outline-none` never appears without a `focus-visible:`
replacement on the same element — and Verification check 6 there greps for it. Lesson 22.1 found
the hole: two `<textarea>` elements carried `focus-visible:ring-[3px] focus-visible:ring-ring/50`,
which *contains* `focus-visible:ring` and therefore passed the grep while measuring about
**1.54 : 1**. A grep can prove a replacement **exists**. It cannot prove the replacement is
**visible**.

Three properties of a focus indicator, only one of which a text search can see:

| Property | Criterion | Checkable by grep? |
|---|---|---|
| It exists | 2.4.7 Focus Visible (AA) | yes — the 11.4 grep |
| It has 3:1 contrast against what is behind it | 1.4.11 Non-text Contrast (AA) | **no** — needs a rendered pixel |
| It is not covered by other content | 2.4.11 Focus Not Obscured (AA) | **no** — needs a scroll position |

Which is why Step 1 of this lesson is a person with a keyboard, and why it comes before anything
this lesson changes. 22.1 fixed the token and the two textareas; this lesson's job is to confirm
that the fix holds on all six routes at three scroll positions, which no static check can do.

### 3. The four state changes that destroy focus, and who owns each

Focus lives on a DOM node. Unmount the node and the browser has to guess — and its guess is
`<body>`, which for a screen-reader user means the page silently reverts to the top and for a
keyboard user means the next `Tab` starts from the beginning.

| State change | Who handles it | Where |
|---|---|---|
| A dialog or sheet opens and closes | **Radix** | trap in, `Escape` out, focus restored to the trigger |
| A `Select` opens, arrows, closes | **Radix** | roving tabindex, typeahead, restore |
| A client-side navigation swaps the page | **you** | Step 3 of this lesson |
| A submitted form replaces itself with a success message | **you** | Step 4 — and it is currently broken |

The fourth row is the one nobody looks for, because it only happens on the happy path. Lesson
16.3's `LeadForm` returns early on success:

```
   BEFORE SUBMIT                     AFTER SUCCESS
   ─────────────────────             ────────────────────────────────
   <form>                            <p role="status">Thanks…</p>
     …five fields…
     <button>Book a demo</button>      ← the focused node no longer exists
   </form>                             ← focus falls to <body>
                                       ← inside a Radix dialog, the trap is
                                         now around nothing at all
```

The `role="status"` is announced, so a screen-reader user hears "Thanks. We will be in touch."
and then has no idea where they are. `IncidentSubmitForm` has the identical early return. Two
files, one shape, one fix.

### 4. What Radix actually guarantees, and how to verify it rather than assume it

Lesson 16.3 §10 lists the six behaviours the `Dialog` primitive supplies. Every one of them is a
real guarantee and reimplementing them would be worse — Radix's focus trap has been tested
against more assistive technology than you will ever install. This lesson's job is **verification
plus the gaps**, and separating the two is the whole point:

| Behaviour | Radix | Verify how |
|---|---|---|
| Focus enters the dialog on open | ✅ | `Tab` after opening: the first stop is inside |
| `Tab` cannot leave while open | ✅ | `Tab` past the last control: it wraps to the first |
| `Escape` closes | ✅ | press it |
| Focus returns **to the trigger** | ✅ | close it, press `Tab`: the next stop is after the trigger |
| `aria-modal`, `role="dialog"`, matched `aria-labelledby`/`aria-describedby` ids | ✅ | the accessibility panel, with the dialog open |
| The rest of the page inert to AT | ✅ | the rotor lists only the dialog's contents |
| **Reduced motion on the open animation** | ❌ | Step 6 |
| **Focus when your own content unmounts inside it** | ❌ | Key Concept 3, Step 4 |
| **Focus after a route change** | ❌ | Step 3 |

One consequence of `aria-modal` is worth knowing because it retires a finding before you make it.
`/hobt` renders `LeadForm` twice — once in the dialog and once inline at `#lead` (Lesson 16.3's
progressive-enhancement answer) — so two textboxes on that page have the accessible name
"Your name". While the dialog is open the inline copy is inert to assistive technology, so there
is no ambiguity for a user. There **is** ambiguity for a Playwright locator, and that is Lesson
22.3's problem to scope, not an accessibility defect.

### 5. Route-change focus: what Next does, what it does not, and why the naive fix is worse

Lesson 11.4 Key Concept 7 printed the illustration and named the four ways focusing `<main>` on
every pathname change makes things worse. It then handed the decision here, "where there is a
screen reader in the loop to judge it". This is that decision.

| | Next App Router | You |
|---|---|---|
| Announces the new page title | ✅ a route announcer element | — |
| Resets scroll position | ✅ | — |
| Moves focus to the new content | ❌ | **yes** |
| Distinguishes a navigation from a query-string change | ❌ | **yes** |
| Distinguishes a link click from a back button | ❌ | **yes** |

The last two rows are the whole reason the naive version is worse than nothing. A filter that
pushes `?q=friday` through `useRouter` is a pathname-unchanged navigation on `/incidents`, and
yanking focus out of the search box the user is typing in is worse than leaving it alone. A back
button is a navigation the user already knows the destination of, and moving focus on it is
disorienting rather than helpful.

So the policy this course adopts, stated as three conditions that must **all** hold:

```
   move focus to <main>  IF
     the pathname changed                  (not a query-string-only change)
     AND this is not the first render      (do not steal focus on load)
     AND the change was not popstate       (back and forward are the user's own)
```

And the honest caveat, because it has not gone away: **nothing about this is standardised.** Every
SPA framework has an open issue, the accessibility community has not converged on focusing
`<main>` versus the `<h1>` versus a dedicated announcer, and the reason this course focuses
`<main>` is that `<main>` is the one element guaranteed to exist on every route and already
carries `tabIndex={-1}` for the skip link. If you find, with a screen reader, that starting the
read at `<main>` skips something above it that matters on your site, that is a legitimate reason
to move the target — not to delete the mechanism.

### 6. Live regions: three properties, and the one that gets forgotten

An `aria-live` region announces changes to its own content without moving focus. Three attributes
decide the behaviour, and there is a fourth requirement that is not an attribute at all.

| Attribute | Values | What it decides |
|---|---|---|
| `aria-live` | `polite` \| `assertive` \| `off` | whether the announcement waits for the user to stop, or interrupts |
| `aria-atomic` | `true` \| `false` (default) | whether the **whole** region is re-read, or only the changed node |
| `aria-relevant` | `additions text removals all` | which mutations count as a change. Almost never worth setting |
| — | — | **the region must already exist in the DOM before its content changes** |

The last row is the one that gets forgotten, and Lesson 16.1 §7 already made this exact argument
about `role="alert"`: some assistive technology only announces mutations to a region it was
already observing, so a region created *by* the update it is meant to announce is unreliable.
That is why `FormMessage` renders an empty `<p role="alert">` for every field, forever.

`role="status"` is shorthand for `aria-live="polite"` plus `aria-atomic="true"`; `role="alert"` is
shorthand for `aria-live="assertive"` plus `aria-atomic="true"`. This app uses both already —
`RegisterForm` and `LeadForm` on success, `incidents/page.tsx` and `blog/page.tsx` for Lesson
18.4's degraded-list notice, and `UntranslatedNotice` from 20.4 — and the result count uses
`role="status"` too, for a reason that has nothing to do with brevity: **a role is addressable and
an attribute is not.** `getByRole('status')` finds it; there is no locator for
`aria-live="polite"` that is not a CSS attribute selector, which the house rules ban and Lesson
23.7 turns into a lint error. Choosing the role over the longhand is what makes Lesson 22.4's
regression test writable without breaking the selector contract.

### 7. One region per fact, because double announcement is the failure nobody tests for

Two live regions reporting the same change do not make it twice as clear; they make the screen
reader say it twice, and the second reading arrives while the user is already acting on the first.
`/incidents` is one edit away from exactly that:

```
   Lesson 20.3 added        <p aria-live="polite">{t('resultCount', {count})}</p>
                            in IncidentBrowser — visible text, always populated

   The empty state          IncidentList renders t('incidents.empty') when the
                            filtered array is empty — "No incidents match these
                            filters. Somebody, somewhere, is relieved."

   The =0 branch of         "No incidents match these filters"
   resultCount              ← the SAME sentence, from the live region
```

So the fix is not "add a live region", it is **consolidate to one**, and pick which one. Step 5
does that: the count stays visible and stops being a live region, and a single `sr-only`
`role="status"` region owns every announcement of that fact. The visible count is then read as
ordinary page content when a user navigates to it, which is what it is.

One clarification, because it looks like a contradiction. Lesson 18.4's degraded-list notice on
the same route is *also* `role="status"`, so when WordPress is unreachable `/incidents` has two
polite regions. That is fine and it is not what this concept forbids: two regions announcing
**two different facts** — "the list may be stale" and "3 incidents" — are two announcements a
user needs. The rule is one region per fact, not one region per page.

There is a second double-announcement risk in this lesson, and Step 3 avoids it rather than
fixing it: Next's route announcer already reads the new page title after a navigation, so
`RouteFocus` must move focus and **say nothing**. Adding an "navigated to Incidents" announcement
would produce the title twice.

### 8. `useId()` is a focus and labelling concern, not a tidiness one

Lesson 16.1 §7 spent a paragraph on this and `ui/form.tsx` does it correctly. `IncidentFilters`
does not: Lesson 08.3 wrote `<label htmlFor="filter-severity">` and `<select id="filter-severity">`
as literal strings, and they have survived four modules.

```
   ONE instance                        TWO instances on one page
   ─────────────────────────────       ──────────────────────────────────────────
   <label for="filter-severity">       <label for="filter-severity">  ← A
   <select id="filter-severity">       <select id="filter-severity">  ← A
                                       <label for="filter-severity">  ← B
        correct                        <select id="filter-severity">  ← B
                                            ↑ resolves to A. B has NO label,
                                              and clicking B's label focuses A.
```

Nothing renders two `IncidentFilters` on one page **today**, so this is latent rather than
broken — and "latent" is exactly the state a duplicate id was in on `/hobt` before Lesson 16.3
rendered `LeadForm` twice and `useId()` earned its place. Fix it now, while the fix is three
lines, rather than when the symptom is "half our users get somebody else's error message".

### 9. Reduced motion, and what an audit that finds nothing looks like

`prefers-reduced-motion` is **done**. Lesson 11.4 Step 7 covered all five animations it had —
`Button` and `Badge`'s `transition-colors`, `IncidentCard`'s, `Skeleton`'s `animate-pulse`, and
`Sheet`'s slide-in — with a DevTools check and a grep. This lesson audits it, and an audit that
mostly confirms is a legitimate outcome:

| Candidate | Verdict |
|---|---|
| `Button`, `Badge`, `IncidentCard`, `Skeleton`, `Sheet` | **done**, 11.4 Step 7 |
| `LocaleSwitcher` (20.3) — the only animated component added after 11.4 | **done**, it shipped with `motion-reduce:transition-none` |
| `IncidentTicker` (14.4) | **nothing to reduce.** Despite the name it renders a static `<ul>`; there is no marquee, no scroll and no animation. Read the component |
| `ui/dialog.tsx`, `ui/sheet.tsx` | **the real gap, and it is five class strings, not two.** Both overlays, both `Close` buttons (`transition-opacity`, easy to miss) and `DialogContent` are unguarded. 11.4 Step 7 patched `SheetContent`'s base string and nothing else |

The last row is worth a note on method: the course never prints `ui/dialog.tsx`, because the CLI
generates it and its output changes between versions. So the honest instruction is "read your
own copy and grep it", not "add this line" — and Step 6 is written that way. At shadcn CLI
4.21.0 neither file carries `motion-reduce:` anywhere, so expect to patch, not to skip.

And one thing the grep cannot tell you, which Step 6 makes you check separately: **on this
project those animations do not currently render at all.** `animate-in`, `fade-in-0` and
`zoom-in-95` are not Tailwind core utilities — they come from `tailwindcss-animate`, and Lesson
11.1 never installed it. They compile to zero bytes of CSS. So the class strings are a real
latent defect and the *motion* is not there yet; fix the strings, and do not read a still dialog
as proof that you fixed anything.

---

## Task

### Step 1: Put the mouse out of reach and record the tab order

Not metaphorically. Move it, or unplug it. Six routes, `Tab` from a fresh load, and write down
every stop in order until focus wraps back to the browser chrome.

```bash
# `npm run dev` in another terminal. Then, on each route:
#   Tab            forward        Enter        activate a link or button
#   Shift+Tab      backward       Space        activate a button, toggle a checkbox
#   Escape         dismiss        arrows       move inside a Select or a radio group
#
# Record for each stop: what it is, whether the ring is fully visible, and whether
# the stop matches where your eye expected to go next.
```

The expected order on `/en` after Lesson 22.1, so you have something to disagree with:

| # | Stop | Watch for |
|---|---|---|
| 1 | "Skip to main content" | appears top-start. In draft mode, is it **over** the preview banner? |
| 2 | the site title link | — |
| 3–n | the `Primary` nav links | ring visible, order matches the visual order |
| n+1 | the locale switcher's available locales | the **current** locale is a `<span>` and is correctly skipped |
| n+2 | the session menu | it hydrates from `/api/auth/session`, so it may appear late |
| n+3… | `<main>` content: card links in card order | **scroll while tabbing** — this is where 2.4.11 shows up |
| last | the footer social links | ring visible, 28 px box after 22.1 |

Four things to look for specifically, because each is a real defect somewhere in this app:

1. **A ring that disappears as you tab down a long list.** 22.1 fixed it with
   `scroll-padding-top`; confirm on `/en/incidents`, which is the longest page.
2. **A stop you cannot see at all.** Any focusable element inside `aria-hidden` content, or a
   `sr-only` element that is not `focus:not-sr-only`.
3. **The skip link's z-order in draft mode.** `SkipLink` is `focus:z-50` and Lesson 17.2's
   `PreviewBanner` is also `z-50` — and the banner comes later in the DOM, so with equal
   `z-index` it paints on top of the thing that is supposed to be the first thing you see.
4. **Focus after `Enter` on a nav link.** This is the finding Step 3 exists for. Press `Enter`,
   then press `Tab` once. If the next stop is the skip link again, focus went to `<body>`.

**Verify §1:**

- [ ] You have six written tab orders, not five and an assumption about the sixth.
- [ ] Every stop's ring was fully visible at every scroll position. One that was not is a 2.4.11
      failure and 22.1's `scroll-padding-top` is either missing or too small.
- [ ] `/en/hobt`: `Tab` to a "Get Demo" button, `Enter`, then `Tab` repeatedly. Focus never
      leaves the dialog. `Escape`, then `Tab` once: the next stop is **after** the button you
      opened it from — and if there are two CTA bands, it is the right one of the two.

### Step 2: Re-audit `SkipLink` against the sticky header and all three locales

Lesson 11.4 created this file and Lesson 20.3 made it `async` to read its string from the
catalogues. Two changes here, both one word.

```tsx
// next-app/src/components/layout/SkipLink.tsx
import { getTranslations } from 'next-intl/server';

/**
 * The first focusable element in the document. Must be the first child of
 * <body>, and its href must target a real, focusable element — Lesson 11.4 §6.
 *
 * `focus:`, NOT `focus-visible:`. A skip link must appear for ANY focus,
 * including a programmatic .focus(), and :focus-visible does not reliably
 * match one (Lesson 11.4 §4).
 */
export async function SkipLink() {
  const t = await getTranslations('common');

  return (
    <a
      href="#main"
      // `start-4`, not `left-4`. Lesson 20.4's logical-property sweep says the
      // skip link should appear top-RIGHT under a forced `dir="rtl"`, and a
      // physical `left-4` pins it top-left in every direction. No locale in this
      // project is RTL yet, which is exactly why this is easy to miss.
      //
      // `z-[60]`, not `z-50`. Tailwind's z scale stops at 50, and Lesson 17.2's
      // PreviewBanner is also `sticky z-50` — it comes later in the DOM, so at
      // equal z-index it paints OVER the first focusable element in the
      // document. An arbitrary value is the honest answer to a two-element
      // stacking contract; the alternative is renumbering the whole scale.
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {t('skipToContent')}
    </a>
  );
}
```

The target needs nothing new: `<main id="main" tabIndex={-1}>` from 11.4 Step 4 already exists,
and 22.1 added `scroll-mt-20` so activating the link no longer parks `<main>`'s top edge under
the header. Check it in all three locales — `common.skipToContent` is a pinned test contract in
English (Lesson 12.3 locates it by name), and the German string is roughly twice as long.

**Verify §2:**

- [ ] `curl -s http://localhost:3000/en | grep -o 'Skip to main content\|<header' | head -2`
      prints the skip link first and `<header` second. Reversed means it is no longer the first
      child of `<body>`.
- [ ] On `/de` and `/uk`, `Tab` once: the panel appears, the translated string fits on one line,
      and it does not overlap the site title.
- [ ] `Enter`, then `Tab`: the next stop is inside `<main>`, and `<main>`'s top edge is fully
      below the header.

### Step 3: `RouteFocus` — the debt Lesson 11.4 named with this lesson's number

New file. It implements the three-condition policy from Key Concept 5 and nothing else.

```tsx
// next-app/src/components/layout/RouteFocus.tsx
'use client';

// `next/navigation`, NOT `@/lib/i18n/navigation`. next-intl's usePathname strips
// the locale prefix, so `/en/incidents` and `/de/incidents` both read as
// `/incidents` — and a locale switch IS a navigation that should move focus.
// Lesson 20.3 warns against mixing the two imports; this is the one component
// that needs the raw path, and the reason is written here so the next reader
// does not "fix" it.
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Moves focus into <main> after a client-side navigation. Discharges the debt
 * Lesson 11.4 Key Concept 7 named with this lesson's number.
 *
 * Three conditions, all of which must hold (Lesson 22.2 §5):
 *   1. the pathname actually changed  — a ?q= push is not a navigation
 *   2. this is not the first render   — never steal focus on load
 *   3. it was not a popstate         — back and forward are the user's own
 *
 * It ANNOUNCES NOTHING. Next's App Router already injects a route announcer
 * that reads the new <title>; a second announcement here would say it twice
 * (Lesson 22.2 §7).
 */
export function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  const fromHistory = useRef(false);

  useEffect(() => {
    function onPopState(): void {
      fromHistory.current = true;
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;

    // Condition 2: the first effect run records the entry path and returns.
    if (from === null) return;
    // Condition 1: React re-runs this on a searchParams change too.
    if (from === pathname) return;

    // Condition 3, and reset the flag either way — a popstate followed by a
    // link click must not inherit the exemption.
    if (fromHistory.current) {
      fromHistory.current = false;
      return;
    }

    // The one element guaranteed on every route, and it already carries
    // tabIndex={-1} for the skip link. focus() triggers a scroll-into-view that
    // honours the scroll-padding-top Lesson 22.1 set, so <main> does not land
    // under the header.
    document.getElementById('main')?.focus();
  }, [pathname]);

  return null;
}
```

Mount it once. This is the file's third accessibility concern after 11.4's `SkipLink` and
`<main>`, and it stays a sibling of them rather than moving inside `<main>`:

```tsx
// next-app/src/app/[locale]/layout.tsx — inside <body>, immediately after <SkipLink />
        <RouteFocus />
```

> **Will a focus ring appear around the whole main region on every navigation?** For a keyboard
> user, usually yes — and that is correct, the same argument Lesson 11.4 made for the skip link:
> focus moved, and a keyboard user is entitled to see where. For a mouse user, usually no,
> because `:focus-visible` does not reliably match a programmatic `.focus()` (11.4 §4) and the
> browser's heuristic is about the last input modality. That asymmetry is doing exactly the
> right thing here, by accident of a heuristic — which is worth knowing, because it means you
> cannot rely on it and must not suppress the ring if it does show up.

### Step 4: Verify the dialog, then fix the two things Radix cannot know about

Work through Key Concept 4's table with the keyboard first. Everything in the Radix column
should pass, and if any of it does not, the cause is your styling and not the primitive —
`display: none` on a wrapper, or an `aria-hidden` ancestor, are the two that break a trap.

Then the gap that is genuinely ours. `GetDemoDialog` is the wrapper Lesson 16.3 wrote around the
generated primitive, and it is the right place for a project-level override:

```tsx
// next-app/src/components/hobt/GetDemoDialog.tsx — the DialogContent class string
      {/* motion-reduce here rather than in ui/dialog.tsx: that file is generated
          by the shadcn CLI and re-running the generator would revert an edit
          made there (ADR 0008, Lesson 11.2 §5). The cost, stated plainly: this
          covers THIS dialog, so the next `<DialogContent>` in the project needs
          the same class and nothing enforces it. Lesson 24.2 is where a
          no-restricted-syntax rule could. Lesson 11.4 put the equivalent class
          in sheet.tsx because Sheet has no wrapper of ours to put it in. */}
      <DialogContent className="motion-reduce:animate-none motion-reduce:transition-none sm:max-w-md">
```

Now the focus loss from Key Concept 3, which is the finding Lesson 22.4 turns into a regression
test. `LeadForm` returns early on success and takes the focused submit button with it. The fix is
a focusable success region, and it is the same three lines in both forms:

```tsx
// next-app/src/components/hobt/LeadForm.tsx — replace the success early return
  // `tabIndex={-1}` plus a focus() on mount. role="status" announces the text,
  // but announcement is not position: without this, focus is on a <button> that
  // no longer exists, the browser falls back to <body>, and inside a Radix
  // dialog the trap is now around nothing. Lesson 22.2 §3.
  const successRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.status === 'success') {
      successRef.current?.focus();
    }
  }, [state.status]);

  if (state.status === 'success') {
    return (
      <p ref={successRef} tabIndex={-1} role="status" className="text-sm font-medium">
        Thanks. We will be in touch about a demo.
      </p>
    );
  }
```

`IncidentSubmitForm`'s success branch has the identical shape — a `<div>` with an `<h2>` and a
`<p>` — and takes the identical fix on the outer `<div>`. Two files, one pattern.

> **`role="status"` and `tabIndex={-1}` on the same element is not redundant.** The role decides
> that the text is *announced*; the tabindex decides that focus has somewhere to *be*. A
> screen-reader user gets the announcement either way and, without the tabindex, then has to find
> their way back from `<body>` by hand. A sighted keyboard user gets no announcement at all and,
> without the tabindex, no signal that anything happened.

### Step 5: `IncidentFilters` — real ids, and exactly one live region on the route

Three changes, and one deliberate refusal. Read Lesson 18.1 and 18.4 before this step: 18.1 gave
`/incidents` a server-side `?q=` facet and said Lesson 22.2 would revisit this component, and
18.4 added a `role="status"` degraded-list notice above the list.

```tsx
// next-app/src/components/incidents/IncidentFilters.tsx
'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';

import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { SEVERITY_LABEL, type SeverityLevel } from '@/types/content';

import { SCAPEGOAT_TERMS } from './fixtures';

export type SeverityFilter = SeverityLevel | 'all';
export type ScapegoatFilter = string;

function isSeverityLevel(value: string): value is SeverityLevel {
  return value in SEVERITY_LABEL;
}

export function isSeverityFilter(value: string): value is SeverityFilter {
  return value === 'all' || isSeverityLevel(value);
}

const SEVERITY_OPTIONS: readonly SeverityLevel[] =
  Object.keys(SEVERITY_LABEL).filter(isSeverityLevel);

type IncidentFiltersProps = {
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  /** How many incidents the caller is currently rendering. Lesson 22.2 §7. */
  readonly resultCount: number;
  readonly onSeverityChange: (next: SeverityFilter) => void;
  readonly onScapegoatChange: (next: ScapegoatFilter) => void;
  readonly onClear: () => void;
};

export function IncidentFilters({
  severity,
  scapegoat,
  resultCount,
  onSeverityChange,
  onScapegoatChange,
  onClear,
}: IncidentFiltersProps) {
  const t = useTranslations('incidents');
  // Lesson 08.3 hard-coded `id="filter-severity"`. Nothing renders two of these
  // on one page today, which makes it latent rather than broken — and latent is
  // exactly where /hobt's duplicate ids were before 16.3 rendered LeadForm
  // twice. Lesson 16.1 §7.
  const ids = useId();

  // The announcement, and NOT the visible count. Empty on the server and until
  // the first change after mount, because (a) some AT only announces mutations
  // to a region it was already observing — 16.1 §7 makes this argument about
  // role="alert" and it is the same argument — and (b) announcing "40 incidents
  // found" on page load is noise the user did not ask for.
  const [announcement, setAnnouncement] = useState('');
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    setAnnouncement(t('resultCount', { count: resultCount }));
  }, [severity, scapegoat, resultCount, t]);

  function handleSeverity(event: ChangeEvent<HTMLSelectElement>): void {
    // event.target.value is a string whatever the <option>s carry. Narrow it;
    // never `as SeverityFilter`. Lesson 08.3.
    const value = event.target.value;

    if (isSeverityFilter(value)) {
      onSeverityChange(value);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* The heading outline entry Lesson 11.4 Step 6 asked for. Hidden, because
          the design has no room for it and the outline still needs an h2 between
          the page's h1 and the card titles. */}
      <VisuallyHidden asChild>
        <h2>{t('filters')}</h2>
      </VisuallyHidden>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-severity`} className="text-sm font-medium">
          {t('severity')}
        </label>
        <select
          id={`${ids}-severity`}
          value={severity}
          onChange={handleSeverity}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">{t('allSeverities')}</option>
          {SEVERITY_OPTIONS.map((slug) => (
            <option key={slug} value={slug}>
              {SEVERITY_LABEL[slug]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-scapegoat`} className="text-sm font-medium">
          {t('scapegoat')}
        </label>
        <select
          id={`${ids}-scapegoat`}
          value={scapegoat}
          onChange={(event) => onScapegoatChange(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">{t('anyScapegoat')}</option>
          {SCAPEGOAT_TERMS.map((term) => (
            <option key={term.slug} value={term.slug}>
              {term.name}
            </option>
          ))}
        </select>
      </div>

      {/* ALWAYS RENDERED, never conditional on a filter being set. A button that
          unmounts when it becomes irrelevant takes the user's focus with it —
          which is Key Concept 3's fourth row, in miniature. `h-9` is 36px and
          clears SC 2.5.8 without the Spacing exception (Lesson 22.1 §7). */}
      <button
        type="button"
        onClick={onClear}
        className="h-9 rounded-md px-3 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('clear')}
      </button>

      {/* The one region announcing the COUNT. `role="status"` rather than the
          longhand aria-live/aria-atomic pair: it means exactly the same thing to
          assistive technology, and it is addressable by getByRole('status'),
          which is what lets Lesson 22.4's regression test assert on it without
          a CSS attribute selector (§6). */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
```

Then remove the duplicate, which is the whole point of Key Concept 7:

```tsx
// next-app/src/components/incidents/IncidentBrowser.tsx — two edits
//
// 1. The count stays VISIBLE and stops being a live region. Lesson 20.3 added
//    aria-live here; consolidating to one region is Lesson 22.2 §7.
//       <p>{t('resultCount', { count: visible.length })}</p>
//
// 2. Hand the count down, so the announcement and the visible text can never
//    disagree about the number:
//       <IncidentFilters … resultCount={visible.length} />
```

Two new keys per catalogue — `incidents.filters`, `incidents.allSeverities`,
`incidents.anyScapegoat` — because Lesson 08.3's `All severities` and `Anyone` were English
literals that Lesson 20.3's sweep left in the `<option>` elements.

> **The refusal, and what would reverse it.** A `<fieldset>` with a `<legend>` is the obvious
> grouping mechanism and this component does not use one. `<fieldset>` is form-associated
> markup, and these two selects are not in a `<form>` at all — they drive client state through
> Lesson 08.5's context and submit nothing. Adding a fieldset would give the group a *second*
> accessible name alongside the hidden `<h2>`, which is redundancy, not clarity. **What would
> reverse it:** if the client filters ever become a real `<form>` with a submit button and a URL
> round trip — the shape Lesson 18.1's `?q=` facet already has — then `<fieldset>` becomes
> correct and the hidden `<h2>` becomes the thing to delete.

> **The two search affordances are still two.** Lesson 18.1 named this debt: `IncidentSearch`
> filters the fetched page in the browser, `?q=` filters what WordPress is asked for, and both
> are on screen. Consolidating the *announcement* is this lesson's contribution; consolidating
> the two boxes is a product decision about what "search" means on that page, and it is recorded
> in Step 8 rather than decided here.

### Step 6: Audit reduced motion, and fix the one gap

```bash
cd next-app

# 1. Every animation utility in the project, and whether its element is guarded.
grep -rn 'animate-in\|animate-out\|animate-pulse\|animate-spin\|transition-' \
  src/components/ | grep -v 'motion-reduce'
# Expected: FIVE hits, across TWO files — dialog.tsx's DialogOverlay, its
#           DialogContent and its Close button; sheet.tsx's SheetOverlay and its
#           Close button. Lesson 11.4 Step 7 covered SheetContent's base string
#           and nothing else. The two Close buttons carry `transition-opacity`
#           rather than an `animate-*`, which is why they get read past.

# 2. Do those animation utilities even exist? `animate-in` and friends ship in
#    tailwindcss-animate, which Lesson 11.1 did not install.
grep -rc 'tailwindcss-animate\|tw-animate-css' package.json 'src/app/[locale]/globals.css'
# Expected: 0 and 0. So `animate-in`/`fade-in-0`/`zoom-in-95` are undefined
#           utilities that emit no CSS — the class strings are a latent defect,
#           not a visible one. Fix them anyway; the day someone adds the plugin
#           is not the day to discover five unguarded animations.

# 3. The ticker, which the name suggests animates and which does not.
grep -c 'animate\|marquee\|@keyframes' src/components/blocks/IncidentTicker.tsx
# Expected: 0 — a static <ul>. "We checked and there is nothing to do" is a
#           result; inventing a fix for it is not.
```

Add `motion-reduce:animate-none motion-reduce:transition-none` to **all five** class strings
command 1 named — `DialogOverlay`, `DialogContent` and the `Close` button in
`src/components/ui/dialog.tsx`, and `SheetOverlay` and its `Close` in `src/components/ui/sheet.tsx`
— exactly as Lesson 11.4 Step 7 did for `SheetContent`. Then prove it:

**Verify §6:**

- [ ] Chrome DevTools → Rendering → "Emulate CSS `prefers-reduced-motion`" → `reduce`.
- [ ] A `loading.tsx` skeleton is a static grey block, and the mobile drawer appears without
      sliding. Those two are `animate-pulse` and `transition`, both Tailwind core, so this is a
      real before-and-after.
- [ ] The Get Demo dialog looks **identical to before the edit** — and that is the expected
      result, not a failed fix. Command 2 explained it: its zoom-and-fade utilities compile to
      nothing today. Command 1 returning no output is the proof here; the eye is not.
- [ ] Button hover still changes colour. Correct — a 150 ms colour fade is not a vestibular
      trigger, and removing it makes state harder to perceive (Lesson 11.4 §9).

### Step 7: Write the screen-reader smoke script, then run it once

Twenty minutes, once. The deliverable is a **script a future contributor can follow**, because a
finding you cannot reproduce is a finding nobody will act on.

```markdown
<!-- docs/accessibility.md — append one section -->
## Screen-reader smoke script (Lesson 22.2)

Run before any release that changed the app shell, a form, or the dialog. Twenty minutes.
This is a **manual** check on purpose: axe cannot judge whether an announcement was useful,
and the house rule forbids snapshot tests of rendered markup.

### VoiceOver (macOS) — `Cmd+F5` to toggle

| Step | Keys | Pass condition |
|---|---|---|
| 1. Landmarks on `/en` | `VO-U`, then arrows to "Landmarks" | banner, navigation ×3 with distinct names, main, contentinfo. Nothing called "navigation, navigation" |
| 2. Headings on `/en/incidents` | `VO-U` → "Headings" | h1 Incidents, h2 Filters, h2 Results, then h3 per card. No skipped level |
| 3. The skip link | `Tab` once from a fresh load, `Enter` | announced as "Skip to main content, link"; after `Enter`, reading resumes inside main |
| 4. Filter announcement | change the Severity select | "N incidents found" is spoken once, without focus moving. NOT twice |
| 5. The dialog on `/en/hobt` | `Enter` on Get Demo | "Book a demo, dialog"; the rotor lists only the dialog's contents |
| 6. Form errors on `/en/incidents/submit` | submit empty | the summary is spoken, then "list, N items", then each message |
| 7. Success | complete the demo form | "Thanks. We will be in touch." and `VO-F5` reports focus **on that message** |
| 8. Route change | `Enter` on a nav link | the new page title is announced **once**, and reading starts in main |

### NVDA (Windows) — `Ctrl+Alt+N` to start

| Step | Keys | Pass condition |
|---|---|---|
| 1. Elements list | `Ins+F7` | the Landmarks and Headings tabs match VoiceOver's rotor |
| 2. Region cycling | `D` | steps through the same landmarks in DOM order |
| 3. Heading jump | `H`, then `1`–`6` | `2` reaches Filters and Results; `3` reaches the card titles |
| 4. Forms mode | `Tab` into a select | NVDA switches to forms mode and reads the label, then the value |
| 5. Live region | change a filter | the count is spoken. If it is silent, the region was created by the update rather than existing before it |
| 6. `aria-modal` | open the dialog, then `Ins+F7` | the elements list contains the dialog's controls and not the page's |

### Findings from the first run

| Finding | Verdict |
|---|---|
| `8.5/10` on `/reviews/[slug]` is spoken as "8.5 slash 10" | minor, accepted (22.1) |
| The German skip-link string is long enough to overlap the site title at 320 px | fixed by the `focus:fixed` panel, which is out of flow |
| Two textboxes named "Your name" exist on `/hobt` | not a defect: the dialog is `aria-modal`, so only one is ever reachable |
```

> **Do not claim to have run it here.** This lesson ships the script and the shape of what a
> first run finds. Your run is the one that counts, on your machine, with your assistive
> technology, and the third table is where you write down what it told you.

### Step 8: The rows, including one correction to an earlier lesson's table

`docs/accessibility.md` has a standing rule from Lesson 11.4: every lesson adding an `aria-*`
attribute or a role adds a row. This lesson adds two attributes and corrects a row that has been
wrong since Lesson 20.3.

```markdown
<!-- docs/accessibility.md — append to the "Every aria-* in src/, and why" table -->
| `role="status"` on an `sr-only` region | `incidents/IncidentFilters.tsx` | announces the result count after a filter change, without moving focus. `role="status"` rather than `aria-live="polite" aria-atomic="true"`: identical meaning, and a role is addressable by `getByRole` while an attribute is not. Empty in the server HTML and until the first change after mount — Lesson 16.1 §7's argument, applied to a count | no — nothing native announces a change |
| `tabIndex={-1}` on a success message | `hobt/LeadForm.tsx`, `incidents/IncidentSubmitForm.tsx` | the form that had focus unmounts on success; without this, focus falls to `<body>` and inside a Radix dialog the trap is around nothing | no |
```

```markdown
<!-- docs/accessibility.md — the "Deliberately NOT used" table: DELETE the aria-live row -->
The row reading `| aria-live | nothing announces yet. Module 22 Lesson 22.2 adds one for filter
results |` has been wrong since Lesson 20.3, which added `aria-live="polite"` to the result count
in `IncidentBrowser.tsx` without moving the row out of "Deliberately NOT used". Delete it: the
concern now has a real row above, spelled `role="status"`.
```

```markdown
<!-- docs/accessibility.md — append to "Known gaps, owned by a later module" -->
| Route-change focus moves to `<main>`; nothing standardises that target, and it is not the right one on a route whose first meaningful content sits above `<main>` | accepted — Lesson 22.2 §5 states the three conditions and the caveat |
| Two search affordances on `/incidents`: `IncidentSearch` filters the fetched page, `?q=` filters what WordPress is asked for. One announcement covers both; the duplication itself is a product decision | accepted — named by Lesson 18.1 |
| A `motion-reduce:` variant on a new `<DialogContent>` is not enforced by anything | open. Verification check 13's grep is the only guard; a `no-restricted-syntax` selector would close it |
```

---

## Verification

```bash
cd next-app

# 1. The gate, and the suites this lesson could have broken.
npm run verify
# Expected: exit 0, silent
npm test -- --run
# Expected: all green. IncidentFilters gained a required `resultCount` prop, so a
#           type error here is a call site you missed, not a test that is wrong.
npx playwright test --project=smoke
# Expected: all green. The suite has grown well past Lesson 12.3's thirteen —
#           16.4, 17.2 and 20.4 all added specs to `smoke` — so read the exit
#           code rather than a count. The skip-link test and the landmark
#           assertions from 12.3 are the two this lesson is most likely to break.

# 2. The skip link is still the first focusable element in the document.
curl -s http://localhost:3000/en | grep -o 'Skip to main content\|<header' | head -2
# Expected: "Skip to main content" first, "<header" second

# 3. The two one-word fixes on SkipLink.
grep -c 'focus:start-4' src/components/layout/SkipLink.tsx
# Expected: 1
grep -c 'focus:z-\[60\]' src/components/layout/SkipLink.tsx
# Expected: 1 — above PreviewBanner's z-50, which comes later in the DOM

# 4. NEGATIVE — no physical inset property survives on the skip link. Lesson
#    20.4's sweep says it must appear top-RIGHT under a forced dir="rtl".
grep -nE 'left-|right-' src/components/layout/SkipLink.tsx
# Expected: no output

# 5. RouteFocus is mounted once, reads the RAW pathname, and announces nothing.
grep -c 'RouteFocus' 'src/app/[locale]/layout.tsx'
# Expected: 2 — the import and the element
grep -c "from 'next/navigation'" src/components/layout/RouteFocus.tsx
# Expected: 1 — next-intl's usePathname strips the locale prefix, so a locale
#           switch would not register as a navigation
grep -cE 'aria-live|role="status"|role="alert"' src/components/layout/RouteFocus.tsx
# Expected: 0 — Next's route announcer already reads the new title (§7)

# 6. NEGATIVE — all three conditions from §5 are implemented, not two of them.
grep -c 'popstate' src/components/layout/RouteFocus.tsx
# Expected: 2 — the addEventListener and the removeEventListener
grep -c 'from === pathname' src/components/layout/RouteFocus.tsx
# Expected: 1 — the query-string-only guard. Without it, typing in the search
#           box on /incidents yanks focus out of the box on every keystroke that
#           pushes a new URL.

# 7. EXACTLY ONE region announcing the count, and it is EMPTY in the server
#    HTML. Both halves matter: two regions double-announce the same fact (§7),
#    and a region created by its own update is unreliable (§6).
curl -s http://localhost:3000/en/incidents | grep -o 'role="status"' | wc -l
# Expected: 1 on a healthy origin — the count region. Lesson 18.4's degraded
#           notice is also role="status" and renders only when WordPress is
#           unreachable, which is a DIFFERENT fact and therefore allowed (§7).
curl -s http://localhost:3000/en/incidents | grep -coE '<p role="status"[^>]*></p>'
# Expected: 1 — the region is present and there is NOTHING between its tags.
#           React renders {''} as no child at all, so an empty region really is
#           `<p …></p>`. A populated region here means the announcement is
#           server-rendered, which announces the count to nobody and duplicates
#           the visible text.

# 8. NEGATIVE — Lesson 20.3's region really moved rather than being duplicated,
#    and the longhand attribute pair is nowhere.
grep -c 'aria-live' src/components/incidents/IncidentBrowser.tsx
# Expected: 0
grep -rn 'aria-live' src/components/
# Expected: no output. role="status" and role="alert" mean polite+atomic and
#           assertive+atomic respectively, and unlike an attribute a role is
#           addressable by getByRole — which is what keeps Lesson 22.4's
#           regression test inside the selector contract (§6).

# 9. Ids are generated, not literal.
grep -c 'useId' src/components/incidents/IncidentFilters.tsx
# Expected: 1
grep -cE 'id="filter-|htmlFor="filter-' src/components/incidents/IncidentFilters.tsx
# Expected: 0 — Lesson 08.3's literals are gone
curl -s http://localhost:3000/en/incidents | grep -oE 'id="[^"]*-severity"' | sort -u | wc -l
# Expected: 1 — one instance, one id. Read the value: React 19's `useId`
#           generates a prefix with punctuation in it, which is legal in an HTML
#           id and is why you must never put a generated id into a CSS selector
#           or a Playwright locator. The exact characters are a React
#           implementation detail and have changed between majors — do not
#           assert on them, which is another reason the locator rule is role and
#           accessible name.

# 10. NEGATIVE — no element that should be reachable carries tabIndex={-1}. The
#     only legitimate uses are <main>, the honeypot input, and the two success
#     messages this lesson added.
grep -rn 'tabIndex={-1}' src/
# Expected: exactly four files — app/[locale]/layout.tsx (<main>),
#           hobt/LeadForm.tsx (the honeypot AND the success message),
#           incidents/IncidentSubmitForm.tsx (the success message),
#           ui/form.tsx (FormErrorSummary, from Lesson 22.1). A FIFTH hit on an
#           interactive control is a control you have removed from the keyboard.

# 11. NEGATIVE — no focus ring removed without a visible replacement. Lesson
#     11.4's grep, plus the alpha check 22.1 added because 11.4's version
#     passed on a 1.54:1 ring.
grep -rn 'outline-none\|outline-0' src/components/ src/app/ \
  | grep -v 'focus-visible:ring\|focus:ring'
# Expected: no output
grep -rn 'ring-ring/' src/
# Expected: no output

# 12. NEGATIVE — no focusable element can hide under the sticky header. This is
#     the grep half; check 16 is the half that actually proves it.
grep -c 'scroll-padding-top' 'src/app/[locale]/globals.css'
# Expected: 1
grep -c 'scroll-mt-20' 'src/app/[locale]/layout.tsx'
# Expected: 1

# 13. NEGATIVE — no animation without a motion-reduce variant, in the whole
#     component tree. This is the check that closes Lesson 11.4 Step 7's gap.
grep -rn 'animate-in\|animate-out\|animate-pulse\|animate-spin\|transition-' \
  src/components/ | grep -v 'motion-reduce'
# Expected: no output. Before this lesson, dialog.tsx and sheet.tsx produced five
#           between them — count them in Step 6 command 1 before you patch, so
#           this zero has a denominator.

# 14. The ticker does not tick. Recorded, because the audit result is "nothing
#     to do" and a future reader will assume otherwise from the name.
grep -c 'animate\|marquee\|@keyframes' src/components/blocks/IncidentTicker.tsx
# Expected: 0

# 15. NEGATIVE — no CSS or attribute locator crept into the E2E suite while you
#     were reasoning about the DOM. Role and accessible name only, with
#     getByLabel for password fields as the one documented exception.
grep -rnE 'data-testid|page\.locator\(|nth-child|xpath=' e2e/
# Expected: no output

# 16. By hand, with the keyboard, because checks 12 and 13 only prove the
#     classes are present.
#     - /en/incidents: Tab down the list while it scrolls. Every ring stays
#       fully visible; none passes under the header.
#     - /en/hobt: Enter on Get Demo. Tab past the last field — it wraps to the
#       first. Escape — focus is back on the button you came from.
#     - Complete the demo form. The success message is announced AND
#       document.activeElement is that <p>, not <body>. Check it in the console:
#       `document.activeElement.tagName`
#     - /en → Enter on "Incidents" → Tab once. The next stop is inside main,
#       not the skip link.
#     - Back button → Tab once. Focus did NOT move to main. Condition 3.
```

Checks 6, 7, 10 and 13 are the four that define this lesson: the focus policy has all three of
its conditions, there is exactly one live region and it starts empty, nothing reachable was
removed from the keyboard, and every animation is now guarded.

## Control Questions

1. `RouteFocus` imports `usePathname` from `next/navigation` while `NavLink` imports it from
   `@/lib/i18n/navigation`, and Lesson 20.3 warns that mixing the two breaks active-link
   highlighting with no error. Explain what each import returns for the URL `/de/incidents`, say
   which behaviour of `RouteFocus` would be lost by using next-intl's version, and describe the
   symptom `NavLink` would show if it used `next/navigation`'s.
2. The live region on `/incidents` is `sr-only` and starts empty, while the visible result count
   is ordinary text with no `aria-live` at all — the reverse of what Lesson 20.3 shipped. Give the
   two independent reasons the region must be empty in the server HTML, and say what a
   screen-reader user would hear on first page load if it were not.
3. Lesson 11.4's Verification greps for `outline-none` unpaired with a `focus-visible:ring`, and
   two textareas passed it while their focus ring measured 1.54:1. Generalise: state the property
   that separates the assertions a `grep` can make from the ones it cannot, and give one *other*
   accessibility fact in this codebase that is currently asserted by a grep and should not be.
4. `LeadForm`'s success branch gets both `role="status"` and `tabIndex={-1}`, and the lesson
   claims neither is redundant. Describe what a VoiceOver user experiences with the role and
   without the tabindex, what a sighted keyboard user experiences with the tabindex and without
   the role, and why the Radix dialog makes the first case worse than it would be on a plain page.
5. `IncidentFilters` deliberately does not use a `<fieldset>` and `<legend>`, and the lesson names
   the change that would reverse that. State the property of the current component that makes the
   fieldset wrong, name the element that would have to be deleted if the reversal happened, and
   say which of Lesson 18.1's decisions would have to change first.

## Learn More

- [WAI-ARIA Authoring Practices: keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
  — tab order, `tabindex="-1"`, and the roving-tabindex pattern Radix implements for you
- [WAI-ARIA APG: the modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  — the specification Radix is implementing, so you can tell a bug from a design choice
- [WAI-ARIA APG: live regions](https://www.w3.org/WAI/ARIA/apg/practices/live-regions/) — politeness,
  atomicity, and the "the region must already exist" rule Key Concept 6 turns into a code shape
- [MDN: `aria-live`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-live)
  — including which mutations actually trigger an announcement, which is narrower than you expect
- [Radix UI: Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) — read
  `onOpenAutoFocus` and `onCloseAutoFocus`, the two escape hatches this lesson deliberately does not use
- [Marcy Sutton: accessible client-side routing](https://www.gatsbyjs.com/blog/2019-07-11-user-testing-accessible-client-routing/)
  — the user research behind Key Concept 5; the community still has not converged, and this is why
- [Understanding 2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)
  — the criterion Key Concept 1's table is about, with the `order-*` failure spelled out
- [WebAIM: VoiceOver keyboard shortcuts](https://webaim.org/articles/voiceover/) — the `VO-U`
  rotor and `VO-F5` "where is focus" commands Step 7's script depends on
- [WebAIM: using NVDA to evaluate accessibility](https://webaim.org/articles/nvda/) — `Ins+F7`,
  the `D` and `H` navigation keys, and the browse/forms mode distinction that surprises everyone once
