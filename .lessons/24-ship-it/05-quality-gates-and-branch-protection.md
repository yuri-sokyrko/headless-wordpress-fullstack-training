---
title: 'Quality Gates & Branch Protection'
module: 24
lesson: 5
teaches: [quality-gates, phpstan-baseline, patch-coverage, gitleaks, trivy, licence-allowlist, commitlint, branch-protection, ratchet-philosophy]
produces: ['docs/quality-gates.md', '.github/workflows/ci.yml']
requires: [24.4, 22.4, 21.4]
---

# Lesson 24.5 — Quality Gates & Branch Protection

## Quick Overview

A gate is a check with a threshold and a consequence. Without the threshold it is a dashboard;
without the consequence it is a suggestion. This lesson assembles every check the course has
produced into one table with four columns — `Gate | Tool | Threshold | Blocks merge?` — writes it
into `docs/quality-gates.md`, and then configures branch protection to enforce it. The table is
the deliverable, because a gate table is the shortest honest answer to "what does this
codebase guarantee?", and it is the first thing a new contributor should read.

Two gates need explaining beyond their row. **PHPStan runs at level 6 with a shrink-only
baseline**: existing violations are recorded in a baseline file so the gate does not fail on day
one, and the baseline may only get smaller — a pull request that adds an entry fails. That gives
you a strict analyser on a real codebase without a two-week stop-the-world cleanup. And
**coverage is measured on the patch, not the total**: 80% of the lines *this pull request*
changed, which is a threshold a reviewer can act on, unlike a total-coverage percentage that
moves by 0.1% and tells nobody anything.

Then the ratchet, restated because it applies to every row and it is what keeps a gate table
alive: **start every threshold at "no worse than today" and raise it in a dedicated pull
request.** A gate set at an aspirational number is red on arrival, red for reasons unrelated to
the change in front of it, and disabled within a week. A gate set at your measured baseline is
green on arrival and blocks exactly the regressions it exists to block.

By the end of this lesson you will have:

- `docs/quality-gates.md` — the complete table, with the threshold and the blocking decision for
  every gate, and the date each threshold was last raised
- A shrink-only PHPStan level 6 baseline enforced by a check, and Codecov patch coverage at
  ≥ 80% with a written list of legitimately excluded paths
- `gitleaks` scanning the full history on first run and the diff thereafter
- Trivy on the WordPress image failing on HIGH and CRITICAL **that have a fix available**, a
  per-directory licence allowlist, and `commitlint` on pull request titles and commits
- Branch protection on `main` requiring exactly one status check — `ci-required` — plus review,
  linear history and no force pushes
- A written escape-hatch procedure: how to ship past a gate on purpose and what gets recorded

The table you assemble, in summary — `docs/quality-gates.md` is the authoritative copy:

| Gate | Tool | Threshold | Blocks merge? |
|---|---|---|---|
| Type safety | `tsc --noEmit` | strict, zero errors | ✅ |
| JS lint | ESLint | `--max-warnings=0` | ✅ |
| GraphQL documents | `@graphql-eslint` | zero errors against `schema.graphql` | ✅ |
| PHP style | PHPCS (WPCS) | zero errors | ✅ |
| PHP static analysis | PHPStan | level 6, shrink-only baseline | ✅ |
| Patch coverage | Vitest + Codecov | ≥ 80% of changed lines | ✅ |
| Schema / codegen drift | `git diff --exit-code` | no diff | ✅ |
| E2E | Playwright | all pass; **zero quarantined tests in the required set** | ✅ |
| Accessibility | `@axe-core/playwright` | zero `critical`, zero `serious` | ✅ |
| Lighthouse | Lighthouse CI | perf ≥ 0.90, a11y ≥ 0.95, SEO ≥ 0.95 | ✅ |
| LCP / CLS | Lighthouse CI | ≤ 2500 ms / ≤ 0.10 | ✅ |
| Bundle budget | `next build` + script | ≤ 180 KB gzip, ≤ +10 KB vs `main` | ✅ |
| Secret scanning | gitleaks | zero findings | ✅ |
| Image vulnerabilities | Trivy | zero HIGH/CRITICAL **with a fix** | ✅ |
| Dependency licences | allowlist per directory | no GPL/AGPL in `next-app` | ✅ |
| Commit format | commitlint | conventional commits | ✅ |
| Agentic QA | Playwright MCP | advisory only — see Lesson 23.9 | ❌ |
| AI code review | review job | advisory except two findings — see Lesson 24.8 | ❌ |

## Classic WP Analogy

Your Classic equivalent, if you had one, was PHPCS with the WordPress Coding Standards ruleset —
and that is a genuinely good starting point, because it already taught you the central insight:
**a rule enforced by a tool changes the default, and a rule enforced by a person does not.**
Before PHPCS, correct spacing required someone to care at the moment of typing. After PHPCS,
incorrect spacing required someone to fight the tool.

Where the analogy breaks is scope and stakes. PHPCS covered one language, one concern, and its
failures were unambiguous. This table covers two languages, four runtimes, performance,
accessibility, security, licensing and commit hygiene, and several of its rows are **judgement
calls dressed as numbers**. Is 180 KB the right bundle budget? Is patch coverage at 80% right?
Neither has a correct answer; both have a *defensible* answer that someone wrote down, which is
strictly better than no answer.

That difference has a practical consequence with no PHPCS counterpart: **this table needs an
escape hatch, and PHPCS did not.** A style violation is always wrong, so a hard failure is always
correct. A bundle-budget violation might be the right trade for a genuinely valuable feature. So
the procedure is defined here — raise the threshold in the same pull request, in the file, with
the reason written down — and it is deliberately not "add `continue-on-error`". A gate that can
be bypassed silently is not a gate. A gate that can be bypassed *on the record* is a gate people
will still trust in a year.

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
