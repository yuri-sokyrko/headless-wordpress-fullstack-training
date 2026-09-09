---
title: 'Agent-Driven Exploratory Testing'
module: 23
lesson: 8
teaches: [exploratory-testing, test-charters, agent-session-logs, finding-triage, agentic-qa]
produces: ['docs/agentic-qa.md']
requires: [23.7]
---

# Lesson 23.8 — Agent-Driven Exploratory Testing

## Quick Overview

Exploratory testing is the discipline of looking for bugs you did not think to look for. It is
driven by a **charter** — a goal and a boundary, not a script — because a script can only find
the failures its author already imagined. A charter reads like this:

> *You are a QA engineer. Explore incident submission. Try to get an incident published without
> moderator approval. Report anything surprising.*

That is the whole instruction. The agent decides what to click, notices what happened, forms a
hypothesis and tries the next thing. Where an agent beats a script is breadth and patience: it
will try the flow with the field left empty, with the session expired, with the moderation kill
switch off, in German, with the query string still attached — combinations a human tester would
get to eventually and a `spec.ts` file will never get to at all, because somebody had to write
each one.

Expect real findings, because there are real bugs in this application by construction. A pending
incident leaking into the scapegoat term count, because
`wp_term_taxonomy.count` includes statuses you did not intend. The Get Demo dialog not trapping
focus after a styling change, which Lesson 22.2 fixed and a later refactor can silently undo. The
locale switcher dropping `?scapegoat=` so a filtered German list resets. None of those are exotic;
all three are the kind of thing that ships. The job in this lesson is to run the exploration
under the guardrails from Lesson 23.7, read the session logs, and **triage** — because a report
is raw material, not a bug list. Some findings are real bugs, some are misread intent, some are
duplicates of the same underlying cause, and separating them is human work.

By the end of this lesson you will have:

- Four to six written charters covering submission, moderation, auth, i18n and the HOBT funnel,
  each with an explicit boundary
- A completed exploration run against the local seeded stack, logged to `.agent-artifacts/`
- `docs/agentic-qa.md` — the charters, the raw findings, and the triage decision for each
- At least three triaged findings with a reproduction, a severity and a verdict: real bug,
  misread intent, or duplicate
- One finding checked against the session log line by line, so you have confirmed the behaviour
  yourself rather than trusting a summary
- A written note on what the agent did *not* find, and why that is the more interesting half of
  the report

## Classic WP Analogy

**Nothing in Classic WordPress practice maps onto this, and the honest version of the analogy is
to say so and then look at what the absence tells you.** The closest thing you have done is
"click around staging before launch and see if anything looks wrong" — which is genuinely
exploratory testing, performed by a human, undocumented, unrepeatable, and skipped whenever the
release was late.

Two things transfer, though, and both are worth naming.

**The mindset is not new, only the operator.** Exploratory testing predates AI by decades and the
skill it requires is entirely human: forming a hypothesis about how something might break, and
then trying it. "What if I submit this as a contributor?" "What if the post is scheduled instead
of published?" "What if the slug has a Cyrillic character?" You have had those thoughts about
WordPress sites for years. The agent does not have better instincts than you — it has more
patience, no fear of repetition, and no ego about being wrong forty times.

**Writing the charter is the skill worth practising.** A charter that is too narrow ("click the
submit button and check for an error") is a script wearing a charter's clothes, and produces
nothing you did not already know. A charter that is too broad ("test the site") produces a
wandering report full of screenshots and no findings. The sweet spot — one flow, one adversarial
goal, one instruction to report surprises — is a real craft, and it is the same craft as writing
a good bug report or a good acceptance criterion.

Where the analogy breaks hardest is **trust**. A human tester who says "I could publish without
approval" is reporting an observation. An agent that says the same thing is producing text that
is *consistent with* an observation, and it may have misread a page, conflated a pending incident
with a published one, or been looking at a stale cache. So every finding gets reproduced by hand
before it becomes a bug — the session log exists precisely so you can check. That step has
no Classic counterpart because you never had to ask whether your tester's report was a
hallucination, and building it into the workflow from the first run is what keeps agentic QA
useful rather than noisy.

---

## Key Concepts

### 1. A charter is a goal and a boundary, and the boundary is half the work

A script says what to do. A charter says what to achieve and where to stop. The difference is not
formality — it is what the two can find.

| | A script | A charter |
|---|---|---|
| Can find | the failures its author imagined | failures nobody imagined, sometimes |
| Repeatable | exactly | no. Lesson 23.9's first honest limit |
| Value when it passes | a guarantee | almost nothing |
| Value when it fails | a regression | a lead to investigate |
| Author's job | describe the steps | describe the goal, the boundary, and what counts as surprising |

The boundary is the part beginners omit and the part that decides whether you get a report or a
wander. A boundary does three jobs at once: it keeps the run finite, it keeps the agent inside
the guardrails from Lesson 23.7 without relying on them, and — most usefully — it tells you what
the run *did not cover*, which is Key Concept 8.

```
   TOO NARROW                          TOO BROAD                       RIGHT
   ─────────────────────────────       ─────────────────────────       ────────────────────────
   "click Submit with the title       "test the site"                 one flow
    field empty and check for                                        one adversarial goal
    an error"                          → 40 screenshots               one boundary
                                       → 3 pages visited              one instruction to
   → a script in a charter's           → 0 findings                     report surprises
     clothes                           → 11 minutes of tokens
   → tells you what you knew
```

This is the same craft as writing a good acceptance criterion, and it fails the same two ways.
"The form should work" is untestable. "The form should reject an empty title with the message
*What happened is required*" is a unit test somebody already wrote. The useful version sits
between them: **a goal an adversary would have, plus a place to stop.**

### 2. Where an agent beats a script, and where it does not

Be specific about this, because the honest version is narrower than the marketing version and
much more useful.

| | Human tester | `spec.ts` file | Agent |
|---|---|---|---|
| Judgement about what is surprising | excellent | none | moderate, and unreliable |
| Patience for the fortieth variation | poor | perfect, for the variations written | **good** |
| Willingness to be wrong repeatedly | low, it is embarrassing | n/a | total |
| Combinatorial breadth | low | only what was written | **high** |
| Cost per run | expensive | ~free | minutes and money |
| Result you can gate a merge on | no | **yes** | **no** — Lesson 23.9 |

The column that earns the tooling is breadth crossed with patience. A charter about submission
will try the flow with a field empty, with the session expired, in German, with a query string
still attached, after a back-button navigation, twice in a row — combinations a human would reach
eventually and a spec file will never reach at all, because somebody has to write each one and
nobody writes the twenty-third.

The column that limits it is judgement. The agent does not know which of its forty observations
matters. That is Key Concept 5.

### 3. Six charters, and why these six

The stub's charter is the model. Five more, each with an explicit boundary, chosen to cover the
flows where this application's real complexity lives:

| # | Flow | Adversarial goal | Boundary |
|---|---|---|---|
| C1 | incident submission | get an incident published without moderator approval | `localhost:3000` only; stop after 15 minutes or 3 submissions |
| C2 | moderation queue | see or edit another reporter's pending incident | do not use wp-admin; you are `e2e_agent` and have no dashboard |
| C4 | auth and session | reach `/en/account` or `/en/incidents/submit` without a session, or keep a session past its expiry | do not attempt more than 5 logins; report, never brute force |
| C5 | locale routing | find a URL where the language of the page and the language in the URL disagree | the three seeded locales only; do not edit content |
| C6 | HOBT funnel | submit the Get Demo form twice, or with the honeypot filled, and get two leads | do not submit more than 6 times — Lesson 16.2's limiter fails closed and will lock you out |
| C7 | the blame leaderboard | make the number on a scapegoat page disagree with the incidents listed under it | read-only except for one incident submission |

Two things about that table are deliberate and worth copying.

**Every goal is adversarial**, phrased as something a bad actor or an unlucky user would want.
"Explore the submission form" produces a tour. "Get an incident published without approval"
produces attempts, and an attempt that fails is still information — it is a confirmation of
Module 03's structural authorisation, which is worth having.

**Every boundary is concrete and includes a stop condition.** "Stop after 3 submissions" is a
boundary; "don't go too far" is not. C6's limit exists because Lesson 16.2's rate limiter fails
closed, so a charter without a submission cap ends with the agent locked out and reporting an
outage it caused. That is the class of finding you have to learn to discount, and the cheapest way
to avoid learning it is a number in the charter.

### 4. What the run produces, and what to do with each artefact

```
   one charter run
        │
        ├─▶ the agent's narrative      ← text. NOT evidence. Key Concept 5
        ├─▶ .agent-artifacts/*.zip     ← a Playwright TRACE. This IS evidence
        └─▶ your notes                 ← what you decided, which is the deliverable
```

The **session log** is the artefact that makes the whole practice defensible, and reading one is a
Task step rather than an optional extra. `--save-session` writes
`.agent-artifacts/session-<timestamp>/session.md`: every tool call the agent made, in order, with
its arguments and its result as JSON. It is a transcript of actions, not a Playwright trace —
there is no filmstrip and no network waterfall, because the MCP server has no trace flag. Read it
in any editor.

| Artefact | Trustworthy? | Use it for |
|---|---|---|
| The narrative summary | **no** | generating hypotheses |
| `session.md`'s tool calls | yes | what was actually clicked, in order |
| The snapshots inside those results | yes | what the page actually said at that moment |
| Console messages in those results | yes | an error the agent did not mention because it was not visible on the page. Requires `--console-level error` or lower |
| **A network log** | **does not exist** | nothing. Key Concept 6 below, and Lesson 23.7 Key Concept 6 |

That last row replaced the highest-value check an earlier draft of this lesson claimed to have:
reading origins out of a trace's network entries, to see whether `--allowed-origins` held under
real navigation with redirects included. Two things killed it. There is no trace to read, and the
flag's own help text says an origin list "does not affect redirects" — so the check could not have
proved what it claimed even with the artefact. Lesson 23.7's live permit-and-deny probe is where
that flag is exercised, and the thing that actually bounds this agent is the target rule: a local,
disposable, seeded stack. Keep the honest control and drop the reassuring one.

### 5. An agent report is raw material, and triage is the deliverable

This is where the practice earns or loses its reputation inside a team, so it is worth stating
without hedging.

> **A human tester who says "I could publish without approval" is reporting an observation. An
> agent that says the same thing is producing text *consistent with* an observation.** It may have
> misread a page, conflated a pending incident with a published one, or — after Lesson 23.6 you
> know this is real — been looking at a stale ISR entry from before its own submission.

So every finding gets one of three verdicts, and reaching a verdict requires a human reproducing
the behaviour by hand:

| Verdict | Means | What happens next |
|---|---|---|
| **real bug** | reproduced by hand, and the behaviour is wrong | Lesson 23.9 writes a deterministic spec, then somebody fixes it |
| **misread intent** | reproduced by hand, and the behaviour is **correct** | nothing changes in the code. Something may change in a *document*, because the agent read the UI the way a user would |
| **duplicate** | a different symptom of a cause already recorded | merge it into the other finding, and keep the second symptom — two symptoms make a better spec than one |

A fourth outcome exists and needs a name because it will be your most common one:
**not reproducible.** That is not a verdict about the application; it is a verdict about the
report. Record it, because a pattern of them tells you a charter is too broad.

And the asymmetry that makes triage cheap: **a finding you cannot reproduce costs you ten
minutes; a finding you file without reproducing costs somebody else a day.** The log exists so
the ten minutes is spent on evidence rather than on guessing.

### 6. The three findings this run produces, and the one whose mechanism is wrong

This application has real defects by construction, and the charters above find them. What makes
this lesson worth doing rather than reading is that **one of the three arrives with a confident,
plausible and incorrect explanation** — which is the single most important thing to experience
about agent reports.

| Finding | Symptom the agent reports | Its proposed mechanism | Verdict after triage |
|---|---|---|---|
| F1 (C7) | "The Intern is blamed 7 times, but the list under it shows 5" | "`wp_term_taxonomy.count` includes pending incidents" | **real bug, wrong mechanism** |
| F2 (C6) | "After the Get Demo dialog opened, Tab moved focus behind it" | "the dialog does not trap focus" | real bug, correct mechanism |
| F3 (C5) | "Switching to German from a filtered list dropped `?scapegoat=`" | "the switcher rebuilds the URL without the query" | **already fixed — the finding that produced the assertion** |

F1 is the interesting one and Task Step 5 works it through. The proposed mechanism is checkable
in ten minutes and it is **false**: `count` is maintained by `_update_post_term_count()`, which
counts only posts whose `post_status` is `publish`, and Lesson 03.3 §2 says so in as many words.
Module 03 registered no `update_count_callback` of its own — only a `capabilities` map — so core's
behaviour is the behaviour.

The symptom is nonetheless real, and the actual mechanism is the subject of Lesson 23.6:
`/en/scapegoats/the-intern` reads `count` **and** the incidents under the term from one query,
and Next serves that page from a cache tagged `[termTag('scapegoat', slug), listTag('incident')]`
with `revalidate: 3600`. If either tag stops being expired when an incident's status changes, the
number and the list are rendered from different moments in time. **The count is correct in MySQL
and stale in Next**, and the direction of the disagreement depends on whether the last moderation
action was an approval or a rejection — which is exactly why a rejected incident can appear to
still be counted.

> **This is the whole reason triage is human work.** The agent's symptom was accurate, its
> mechanism was confident, and acting on the mechanism would have sent someone into
> `_update_post_term_count()` for an afternoon. Both halves of that sentence are typical.

F3 needs care of a different kind. Lesson 23.6's `i18n.spec.ts` asserts that the switcher
**preserves** the query string, and that spec passes. So F3 is closed, and the honest way to
record it is: *this is the finding that produced the assertion, not an open bug.* An agent
rediscovering a fixed bug is a signal that the guard is where it should be — and recording it as
"real bug" would have somebody re-fixing working code.

### 7. What you cannot conclude from a green run

A charter that finds nothing tells you almost nothing, and this is the asymmetry to internalise
before you show a report to anyone.

| A `spec.ts` that passes | A charter that finds nothing |
|---|---|
| The behaviour it asserts is correct, on this commit | The agent did not find anything **on this path, this time** |
| Repeatable | A second run takes a different path |
| Safe to gate a merge on | Never (Lesson 23.9) |

So "we ran six charters and found three bugs" is a report. "We ran six charters and found nothing,
so submission is fine" is not a claim the method can support. The charter that finds nothing is
worth its cost only for what its boundary tells you about coverage — which is the next concept,
and it is the one people skip.

### 8. What the agent did not find, and why that is the more interesting half

Write this down deliberately, because nobody does it and it is where the real information is.

| Not found | Why not | Where it belongs instead |
|---|---|---|
| Any colour-contrast or layout problem | the agent reads the accessibility tree, not pixels (Lesson 23.7 §4) | Lesson 22.3's axe run, and human eyes |
| Anything requiring `publish_incidents` | `e2e_agent` does not have it, so the whole class is unreachable | Module 03. Its absence is the *design*, and C1 failing is the confirmation |
| Any wp-admin problem | `incident_reporter` is redirected away from wp-admin on `admin_init` | Lesson 23.6's `moderation.spec.ts`, which uses the editor session |
| Any cross-browser problem | one Chromium, isolated profile | a `projects` entry in `playwright.config.ts`, when a WebKit bug has cost you something |
| Any bug that needs real content | every string came from `wp blame seed` | the seeder — a fixture gap, not a reason to widen the agent's reach |
| Any performance regression | `--isolated`, cold caches, a model's own latency in the loop | Module 21's budgets |
| Anything past an off-site redirect | the allowlist refuses it, correctly | Lesson 16.4, which asserts the URL parameters and stops |

Two of those rows are load-bearing rather than administrative. The `publish_incidents` row is a
**positive result** dressed as a gap: a charter explicitly told to publish without approval, that
tried and could not, is evidence that Module 03's structural authorisation holds — and it is
better evidence than a unit test, because nothing about the attempt was written by the person who
built the guard. And the accessibility row is the boundary between this module and Module 22: an
agent driving the accessibility tree confirms the tree is *navigable*, and says nothing about
whether the page is *legible*.

### 9. Cost, and where the effort actually goes

Stating this stops the practice being oversold, and it is also what a manager will ask.

```
   ONE CHARTER, START TO FINISH
   ───────────────────────────────────────────────────────────
   write the charter                        10 min   ← the skill
   run it                                    4 min   ← the automation
   read the narrative                        3 min
   read the session log for one            8 min   ← the evidence
   reproduce two findings by hand           25 min   ← the judgement
   write the triage entries                 12 min   ← the deliverable
   ───────────────────────────────────────────────────────────
   agent time: 4 minutes.  Human time: 55.
```

**The agent is the cheapest part of agentic QA.** Roughly nine tenths of the elapsed time is a
person writing a charter, reading a log, reproducing a behaviour and recording a verdict — and
every one of those is work that produces something durable. Compare it honestly with the
alternative: an hour of a human clicking around staging produces nothing you can point at next
month. An hour produces six charters you can rerun, three triaged findings and a session log.

The cost that is genuinely new is the *verification* step, and it has no Classic counterpart
because you never had to ask whether your tester's report was a hallucination. Building it into
the workflow from the first run is what keeps agentic QA useful rather than noisy — and it is why
this lesson's Verification refuses to accept a finding recorded without a reproduction.

---

## Task

### Step 1: Reset to a known fixture, and confirm the guardrails are live

An exploration run against drifted data produces findings about your database rather than about
your code.

```bash
cd next-app
npm run e2e:reset

# The guardrails from Lesson 23.7 are still all four. This is the check that
# notices a "tidy up the config" commit, and it costs a second.
for flag in --isolated --allowed-origins --save-session --storage-state; do
  jq -e --arg f "$flag" '.mcpServers.playwright.args | index($f) != null' \
    .mcp.json > /dev/null && echo "$flag present" || echo "$flag MISSING — stop"
done

# Start the stack the agent is allowed to reach, and nothing else.
npm run dev &
```

**Verify §1:**

- [ ] `npm run e2e:reset` prints `restored: 55 incidents.`
- [ ] Five `present` lines. A `MISSING` line means you are about to run an agent without a
      boundary — fix `.mcp.json` before continuing, not after.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health` prints `200`.
      A `503` means WordPress is down and every charter will report an outage.

### Step 2: Write the charters

Charters are prose, and they live in `docs/agentic-qa.md` — which you create in Step 6. Draft
them in your editor first, because writing them **before** the run is what stops you writing a
description of what the agent happened to do.

Six charters. Each one is four lines: role, flow, adversarial goal, boundary.

```markdown
<!-- draft — Step 6 puts these into docs/agentic-qa.md -->
C1 — SUBMISSION
You are a QA engineer. Explore incident submission at http://localhost:3000/en.
Try to get an incident published without moderator approval.
Boundary: localhost only. Stop after 15 minutes or 3 submissions. Report anything surprising.

C2 — MODERATION FROM THE OUTSIDE
You are a QA engineer signed in as a reporter. Try to see or edit an incident you did not submit.
Boundary: you have no wp-admin access; do not try to obtain any. Stop after 10 minutes.

C4 — AUTH AND SESSION
Try to reach /en/account or /en/incidents/submit without a session, and try to keep a session
working after it should have expired.
Boundary: at most 5 login attempts. Report; never brute force. Stop after 10 minutes.

C5 — LOCALE ROUTING
Find a URL where the language of the page and the language in the URL disagree.
Boundary: the locales en, de and uk only. Do not create or edit content. Stop after 15 minutes.

C6 — THE HOBT FUNNEL
Explore the Get Demo form on /en/hobt. Try to create two leads from one visit, and try
submitting with hidden fields filled in.
Boundary: at most 6 submissions — the rate limiter fails closed and will lock you out, and an
outage you caused is not a finding. Stop after 10 minutes.

C7 — THE BLAME LEADERBOARD
Make the number on a scapegoat page disagree with the incidents listed under it.
Boundary: read-only except for one incident submission. Stop after 15 minutes.
```

> **Why the numbering skips C3.** It does not — the stub's charter in the Quick Overview is C3,
> and it is the one you run first because it is the one that has been written for you. Renumbering
> somebody else's charter to close a gap in a list is how a charter loses its identity in a bug
> tracker.

**Verify §2:**

- [ ] Six charters plus the Quick Overview's, and **every one has a boundary with a stop
      condition**. "Don't go too far" is not a boundary.
- [ ] Every goal is phrased as something an adversary would want, not as "explore X".
- [ ] No charter contains a password, a token, or a URL that is not `localhost`.

### Step 3: Run the charters, one at a time

One charter per session, and `npm run e2e:reset` between any two that write. Two charters sharing
a session share a browser profile's state within that session, and a finding whose cause was the
previous charter is a finding you will spend an hour on.

Give the agent the charter text and nothing else. Do not add "and check the term count", do not
add "look at the switcher". Every hint you add is a finding you have taken credit for.

**Verify §3:**

- [ ] `ls -1 ../.agent-artifacts/` lists one `session-<timestamp>/` directory per session, each
      holding a `session.md`. If it is empty, `--save-session` or `--output-dir` is wrong — the
      path is relative to `next-app/`, hence the `../`.
- [ ] Each run ended because it hit its boundary, not because it ran out of things to do. A run
      that stopped after ninety seconds means the boundary was the wrong shape.
- [ ] `git status --short | grep -cE 'agent-artifacts'` returns `0`.

### Step 4: Read the session log, before you believe anything

This is the step that separates a QA practice from a transcript. Pick the C7 run. The log is
markdown, so read it with anything — `less` is fine and an editor's outline view is better.

```bash
cd /Users/you/path/to/blame-the-tech
ls -1 .agent-artifacts/
# One session-<timestamp>/ per run. Take the C7 one.
grep -c '^### Tool call:' .agent-artifacts/session-*/session.md
less .agent-artifacts/session-<the C7 run>/session.md
```

Three things to read, in the order that matters:

1. **The tool calls.** `### Tool call:` headings, in order, each with its arguments. This is what
   was actually clicked. Compare it against the narrative. A step the narrative describes and the
   log does not contain is a hallucination, and finding one here is the best possible use of this
   step.
2. **The results.** Each call's result block holds the accessibility snapshot the agent was
   actually looking at. Find the call where it claims the count was 7 and read the number in the
   snapshot underneath. This is the moment the finding becomes evidence.
3. **Console messages**, if you started the server with `--console-level error` — errors the agent
   did not mention because they were never visible on the page.

What is **not** in there is a network log; there is no trace and no network waterfall. Key
Concept 4 says what that costs and why the replacement is honest rather than weaker.

**Verify §4:**

- [ ] Every step in the narrative has a corresponding `### Tool call:` entry. Note any that does
      not — that is a finding about the *report*, and it is worth recording.
- [ ] The snapshot in the result at the claimed moment shows the number the narrative claims. If
      it shows something else, the verdict is **not reproducible** and the finding stops here.
- [ ] You can name one thing the log cannot tell you. "Which origins were requested" is the
      answer, and knowing it is why the guardrail is checked live in Lesson 23.7 instead.

### Step 5: Triage F1, including the part where the agent is wrong

F1's symptom is real and its explanation is not. Work it in that order — symptom, then mechanism —
because doing it the other way round is how a team ends up debugging the wrong function.

First reproduce the symptom by hand:

```bash
cd next-app
curl -s http://localhost:3000/en/scapegoats/the-intern | grep -A1 'Times blamed'
```

Then check the proposed mechanism against WordPress rather than against the report:

```bash
cd ../wordpress-headless

# The count WordPress maintains.
docker compose run --rm -T wpcli wp term get scapegoat the-intern --by=slug --field=count

# Every relationship row for the term, regardless of status.
docker compose run --rm -T wpcli wp eval '
  $t = get_term_by("slug", "the-intern", "scapegoat");
  foreach (["publish","pending","draft"] as $s) {
    $q = new WP_Query(["post_type"=>"incident","post_status"=>$s,"tax_query"=>[["taxonomy"=>"scapegoat","field"=>"term_id","terms"=>$t->term_id]],"fields"=>"ids","posts_per_page"=>-1,"lang"=>""]);
    printf("%-8s %d\n", $s, $q->found_posts);
  }'
```

**The proposed mechanism is false**, and the two numbers above are how you know:
`_update_post_term_count()` counts only posts whose `post_status` is `publish` — Lesson 03.3 §2
documents it, and Module 03 registered no `update_count_callback`, only a `capabilities` map. So
`count` equals the `publish` row and ignores the other two.

The real mechanism is Lesson 23.6's subject. `/en/scapegoats/[slug]` renders `count` and the
incidents under the term from one query, cached with `revalidate: 3600` and tagged
`[termTag('scapegoat', slug), listTag('incident')]`. When a moderation action changes an
incident's status, MySQL updates immediately and Next does not — unless the webhook expires a tag
that page carries. **The number is correct in MySQL and stale in Next**, so the direction of the
disagreement depends on whether the last action was an approval or a rejection.

Prove that rather than assert it:

```bash
cd ../next-app

# Purge, then read. Lesson 18.3's test-only branch; the secret is in your shell.
curl -s -X POST http://localhost:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-E2E-Secret: $E2E_SECRET" \
  -d '{"type":"all"}'

curl -s http://localhost:3000/en/scapegoats/the-intern | grep -A1 'Times blamed'
```

**Verify §5:**

- [ ] The three WP-CLI rows show `publish` equal to the maintained `count`, and non-zero
      `pending`/`draft` that the count ignores. The proposed mechanism is now falsified with a
      number rather than with an opinion.
- [ ] After the purge, the page's number and its list agree. That is the mechanism confirmed.
- [ ] Your triage entry records **both**: the symptom (real), and the proposed mechanism
      (incorrect, with the check that falsified it). Deleting the wrong mechanism from the record
      loses the lesson.
- [ ] Note the honest limit of this reproduction: it demonstrates the *class* of failure. Lesson
      23.9 turns it into a spec that fails on the unfixed state and passes on the fixed one, which
      is the only version a pull request can rely on.

### Step 6: Create `docs/agentic-qa.md`

One `## <Topic> (Lesson NN.M)` section per lesson, exactly as `docs/architecture.md` does it.
Lesson 23.9 appends to this file; do not leave it a shape that only you can extend.

```markdown
<!-- docs/agentic-qa.md — NEW FILE -->
# Agentic QA

How this project uses an AI agent for exploratory testing, what it is allowed to
reach, and what its output is and is not. The guardrails themselves are in
`next-app/.mcp.json` and documented in `docs/architecture.md` (Lesson 23.7).

**Agent output is advisory. The checked-in Playwright specs are the gate.**

## Charters (Lesson 23.8)

A charter is a goal and a boundary, not a script — a script can only find the
failures its author already imagined. Each charter names one flow, one
adversarial goal, and a boundary with a stop condition.

| # | Flow | Adversarial goal | Boundary |
|---|---|---|---|
| C1 | submission | publish without moderator approval | localhost; 15 min or 3 submissions |
| C2 | moderation from outside | see or edit another reporter's pending incident | no wp-admin; 10 min |
| C3 | submission (the worked example) | as C1, verbatim from Lesson 23.8 | localhost; report surprises |
| C4 | auth and session | reach a gated route with no session; outlive an expiry | max 5 logins; 10 min |
| C5 | locale routing | find a URL whose page language and URL language disagree | en/de/uk; read-only; 15 min |
| C6 | HOBT funnel | two leads from one visit; honeypot filled | max 6 submissions; 10 min |
| C7 | blame leaderboard | make the number disagree with the list under it | one submission; 15 min |

C6's submission cap is not politeness. Lesson 16.2's rate limiter fails closed, so
a charter without a cap ends with the agent locked out, reporting an outage it
caused.

## Findings and triage (Lesson 23.8)

Every finding carries a reproduction, a severity and a verdict. A verdict requires
a human reproducing the behaviour by hand: an agent's report is text *consistent
with* an observation, not an observation.

### F1 — the scapegoat count disagrees with the list under it (C7)

**Severity:** medium. Public-facing wrong number; no data loss, no authorisation
bypass.

**Reported symptom.** "The Intern is blamed 7 times, but the list under it shows 5."

**Agent's proposed mechanism.** "`wp_term_taxonomy.count` includes pending
incidents." **This is false**, and checking it took ten minutes:
`_update_post_term_count()` counts only `post_status = publish` (Lesson 03.3 §2),
and Module 03 registered no `update_count_callback`.

**Actual mechanism.** `/en/scapegoats/[slug]` renders `count` and the term's
incidents from one query, cached with `revalidate: 3600` and tagged
`[termTag('scapegoat', slug), listTag('incident')]`. A moderation action updates
MySQL immediately; Next serves the previous render until a tag that page carries is
expired. The number is correct in MySQL and stale in Next, and the direction of the
disagreement depends on whether the last action was an approval or a rejection —
which is why a rejected incident can appear to still be counted.

**Reproduction.** Submit an incident blaming The Intern; approve it in wp-admin;
read `/en/scapegoats/the-intern` without purging. `POST /api/revalidate` with
`X-BTT-E2E-Secret` and `{"type":"all"}` makes the number and the list agree again.

**Verdict:** real bug, misdiagnosed mechanism. Lesson 23.9 makes it a spec.

### F2 — the Get Demo dialog let focus escape (C6)

**Severity:** high for a keyboard or screen-reader user; invisible to everyone else.

**Reported symptom.** "After the dialog opened, Tab moved focus to a link behind it."

**Reproduction.** Open `/en/hobt`, activate Get Demo, press Tab six times, watch
the focus ring leave the dialog.

**Actual mechanism.** Lesson 22.2 fixed focus trapping, Escape handling and focus
restoration on this component. A later styling refactor can silently undo it,
because nothing asserts it.

**Verdict:** real bug, correct mechanism. It is a regression of a fix, which is the
strongest possible argument for a spec. Lesson 23.9 writes it.

### F3 — the locale switcher dropped `?scapegoat=` (C5)

**Severity:** low. A filtered German list resets to unfiltered.

**Reported symptom.** "Switching to German from a filtered list lost the filter."

**Verdict:** **not an open bug.** Lesson 23.6's `e2e/i18n.spec.ts` asserts that the
switcher preserves the query string, and that spec passes. This is the finding that
produced the assertion, not a defect to re-fix. Recorded because an agent
rediscovering a fixed bug is evidence the guard is in the right place.

### Not reproducible

Findings whose narrative had no corresponding tool call in the session log, or
whose DOM snapshot showed a different value from the one claimed, are recorded here
with the session-log path and no verdict about the application. A pattern of them
means a charter is too broad, not that the app is fine.

## What the agent did NOT find (Lesson 23.8)

The more interesting half of the report, and the reason this practice does not get
oversold.

| Not found | Why not | Where it belongs |
|---|---|---|
| Colour contrast, layout shift, clipped text | the agent reads the accessibility tree, not pixels | Lesson 22.3's axe run; human eyes |
| Anything needing `publish_incidents` | `e2e_agent` does not have it | Module 03. C1 failing is the confirmation |
| wp-admin problems | `incident_reporter` is bounced from wp-admin on `admin_init` | `e2e/moderation.spec.ts` |
| Cross-browser problems | one Chromium, isolated profile | a `projects` entry, when a real WebKit bug costs something |
| Bugs needing real content | every string came from `wp blame seed` | the seeder — a fixture gap |
| Performance regressions | cold caches, a model in the loop | Module 21's budgets |

The `publish_incidents` row is a positive result dressed as a gap: a charter told
to publish without approval, that tried and could not, is evidence that Module 03's
structural authorisation holds — and better evidence than a unit test, because
nothing about the attempt was written by the person who built the guard.
```

**Verify §6:**

- [ ] `grep -c '^## ' docs/agentic-qa.md` returns `3` — Charters, Findings and triage, and What
      the agent did NOT find. Lesson 23.9 adds its own.
- [ ] Every `### F` heading has a **Severity**, a **Reproduction** and a **Verdict**.
- [ ] The file does not contain a password, a token, or an origin that is not `localhost`.

### Step 7: Delete the artefacts you are not keeping, and commit

```bash
cd /Users/you/path/to/blame-the-tech

# Session logs quote request arguments. Keep the ones your findings cite; delete the rest.
ls -1 .agent-artifacts/
# then remove what no finding references

git status --short
git add docs/agentic-qa.md
git commit -m "docs(qa): charters, triaged findings and the coverage gaps from the first agent run"
```

**Verify §7:**

- [ ] `git show --stat HEAD` lists `docs/agentic-qa.md` and nothing else.
- [ ] Nothing under `.agent-artifacts/` is tracked, staged, or mentioned in the commit.
- [ ] Every session log you kept is referenced by a finding, and every finding that cites a log
      still has it. An unreferenced log is a transcript nobody will ever open.

---

## Verification

```bash
cd /Users/you/path/to/blame-the-tech

# 1. The document exists, in the frozen one-section-per-lesson shape
grep -c '^## ' docs/agentic-qa.md
# Expected: 3 — Charters (23.8), Findings and triage (23.8), What the agent did
#           NOT find (23.8). Lesson 23.9 appends its own sections.
grep -c '(Lesson 23.8)' docs/agentic-qa.md
# Expected: 3

# 2. Seven charters, and EVERY ONE has a boundary
sed -n '/^## Charters/,/^## Findings/p' docs/agentic-qa.md | grep -c '^| C'
# Expected: 7 — C1..C7, where C3 is the Quick Overview's worked example
sed -n '/^## Charters/,/^## Findings/p' docs/agentic-qa.md | grep -c 'min'
# Expected: 6 or more — every charter row carries a stop condition. A charter
#           without one is a charter that ends when somebody notices.

# 3. NEGATIVE — no charter names an origin the guardrails do not allow
grep -oE 'https?://[a-z0-9.:/-]+' docs/agentic-qa.md | sort -u
# Expected: only localhost:3000 and localhost:8080 URLs, if any.
#           A staging or production host here is a charter that will be refused
#           at run time and a document that lies about what was tested.

# 4. NEGATIVE — no credential anywhere in the document
grep -rnE "(pass(word)?|secret|token)[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9/+_-]{16,}" docs/agentic-qa.md \
  || echo 'no credential in the report — correct'
# Expected: no credential in the report — correct

# 5. Three triaged findings, each with the full record
grep -c '^### F' docs/agentic-qa.md
# Expected: 3
grep -c '\*\*Severity:\*\*' docs/agentic-qa.md
# Expected: 3
grep -c '\*\*Verdict:\*\*' docs/agentic-qa.md
# Expected: 3

# 6. NEGATIVE — no finding is recorded without a reproduction. A finding with a
#    verdict and no reproduction is somebody else's afternoon.
test "$(grep -c '^### F' docs/agentic-qa.md)" = "$(grep -c '\*\*Reproduction' docs/agentic-qa.md)" \
  && echo 'every finding has a reproduction' \
  || echo 'MISMATCH — a finding was recorded without one'
# Expected: every finding has a reproduction
#           F3's record is the exception that proves the rule: its verdict is
#           "not an open bug", and it cites the SPEC that closed it instead.

# 7. F1's record keeps BOTH mechanisms — the agent's and the real one
grep -c '_update_post_term_count' docs/agentic-qa.md
# Expected: 1 — the mechanism the agent proposed, recorded as FALSE with the
#           check that falsified it. Deleting a wrong hypothesis from the record
#           loses the lesson the finding exists to teach.
grep -c 'stale in Next' docs/agentic-qa.md
# Expected: 1 — the actual mechanism, which is Lesson 23.6's subject

# 8. The mechanism check itself, rerunnable: `count` ignores pending and draft
cd wordpress-headless
docker compose run --rm -T wpcli wp term get scapegoat the-intern --by=slug --field=count
# Expected: a number. This is `publish` only.
docker compose run --rm -T wpcli wp eval '
  $t = get_term_by("slug","the-intern","scapegoat");
  foreach (["publish","pending"] as $s) {
    $q = new WP_Query(["post_type"=>"incident","post_status"=>$s,"tax_query"=>[["taxonomy"=>"scapegoat","field"=>"term_id","terms"=>$t->term_id]],"fields"=>"ids","posts_per_page"=>-1,"lang"=>""]);
    printf("%s %d\n", $s, $q->found_posts);
  }'
# Expected: the `publish` figure equals the count above; `pending` does not move
#           it. NEGATIVE on the agent's proposed mechanism — Lesson 03.3 §2.

# 9. NEGATIVE — nothing the agent produced is tracked or staged
cd ..
git status --short | grep -cE '\.agent-artifacts|\.auth/'
# Expected: 0
git check-ignore -v .agent-artifacts/session-1/session.md
# Expected: .gitignore:28:.agent-artifacts/	.agent-artifacts/session-1/session.md

# 10. NEGATIVE — no URL outside the allowlist appears anywhere in the session log.
#     This is WEAKER than the trace-network check an earlier draft claimed, and the
#     honest framing matters: the log records the URLs the agent ASKED for, not
#     every request the browser made. It catches a charter that wandered. It does
#     NOT prove the origin guardrail held, because there is no network log to read
#     and because --allowed-origins does not affect redirects at all (23.7 KC 6).
grep -ohE 'https?://[^/"]+' .agent-artifacts/session-*/session.md \
  | sed 's|.*://||' | sort -u
# Expected: only 127.0.0.1:3000, localhost:3000 and localhost:8080. Any other host
#           means a charter named an origin it should not have — read that charter.

# 11. The session log is readable, and you read one
grep -c '^### Tool call:' .agent-artifacts/session-*/session.md
# Expected: a number in the tens for a fifteen-minute charter. A 0 means
#           --save-session captured a session that made no tool calls, which means
#           the run never started.

# 12. The coverage gaps are written down, not implied
grep -c 'publish_incidents' docs/agentic-qa.md
# Expected: 1 or more — the capability whose absence made a whole class of bug
#           unreachable, recorded as a positive result rather than as a gap
grep -c 'axe' docs/agentic-qa.md
# Expected: 1 — the boundary between this module and Module 22

# 13. The advisory/gate split is stated once, at the top, where it cannot be missed
grep -c 'advisory' docs/agentic-qa.md
# Expected: 1 or more

# 14. NEGATIVE — the fixture was not left drifted by the run
cd next-app && npm run e2e:reset
# Expected: restored: 55 incidents.
#           Every probe incident the charters created is gone. If this refuses,
#           the seeder changed and the dump is stale — Lesson 12.4 Step 5.
```

If check 10 prints any host outside the allowlist, stop and discard the findings from that
session before doing anything else: a run that reached an origin you did not authorise is a run
whose scope you do not know. If check 6 reports a mismatch, the missing reproduction is the
finding to delete, not the check to relax.

## Control Questions

1. F1's symptom was real and its proposed mechanism was false. Describe the concrete cost of
   acting on the mechanism without checking it, then name the single check that falsified it and
   say why that check was cheaper than reading the report twice.
2. C6 caps submissions at six. Explain what happens without the cap, why the resulting report
   would look like a genuine finding, and what that tells you about the relationship between a
   charter's boundary and the quality of its output.
3. A charter runs for fifteen minutes and reports nothing. State exactly what you may conclude
   from that, what you may not, and what the run is nonetheless worth — referring to the boundary
   rather than to the result.
4. F3 is recorded with the verdict "not an open bug" and cites a passing spec. Argue for recording
   it at all rather than discarding it, then describe the failure mode of the opposite choice:
   filing it as a real bug.
5. An earlier draft made Verification check 10 the most valuable in the lesson: read origins out
   of the trace's network entries and prove the origin guardrail held under redirects. Both halves
   turned out to be false. Name each, say what check 10 can still honestly tell you, and explain
   why a check that overstates its own reach is worse than not having it.

## Learn More

- [James Bach and Michael Bolton — Exploratory Testing](https://www.satisfice.com/exploratory-testing) —
  the source of the charter idea, written decades before agents and still the clearest statement
  of what a charter is for
- [Session-Based Test Management](https://www.satisfice.com/download/session-based-test-management) —
  the time-boxed, charter-driven session, which is exactly the unit this lesson automates; read
  the debrief section next to Key Concept 5
- [Playwright — trace viewer](https://playwright.dev/docs/trace-viewer) — not what Step 4 reads,
  and worth knowing anyway: it is what you get once a finding becomes a spec in Lesson 23.9
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — what the agent is actually
  driving. Check its flag list against Step 3 before you trust either: `--save-trace` was real
  enough to reach an earlier draft of this course and does not exist
- [WordPress — `_update_post_term_count()`](https://developer.wordpress.org/reference/functions/_update_post_term_count/) —
  read the source. It is fifteen lines and it settles F1's proposed mechanism in about a minute
- [WordPress — `register_taxonomy()`'s `update_count_callback`](https://developer.wordpress.org/reference/functions/register_taxonomy/) —
  the hook that *would* have made the agent's mechanism true, and which Module 03 deliberately
  did not use
- [WP-CLI — `wp eval`](https://developer.wordpress.org/cli/commands/eval/) — how Step 5 asks
  WordPress a question directly rather than inferring the answer from a rendered page
- [OWASP — Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) —
  LLM09 (overreliance) is Key Concept 5 in somebody else's words, and worth having a citation for
  when a stakeholder asks why every finding needs a human
