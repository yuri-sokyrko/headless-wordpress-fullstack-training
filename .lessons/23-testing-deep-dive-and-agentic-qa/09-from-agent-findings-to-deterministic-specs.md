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

### 1. Hardening is a checklist, and that is the point

An agent's proposed spec is usually 80% right and wrong in the same five ways every time. That
makes the conversion mechanical, which means it can be a checklist rather than a judgement call —
and a checklist is something you can hand to a colleague, or run against your own specs from
before you read this lesson.

| # | Replace | With | Because |
|---|---|---|---|
| 1 | `await page.waitForTimeout(n)` | a web-first assertion on the condition | a sleep is a guess about a machine that is not yours |
| 2 | `await expect(x).toBeVisible()` on a value | an assertion on the **value** | "the count is visible" passes when the count is wrong |
| 3 | a CSS-chain locator | `getByRole(role, { name })` | Lesson 23.7's contract, now an ESLint rule |
| 4 | nothing | **the negative case** | agents test that the fix works; they rarely test that the guard still refuses |
| 5 | one spec asserting four things | one behaviour per spec | a four-behaviour spec fails once and tells you a quarter of what it knows |
| 6 | "the agent wrote it" | a human review and a normal commit | it is code, and code gets reviewed |

Row 4 is where most of the value is, and row 2 is where most of the *lost* value is. Rows 1 and 3
are enforced by the ESLint rule from Lesson 23.7, so they cannot regress. Rows 2, 4 and 5 are
review, and this lesson's Verification is the closest thing to enforcement they get.

### 2. `waitForTimeout` is a guess; a web-first assertion is a question

```ts
// (illustration) the same intent, three ways
await page.waitForTimeout(2000);                              // a guess
await expect(count).toBeVisible();                            // a question, wrongly aimed
await expect(count).toHaveText('6');                          // a question, correctly aimed
```

The first form fails on a slower runner and wastes two seconds on a faster one. Its real cost is
worse than either: **it moves the failure away from the cause.** The spec fails at the assertion
three lines later, so the failure message describes the wrong thing and the next person adds
another second.

Lesson 12.3 §2 made the argument; this lesson supplies the part that only becomes obvious when
you are converting somebody else's spec. A retrying assertion is *faster on average*, because it
returns the instant the condition holds rather than after a fixed pessimistic wait. The fix that
looks like "waiting properly" is the fix that makes the suite quicker.

The one honest exception is a condition with no observable proxy — "nothing happened for two
seconds". That is rare, it is worth a comment naming why, and it is not what an agent produces
`waitForTimeout` for.

### 3. `toBeVisible()` on a value is a test that cannot fail for the reason you wrote it

This is the one that survives review most often, because it looks like an assertion.

```ts
// (illustration)
// The whole finding was that the number was 7 and should have been 6.
await expect(page.getByRole('main')).toContainText('Times blamed');   // ✅ passes at 7
await expect(page.getByRole('main')).toContainText('Times blamed 6'); // ✅ fails at 7
```

An agent writes the first form because the first form is what its own observation supports: it saw
an element, it noted that the element was there. **You** know the number is the finding, and
encoding the number is a step the agent cannot take for you — which is honest limit 3 below,
arriving in the smallest possible form.

| Assertion | Fails when the count is wrong | Fails when the element disappears | Fails when the label changes |
|---|---|---|---|
| `toBeVisible()` | no | yes | no |
| `toContainText('Times blamed')` | no | yes | yes |
| `toHaveText('6')` on the value | **yes** | yes | no |
| both, in one spec | yes | yes | yes |

A bare `toBeVisible()` is not banned — it is exactly right for asserting that a banner appeared or
a dialog opened, where presence *is* the behaviour. It is wrong for a value, and Verification
check 4 asks you to justify each remaining one in a comment rather than to delete them all.

### 4. The negative case the agent forgot, every time

An agent that has just watched something work writes a spec that watches it work. It very rarely
writes the spec that watches the guard refuse, because refusal was not what it was exploring.

| The finding | The agent's spec asserts | The negative case a human adds |
|---|---|---|
| the count disagreed with the list | after publishing, both move | a **pending** submission moves neither |
| focus escaped the dialog | Tab cycles inside the dialog | Escape closes it and focus returns to the trigger |
| the switcher dropped the query | the query survives the switch | it survives the 307 to an untranslated fallback too |

The first row is doing double duty in this lesson and it is worth pausing on. Lesson 23.8's F1
arrived with a confident mechanism — "`wp_term_taxonomy.count` includes pending incidents" — which
was false. The negative case, *a pending submission moves neither number*, is simultaneously the
case the agent forgot **and** the assertion that pins the falsified mechanism into the suite
forever. Somebody who reintroduces a custom `update_count_callback` in three years gets a red
test rather than an argument.

That is the general shape of a good negative: it does not just cover a gap, it **records a
decision**.

### 5. One behaviour per spec, and what that costs

A spec that asserts four behaviours fails on the first one and tells you nothing about the other
three. Splitting them costs setup — three specs each submitting an incident is three submissions —
and buys a failure report that is a diagnosis rather than a hint.

```
   ONE SPEC, FOUR ASSERTIONS               FOUR SPECS, ONE EACH
   ─────────────────────────────           ──────────────────────────────
   run → fails at assertion 2              run → 1 pass, 1 fail, 2 pass
   you know: something is wrong            you know: exactly which behaviour
   assertions 3 and 4: never evaluated     and that the other three are fine
   cost: 1 setup                           cost: 4 setups
```

The trade is real and the answer is not always "split". Lesson 16.4's `funnel.spec.ts` is
deliberately one long test across two applications, because the *journey* is the behaviour and
splitting it would need four logins and produce four specs that each mean less than the one. The
rule is one behaviour per spec, and a journey is one behaviour.

### 6. The honest-limits table, and why this module can recommend agentic QA at all

Four limits. Each one implies a control, and the controls are what make the practice
recommendable rather than fashionable.

**Limit 1 — nondeterminism.** The same charter run twice takes a different path and sometimes
reaches a different conclusion. There is no configuration that fixes this; it is what the tool is.

> **Therefore agents never gate a merge. They generate the deterministic specs that do.**

That is the single most important sentence in the module. Everything else in these four lessons is
downstream of it. A gate has to answer the same question the same way for the same commit, and an
agent cannot promise that. A `spec.ts` file can, which is why the whole practice is a pipeline
*from* the agent *to* the suite and never the other way round.

**Limit 2 — cost and latency.** A run takes minutes and costs money, and a nondeterministic check
that is slow and costs money is the worst possible thing to put on every push: it produces red
builds unrelated to the change in front of it, and it gets disabled within a week. Therefore
nightly, or on an explicit label. That is exactly what the workflow's triggers encode, and it is
the same ratchet argument Lesson 21.4 made about thresholds.

**Limit 3 — no knowledge of business intent.** The agent cannot know that an incident must be
`pending` until a moderator holding `publish_incidents` acts, because that is a decision recorded
in [appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) and
nothing in the UI states it. What the agent can see is a symptom.

> **Therefore any assertion encoding a business rule is hand-written by a human from the
> acceptance criteria.** The agent finds the symptom; a person writes the rule.

This is why Key Concept 3 matters more than it looks. `toHaveText('6')` is a business rule —
somebody decided that a pending submission does not count — and no amount of observation produces
it.

**Limit 4 — an LLM "fixing" a red test by loosening the assertion.** A model optimising for "the
test is green" will change `toBe(1)` to `toBeGreaterThanOrEqual(0)`, or add a sleep, and it will
do so with a plausible commit message. It is locally rational and it destroys the suite's value
silently.

Nothing in normal engineering practice defends against this, and it is worth being precise about
why. A human who cannot make a test pass either fixes the code or comes and tells you the test is
wrong — **neither of those is silent.** Code review does not scale against it either: a
two-character change from `toBe(1)` to `toBeGreaterThanOrEqual(0)` is invisible in a
four-hundred-line diff at five o'clock on a Friday.

Therefore the control is mechanical, and it is Key Concept 7.

### 7. The diff guard: crude on purpose, and honest about its hole

**A guard rejects any agent-proposed diff that touches `expect(`.**

That is the whole rule. It is crude, and crude is precisely the property that makes it work: it
cannot be talked around, it needs no judgement, it has no configuration to weaken, and it draws
the line exactly where the value of the suite lives. An agent may add a spec, fix a locator,
rename a variable, refactor a helper. It may not change what the suite asserts.

```
   the guard, in one line
   ─────────────────────────────────────────────────────────────────────
   git diff "$BASE"...HEAD -- <test paths> | grep -E '^[+-].*expect\('
                                              │
                             ADDED and REMOVED lines both.
                             `-` catches deletion — including a whole
                             file, because a deleted file's contents
                             appear as `-` lines.
```

Both polarities matter and only checking `+` is the common mistake. A diff that *removes*
`expect(await response.json()).toEqual(...)` weakens the suite exactly as much as one that
loosens it, and it is easier to miss in review because the diff gets shorter.

**What it does not cover**, stated rather than glossed:

| Gap | Closed how |
|---|---|
| a rename with `--find-renames` producing no content lines | the second half of the guard: count assertions in the base and in the head, and refuse a decrease |
| a **new** spec whose assertions are weak from birth | not closed. Nothing mechanical can tell a weak new assertion from a correct one. That is review, and Key Concept 1 row 6 |
| a change to the code under test that makes a correct assertion vacuous | not closed. Also review |
| an assertion moved between files | the count check sees no net change, correctly |

So the guard is a floor, not a ceiling, and the assertion count is what turns "did any `expect(`
line change" into "did the suite get weaker". Two crude checks, both of which a human can read in
ten seconds, beat one clever check nobody trusts.

### 8. This is the first workflow file in the course, deliberately minimal

Lesson 24.4 teaches GitHub Actions properly, from the vocabulary up — it opens by assuming you
have never written a workflow file — and it comes *after* this one. So the file below is the
smallest thing that works, and every line carries a comment. You are not expected to have
opinions about `concurrency` groups yet.

The three words you need for now: a **workflow** is a YAML file triggered by an event; it contains
**jobs** that run on **runners**; each job is a list of **steps**. Lesson 24.4 adds path filtering,
reusable workflows, sharding, caching and the `ci-required` aggregation job.

**And this workflow is deliberately not part of `ci-required`.** That is not housekeeping. Lesson
24.4 builds `ci-required` as the single aggregating check that branch protection points at, and
keeping this workflow outside it is the module's central claim made structural:

```
   ci-required  ◀── branch protection
        ├── type-check, lint, Vitest, next build
        ├── PHPCS, PHPStan, Pest, wp-phpunit
        ├── the E2E suite — INCLUDING the specs in this lesson
        └── axe, Lighthouse
                                        (no edge here)
   agentic-qa   ◀── nightly, or a label.  ADVISORY.
```

The specs this lesson writes go into `ci-required` through the E2E suite, like any other spec.
The agent, and everything advisory about it, does not. An advisory practice that can block a merge
stops being advisory the first time it is wrong, and then somebody disables it — which loses you
the advisory value as well.

The cost, stated plainly: a workflow outside `ci-required` cannot block anything, including the
assertion guard. So on a labelled pull request the guard fails **visibly** and a human has to look
at it, which is weaker than a required check. Promoting it is a decision for Lesson 24.5's gate
table, and this lesson records it as a candidate rather than making it one — because a gate
introduced before anybody has watched it behave is a gate that gets `continue-on-error: true`
within a fortnight.

### 9. When you add a non-human contributor, you add its incentives too

The generalisable close, and the lesson of the whole module.

A code review process assumes contributors who want the code to be correct and who will tell you
when they cannot make it so. Both halves of that assumption are load-bearing, and an LLM
contributor satisfies neither: it optimises for the observable signal, and it does not escalate.
So the defences have to be **structural rather than procedural** — properties of the system rather
than expectations of the participant.

| Procedural | Structural |
|---|---|
| "reviewers should check assertion changes carefully" | a guard that rejects a diff touching `expect(` |
| "don't publish without approval" | `incident_reporter` does not hold `publish_incidents` |
| "don't use CSS selectors in tests" | an ESLint rule scoped to `e2e/**` |
| "remember to clear the cache before asserting" | a `setup` project every other project depends on |
| "keep secrets out of the config" | no `env` block in `.mcp.json`, and a check that asserts its absence |

Read that left column and notice that every entry is true, sensible, and completely useless under
pressure. Then notice that this is exactly the argument Module 03 made about
`publish_incidents`, three modules before any of this existed:

> **Do not check for the bad outcome. Make it unreachable.**

That sentence is the through-line of the whole course, and the agent is only its newest test case.
The reason it is worth restating here rather than assuming it is that agentic tooling makes the
procedural answer sound reasonable again — *"we'll review the agent's diffs carefully"* — and it
is not more reasonable than *"we'll remember to check `$_POST`"* ever was.

---

## Task

### Step 1: Read the agent's proposed spec against the checklist

The C7 charter produced a spec. Read it before you fix it, and count the checklist violations —
five in eleven lines is typical, and recognising the pattern is the transferable skill.

```ts
// next-app/e2e/incident-leakage.spec.ts — WHAT THE AGENT PROPOSED. Do not save
// this version; Step 3 writes the file. It is an input, not an artefact.
test('scapegoat count is right', async ({ page }) => {
  await page.goto('/en/scapegoats/the-intern');
  await page.waitForTimeout(2000);                                  // 1
  await expect(page.locator('.profile dl dd').first()).toBeVisible(); // 2, 3
  await page.getByRole('link', { name: 'Submit an incident' }).click();
  // …submits, approves through wp-admin…
  await page.goto('/en/scapegoats/the-intern');
  await expect(page.locator('.profile dl dd').first()).toBeVisible(); // 2, 3
});
```

| Violation | Line | Fix |
|---|---|---|
| a sleep | `waitForTimeout(2000)` | assert the condition instead |
| visibility asserted, not the value | both `toBeVisible()` | `toBe(before + 1)` |
| a CSS chain | `.locator('.profile dl dd')` | `getByRole('main')` plus the visible text |
| no negative case | — | a **pending** submission moves nothing |
| two behaviours, one test | submit **and** approve | split, or scope to one invariant |

The two `.locator()` calls will not even lint: Lesson 23.7's rule fires on both. That is the rule
paying for itself on the first agent-authored spec it ever saw.

**Verify §1:**

- [ ] You found all five before reading the table. If not, reread Key Concepts 1 to 5 — the
      checklist is the deliverable of this lesson, not the spec.
- [ ] The agent's file is **not** saved anywhere. It is an input, not an artefact.

### Step 2: Reproduce the red state, with a reversible probe

The spec has to fail on the unfixed behaviour or it proves nothing. The mechanism is Lesson 23.8's
triaged F1: `/en/scapegoats/[slug]` renders the count and the term's incidents from one cached
query, so the two agree only if the cache is expired when an incident's status changes.

Lesson 18.1 wrote that page's tags as `[termTag('scapegoat', slug), listTag('incident')]` and
Lesson 18.2 §6 explains why the second one is not optional: `listTag('incident')` is the tag
Lesson 18.3's webhook sends on every incident transition, and `termTag('scapegoat', …)` is sent
only when a **term** is saved. Remove the first and you have the "first approximation" that lesson
warns about.

```bash
cd next-app

# THE PROBE. Reversible, and restored with the .bak file rather than with git —
# a `git checkout --` in a test procedure will one day discard work somebody
# else had staged.
sed -i.bak \
  "s/tags: \[termTag('scapegoat', slug), listTag('incident')\]/tags: [termTag('scapegoat', slug)]/" \
  "src/app/[locale]/scapegoats/[slug]/page.tsx"

grep -n "termTag('scapegoat', slug)" "src/app/[locale]/scapegoats/[slug]/page.tsx"
```

**Verify §2:**

- [ ] The grep shows the tags array with **one** entry. If it shows two, the substitution did not
      match — your file's formatting differs, so edit the line by hand and note what it says.
- [ ] `src/app/[locale]/scapegoats/[slug]/page.tsx.bak` exists. Step 3 restores from it.
- [ ] `npm run type-check` is still silent. The probe is a behaviour change, not a type change,
      which is exactly why nothing but a test would notice it.

### Step 3: Write `e2e/incident-leakage.spec.ts`

```ts
// next-app/e2e/incident-leakage.spec.ts
// ONE behaviour, from Lesson 23.8's finding F1:
//
//   the number under "Times blamed" on a scapegoat page must equal the number of
//   incidents listed beneath it, at every moment a reader can observe.
//
// Plus the negative case the agent did not write, which is also the assertion
// that pins F1's FALSIFIED mechanism into the suite: `count` is maintained by
// _update_post_term_count(), which counts post_status = publish only (Lesson
// 03.3 §2). A pending submission must move nothing. Somebody who introduces a
// custom update_count_callback in three years gets a red test, not an argument.
//
// Runs in `mutations`: it publishes. Locators are getByRole plus visible text —
// the <dl> on that page has no accessible name, so the number is read out of the
// main landmark's text rather than through a CSS chain.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const TERM = 'the-intern';
const TERM_PAGE = `/en/scapegoats/${TERM}`;
const EDITOR_STATE = 'e2e/.auth/editor.json';
const WP = 'http://localhost:8080';

test.describe.configure({ mode: 'serial' });

/** Lesson 18.3's test-only branch. Every read in this spec is preceded by one. */
async function purge(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/revalidate', {
    headers: { 'X-BTT-E2E-Secret': process.env.E2E_SECRET ?? '' },
    data: { type: 'all' },
  });

  expect(response.status(), 'the test-only purge branch must answer 200').toBe(200);
}

/**
 * The number the page prints under "Times blamed".
 *
 * ASSERT THE SHAPE FIRST, then read. `innerText()` resolves one value at one
 * instant and cannot retry (Lesson 12.3 §2), so the retrying assertion above it
 * is what makes the read safe rather than lucky.
 */
async function timesBlamed(page: Page): Promise<number> {
  const main = page.getByRole('main');

  await expect(main).toContainText(/Times blamed\s+\d+/);

  const match = /Times blamed\s+(\d+)/.exec(await main.innerText());

  // Non-null asserted only after the retrying assertion above proved the shape.
  return Number(match?.[1]);
}

/** Incident cards under the term. IncidentCard renders an <article>. */
function cardCount(page: Page) {
  return page.getByRole('article');
}

test.describe('the scapegoat count agrees with the incidents listed under it', () => {
  test('NEGATIVE: a pending submission moves neither the count nor the list', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    await purge(request);
    await page.goto(TERM_PAGE);

    const before = await timesBlamed(page);
    const cardsBefore = await cardCount(page).count();

    // The invariant, asserted before anything changes. If this fails, the state
    // is already wrong and nothing below would be interpretable.
    expect(before, 'the count must equal the cards on a quiet page').toBe(cardsBefore);

    // Submit as the reporter this project's storageState logged in. createIncident
    // forces post_status = 'pending' (appendix 03 §7) — the reporter has no
    // publish_incidents, so there is no code path by which this publishes.
    const title = `Leakage probe ${Date.now().toString(36)}`;

    await page.goto('/en/incidents/submit');
    await page.getByRole('textbox', { name: 'What happened' }).fill(title);
    await page.getByRole('textbox', { name: 'The full story' }).fill('e2e/incident-leakage.spec.ts');
    await page.getByRole('combobox', { name: 'Who is to blame' }).click();
    await page.getByRole('option', { name: 'The Intern' }).click();
    await page.getByRole('combobox', { name: 'How bad' }).click();
    await page.getByRole('option', { name: 'S3 — Minor' }).click();
    await page.getByRole('textbox', { name: 'When it happened' }).fill('2024-06-02T10:00');
    await page.getByRole('spinbutton', { name: 'Downtime (minutes)' }).fill('7');
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByRole('heading', { name: 'Queued for review' })).toBeVisible();

    // Purge FIRST. Without it this negative would pass because the page is
    // stale, which is passing for the wrong reason — and a negative that passes
    // for the wrong reason is a negative that rots silently.
    await purge(request);
    await page.goto(TERM_PAGE);

    // THE ASSERTION ON THE VALUE, not on visibility. `toBe(before)` is what
    // makes this a test of the count; `toBeVisible()` would pass at any number.
    expect(await timesBlamed(page), 'a pending incident must not be counted').toBe(before);
    await expect(cardCount(page), 'a pending incident must not be listed').toHaveCount(cardsBefore);
  });

  test('publishing moves the count and the list by exactly one, together', async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(150_000);

    await purge(request);
    await page.goto(TERM_PAGE);

    const before = await timesBlamed(page);
    const cardsBefore = await cardCount(page).count();
    expect(before).toBe(cardsBefore);

    const title = `Leakage publish ${Date.now().toString(36)}`;

    await page.goto('/en/incidents/submit');
    await page.getByRole('textbox', { name: 'What happened' }).fill(title);
    await page.getByRole('textbox', { name: 'The full story' }).fill('e2e/incident-leakage.spec.ts');
    await page.getByRole('combobox', { name: 'Who is to blame' }).click();
    await page.getByRole('option', { name: 'The Intern' }).click();
    await page.getByRole('combobox', { name: 'How bad' }).click();
    await page.getByRole('option', { name: 'S3 — Minor' }).click();
    await page.getByRole('textbox', { name: 'When it happened' }).fill('2024-06-02T11:00');
    await page.getByRole('spinbutton', { name: 'Downtime (minutes)' }).fill('9');
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByRole('heading', { name: 'Queued for review' })).toBeVisible();

    // Approve as a real editor, in a second context. Publishing is what fires
    // Lesson 18.3's webhook, and the webhook is the thing under test.
    const editor = await browser.newContext({ storageState: EDITOR_STATE });

    try {
      const editorPage = await editor.newPage();
      await editorPage.goto(`${WP}/wp-admin/edit.php?post_type=incident`);

      const row = editorPage.getByRole('row', { name: new RegExp(title) });
      await expect(row).toBeVisible();
      await row.hover();
      await row.getByRole('link', { name: 'Approve' }).click();
      await expect(editorPage.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
    } finally {
      await editor.close();
    }

    // NO PURGE. That is the assertion: the webhook must have expired a tag this
    // page carries. With Lesson 18.2's tags intact it did; with the Step 2 probe
    // applied it did not, and this is the line that goes red.
    await page.goto(TERM_PAGE);

    expect(await timesBlamed(page), 'the count must include the newly published incident').toBe(
      before + 1
    );
    await expect(cardCount(page), 'and so must the list').toHaveCount(cardsBefore + 1);
    await expect(page.getByRole('link', { name: title })).toBeVisible();
  });
});
```

**Verify §3:**

- [ ] `npm run lint` is clean on the new file. Zero `.locator()` calls, zero `waitForTimeout` —
      Lesson 23.7's rule is the thing checking, not your memory.
- [ ] `npx playwright test --list e2e/incident-leakage.spec.ts` prints **2** tests, under
      `[mutations]`. Lesson 23.6 already listed this filename in that project's `testMatch`, for
      the reason its comment gives: a spec matching no project is silently never run.
- [ ] `grep -c 'toBe(' e2e/incident-leakage.spec.ts` is `4` or more. Every one is a value.

### Step 4: Watch it go red, restore, watch it go green

```bash
cd next-app
npm run e2e:reset

# RED — the probe from Step 2 is still applied.
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" \
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" \
BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  npx playwright test e2e/incident-leakage.spec.ts --workers=1; echo "exit=$?"

# Restore from the .bak, never from git.
mv "src/app/[locale]/scapegoats/[slug]/page.tsx.bak" "src/app/[locale]/scapegoats/[slug]/page.tsx"
npm run e2e:reset

# GREEN.
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" \
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" \
BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  npx playwright test e2e/incident-leakage.spec.ts --workers=1; echo "exit=$?"
```

**Verify §4:**

- [ ] The red run fails the **second** test with `Expected: 7  Received: 6` — a number, naming the
      behaviour. Not "element not visible", which is what the agent's version would have said.
- [ ] The red run **passes** the first test. The negative was always true, because
      `_update_post_term_count()` never counted pending posts — which is the falsified mechanism
      from Lesson 23.8, now permanent.
- [ ] The green run exits `0` and `git status --short` shows no `.bak` file left behind.
- [ ] A spec you have not watched fail is a spec you have not written. If the red run passed,
      the probe did not apply — go back to Verify §2.

### Step 5: Harden F2 — the focus trap, with the negative it needed

Lesson 23.8's F2 is a regression of a fix: Lesson 22.2 made `GetDemoDialog` trap focus, handle
Escape and restore focus to its trigger, and a later styling refactor can undo all three
silently. That is the strongest possible argument for a spec.

It goes into `e2e/smoke.spec.ts`, appended to the app-shell `describe` Lesson 12.3 Step 4 created,
and the reason is worth stating rather than assuming: **this is not something axe can find.** axe
analyses a rendered DOM and cannot press Tab, so a keyboard trap is a functional assertion rather
than an audit finding, and Lesson 22.4's axe-driven `a11y.spec.ts` is the wrong home for it.
`/en/hobt`'s controls are already asserted in `smoke.spec.ts`, and this is read-only.

```ts
// next-app/e2e/smoke.spec.ts — append inside the `the app shell` describe
  test('the Get Demo dialog traps focus, and Escape returns it to the trigger', async ({
    page,
  }) => {
    await page.goto('/en/hobt');

    // Two CTA bands, so two triggers (Lesson 11.5). Take the first explicitly
    // rather than relying on a single match.
    const trigger = page.getByRole('button', { name: 'Get Demo' }).first();
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: /demo/i });
    await expect(dialog).toBeVisible();

    // toBeVisible IS the right assertion here: presence is the behaviour.
    // Key Concept 3's rule is about values, not about dialogs.

    // Tab all the way round — more presses than the dialog has focusable
    // controls, so a correct trap has to wrap at least once.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');

      // The focused element is INSIDE the dialog. `:focus` is a bare
      // pseudo-class with no CSS chain, so Lesson 23.7's rule does not fire on
      // it — and there is no ARIA role for "the currently focused element", so
      // this is the honest locator rather than a shortcut.
      await expect(
        dialog.locator(':focus'),
        `after ${i + 1} tabs focus escaped the dialog — Lesson 22.2's trap regressed`
      ).toHaveCount(1);
    }

    // THE NEGATIVE THE AGENT DID NOT WRITE. It explored the trap; it never
    // checked the way out. A dialog you cannot escape from is worse than one
    // that leaks focus, and it is the more common regression.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger, 'focus must return to the control that opened it').toBeFocused();
  });
```

**Verify §5:**

- [ ] The spec is green. If `Escape` does not close the dialog, that is a real bug and Lesson
      22.2's fix has already regressed — fix the component, not the spec.
- [ ] `await expect(trigger).toBeFocused()` is present. Focus restoration is the half of Lesson
      22.2's fix that nothing else asserts, and it is invisible to a sighted mouse user.
- [ ] `npm run lint` is clean: `dialog.locator(':focus')` is a bare pseudo-class with no CSS
      chain, so Lesson 23.7's rule does not fire on it. Confirm rather than assume — if it does
      fire, add one `eslint-disable-next-line` with a reason, because there is no ARIA role for
      "the currently focused element".

### Step 6: Harden F3 — the query string across the untranslated fallback

Lesson 23.6's `i18n.spec.ts` already asserts the switcher preserves `?scapegoat=`. F3 is
therefore closed, and the hardening is **the negative case it did not cover**: the same switch
from a page that has no version in the target locale, where the answer is a 307 to English with
`?from=de` appended. Two query parameters have to survive one redirect.

```ts
// next-app/e2e/i18n.spec.ts — append inside the `the locale switcher` describe
  test('a filtered list keeps its query across the untranslated 307, not just across a switch', async ({
    request,
  }) => {
    // /de/incidents/incident-40 has no German version, so Lesson 20.2's policy
    // 307s to English with ?from=de. The question F3 raises and the 23.6 spec
    // does not answer: does an EXISTING query survive that rewrite, or does the
    // redirect builder drop everything it did not put there itself?
    const response = await request.get('/de/incidents/incident-40?highlight=dns', {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);

    const location = response.headers()['location'] ?? '';

    // Assert BOTH parameters by name. `toContain('?from=de')` would pass on a
    // Location that had thrown the original query away, which is the exact bug.
    expect(location, 'the policy parameter must be added').toContain('from=de');
    expect(location, 'and the original query must survive').toContain('highlight=dns');
  });
```

**Verify §6:**

- [ ] The test passes, or it fails and you have found a real bug — in which case it is a finding
      with a reproduction, and the fix belongs in the redirect helper from Lesson 20.2.
- [ ] Both parameters are asserted separately. One combined `toContain('?from=de&highlight=dns')`
      assertion would also pin the **order**, which is not a decision anybody made.
- [ ] `npx playwright test --project=smoke e2e/i18n.spec.ts` is 10 passed.

### Step 7: Write the diff guard, and prove it both ways

The guard is a shell script, inlined into the workflow so there is one file to read. Prove it on a
probe diff before you trust it.

```bash
cd /Users/you/path/to/blame-the-tech

# A throwaway branch and a diff that LOOSENS an assertion. The exact move
# Key Concept 6 limit 4 describes.
git switch -c probe/assertion-guard
sed -i.bak 's/toBe(before + 1)/toBeGreaterThanOrEqual(0)/' next-app/e2e/incident-leakage.spec.ts
rm next-app/e2e/incident-leakage.spec.ts.bak
git commit -am 'probe: loosen an assertion so the guard has something to catch'

# The guard, run by hand exactly as the workflow runs it.
git diff main...HEAD -- 'next-app/e2e/**' 'next-app/src/**/*.test.ts' 'next-app/src/**/*.test.tsx' \
  | grep -nE '^[+-].*expect\(' && echo 'REJECTED' || echo 'accepted'

# Now a diff that touches no assertion at all.
git reset --hard main
sed -i.bak 's/Leakage probe/Leakage probe run/' next-app/e2e/incident-leakage.spec.ts
rm next-app/e2e/incident-leakage.spec.ts.bak
git commit -am 'probe: rename a fixture string, touching no assertion'

git diff main...HEAD -- 'next-app/e2e/**' 'next-app/src/**/*.test.ts' 'next-app/src/**/*.test.tsx' \
  | grep -nE '^[+-].*expect\(' && echo 'REJECTED' || echo 'accepted'

# Clean up the probe branch entirely.
git switch main
git branch -D probe/assertion-guard
```

**Verify §7:**

- [ ] The first probe prints the two changed lines and then `REJECTED`. Note that **both** the `+`
      and the `-` line appear: only checking `+` would miss a deletion, and a deletion weakens the
      suite exactly as much.
- [ ] The second probe prints `accepted`. This is the check that proves the guard is usable — a
      guard that rejects a variable rename is a guard somebody removes.
- [ ] `git branch --list 'probe/*'` is empty and `git status --short` is clean.
- [ ] You did not use `git checkout --` anywhere. The `.bak` files were removed explicitly; a
      blanket restore in a procedure like this one day discards somebody's staged work.

### Step 8: Write `.github/workflows/agentic-qa.yml`

The first workflow file in this repository. Minimal, commented line by line, and deliberately
outside `ci-required`.

```yaml
# .github/workflows/agentic-qa.yml
#
# THE FIRST WORKFLOW IN THIS REPOSITORY. Lesson 24.4 teaches GitHub Actions
# properly and adds path filtering, reusable workflows, sharding and caching;
# this file is deliberately the smallest thing that works.
#
# Vocabulary, once: a WORKFLOW is this file, triggered by an EVENT. It contains
# JOBS, which run on RUNNERS. Each job is a list of STEPS.
#
# THIS WORKFLOW IS NOT PART OF `ci-required` (Lesson 24.4's aggregating check
# that branch protection points at). That is the point of the module made
# structural: agent output is advisory, and the deterministic specs it produces
# are what gate a merge — through the normal E2E job, like any other spec.
name: agentic-qa

on:
  # Nightly-ish rather than on every push. An exploration run costs minutes and
  # money and is nondeterministic, so putting it on `push` produces red builds
  # unrelated to the change in front of you — and a gate like that is disabled
  # within a week. Lesson 23.9 Key Concept 6, limit 2.
  schedule:
    - cron: '0 3 * * 1' # 03:00 UTC, Mondays
  # `pull_request`, and NEVER `pull_request_target`. The latter runs the BASE
  # branch's workflow with WRITE permissions and repository secrets in the
  # context of a fork's pull request, which is the single most common way a
  # repository leaks its secrets. Lesson 23.7 Key Concept 10.
  pull_request:
    types: [labeled]
  workflow_dispatch:

# LEAST PRIVILEGE, declared explicitly. The default is whatever the repository
# setting happens to be, which is not a decision anybody made recently. This
# workflow reads code and writes nothing.
permissions:
  contents: read

# No deploy secrets anywhere in this file. The agent job needs a browser and a
# localhost stack; VERCEL_TOKEN and FLY_API_TOKEN have no business in the same
# process as a model reading untrusted page text. Appendix 04 section 7.

concurrency:
  group: agentic-qa-${{ github.ref }}
  cancel-in-progress: true

jobs:
  assertion-guard:
    name: assertions are human-authored
    # On a pull request, only when it carries the label. Everywhere else
    # (schedule, manual) it always runs.
    if: github.event_name != 'pull_request' || github.event.label.name == 'agentic-qa'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # The guard diffs against the base branch, so it needs history.
          fetch-depth: 0

      - name: Reject a diff that touches an assertion
        env:
          BASE: ${{ github.base_ref || github.event.repository.default_branch }}
        run: |
          set -euo pipefail
          git fetch --no-tags --depth=0 origin "$BASE"

          PATHS='next-app/e2e/** next-app/src/**/*.test.ts next-app/src/**/*.test.tsx'

          # BOTH POLARITIES. `+` catches a loosened assertion; `-` catches a
          # removed one, including a whole deleted spec file, because a deleted
          # file's contents appear as `-` lines.
          # shellcheck disable=SC2086
          if git diff "origin/$BASE"...HEAD -- $PATHS | grep -nE '^[+-].*expect\('; then
            echo "::error::This diff changes an assertion. Assertions are human-authored (Lesson 23.9)."
            echo "If you are a human and this change is correct, remove the agentic-qa label and say so in the PR."
            exit 1
          fi

          echo "No assertion was touched."

      - name: Refuse a net decrease in assertion count
        env:
          BASE: ${{ github.base_ref || github.event.repository.default_branch }}
        run: |
          set -euo pipefail

          # Closes the gap the grep cannot see: a rename that git reports with
          # no content lines. Crude, and crude is the property that makes it
          # unarguable. Lesson 23.9 Key Concept 7.
          count() {
            git grep -h -o 'expect(' "$1" -- 'next-app/e2e' 2>/dev/null | wc -l
          }

          HEAD_N="$(count HEAD)"
          BASE_N="$(count "origin/$BASE")"
          echo "assertions: base=$BASE_N head=$HEAD_N"

          if [ "$HEAD_N" -lt "$BASE_N" ]; then
            echo "::error::The suite has $((BASE_N - HEAD_N)) fewer assertions than $BASE."
            exit 1
          fi

  # The EXPLORATION run itself is not a job here, deliberately. It needs a model,
  # a Compose stack and an interactive session, and Lesson 24.4 is where CI grows
  # a real WordPress service. Running it nightly against a preview environment is
  # the natural next step; its artifacts must be scrubbed and short-retention,
  # because a Playwright trace holds request headers. Appendix 04 section 7.
```

Then record the decisions in `docs/agentic-qa.md`, which Lesson 23.8 created. One new section.

```markdown
<!-- docs/agentic-qa.md — append -->
## From findings to specs (Lesson 23.9)

Every agent finding that becomes a test goes through this checklist. Rows 1 and 3
are enforced by the `e2e/**` ESLint rule (Lesson 23.7); the rest are review.

| # | Replace | With |
|---|---|---|
| 1 | `page.waitForTimeout(n)` | a web-first assertion on the condition |
| 2 | `toBeVisible()` on a value | an assertion on the value |
| 3 | a CSS-chain locator | `getByRole(role, { name })` |
| 4 | nothing | the negative case the agent forgot |
| 5 | one spec, four behaviours | one behaviour per spec |
| 6 | "the agent wrote it" | a human review and a normal commit |

Specs produced this way: `e2e/incident-leakage.spec.ts` (F1, red before Lesson
18.2's tag fix and green after), the focus-trap test in `e2e/smoke.spec.ts` (F2,
with the Escape-and-restore negative), and the untranslated-fallback query test in
`e2e/i18n.spec.ts` (F3, the negative the 23.6 spec did not cover).

## Honest limits (Lesson 23.9)

| Limit | What it means | The control it implies |
|---|---|---|
| **Nondeterminism** | the same charter twice takes a different path and sometimes reaches a different conclusion | **agents never gate a merge.** They generate the deterministic specs that do |
| **Cost and latency** | a run takes minutes and costs money | nightly or on an explicit label, never on every push |
| **No business intent** | it cannot know an incident must stay `pending` until a moderator with `publish_incidents` acts — that is appendix 03 §6, not something the UI states | any assertion encoding a business rule is hand-written by a human from the acceptance criteria |
| **Loosening a red test** | a model optimising for "green" will change `toBe(1)` to `toBeGreaterThanOrEqual(0)`, with a plausible commit message | a guard rejects any agent-proposed diff touching `expect(`, in `.github/workflows/agentic-qa.yml` |

The guard is crude on purpose: it cannot be talked around, it needs no judgement,
and it draws the line exactly where the value of the suite lives. It checks added
**and** removed lines, so deleting a spec file is caught too, and a second step
refuses a net decrease in assertion count to cover renames. What it does not cover:
a new spec whose assertions are weak from birth. Nothing mechanical can tell that
from a correct one — that is review.

`.github/workflows/agentic-qa.yml` is deliberately **not** part of `ci-required`.
An advisory practice that can block a merge stops being advisory the first time it
is wrong, and then somebody disables it. The cost: on a labelled pull request the
guard fails visibly rather than blocking. Promoting it to a required check is a
candidate for Lesson 24.5's gate table, not a decision taken here.

**When you add a non-human contributor, you add its incentives too, and the
defences have to be structural rather than procedural.** It is the same argument as
withholding `publish_incidents` from `incident_reporter` in Module 03: do not check
for the bad outcome, make it unreachable.
```

**Verify §8:**

- [ ] `jq -e . /dev/null` is not the check — YAML has no `jq`. Use
      `npx yaml-lint .github/workflows/agentic-qa.yml`, or push the branch and read the Actions
      tab, which is the only validator that counts.
- [ ] `grep -c 'pull_request_target' .github/workflows/agentic-qa.yml` is `0`.
- [ ] `grep -c 'permissions:' .github/workflows/agentic-qa.yml` is `1`, and the block below it
      grants `contents: read` and nothing else.
- [ ] `grep -c 'on:' -A6 .github/workflows/agentic-qa.yml` shows `schedule`, `pull_request` and
      `workflow_dispatch`, and **no** `push`.
- [ ] `grep -c 'Lesson 23.9' docs/agentic-qa.md` is `2` — two sections appended, in the frozen
      one-section-per-lesson shape.

```bash
cd next-app && npm run lint && npm run type-check
cd .. && git add -A
git commit -m "test(e2e): hardened specs from the agent findings, plus the assertion guard"
```

---

## Verification

```bash
cd /Users/you/path/to/blame-the-tech

# 1. The three hardened specs exist and are where they belong
test -f next-app/e2e/incident-leakage.spec.ts && echo 'leakage spec present'
# Expected: leakage spec present
cd next-app
npx playwright test --list e2e/incident-leakage.spec.ts
# Expected: 2 tests, under [mutations] and under no other project. This spec
#           publishes, so `smoke` would be wrong and would interleave with the
#           read specs. Lesson 23.6's testMatch already names the file.

# 2. NEGATIVE — not one sleep in the whole suite, enforced twice
grep -rc 'waitForTimeout' e2e/ | grep -v ':0$' || echo 'no waitForTimeout — correct'
# Expected: no waitForTimeout — correct
npx eslint e2e/ ; echo "exit=$?"
# Expected: no output, exit=0. Lesson 23.7's rule bans waitForTimeout in e2e/,
#           so the grep above is now belt to the lint rule's braces.

# 3. NEGATIVE — no CSS-chain locator survived the conversion
grep -rn "\.locator('[^']*[.#>[]" e2e/ ; echo "exit=$?"
# Expected: no output, exit=1. page.locator('html') and page.locator(':focus')
#           are the only two locator() calls in the suite and neither contains
#           CSS structure.

# 4. Every remaining bare toBeVisible() is on a PRESENCE, not on a value
grep -rn 'toBeVisible()' e2e/incident-leakage.spec.ts
# Expected: no output — this spec asserts numbers, so there is nothing whose
#           presence is the behaviour.
grep -c 'toBeVisible()' e2e/smoke.spec.ts
# Expected: a non-zero count, and every one of them is a landmark, a heading or
#           the dialog — presence IS the behaviour there. Key Concept 3.

# 5. The leakage spec asserts VALUES, and asserts the invariant both ways
grep -c 'toBe(before' e2e/incident-leakage.spec.ts
# Expected: 2 — toBe(before) in the negative, toBe(before + 1) in the positive
grep -c 'toHaveCount(cardsBefore' e2e/incident-leakage.spec.ts
# Expected: 2 — the list must agree with the number at both moments

# 6. NEGATIVE — the leakage spec fails against the UNFIXED state. Demonstrated on
#    a reversible probe, restored from .bak rather than with git.
sed -i.bak \
  "s/tags: \[termTag('scapegoat', slug), listTag('incident')\]/tags: [termTag('scapegoat', slug)]/" \
  "src/app/[locale]/scapegoats/[slug]/page.tsx"
npm run e2e:reset
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" \
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  npx playwright test e2e/incident-leakage.spec.ts --workers=1; echo "exit=$?"
# Expected: 1 failed, 1 passed, exit=1. The failure names a NUMBER
#           ("Expected: 7  Received: 6"), not "element not visible".
#           The NEGATIVE test still passes, because a pending incident was never
#           counted — that is Lesson 23.8's falsified mechanism, now permanent.
mv "src/app/[locale]/scapegoats/[slug]/page.tsx.bak" "src/app/[locale]/scapegoats/[slug]/page.tsx"

# 7. ...and passes against the fixed state
npm run e2e:reset
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" \
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  npx playwright test e2e/incident-leakage.spec.ts --workers=1; echo "exit=$?"
# Expected: 2 passed, exit=0
git status --short | grep -c '\.bak' || true
# Expected: 0 — nothing left behind

# 8. The two other hardened specs, each with its negative
grep -c 'toBeFocused()' e2e/smoke.spec.ts
# Expected: 2 or more — the skip link from Lesson 12.3, and focus restoration
#           after Escape, which is the negative F2's spec needed
grep -c 'highlight=dns' e2e/i18n.spec.ts
# Expected: 2 — the original query asserted across the untranslated 307, which
#           is the negative F3's spec needed

# 9. NEGATIVE — the diff guard REJECTS a diff that loosens an assertion
git switch -c probe/guard-verify
sed -i.bak 's/toBe(before + 1)/toBeGreaterThanOrEqual(0)/' e2e/incident-leakage.spec.ts
rm e2e/incident-leakage.spec.ts.bak
cd .. && git commit -qam 'probe: loosen an assertion'
git diff main...HEAD -- 'next-app/e2e/**' | grep -cE '^[+-].*expect\('
# Expected: 2 — the added line AND the removed line. Only checking `+` would
#           miss a deletion, which weakens the suite just as much.

# 10. ...and ACCEPTS one that does not. The check that proves it is usable.
git reset -q --hard main
sed -i.bak 's/Leakage probe/Leakage probe run/' next-app/e2e/incident-leakage.spec.ts
rm next-app/e2e/incident-leakage.spec.ts.bak
git commit -qam 'probe: rename a fixture string'
git diff main...HEAD -- 'next-app/e2e/**' | grep -cE '^[+-].*expect\(' || echo 'accepted'
# Expected: accepted
git switch -q main && git branch -qD probe/guard-verify
git status --short
# Expected: no output

# 11. The workflow exists and its triggers are the right ones
grep -c 'schedule:' .github/workflows/agentic-qa.yml
# Expected: 1
grep -c 'workflow_dispatch:' .github/workflows/agentic-qa.yml
# Expected: 1
grep -cE '^  push:' .github/workflows/agentic-qa.yml
# Expected: 0 — an exploration run on every push is minutes and money per commit

# 12. NEGATIVE — pull_request, and never pull_request_target
grep -c 'pull_request_target' .github/workflows/agentic-qa.yml
# Expected: 0
grep -rc 'pull_request_target' .github/ | grep -v ':0$' || echo 'none anywhere — correct'
# Expected: none anywhere — correct
#           pull_request_target runs the BASE branch's workflow with write
#           permissions and repository secrets, for a fork's pull request.

# 13. NEGATIVE — minimal permissions, and no deploy secret anywhere in the file
grep -A2 '^permissions:' .github/workflows/agentic-qa.yml
# Expected: contents: read, and nothing else
grep -cE 'VERCEL_TOKEN|FLY_API_TOKEN|CODECOV_TOKEN|secrets\.' .github/workflows/agentic-qa.yml
# Expected: 0

# 14. NEGATIVE — this workflow is not wired into the required check
grep -c 'ci-required' .github/workflows/agentic-qa.yml
# Expected: 0. Lesson 24.4 builds `ci-required`; keeping this workflow outside it
#           is the module's claim made structural, not an omission.

# 15. The document carries both new sections and the four-limit table
grep -c '(Lesson 23.9)' docs/agentic-qa.md
# Expected: 2 — "From findings to specs" and "Honest limits"
sed -n '/^## Honest limits/,$p' docs/agentic-qa.md | grep -c '^| \*\*'
# Expected: 4 — nondeterminism, cost, business intent, loosening a red test
grep -c 'agents never gate a merge' docs/agentic-qa.md
# Expected: 1 — the module's thesis, in the document, in your own words

# 16. NEGATIVE — the document does not claim the agent gates anything
grep -ci 'advisory' docs/agentic-qa.md
# Expected: 2 or more — stated at the top of the file by Lesson 23.8 and again
#           in the honest-limits section

# 17. Everything still lints, type-checks and passes
cd next-app
npm run lint && npm run type-check
# Expected: no output
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" \
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  npx playwright test --workers=1
# Expected: all four projects pass — setup, smoke, mutations, a11y
```

If check 6 passes both tests, the probe did not apply and you have a spec you have never seen
fail. If check 10 reports a rejection, the guard's path list or its regex is too wide — fix the
guard, because a guard that rejects a variable rename is a guard somebody will remove, and they
will not put it back.

## Control Questions

1. The diff guard matches `^[+-].*expect\(` rather than `^\+.*expect\(`. Explain the attack the
   `-` half catches, then name a change that defeats both halves and say which of the guard's two
   steps closes it.
2. `e2e/incident-leakage.spec.ts` contains a negative test that passes in **both** the red and the
   green run, so it never distinguishes the two states. Argue for keeping it, referring to what
   Lesson 23.8's triage discovered about F1's proposed mechanism.
3. The lesson keeps some bare `toBeVisible()` assertions and replaces others. State the rule that
   separates the two cases, then apply it to: a preview banner, a `role="status"` announcement,
   and a scapegoat's blame count.
4. `.github/workflows/agentic-qa.yml` is deliberately outside `ci-required`, which means the
   assertion guard cannot block a merge. Explain why that is the right trade today, name what it
   costs, and say what evidence would make you promote it in Lesson 24.5's gate table.
5. The lesson ends by connecting the diff guard to withholding `publish_incidents` from
   `incident_reporter` in Module 03. Make that connection precise: name the shared property of
   the two controls, and describe the procedural version of each that a team would write instead
   and why it fails in the same way.

## Learn More

- [Playwright — auto-waiting](https://playwright.dev/docs/actionability) — the list of conditions
  an action waits for, which is what makes `waitForTimeout` unnecessary rather than merely
  discouraged
- [Playwright — assertions](https://playwright.dev/docs/test-assertions) — which matchers retry;
  read `toHaveText` and `toHaveCount` next to `toBeVisible` and Key Concept 3 becomes obvious
- [Playwright — test parameterisation and describe modes](https://playwright.dev/docs/test-parameterize)
  — the mechanics behind "one behaviour per spec" when several behaviours share expensive setup
- [GitHub Actions — workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
  — the reference for every key in Step 8's file. Lesson 24.4 teaches it properly; this is the
  page to keep open until then
- [GitHub Actions — events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)
  — `schedule`, `pull_request` with `types`, and `workflow_dispatch`, plus the section that
  explains what `pull_request_target` actually does
- [GitHub Security Lab — preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
  — the definitive write-up of the `pull_request_target` failure, worth reading before you ever
  reach for it
- [`git diff` — the three-dot form](https://git-scm.com/docs/git-diff#Documentation/git-diff.txt-emgitdiffemltoptionsgtltcommitgtltcommitgtltpathgt82308203)
  — why the guard uses `base...HEAD` rather than `base..HEAD`, which is the difference between
  "what this branch changed" and "everything that differs"
- [OWASP — Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
  — LLM09, overreliance, is Key Concept 6 limit 4 in somebody else's words and a useful citation
  when a stakeholder asks why the guard exists
- [Martin Fowler — Eradicating Non-Determinism in Tests](https://martinfowler.com/articles/nonDeterminism.html)
  — written about flaky suites and it reads as though it were written about agents; the section on
  quarantining is the counter-argument to putting an advisory job in `ci-required`
