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

### 1. What a rules engine can decide, and what it structurally cannot

axe-core has roughly a hundred rules. Each one is a deterministic predicate over the DOM and the
computed accessibility tree: it can be evaluated, it returns the same answer twice, and it either
fires or it does not. That is the whole shape of the tool, and it draws a hard line:

| The question | Decidable by a rule? | Why |
|---|---|---|
| Does this `<img>` have an `alt` attribute? | **yes** | presence of an attribute |
| Is the `alt` text *correct*? | **no** | requires knowing what the image depicts |
| Is this text below 4.5:1 against its background? | **yes** | arithmetic on computed styles |
| Does the tab order make sense? | **no** | requires knowing what the user is trying to do |
| Do heading levels skip? | **yes** | a walk over the heading elements |
| Does the heading structure *describe the document*? | **no** | requires reading comprehension |
| Is this form field labelled? | **yes** | the accessible-name computation |
| Is the error message comprehensible? | **no** | requires being a person |

Deque's most favourable published framing is that axe finds "up to 57 %" of WCAG issues. The
practical number on a designed component library is lower, and the useful mental model is
**roughly a third**. That is not a criticism — it is a property of the problem. Nothing in this
lesson is a substitute for Lesson 22.2's walkthrough, and the ordering of this module is the
argument: the manual work is the majority, and the scan is the mechanisable remainder.

### 2. One engine, three delivery vehicles, and where they disagree

The same rules engine ships in three places, which is exactly what makes finding something
interactively and pinning it with a test speak one vocabulary.

| Vehicle | Rule set by default | Scans | Best at |
|---|---|---|---|
| axe DevTools extension | all rules, including best-practice | the current DOM, as rendered | exploring, and reading the fix guidance |
| Lighthouse → Accessibility | a **weighted subset**, no best-practice rules | one page load, throttled | a single number a manager will ask for |
| `@axe-core/playwright` | all rules, **until you select tags** | whatever the browser is showing | a gate, and states you can only reach by driving |

Three ways they disagree, all of which will confuse you once:

**Lighthouse's score is not the gate.** The accessibility category is a weighted average of a
subset of axe rules — a page can score 100 and still fail WCAG, because a rule that never ran
cannot report a violation. Lesson 24.5 asserts ≥ 0.95 anyway, as a **floor with a number a stakeholder
understands**, and this lesson's spec is the thing that actually decides.

**The extension sees the state you are looking at.** Which is its superpower: open the dialog,
scan, and you have scanned a DOM that the Playwright spec had to be *driven* into.

**Playwright sees the state you drove it into, and nothing else.** Which is its superpower for a
gate, and its trap: a scan of a page with a closed dialog proves nothing about the dialog.

### 3. The four impact levels, and what each means to a person

`impact` is axe's own severity, and it is on the violation, not on the rule.

| Impact | What it maps to | Examples in this stack |
|---|---|---|
| `critical` | **the task is impossible** | a button with no accessible name; an `<img>` with no `alt` carrying the only information; `aria-hidden` on a focusable control |
| `serious` | **the task is very hard** | text below 4.5:1; a form field with no label; a duplicate `id` an `aria-describedby` points into; `html` with no `lang` |
| `moderate` | **degraded, still possible** | `heading-order` skipping a level; a `<section>` with no name; a landmark duplicated |
| `minor` | **cosmetic or advisory** | an `aria-*` attribute that is allowed but redundant |

Lesson 22.4 makes `critical` and `serious` block a merge and `moderate` and `minor` report only,
and it argues the split there. What matters here is that **impact is not priority**: a `moderate`
`heading-order` violation inside editor content is unfixable by you (Lesson 14.3), and a `minor`
finding on the submit button is worth fixing this afternoon. The triage table in Step 8 is where
that judgement is recorded, and the tool has no opinion about it.

### 4. Tag selection is the whole gate

Every axe rule carries tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`,
`experimental`, plus `cat.*` categories. The default rule set **includes the best-practice rules**,
and those are not WCAG.

```
   withTags([...])  omitted                withTags(['wcag2a','wcag2aa','wcag21a',
   ─────────────────────────                          'wcag21aa','wcag22aa'])
   region                                   ─────────────────────────────────────
     "all content must be in a landmark"    only rules that map to a numbered
     → fires on IncidentBrowser's           success criterion at level A or AA
       layout <section>                     → the gate is arguable about FACTS,
   landmark-one-main                          not about opinions
   page-has-heading-one
   heading-order  ← best-practice too!
```

A gate built on best-practice rules gets argued with, and then it gets disabled. A gate built on
`wcag2a` through `wcag22aa` is a claim about a published standard, and "we do not meet WCAG 2.2 AA
here" is a sentence nobody wins an argument against. So `withTags` is not optional configuration
— **it is the difference between a gate and a preference**, and it is why `heading-order` (a
best-practice rule, despite everyone treating it as 1.3.1) is reported rather than blocking.

The cost, named: excluding `best-practice` also excludes genuinely useful rules. Step 5 runs the
default set **once**, records what the extra rules say, and then pins the gate to the WCAG tags.

### 5. What axe cannot see because it is not in the DOM

Four blind spots, each of which needs the spec to *do* something before it scans:

| Blind spot | Why | What the spec does |
|---|---|---|
| A closed Radix dialog | Radix unmounts `DialogContent`'s children when closed. There is nothing to scan | opens it, then scans |
| An authenticated header or form | `/incidents/submit` redirects to `/login` for an anonymous visitor (Lesson 15.5) | logs in, then scans |
| `LocaleSwitcher`'s disabled locales | 20.3 server-renders every locale as available and corrects it in an effect | waits for the post-hydration state |
| Lesson 18.4's degraded-list notice | it renders only when WordPress is unreachable | **not scanned.** It is `role="status"` with plain text; Lesson 23.6 covers the warm-cache origin-down case and names the cold-cache one — the case where this notice renders — as not written |

The third one deserves its own note because it is a fact three lessons inherit. Lesson 20.3's
switcher renders three available links on the server and replaces two with disabled buttons after
reading the document's `hreflang` cluster (20.4). So a scan that runs against server HTML sees a
state no user ever sees, and **a spec cannot assert on the server-rendered markup here.** Lesson
23.6 inherits the same fact for its own assertions.

### 6. The matrix, derived rather than assumed

"Six routes × three locales" is eighteen and it is wrong, because the fixture is deliberately not
uniform. Lesson 20.1's translation table is the authority: incident slugs differ per language,
reviews exist in English only, and `/incidents/submit` is behind an auth gate.

| Bucket | What | Scans |
|---|---|---|
| A. locale-invariant paths | `/[locale]`, `/[locale]/incidents`, `/[locale]/hobt` × 3 | 9 |
| B. per-locale node slug | `incident-01` (en), `incident-01-de` (de), `відмова-01` (uk) | 3 |
| C. English-only content | `/en/reviews/review-01` | 1 |
| D. the **fallback** state | `/de/reviews/review-01` → 307 → `/en/reviews/review-01?from=de`, with 20.4's untranslated notice on screen | 1 |
| E. authenticated form | `/[locale]/incidents/submit` × 3 | 3 |
| F. authenticated chrome | `/[locale]` logged in, because `SessionMenu` differs × 3 | 3 |
| G. dialog open | `/[locale]/hobt` with Get Demo open × 3 | 3 |
| | | **23** |

Bucket D is the one worth arguing for. `/de/reviews/review-01` is not a fourth locale of the
review — it is a 307 to English with `?from=de`, which is the only state in the app where
`UntranslatedNotice` is on screen. One scan buys coverage of a component that has no other route.

### 7. Authenticated scans, and the debt Lesson 23.6 pays

Buckets E and F need a session. Lesson 16.4's `funnel.spec.ts` already drives the login form
in-spec, reading `BTT_REPORTER_PASSWORD` from the **invoking shell**, and 16.4 explicitly promised
that Lesson 23.6 replaces that with Playwright's `storageState`. This spec does the same thing
the same way, for the same reason, and inherits the same promise:

| | login in-spec (here, and 16.4) | `storageState` (Lesson 23.6) |
|---|---|---|
| Proves the login path works | ✅ every run | ❌ it is set up once, elsewhere |
| Cost per authenticated scan | a full form round trip | one cookie injection |
| Order dependence between specs | none | the `setup` project must run first |
| Right answer for 23 scans | ❌ six logins is slow | ✅ |
| Right answer **today** | ✅ the `setup` project does not exist yet | — |

The last row is the honest reason. Playwright does not read `.env.local` (appendix 04 §3.1), so
the password comes from the shell, and the spec **skips** rather than fails when it is absent —
because a contributor without the seeder's password should get a shorter run, not a red one.
Lesson 24.4 supplies it as a repository secret.

### 8. Triage: what the suite covers, what it cannot, and who covers the gap

The deliverable of this lesson that outlives the code is a table, and it has three columns
because two would let you write down the good news and stop. Every row of "cannot" needs a named
manual check from Lesson 22.1 or 22.2, or it is not a documented gap — it is an unowned one.

```
   axe covers                     axe cannot                  covered by
   ──────────────────────────     ────────────────────────     ─────────────────────
   the alt attribute exists       the alt text is right        22.1 Step 1, by hand
   contrast arithmetic            the palette is legible       22.1 Step 2, DevTools
   the field has a label          the label says the truth     22.1 Step 1
   no aria-hidden on a control    the focus ORDER is sane      22.2 Step 1, keyboard
   the region exists              it announced something       22.2 Step 7, VoiceOver
   levels do not skip             the outline is the document  22.1 Step 1 + accepted
```

### 9. Lighthouse's role here, and the file this lesson must not edit

`npx lhci autorun` already runs against the six budgeted routes, because Lesson 21.4 wrote
`lighthouserc.json` and owns it. This lesson **runs it and records the accessibility score**; it
does not add an assertion, because Lesson 24.5 owns the ≥ 0.95 threshold and putting it here
would mean two lessons setting one number.

That division is worth stating because it is the ratchet argument in miniature (Lesson 21.4):
record the baseline in the lesson that measures it, and set the threshold in the lesson that owns
the gate. A number introduced in the same commit as the measurement is a number nobody has
compared to anything.

---

## Task

### Step 1: Check the licence, then install

```bash
cd next-app

npm view @axe-core/playwright license
npm view axe-core license
# Expected: MPL-2.0 for both, at the time of writing. Run the command rather than
#           trusting this line — the point of the habit (Lesson 11.1 Step 1) is
#           that a licence is a fact about today's registry, not about a lesson.
```

MPL-2.0 is **not** MIT and it is worth understanding before you type the install. It is
file-level weak copyleft: obligations attach to modified copies of the MPL-licensed *files*, not
to code that merely uses them. Both packages go in `devDependencies`, nothing from either is
bundled into the shipped application, and `next-app` remains MIT (Lesson 07.1 §9). If your
organisation's policy is "permissive only, no copyleft of any kind in the dependency tree", this
is the package to raise before you add it — and the answer would be to run axe through the
extension and Lighthouse only, and lose the gate. Say which you chose.

```bash
npm install --save-dev @axe-core/playwright

npm ls @axe-core/playwright axe-core
# Expected: both listed, and axe-core resolved once. Two copies means something
#           else in the tree pinned a different major, and the rule IDs differ.
```

### Step 2: Run the extension by hand, on the six routes, and read the guidance

Do this before writing a line of spec. The extension's value is not the list of rule IDs — it is
the "Learn more" link on each one, which explains the criterion and the fix. You want to have
read a dozen of those before you write assertions about severity.

```bash
# Install axe DevTools from the Chrome Web Store, then on each of:
#   /en, /en/incidents, /en/incidents/incident-01, /en/hobt,
#   /en/reviews/review-01, and /en/incidents/submit while SIGNED IN as `reporter`
#
#   1. Run "Scan ALL of my page" with the DEFAULT rule set (best-practice included)
#   2. Record every violation: rule id, impact, node count
#   3. Then set the extension to WCAG 2.2 AA only, rescan, and record the difference
#
# On /en/hobt, ALSO: open the Get Demo dialog, then scan. That is the state the
# spec has to be driven into, and the extension reaches it in one click.
```

The difference between the two runs is the thing to write down. The rules that disappear when you
restrict to WCAG tags are the best-practice ones from Key Concept 4 — `region`,
`landmark-one-main`, `page-has-heading-one`, `heading-order` — and you now know exactly which
findings your gate will stop reporting and why.

**Verify §2:**

- [ ] After Lessons 22.1 and 22.2, the WCAG 2.2 AA run reports **zero `critical`** on all six
      routes. If it reports one, stop and fix it; a `critical` means a task is impossible.
- [ ] The default-rule-set run reports at least one `region` violation on `/en/incidents` — the
      layout `<section>` in `IncidentBrowser`. Confirm it is the best-practice rule and not a
      WCAG one, which is Key Concept 4 with your own eyes on it.
- [ ] The dialog-open scan on `/en/hobt` reports something the closed scan did not, even if that
      something is only a different node count. Two scans of one page that agree exactly mean the
      dialog never opened.

### Step 3: Run Lighthouse, record the score, and change no configuration

```bash
cd next-app
npm run build

npx lhci autorun --config=lighthouserc.json
# Expected: all of Lesson 21.4's assertions still pass. Note the ACCESSIBILITY
#           category score for each of the six URLs — it is in the report summary
#           and in .lighthouseci/*.json under categories.accessibility.score.
```

Do not edit `lighthouserc.json`. Lesson 21.4 owns that file and Lesson 24.5 adds the
`accessibility >= 0.95` assertion; setting the number here would mean two lessons setting one
threshold, which is exactly the drift the ratchet argument exists to prevent. Record the score
in `docs/accessibility.md` in Step 8 rather than in `docs/perf-baseline.md`, which belongs to
Module 21 — one topic per file, and a cross-reference costs nothing.

### Step 4: Build the scan matrix as data

The matrix from Key Concept 6, as a module-level constant so adding a route is one line. The
per-locale slugs come from Lesson 20.1's translation table and are not guesses.

```ts
// next-app/e2e/a11y.spec.ts — the matrix. The rest of the file follows in Steps 5-7.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * WCAG tags ONLY. The default rule set includes `best-practice` rules that are
 * not WCAG, and a gate built on them gets argued with and then disabled —
 * Lesson 22.3 §4. `heading-order` and `region` are best-practice and are
 * therefore reported by the extension and not by this suite.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const LOCALES = ['en', 'uk', 'de'] as const;

/** Node slugs differ per language — Lesson 20.1's translation table. */
const INCIDENT_SLUG: Readonly<Record<(typeof LOCALES)[number], string>> = {
  en: 'incident-01',
  de: 'incident-01-de',
  uk: 'відмова-01',
};

type Scan = { readonly id: string; readonly path: string };

/** Buckets A, B, C and D from §6. 14 scans, no session required. */
const ANONYMOUS: readonly Scan[] = [
  ...LOCALES.flatMap((locale) => [
    { id: `A ${locale} home`, path: `/${locale}` },
    { id: `A ${locale} incidents`, path: `/${locale}/incidents` },
    { id: `A ${locale} hobt`, path: `/${locale}/hobt` },
    { id: `B ${locale} incident detail`, path: `/${locale}/incidents/${INCIDENT_SLUG[locale]}` },
  ]),
  // C — reviews exist in `en` only (Lesson 20.1). There is no /de/reviews/… node.
  { id: 'C en review detail', path: '/en/reviews/review-01' },
  // D — the FALLBACK state, and the only route in the app that renders Lesson
  // 20.4's UntranslatedNotice. Lesson 20.2 §8 case 2: the node exists in another
  // locale, so this 307s to /en/reviews/review-01?from=de and Playwright follows
  // it. One scan, one component that has no other home.
  { id: 'D de→en review fallback', path: '/de/reviews/review-01' },
];
```

### Step 5: The scan helper, and the anonymous run

Two things the helper has to do that a bare `analyze()` call does not: wait for the page to be in
the state a user sees, and partition the result by impact so the failure message is readable.

```ts
// next-app/e2e/a11y.spec.ts — append
type Partitioned = {
  readonly blocking: readonly string[];
  readonly reported: readonly string[];
};

/**
 * Scan whatever the page is currently showing.
 *
 * The `blocking` / `reported` split is the threshold Lesson 22.4 turns into a
 * merge gate: critical and serious block, moderate and minor are reported.
 * Partitioning HERE rather than in the assertion means the failure message
 * names the rule and the node, which is the difference between a gate people
 * fix and a gate people disable.
 */
async function scan(page: Page, id: string): Promise<Partitioned> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const describe = (impacts: readonly string[]): readonly string[] =>
    results.violations
      .filter((violation) => impacts.includes(violation.impact ?? 'minor'))
      .map(
        (violation) =>
          `[${violation.impact}] ${violation.id} × ${violation.nodes.length} — ` +
          `${violation.help} (${violation.helpUrl})`
      );

  // The machine-readable copy, attached to the Playwright report. Lesson 22.4
  // turns this into a CI artifact with a count in the job summary.
  await test.info().attach(`axe-${id}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });

  return {
    blocking: describe(['critical', 'serious']),
    reported: describe(['moderate', 'minor']),
  };
}

/**
 * Go to a path and wait until the DOM is worth scanning.
 *
 * BE HONEST ABOUT THIS ONE. There is no public, stable "React has hydrated"
 * signal in Next 15, so `waitUntil: 'load'` plus a visible <main> is the best
 * this helper can do, and it does NOT prove that Lesson 20.3's locale switcher
 * has corrected its server-rendered state yet. This is the weakest assertion in
 * the file. Lesson 23.6 owns the switcher's hydration race and its `setup`
 * project is where a shared, correct helper belongs; the scans that actually
 * depend on a post-hydration DOM add their own explicit wait below.
 */
async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.getByRole('main')).toBeVisible();
}

test.describe('axe — anonymous', () => {
  for (const route of ANONYMOUS) {
    test(`${route.id} has no critical or serious violations`, async ({ page }) => {
      await settle(page, route.path);

      // The one place a post-hydration DOM is load-bearing. Reviews exist in
      // `en` only (Lesson 20.1), so on these two scans the switcher HAS
      // something to correct: two locales become disabled buttons carrying the
      // reason in their accessible name (Lesson 20.3). Waiting for one of them
      // is a real hydration barrier, and it is also the only way axe ever sees
      // a disabled control on this site.
      if (route.id.startsWith('C ') || route.id.startsWith('D ')) {
        await expect(page.getByRole('button', { name: /not available/i }).first()).toBeVisible();
      }

      const { blocking, reported } = await scan(page, route.id);

      // Reported, not asserted. Lesson 22.4 §3 argues the split.
      if (reported.length > 0) {
        console.log(`[a11y] ${route.id} — ${reported.length} moderate/minor:\n  ${reported.join('\n  ')}`);
      }

      expect(blocking, `${route.path}\n${blocking.join('\n')}`).toEqual([]);
    });
  }
});
```

**Verify §5:**

- [ ] `npx playwright test e2e/a11y.spec.ts` runs 14 tests. Not 18 — the matrix is derived from
      the fixture, and reviews exist in one language.
- [ ] The Ukrainian incident path works. `відмова-01` is percent-encoded by the browser and
      Playwright handles that; a 404 here means your seeder did not run 20.1's translations.
- [ ] Bucket D logs the untranslated notice's page. `curl -s -o /dev/null -w '%{http_code}'
      'http://localhost:3000/de/reviews/review-01'` prints `307`, which is what the spec follows.

### Step 6: The authenticated scans, driving the login form in-spec

```ts
// next-app/e2e/a11y.spec.ts — append
// Playwright does NOT read .env.local (appendix 04 §3.1). The password comes from
// the invoking shell, exactly as Lesson 16.4's funnel.spec.ts does it:
//   BTT_REPORTER_PASSWORD=… npx playwright test e2e/a11y.spec.ts
const REPORTER_PASSWORD = process.env.BTT_REPORTER_PASSWORD ?? '';

/**
 * Drive the real login form. Lesson 16.4 already made this choice and already
 * promised Lesson 23.6 would replace it with `storageState`; this spec inherits
 * both. Six logins is slower than one cookie injection, and today the `setup`
 * project that would mint that cookie does not exist.
 */
async function signIn(page: Page, locale: string): Promise<void> {
  await page.goto(`/${locale}/login`);
  await page.getByRole('textbox', { name: /username|email/i }).fill('reporter');
  // The one documented exception to role-based locators: <input type="password">
  // exposes no ARIA role, so getByRole('textbox') cannot match it in any browser.
  await page.getByLabel(/password|пароль|passwort/i).fill(REPORTER_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|увійти|anmelden/i }).click();
}

test.describe('axe — authenticated', () => {
  // SKIP, not fail. A contributor without the seeder's password should get a
  // shorter run, not a red one. Lesson 24.4 supplies it as a repository secret.
  test.skip(
    REPORTER_PASSWORD === '',
    'BTT_REPORTER_PASSWORD must be in the invoking shell — appendix 04 §2'
  );

  for (const locale of LOCALES) {
    // Bucket E. Anonymous, this route 307s to /login (Lesson 15.5's auth gate),
    // so there is no anonymous scan of it at all — the anonymous scan would be a
    // second scan of the login page.
    test(`E ${locale} submit form has no critical or serious violations`, async ({ page }) => {
      await signIn(page, locale);
      await settle(page, `/${locale}/incidents/submit`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const { blocking } = await scan(page, `E-${locale}-submit`);

      expect(blocking, `/${locale}/incidents/submit\n${blocking.join('\n')}`).toEqual([]);
    });

    // Bucket F. The same path as bucket A, in a different state: SessionMenu
    // renders an account control instead of a sign-in link (Lesson 18.1).
    test(`F ${locale} home renders its signed-in chrome accessibly`, async ({ page }) => {
      await signIn(page, locale);
      await settle(page, `/${locale}`);

      const { blocking } = await scan(page, `F-${locale}-home`);

      expect(blocking, `/${locale} signed in\n${blocking.join('\n')}`).toEqual([]);
    });
  }
});
```

### Step 7: The dialog-open scan, which is the one that proves the point

```ts
// next-app/e2e/a11y.spec.ts — append
test.describe('axe — dialog open', () => {
  for (const locale of LOCALES) {
    // Bucket G. A closed Radix dialog has NO CONTENT IN THE DOM — the primitive
    // unmounts DialogContent's children — so bucket A's scan of /hobt says
    // nothing whatsoever about the five-field lead form inside it. This is the
    // scan that covers it, and it is also the only scan that exercises
    // aria-modal, the focus trap's markup, and the labelled dialog title.
    test(`G ${locale} get-demo dialog has no critical or serious violations`, async ({ page }) => {
      await settle(page, `/${locale}/hobt`);

      // /hobt renders the CTA band TWICE on purpose (Lesson 11.5), so there are
      // two triggers with this name and Lesson 12.3 asserts the count. .first()
      // is correct here and is not a locator smell: either one opens the same
      // dialog, and which one is a Lesson 22.2 focus-restoration question, not
      // an axe question.
      await page.getByRole('button', { name: /get demo|demo/i }).first().click();

      // Wait for the dialog to BE the dialog, not for a timeout. If this locator
      // fails, the scan below would have silently scanned the closed page.
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('textbox').first()).toBeFocused();

      const { blocking } = await scan(page, `G-${locale}-dialog`);

      expect(blocking, `/${locale}/hobt with the dialog open\n${blocking.join('\n')}`).toEqual([]);
    });
  }
});
```

**Verify §7:**

- [ ] 23 tests total: 14 anonymous, 6 authenticated, 3 dialog. With no password in the shell, 17
      run and 6 skip.
- [ ] The `toBeFocused()` assertion passes. Radix moves focus to the first tabbable element, and
      Lesson 16.3's honeypot input carries `tabIndex={-1}` specifically so it is not that element.
- [ ] Comment out the `.click()` and the dialog scan still passes. **That is the failure this
      step exists to prevent** — a scan of the closed state proves nothing, and it is green. Put
      the click back and keep the `expect(getByRole('dialog'))` line, which is what makes the
      silent version impossible.

### Step 8: Fix what the scan found, then write the coverage table

Every remaining `critical` and `serious` gets fixed now, before Lesson 22.4 makes it a gate — a
gate introduced on a red suite is a gate somebody disables in week one (Lesson 21.4). Then the
table, which is the artifact of this lesson that outlives the spec.

```markdown
<!-- docs/accessibility.md — append one section -->
## Automated coverage (Lesson 22.3)

`e2e/a11y.spec.ts`, `@axe-core/playwright`, 23 scans. Run it with
`npx playwright test e2e/a11y.spec.ts`, or as `--project=a11y` from Lesson 22.4.

**Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.** Deliberately not
`best-practice`: those rules are not WCAG, and a gate built on them gets argued with and then
switched off. `heading-order`, `region`, `landmark-one-main` and `page-has-heading-one` are
best-practice rules and are therefore reported by the DevTools extension and by no gate.

| Lighthouse accessibility score | Before 22.1 | After 22.3 |
|---|---|---|
| the six budgeted routes, mobile preset | record yours | record yours |

Threshold assertion is Lesson 24.5's (≥ 0.95). `lighthouserc.json` belongs to Lesson 21.4 and
this lesson changed nothing in it. Performance numbers live in `docs/perf-baseline.md`.

| The suite covers | It cannot cover | Covered instead by |
|---|---|---|
| every `<img>` has an `alt` | whether the `alt` is correct, or English in a German page | 22.1 Step 1 by hand; the English-`alt` gap is accepted (20.4) |
| text contrast arithmetic on rendered pixels | whether the palette is legible at 12 px on a phone | 22.1 Step 2, DevTools readout |
| every field has an accessible name | whether the name matches what the field wants | 22.1 Step 1 |
| no `aria-hidden` on a focusable element | whether the focus **order** is sensible | 22.2 Step 1, keyboard walkthrough |
| a live region exists and is well-formed | whether it announced something useful, once | 22.2 Step 7, VoiceOver and NVDA |
| `<html lang>` is present and valid | whether the content is in that language | accepted: `global-error.tsx` is English-only (20.4) |
| duplicate ids, orphaned `aria-describedby` | whether two identically-named controls confuse a user | 22.2 §4 — `aria-modal` resolves the `/hobt` case |
| the dialog's markup, **because the spec opens it** | whether `Escape` restores focus to the right trigger | 22.2 Step 1 and Step 4 |
| nothing about the origin-down state | Lesson 18.4's degraded-list notice | Lesson 23.6, warm cache only. Nothing scans the cold-cache render |

**Authentication debt.** Buckets E and F drive the login form in-spec and read
`BTT_REPORTER_PASSWORD` from the invoking shell, exactly as `e2e/funnel.spec.ts` does. Lesson
23.6 replaces both with `storageState` and a `setup` project. Until then the suite skips those
six scans when the password is absent.
```

---

## Verification

```bash
cd next-app

# 1. The gate, and the suite that already existed.
npm run verify
# Expected: exit 0, silent
npx playwright test --project=smoke
# Expected: all green. Do not assert a count — `smoke` has grown past Lesson
#           12.3's thirteen tests and Lesson 23.6 will move some of them out.

# 2. The a11y spec runs, and reports per route and per locale. The test NAMES
#    carry the bucket letter, so the `list` reporter is the per-route report.
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" npx playwright test e2e/a11y.spec.ts
# Expected: 23 passed. 14 anonymous, 6 authenticated, 3 dialog-open.
#           Every moderate/minor finding is on stdout as `[a11y] <id> — N …`
#           and none of them failed anything.

# 3. NEGATIVE — the suite SKIPS rather than fails with no password. A
#    contributor who has not seeded should get a shorter run, not a red one.
env -u BTT_REPORTER_PASSWORD npx playwright test e2e/a11y.spec.ts
# Expected: 17 passed, 6 skipped, 0 failed

# 4. NEGATIVE — the tag list is WCAG only. `best-practice` in this array turns a
#    standards claim into a preference (§4), and `experimental` turns it into a
#    lottery that changes when axe-core does.
grep -c 'withTags' e2e/a11y.spec.ts
# Expected: 1 — one call site, one rule set
grep -nE "'best-practice'|'experimental'|'ACT'" e2e/a11y.spec.ts
# Expected: no output
grep -o "wcag2[12]*a[a]*" e2e/a11y.spec.ts | sort -u
# Expected: wcag21a, wcag21aa, wcag22aa, wcag2a, wcag2aa — five tags

# 5. NEGATIVE — no CSS, attribute or positional locator anywhere in e2e/. Role
#    and accessible name only, with getByLabel for password fields as the single
#    documented exception (Lesson 12.3 §3).
grep -rnE 'data-testid|page\.locator\(|nth-child|xpath=|\$\(' e2e/
# Expected: no output
grep -c 'getByLabel' e2e/a11y.spec.ts
# Expected: 1 — the password field in signIn(), and nothing else

# 6. NEGATIVE — the closed-dialog scan is NOT the one that gates. Prove the
#    dialog really opens by asserting on it, so a silently-closed dialog is a
#    failure rather than a pass.
grep -c "getByRole('dialog')" e2e/a11y.spec.ts
# Expected: 1 — the visibility assertion before the scan
grep -c 'toBeFocused' e2e/a11y.spec.ts
# Expected: 1 — Radix moved focus INTO the dialog, which a closed dialog cannot do

# 7. NEGATIVE — Lesson 21.4's Lighthouse configuration was not touched. The
#    accessibility threshold is Lesson 24.5's to set.
git status --short lighthouserc.json
# Expected: no output
grep -c 'accessibility' lighthouserc.json
# Expected: 0 — no assertion here yet, on purpose

# 8. NEGATIVE — the matrix is derived from the fixture, not from "six times
#    three". Reviews exist in `en` only (Lesson 20.1's table).
grep -c "reviews/review-01" e2e/a11y.spec.ts
# Expected: 2 — bucket C in `en`, and bucket D's `de` path that 307s to it
grep -c 'відмова-01' e2e/a11y.spec.ts
# Expected: 1 — the Ukrainian incident slug is Cyrillic and is not derivable
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/de/reviews/review-01'
# Expected: 307 — bucket D's redirect, which Playwright follows into the
#           untranslated-notice state (Lesson 20.2 §8 case 2)

# 9. NEGATIVE that tests the SUITE, not the code. Break an accessible name on
#    purpose and watch bucket A and bucket G both go red. `sed -i.bak` plus `mv`,
#    never `git checkout --`: the probe must be reversible without touching git.
sed -i.bak 's|name="fullName"|name="fullName" aria-hidden="true"|' \
  src/components/hobt/LeadForm.tsx
grep -c 'aria-hidden="true"' src/components/hobt/LeadForm.tsx
# Expected: 2 — the honeypot's legitimate one, plus the probe
npx playwright test e2e/a11y.spec.ts --grep 'hobt|dialog'; echo "exit=$?"
# Expected: exit=1, with `[critical] aria-hidden-focus` in the failure message.
#           A focusable element hidden from the accessibility tree is rule 4 of
#           ARIA (Lesson 22.1 §8) and axe calls it critical.
mv src/components/hobt/LeadForm.tsx.bak src/components/hobt/LeadForm.tsx
npx playwright test e2e/a11y.spec.ts --grep 'hobt|dialog'
# Expected: 6 passed. A suite you have never seen fail is a suite you have not
#           installed.

# 10. NEGATIVE — the probe left nothing behind.
git status --short src/
# Expected: no output
ls src/components/hobt/*.bak 2>/dev/null | wc -l
# Expected: 0

# 11. The Lighthouse accessibility score is recorded, and it is a number rather
#     than an adjective.
npx lhci autorun --config=lighthouserc.json
# Expected: Lesson 21.4's assertions still pass
jq -r '.categories.accessibility.score' .lighthouseci/lhr-*.json 2>/dev/null | sort -u
# Expected: one score per URL. Write them into docs/accessibility.md's table —
#           Lesson 24.5 asserts ≥ 0.95 against these, so a value below it is a
#           number you have to move before Module 24.

# 12. The written coverage table exists and names a manual owner for every gap.
grep -c 'Automated coverage (Lesson 22.3)' ../docs/accessibility.md
# Expected: 1
grep -c 'It cannot cover' ../docs/accessibility.md
# Expected: 1 — a two-column table would let you record the good news and stop
```

Checks 4, 6 and 9 are the three that define this lesson: the gate is a WCAG claim rather than a
preference, the dialog scan cannot silently scan a closed dialog, and the suite has been observed
failing on a real defect.

## Control Questions

1. The matrix is 23 scans, not 18. Derive the number yourself from Lesson 20.1's translation
   table and Lesson 15.5's auth gate, then say which single bucket you would delete first if the
   suite's runtime became a problem — and what coverage you would be giving up, naming the
   component that loses its only scan.
2. `withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])` deliberately omits
   `best-practice`, which means `heading-order` no longer fires in the suite. Explain why that is
   the right call for a **gate** and the wrong call for the **extension** run in Step 2, and name
   the earlier lesson that makes `heading-order` unfixable on one of the six routes anyway.
3. Bucket A scans `/en/hobt` and bucket G scans the same URL again with the dialog open. State
   precisely what bucket A cannot see, explain why deleting bucket A and keeping only bucket G
   would lose coverage rather than save time, and describe what would go wrong if bucket G asserted
   nothing about the dialog before calling `analyze()`.
4. `settle()` waits for `load` and a visible `<main>`, and the lesson calls that the weakest
   assertion in the file. Describe the specific false result it can produce on bucket F, explain
   why buckets C and D add their own wait instead, and say what Lesson 23.6 has that would let it
   be written correctly.
5. A colleague proposes replacing every `expect(blocking).toEqual([])` with
   `expect(results.violations.length).toBe(0)` because it is shorter. Give three separate things
   that change about the suite, and say which of the three would cause the gate to be disabled
   first and by whom.

## Learn More

- [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
  — the `AxeBuilder` API: `withTags`, `include`, `exclude`, `disableRules`, `analyze`
- [axe-core rule descriptions](https://dequeuniversity.com/rules/axe/) — every rule, its tags and
  its impact; the table Key Concept 3 summarises, and the pages the extension links to
- [axe-core: accessibility rules and their tags](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)
  — the machine-readable version, and the one place to confirm a rule really is `best-practice`
- [Deque: automated accessibility testing coverage](https://www.deque.com/automated-accessibility-testing-coverage/)
  — the source of the "up to 57 %" figure, including what it is measuring and what it is not
- [Lighthouse accessibility scoring](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)
  — the weighting, and why a score of 100 is not a conformance claim
- [Playwright: accessibility testing](https://playwright.dev/docs/accessibility-testing) — the
  official recipe, including scanning a subset of a page and the snapshot approach this course declines
- [Playwright: `test.info().attach`](https://playwright.dev/docs/api/class-testinfo#test-info-attach)
  — how the JSON in `scan()` reaches the HTML report, and how Lesson 22.4 turns it into a CI artifact
- [Understanding conformance: WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/conformance)
  — what "conforms at level AA" actually claims, which is narrower than "is accessible"
- [MPL-2.0, in the licence author's own FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) — read
  questions 8 and 9 before you argue with a legal team about a devDependency
