---
title: 'Auditing with axe & Lighthouse'
module: 22
lesson: 3
teaches: [axe-core, axe-devtools, axe-core-playwright, lighthouse-a11y, automated-coverage-limits, manual-audit]
produces: ['next-app/e2e/a11y.spec.ts']
requires: [22.2, 12.3]
---

# Lesson 22.3 — Auditing with axe & Lighthouse

## Quick Overview

axe-core is a rules engine. It walks the rendered DOM and the computed accessibility tree,
applies around a hundred deterministic rules, and returns violations with a node, a rule ID, a
severity (`minor`, `moderate`, `serious`, `critical`) and a help URL. It is the same engine
inside the axe DevTools browser extension, inside Lighthouse's accessibility category, and
inside `@axe-core/playwright` — so you can find an issue interactively and then pin it with a
test that speaks the same vocabulary. That combination is what makes axe the right tool: the
manual and automated paths agree.

This lesson runs all three, on the six audited routes, in all three locales, and then does the
thing most accessibility tooling articles skip: it states the coverage honestly.
**Automated tools catch roughly a third of real accessibility issues** — Deque's own published
figure for axe is "up to 57% of WCAG issues" in the most favourable framing, and the practical
number on a real component library is lower. That is not a criticism of axe; it is a property of
the problem. A rule can prove an image has no `alt`. No rule can prove the `alt` text is
*correct*, that the focus order makes sense, that the error message is comprehensible, that the
live region announced something a user needed, or that the heading structure describes the
document. Which is precisely why Lessons 22.1 and 22.2 came first: the manual work is not
optional cleanup after the scan, it is the majority of the audit, and the scan is the part you
automate because it is the part that is mechanisable.

By the end of this lesson you will have:

- axe DevTools run manually over the six routes with the findings triaged by severity, and
  Lighthouse's accessibility score before and after, recorded next to the performance baseline
- `next-app/e2e/a11y.spec.ts` — `@axe-core/playwright` parameterised over routes × locales, with
  WCAG 2.2 AA tags selected explicitly
- Two scans per authenticated route: one anonymous, one logged in, because the header and the
  submit form differ
- A dialog-open scan, because a closed dialog's contents are not in the DOM and a scan of the
  closed state proves nothing
- A written table of what the automated suite covers, what it cannot cover, and which manual
  check covers each gap
- Every remaining `critical` and `serious` violation fixed, and every suppression annotated with
  a reason and an owner

## Classic WP Analogy

**There is no classic analogue for this, and that is worth saying plainly rather than stretching
for one.** Classic WordPress accessibility work was human review against a checklist. The Theme
Review team's `accessibility-ready` audit was a person with a keyboard and a screen reader
reading a list. WordPress core has no accessibility test suite that runs on every commit. If you
have shipped accessible WordPress themes, you did it by knowing the rules and caring — not by
running a tool that failed your build.

Two things follow from that absence, and both are the reason this lesson exists.

**First, tooling changes what you can promise.** "We reviewed this and it was accessible in March"
is a statement about the past. "Zero critical or serious violations on the six key routes, checked
on every pull request" is a statement about the present that stays true without anyone
remembering. That is a categorically different kind of commitment, and it is available to you now
in a way it was not in a PHP theme, because the page is rendered by something a headless browser
can drive.

**Second, a new tool invites a new failure mode.** The Classic-era risk was doing no accessibility
work at all. The automated-era risk is doing a scan, seeing green, and believing you are done —
which is worse, because it comes with a false certificate. The honest posture is to treat axe the
way you treat PHPCS: it eliminates a category of mistake so that human attention can go to the
things only humans can judge. A green axe run means your markup does not contain the hundred
mistakes axe knows about. It does not mean a blind user can submit an incident, and the only way
to know that is Lesson 22.2's walkthrough.

---

## Key Concepts

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
