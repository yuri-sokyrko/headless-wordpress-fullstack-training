# Module 22 — Accessibility

## Prerequisites

Before starting this module you should have completed:

- **Module 11** — the design system and app shell, because Lesson 11.4 built the components
  accessibly and this module is where you find out how well
- **Module 16** — the forms and the Get Demo dialog, which are where the hardest focus problems live
- **Module 20** — i18n, because `lang` and `dir` on `<html>` are accessibility attributes before
  they are internationalization attributes
- **Module 21** — performance, because `prefers-reduced-motion` and layout stability are shared ground

> ⚠️ **An automated scan is not an accessibility audit.** axe reports zero violations on a page
> that is completely unusable with a keyboard, because "the focus order is nonsense" is not
> something a static rule can detect. If you finish Lesson 22.3 with a green axe run and skip
> the manual walkthrough in 22.2, you have tested your markup and not your product.

## Starting State

Module 21 complete: Core Web Vitals pass on the key routes, with budgets written down.

```bash
# 1. The budgets exist and are committed
test -f next-app/lighthouserc.json && test -f docs/perf-baseline.md && echo ok
# Expected: ok

# 2. A production build is within budget
cd next-app && npm run build && node scripts/check-bundle-budget.mjs
# Expected: exit 0, and a per-route table under the 180 KB ceiling

# 3. Lighthouse CI runs locally against the built app
npx lhci autorun --config=lighthouserc.json
# Expected: all assertions pass; note the accessibility category score — it is the number you improve
```

## What You'll Learn

- **Why accessibility is a discipline, not a checkbox** — WCAG 2.2 AA as a set of testable
  criteria rather than a compliance PDF
- **Semantics first** — landmarks, heading order, and the accessible name/role/value triad that
  every assistive technology actually consumes
- **Forms that announce themselves** — labels, descriptions, required state, and error messages
  that reach a screen reader instead of only reaching a sighted user
- **Colour and target size** — auditing the satirical palette against contrast ratios, and the
  WCAG 2.2 criteria that are new since 2.1
- **Keyboard and focus** — focus order, visible focus, focus trapping in a dialog, focus
  restoration, and skip links
- **Live regions** — `aria-live` so a filtered result count is announced, not silently replaced
- **Auditing tools** — axe DevTools, `@axe-core/playwright`, the Lighthouse accessibility
  category, and a clear-eyed account of what they cannot see
- **Enforcement** — a11y as a merge gate, and the loop where accessible markup makes your unit
  tests easier to write

## What You'll Build

- A semantic pass over the app shell: one `<main>`, correct landmarks, a heading outline that
  reads as a table of contents, `lang` and `dir` correct in all three locales
- Accessible names on every icon-only control, every card link and every form field
- A contrast-corrected palette, with the failures listed and the token changes recorded
- `SkipLink`, a visible focus style that survives the design review, and a keyboard-only
  walkthrough of the six key routes with the findings written down
- A focus-trapping, focus-restoring Get Demo dialog and an `aria-live` region on the incident filter
- `e2e/a11y.spec.ts` — `@axe-core/playwright` across the six key routes, in all three locales
- A CI gate: zero `critical` and zero `serious` violations blocks a merge; `moderate` is reported
- A short manual test script for VoiceOver and NVDA that a future contributor can actually follow

After this module the site is keyboard-navigable end to end, announces its state changes, has no
serious axe violations, and a regression in any of those fails a check.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Accessibility Foundations for Components](01-accessibility-foundations-for-components.md) | WCAG 2.2 AA, ARIA, the accessibility tree | Semantic markup, names, labels, contrast fixes |
| 2 | [Keyboard, Focus & Screen Readers](02-keyboard-focus-and-screen-readers.md) | Focus management, `aria-live`, VoiceOver/NVDA | Skip link, focus trap, announced filter results |
| 3 | [Auditing with axe & Lighthouse](03-auditing-with-axe-and-lighthouse.md) | axe DevTools, `@axe-core/playwright` | `e2e/a11y.spec.ts` and a triaged findings list |
| 4 | [Accessibility in CI](04-accessibility-in-ci.md) | Playwright a11y project, severity thresholds | The merge gate and the regression test |

## The Six Routes Under Audit

Five of these are Module 21's budgeted routes. `/[locale]/incidents/submit` replaces
`/[locale]/blog/[slug]`, because a form is where the hard accessibility problems live and a long
blog post is where the hard performance ones do — so the two modules audit an overlapping set
rather than an identical one, and one Playwright project still covers the overlap.

| Route | The hard part | Lesson |
|---|---|---|
| `/[locale]` | Landmark structure, skip link, heading order | 22.1, 22.2 |
| `/[locale]/incidents` | Filter results announced; contrast on severity badges | 22.1, 22.2 |
| `/[locale]/incidents/[slug]` | Editor HTML from `RichText`; heading order you do not control | 22.1 |
| `/[locale]/incidents/submit` | Labels, required state, error association, error summary focus | 22.1, 22.2 |
| `/[locale]/hobt` | Get Demo dialog: focus trap, `Escape`, focus restoration | 22.2 |
| `/[locale]/reviews/[slug]` | Rating semantics — an unnamed `<dl>` of four numbers, announced as "8.5 slash 10" | 22.1 |

## How to Work

1. **Unplug your mouse for Lesson 22.2.** Not metaphorically. The bugs in this module are not
   visible from a mouse-driven session, and reading about focus order teaches you nothing that
   ten minutes of `Tab` will not teach you faster.
2. **Fix in 22.1 and 22.2, measure in 22.3, enforce in 22.4.** Running axe first produces a list
   of rule IDs and no understanding; the tool is far more useful once you know what it is looking for.
3. **Test all three locales.** German compound nouns break truncated accessible names, and
   Ukrainian exposes any place you concatenated a string instead of using a message with a placeholder.
4. **Commit after every lesson.** `git commit -m "fix(a11y): trap and restore focus in the get demo dialog"`
