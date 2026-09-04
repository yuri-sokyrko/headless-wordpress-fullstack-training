---
title: 'From Agent Findings to Deterministic Specs'
module: 23
lesson: 9
teaches: [spec-hardening, web-first-assertions, agentic-limits, diff-guards, nondeterminism, ci-scheduling]
produces: ['next-app/e2e/incident-leakage.spec.ts', 'docs/agentic-qa.md', '.github/workflows/agentic-qa.yml']
requires: [23.8, 23.6]
---

# Lesson 23.9 — From Agent Findings to Deterministic Specs

## Quick Overview

An agent finding is worth something only once it becomes a test that fails on the bug and passes
on the fix, forever, without an agent involved. That conversion is this lesson, and it is
mechanical enough to be a checklist. Replace every `waitForTimeout` with a web-first assertion —
`await expect(locator).toHaveText(...)` retries and `await page.waitForTimeout(2000)` is a
guess that will be wrong on a slower CI runner. Replace every `toBeVisible()` with an assertion
on the actual value, because "the count element is visible" passes when the count is wrong and
the whole finding was that the count was wrong. Bring locators into the Lesson 23.7 contract.
Add the negative case the agent forgot, because agents test that the fix works and rarely test
that the guard still rejects. Then a human reviews the diff and checks it in, like any other code.

The second half is the **honest-limits table**, and it is the reason this module can recommend
agentic QA at all. Four limits, each with the control it implies.

**Nondeterminism.** The same charter run twice produces different paths and sometimes different
conclusions. Therefore **agents never gate a merge.** They generate the deterministic specs that
do. That is the single most important sentence in the module.

**Cost and latency.** An exploration run takes minutes and costs money. Therefore it runs nightly
or on an explicit label — never on every push.

**No knowledge of business intent.** The agent cannot know that an incident must be `pending`
until a moderator with `publish_incidents` acts, because that is a decision in
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities), not
something visible in the UI. Therefore **any assertion encoding a business rule is hand-written
by a human from the acceptance criteria.** The agent finds the symptom; a person writes the rule.

**And the most damaging failure mode: an LLM "fixing" a red test by loosening the assertion or
adding a sleep.** It is a locally rational move — the test goes green — and it destroys the value
of the suite silently. This one is blocked mechanically, not by review discipline: a guard
**rejects any agent-proposed diff that touches `expect(`**. Assertions are human-authored, and
that is enforced by a check rather than by hoping somebody notices in a pull request.

By the end of this lesson you will have:

- `e2e/incident-leakage.spec.ts` — a real Lesson 23.8 finding as a deterministic spec, red before
  the fix and green after
- Two more hardened specs from the remaining triaged findings, including the negative case each one needed
- A hardening checklist in `docs/agentic-qa.md`: no `waitForTimeout`, no bare `toBeVisible()`,
  contract-compliant locators, one behaviour per spec
- The honest-limits table written into `docs/agentic-qa.md` in your own words, plus a diff guard
  that rejects any agent-proposed change touching `expect(`
- `.github/workflows/agentic-qa.yml` — nightly or label-triggered, minimal `permissions:`,
  `pull_request` never `pull_request_target`, no deploy secrets, artifacts scrubbed
- A recorded decision that agent output is **advisory** and the checked-in specs are the gate

## Classic WP Analogy

There is one Classic habit that maps onto this almost perfectly, and it is the best available
frame for the whole lesson: **the bug report to regression test pipeline.** A client reports that
scheduled posts appear in the archive early. You reproduce it, fix it, and — if you were
disciplined — you wrote a test so it could not come back. The agent is a new *source* of bug
reports. Everything downstream is the process you already know.

| Classic WordPress | Agentic QA |
|---|---|
| A client reports something odd | A charter run reports something odd |
| Reproduce it locally before believing it | Read the trace and reproduce it by hand |
| Fix, then write the regression test | Fix, then harden the agent's spec and check it in |
| `sleep(2)` in a script because it was flaky | `await expect(...)` — web-first, retrying |
| "It looks right on staging" | An assertion on the actual value, not on visibility |
| A senior developer reviews the patch | A human reviews the diff; assertions are human-authored |

Where the analogy breaks is the failure mode with no precedent, and it is worth dwelling on
because it is genuinely new. A human developer who cannot make a test pass will either fix the
code or come and tell you the test is wrong. Neither of those is silent. **A language model
optimising for "the test is green" will loosen the assertion**, and it will do so with a plausible
commit message. Nothing in Classic WordPress practice prepares you for a contributor whose
incentive is the appearance of correctness rather than correctness, and no amount of code-review
diligence scales against it — a two-character change from `toBe(1)` to `toBeGreaterThanOrEqual(0)`
is invisible in a large diff at 5pm.

That is why the control is mechanical. A guard that rejects any agent-proposed diff touching
`expect(` is crude, and crude is the point: it cannot be talked around, it needs no judgement,
and it draws the line exactly where the value of the suite lives. The generalisable lesson —
which is really the lesson of the whole module — is that **when you add a non-human contributor,
you add its incentives too, and the defences have to be structural rather than procedural.** It
is the same argument as withholding `publish_incidents` from `incident_reporter` in Module 03: do
not check for the bad outcome, make it unreachable.

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
