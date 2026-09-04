---
title: 'Your First Playwright Test'
module: 12
lesson: 3
teaches: [playwright, e2e-testing, role-based-locators, accessible-name, web-server-config, auto-waiting]
produces: ['next-app/playwright.config.ts', 'next-app/e2e/smoke.spec.ts']
requires: [12.2, 11.4]
---

# Lesson 12.3 — Your First Playwright Test

## Quick Overview

This is the load-bearing lesson of the module. Playwright drives a real browser against a real
Next.js server talking to a real WordPress, which makes it the only tool in the course that can
answer "does the site work?". You will configure it to start `npm run dev` itself, write a smoke
spec that visits every route from the Module 09 inventory, and assert the things that would
matter at 9am on a Monday: the page responds, the `<h1>` is the right one, the nav is present,
and nothing logged a console error.

The part that will change how you write code for the remaining twelve modules is **locators**.
A test has to find elements, and after Lesson 11.1 there are no semantic class names left to
find them by — Tailwind utilities are not identifiers, and `page.locator('.flex.gap-4')` is a
test that breaks the next time someone adjusts spacing. The right answer is
`page.getByRole('button', { name: 'Get Demo' })`: find the element the way an assistive
technology finds it, by its role and its accessible name. That works only if your components
have correct roles and real accessible names — which means from this lesson onward, every
component you write is either accessible or untestable. Lesson 11.4 did the work; this lesson
is what makes it stay done.

By the end of this lesson you will have:

- `next-app/playwright.config.ts` with a `webServer` block, one browser project, retries off locally and on in CI
- `next-app/e2e/smoke.spec.ts` visiting every route in the Module 09 inventory and asserting a stable heading on each
- Role-based locators throughout, and zero CSS-class or `data-testid` selectors
- A console-error assertion that fails the spec if any page logs to `console.error`
- A test broken by deleting a button's accessible name, and the same test passing again once the name is restored

## Classic WP Analogy

Playwright is your pre-deploy click-through, written down:

| Manual ritual | Playwright |
|---|---|
| Open staging and click every nav item | `for (const route of routes) { await page.goto(route) }` |
| "does the incidents archive still list posts?" | `expect(page.getByRole('article')).toHaveCount(…)` |
| Open devtools and check for red console lines | a `page.on('console')` listener asserting none |
| Check a page loads at all | `expect(response.status()).toBe(200)` |
| Do all of that again after every change | `npx playwright test` |
| Ask a colleague to check on their machine | one CI run, same browser, same data |

The value is not that Playwright does anything you cannot do by hand. It is that it does it
every time, in two minutes, on twenty-eight routes, without getting bored on route nine — and
that it does it on somebody else's pull request while you are asleep. This is the "did I break
it?" loop the second half of the course depends on.

The analogy breaks on **how the test finds things**, and this is the whole substance of the
lesson. You find the "Get Demo" button by looking at the screen, using context, colour,
position and text at once. A test has none of that. Every locator strategy is a coupling
decision, and most of them are bad ones:

| Locator | Couples the test to | Verdict |
|---|---|---|
| `.locator('.hobt-cta button')` | your CSS class names | ❌ and after Lesson 11.1 those names do not exist |
| `.locator('[data-testid="cta"]')` | an attribute that exists only for tests | ❌ passes while the button is invisible or unreachable |
| `.locator('div > div > button')` | your DOM structure | ❌ breaks on any refactor |
| `.getByRole('button', { name: 'Get Demo' })` | the accessible name and role | ✅ breaks only when a user would also be broken |

That last row is the one with a consequence beyond testing. A role-and-name locator fails if
the button becomes a `<div onClick>`, if its label becomes an unlabelled icon, or if it ends up
inside `aria-hidden` content. Those are all real accessibility regressions, and CI now catches
them — for free, as a side effect of how the tests are written. It is the cheapest accessibility
enforcement available, and it only works if you never reach for `data-testid` when a locator is
awkward. When a locator is awkward, the component is usually wrong.

The second break is one Classic WordPress developers consistently underestimate: **this test
has state.** A PHP click-through is stateless because you are looking at whatever content
happens to be there. An assertion like "the incidents list shows 40 items" is only true against
a known database, and the moment you or a colleague publishes a draft, the spec goes red for a
reason that has nothing to do with the code. Lesson 12.4 exists entirely to fix that, and
writing this spec first is how you come to want it.

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
