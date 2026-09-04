---
title: 'Performance Budgets & Guardrails'
module: 21
lesson: 4
teaches: [performance-budgets, lighthouse-ci, bundle-budget, ratchet-philosophy, ci-guardrails]
produces: ['next-app/lighthouserc.json', 'next-app/scripts/check-bundle-budget.mjs', 'docs/perf-baseline.md']
requires: [21.3, 21.2]
---

# Lesson 21.4 — Performance Budgets & Guardrails

## Quick Overview

Performance work that is not defended decays. Not because anyone is careless, but because the
cost of each individual regression is invisible: a new dependency here, a `'use client'` there,
an analytics snippet somebody added on a Friday. Six weeks later the site is 400 KB heavier and
no single change is to blame. A **budget** makes each increment visible at the moment it is
introduced, in the pull request that introduces it, to the person who still remembers why.

This lesson turns Module 21's measurements into two mechanical checks. `lighthouserc.json`
drives Lighthouse CI against the six key routes with assertions on LCP, CLS, TBT and the
category scores — the lab half. A bundle-budget script parses the `next build` output and fails
on two conditions: any route above 180 KB gzip First Load JS, or any route more than 10 KB above
the same route on `main` — the delta half, which is the one that actually catches regressions,
because an absolute ceiling with 40 KB of headroom silently absorbs four bad merges. Both run as
required checks in Lesson 24.5's gate table.

The philosophy matters more than the configuration, so it gets stated plainly and repeated:
**start every threshold at "no worse than today" and raise it in a dedicated pull request.** A
gate introduced at an aspirational number is red on arrival, red for reasons unrelated to the
change in front of it, and disabled within a week — usually with a `continue-on-error: true`
that nobody removes. A gate set at your measured baseline is green on arrival, blocks exactly
the regressions it was built to block, and earns the credibility you need to tighten it later.

By the end of this lesson you will have:

- `next-app/lighthouserc.json` — six URLs, mobile preset, three runs with median aggregation, and
  assertions set from your own baseline
- `next-app/scripts/check-bundle-budget.mjs` — a parser over the build output enforcing both the
  absolute ceiling and the delta-vs-`main` limit, with a readable failure message
- `docs/perf-baseline.md` finalised: current numbers, the thresholds derived from them, and the
  date each threshold was last raised
- A deliberately-broken branch proving both checks fail — an unnecessary `'use client'` and a
  removed `sizes` attribute
- A written ratchet procedure: who raises a threshold, in what kind of pull request, and what
  evidence the PR must contain
- An escape hatch defined honestly: how to ship past a budget on purpose, what must be recorded,
  and why "disable the check" is not on the list

## Classic WP Analogy

There is no real Classic WordPress analogue for an automated performance budget, and that
absence is itself the lesson. The Classic equivalents were all **human rituals**: a pre-launch
GTmetrix screenshot, an agency performance checklist, a senior developer who noticed the page
felt slower, a client complaint that triggered a "speed optimisation" project three months after
the regression landed. All retrospective, all reliant on someone caring on the right day.

The closest mechanical thing you may have used is a PHPCS ruleset — and that comparison is
actually the useful one. PHPCS did not make anyone a better programmer; it made a specific class
of mistake **impossible to merge**, which freed reviewers to talk about design instead of
spacing. A performance budget does the same trick for a different class of mistake. Nobody has to
remember to check the bundle size, and nobody has to be the person who says "this got slower" in
a code review.

Where the comparison breaks: a PHPCS violation is objectively wrong, so a hard failure is always
correct. A budget violation might be **the right trade** — a genuinely valuable feature that
costs 30 KB is a decision, not a defect. So a performance gate needs something a linter does not:
a documented, low-friction, *recorded* way to ship past it. This lesson defines that path, and it
is deliberately not "add `continue-on-error`". It is: raise the budget in the same pull request,
in `docs/perf-baseline.md`, with the reason written down. The gate stays honest, the number stays
true, and six months later someone can read why the site got heavier.

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
