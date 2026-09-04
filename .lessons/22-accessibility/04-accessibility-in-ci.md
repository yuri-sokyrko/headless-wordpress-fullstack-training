---
title: 'Accessibility in CI'
module: 22
lesson: 4
teaches: [a11y-merge-gate, severity-thresholds, playwright-projects, regression-tests, rtl-a11y-payoff]
produces: ['next-app/playwright.config.ts', 'next-app/e2e/a11y.spec.ts']
requires: [22.3, 21.4]
---

# Lesson 22.4 — Accessibility in CI

## Quick Overview

An audit is a snapshot. A gate is a guarantee. This lesson turns Lesson 22.3's spec into a
required check with a threshold chosen so it will still be enabled in six months: **zero
`critical` and zero `serious` axe violations on the six key routes blocks a merge; `moderate`
and `minor` are reported in the job summary and block nothing.** That split is deliberate.
`critical` and `serious` map to "a user cannot complete a task" — no accessible name on the
submit button, a form field with no label, text below 4.5:1. `moderate` includes a long tail of
best-practice findings that are genuinely worth fixing and genuinely not worth blocking a
release for, and a gate that blocks on them gets switched off the first time somebody needs to
ship a hotfix.

The second half of the lesson is the payoff loop, and it is the reason accessibility work
compounds instead of decaying. Module 23 writes component tests with React Testing Library,
whose primary queries are `getByRole`, `getByLabelText` and `getByText` — the accessibility tree,
by design. A button with no accessible name is not findable by `getByRole('button', { name })`,
so the unit test fails. A form field with no label is not findable by `getByLabelText`, so the
unit test fails. Playwright's recommended locators work the same way, and Lesson 23.7 makes that
the enforced selector contract. **Once your tests query the way assistive technology queries,
inaccessible markup fails your test suite before it ever reaches an axe scan** — and
accessibility stops being a separate audit somebody has to schedule.

By the end of this lesson you will have:

- A dedicated `a11y` Playwright project in `playwright.config.ts`, runnable independently and in CI
- `e2e/a11y.spec.ts` finalised: severity-partitioned assertions, per-route and per-locale reporting
- A machine-readable violation report uploaded as a CI artifact, with the count in the job summary
- A regression test for one real finding from Lesson 22.2 — a named failing case, fixed, then pinned
- A written suppression policy: what may be suppressed, where the annotation lives, and that every
  suppression carries a reason and an owner
- The gate registered in the quality-gate table that Lesson 24.5 assembles, and pointed at by
  branch protection in Lesson 24.5

## Classic WP Analogy

**Like Lesson 22.3, this has no classic analogue at all — and here the absence is the entire
point of the lesson.** There is no WordPress equivalent of "the build fails because a form field
lost its label". `wp plugin check` has accessibility sniffs, and they are useful, and they are
not a merge gate on your site. The Theme Review process is a review, performed once, by a person,
before the theme is published. Nothing in the Classic WordPress toolchain re-verifies
accessibility when a developer changes a button three years later.

The closest habit you have is PHPCS, and the comparison holds well enough to be instructive.
PHPCS did not teach anyone the WordPress Coding Standards; it made a class of violation
unmergeable, which changed the *default*. Before PHPCS, correct spacing required someone to care
at the moment of typing. After PHPCS, incorrect spacing required someone to actively fight the
tool. An accessibility gate does the same thing to a category of bug that has, historically,
been fixed only after a complaint or an audit — which is to say, mostly not fixed.

Where the analogy breaks is the shape of the failure. A PHPCS violation is a fact: the line is
either indented correctly or it is not, and the fix is unambiguous. An axe violation is
occasionally arguable — a rule can fire on a construct that is genuinely fine, or fire on
third-party markup you do not control, or fire on editor-authored HTML coming out of `RichText`
where the fix belongs in WordPress rather than in your React tree. So an accessibility gate needs
something PHPCS does not: a suppression mechanism with a written policy, so that "axe is wrong
here" is a recorded, reviewable decision rather than a silently disabled rule. That policy is
the last thing you write in this module, and it is what keeps the gate credible.

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
