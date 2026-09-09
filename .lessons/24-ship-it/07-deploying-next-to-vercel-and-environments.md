---
title: 'Deploying Next.js to Vercel & Environments'
module: 24
lesson: 7
teaches: [vercel-deployments, preview-per-pr, artifact-promotion, env-scoping, prod-smoke-tests, automated-rollback, runbook]
produces: ['next-app/vercel.json', '.github/workflows/deploy-web.yml', 'docs/runbook.md']
requires: [24.6, 24.5]
---

# Lesson 24.7 — Deploying Next.js to Vercel & Environments

## Quick Overview

Vercel gives you a deployment per pull request for free, and used properly it changes how review
works: a reviewer opens a URL running the branch's code, against **staging WordPress**, and reads
the page instead of imagining it. Lighthouse CI and axe from Lesson 24.4 run against that same
preview URL, which is why the preview must point at staging content — a preview pointed at
production would put mutating E2E tests and an exploratory agent next to real user data.

The promotion model is the part worth getting right. **You do not rebuild for production.** You
promote the exact artifact that already passed E2E, Lighthouse and axe on the preview, because a
rebuild is a new artifact and everything you verified was about the old one. Environment scoping
makes that safe: Preview and Production hold **different** `WP_GRAPHQL_ENDPOINT` and
**different** `WP_APP_TOKEN`, per
[appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target), so a preview
deployment structurally cannot write to production WordPress even if a test tries.

Then the operational surface. A production smoke test after every promotion — **read-only,
never mutating production** — checking that the home page renders, an incident detail resolves,
the sitemap is XML and `/api/health` is honest. A rollback you have actually run once, before you
need it: `vercel promote` for the front end, `flyctl deploy --image <previous-sha>` for
WordPress, in that order, because the front end is the user-visible tier. And `docs/runbook.md`,
written for someone who is not you, at 3am, with no context.

By the end of this lesson you will have:

- Preview deployments per pull request, pointed at staging WordPress, with the preview URL posted
  on the pull request
- `vercel.json` and project settings under review, with the Node version and regions chosen deliberately
- Environment variables scoped across Development, Preview and Production, with the sensitive flag
  set and **different** endpoint and app-token values per environment
- `.github/workflows/deploy-web.yml` — environment-protected, promoting the already-verified
  artifact rather than rebuilding, with the domain and DNS configured
- A read-only production smoke-test job that runs after promotion and alerts rather than mutating
- A rehearsed, timed rollback for both tiers, and `docs/runbook.md` — deploy, roll back, rotate a
  secret, purge the cache, read the logs, and who to escalate to

## Classic WP Analogy

| Classic WordPress | Vercel |
|---|---|
| One staging subdomain, shared, always stale | A deployment per pull request, per branch, disposable |
| "I'll push to staging so you can look" | The reviewer opens the preview URL from the PR |
| Deploy = FTP the same files again | Promote a build that already passed every gate |
| `wp-config.php` branching on `$_SERVER['HTTP_HOST']` | Environment-scoped variables per target |
| Roll back by re-uploading yesterday's folder | `vercel promote` to a previous deployment |
| Smoke test = load the homepage in a browser | A read-only smoke-test job with real assertions |
| The deploy steps live in one person's head | `docs/runbook.md`, in git, reviewed |

The **preview-per-pull-request** row is the genuine upgrade and it is worth naming why. A single
shared staging site is a queue: two developers cannot test conflicting changes at once, someone
overwrites someone else, and it drifts from production because nobody re-seeds it. A deployment
per branch removes the contention entirely, which changes reviewer behaviour — people look at
things they would not have bothered to check out and run locally.

Two places the analogy breaks, and both are practical.

**Environment parity is now partial by design.** Your Classic staging site was a copy of
production: same PHP, same plugins, ideally a sanitised database copy. A Vercel preview runs your
front-end code against **staging WordPress**, so the front end is production-identical and the
content is not. That is the right trade — you must never point mutating tests or an exploratory
agent at production data — but it means content-shaped bugs (a page with an unusual block
combination, a 4000-word incident, a missing translation) will not appear in preview unless your
staging content covers them. Keeping staging seeded from the Module 12 seeder rather than letting
it rot is what makes previews trustworthy.

**Promotion is not deployment, and confusing them is how a verified artifact stops being
verified.** In the FTP model there was only one operation: upload. Here, "deploy to production"
should mean "make the build that already passed live", and it is very easy to configure a
production job that runs `next build` again — new dependency resolution, new build ID, possibly a
different Node patch version. It will almost always be identical. When it is not, you find out in
production, and none of your green checks were about the thing that shipped.

---

## Key Concepts

### 1. Promotion is not deployment, and this is the lesson

There are two operations that both look like "ship it", and confusing them is how a verified
artifact quietly stops being verified.

| | Build | Promote |
|---|---|---|
| Input | a commit | **a deployment that already exists** |
| Output | a new immutable artifact with a new build ID | an alias moved to point at that artifact |
| Duration | minutes | seconds |
| What your green checks were about | this artifact | **this artifact** |
| Risk | a new artifact nothing tested | none — the bytes do not change |

Every gate in [Lesson 24.5](05-quality-gates-and-branch-protection.md) ran against the preview
deployment: Playwright drove it, Lighthouse CI measured it, axe scanned it. Run `next build`
again for production and you have produced **a different artifact** — new dependency resolution
within your semver ranges, a new build ID, possibly a different Node patch on a different runner —
and every one of those green ticks was about the old one.

It will almost always be identical. That is exactly the problem: a discrepancy that appears once
every three hundred deploys is a discrepancy you will not be looking for, and you find out about
it in production, from a user, with no failing check anywhere to point at.

```
   REBUILD FOR PRODUCTION                 PROMOTE
   ──────────────────────                 ───────
   commit → build A → tested  ✅          commit → build A → tested  ✅
   commit → build B → SHIPPED ❓                            → SHIPPED ✅
            (never tested)                          alias moves. same bytes.
```

In the FTP model there was **only one operation** — upload — so this distinction has no Classic
analogue at all, and nothing in your instincts warns you. The configuration mistake is easy and
looks completely reasonable: a production job that checks out `main` and runs `next build`.

### 2. What a Vercel deployment actually is

A deployment is an immutable, permanently addressable artifact with its own URL. Production is
not a deployment; production is a **domain alias** pointing at one.

```
   deployment  dpl_7fA…   ← the artifact. Immutable. Never changes. Never deleted.
       ▲            ▲
       │            └── https://btt-git-fix-nav-acme.vercel.app   (branch alias)
       │
   blamethe.tech ────────┘   the PRODUCTION alias — one atomic pointer
```

Three consequences that shape everything else in this lesson. **Rollback is moving the alias
back**, which is why it takes seconds and cannot half-succeed. **The preview URL a reviewer opens
is the same artifact that will be promoted**, which is what makes reviewing a URL meaningful
rather than theatre. And **environment variables are read at build time for anything inlined and
at run time for everything else** — so a variable a bundle inlined is baked into the artifact and
promoting does not change it. That last one is the sharp edge in Key Concept 3.

### 3. Environment scoping is a structural property, not a policy

Vercel scopes every environment variable to Development, Preview and Production. Per
[appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target), Preview and
Production hold **different** `WP_GRAPHQL_ENDPOINT` and **different** `WP_APP_TOKEN`.

Read what that buys you carefully, because it is stronger than a rule:

| | A policy | A structural property |
|---|---|---|
| "Do not point tests at production" | someone must remember | — |
| Preview holds a staging endpoint and a staging app token | — | a preview deployment **cannot** write to production WordPress. The endpoint is a different host and the token would not verify against it |

A mutating E2E test that somehow ran against a preview deployment does not damage production
data; it damages staging data, which is regenerated from the Module 12 seeder. That is not
discipline holding, it is the topology making the bad outcome unreachable — and it is the same
argument [Lesson 23.7](../23-testing-deep-dive-and-agentic-qa/07-agentic-qa-guardrails-and-setup.md)
spent a whole lesson on for the exploratory agent.

Two operational details that bite:

- **Mark the secret ones Sensitive.** A Sensitive variable is write-only in the dashboard: nobody,
  including you, can read it back. The cost is real — you cannot check a value, you can only
  replace it — and the benefit is that a screenshare or a compromised dashboard session does not
  leak a token.
- **A variable change is not retroactive.** Anything inlined at build time is inside the existing
  artifact. Change `NEXT_PUBLIC_SITE_URL` and every already-built deployment keeps the old value
  until it is rebuilt. Which means: **rotating a build-time variable requires a rebuild, and
  rotating a run-time one does not.** Write down which of yours is which before you need to know.

### 4. Why the preview must point at staging

The temptation is real: production content makes a preview look like the real site, and reviewers
see real data. Do not.

| Preview points at | What happens when a mutating spec runs |
|---|---|
| Production WordPress | a test incident in your real moderation queue, a test lead in `wp_btt_leads`, a real notification email |
| **Staging WordPress** | staging data changes, and `wp blame fixture load` puts it back in seconds |

[Lesson 24.4](04-ci-with-github-actions.md) wires Lighthouse CI and axe to run against the
preview URL, and Module 23's specs mutate. An exploratory agent is worse still: it has no
knowledge of business intent, and its whole job is to try things nobody planned for. Pointing any
of that at production data is not a risk you manage, it is a risk you decline.

### 5. Environment parity is now partial, by design

Your Classic staging site was a copy: same PHP, same plugins, ideally a sanitised database dump. A
Vercel preview is not that shape at all.

```
   PRODUCTION                             PREVIEW
   ──────────                             ───────
   front end: this artifact               front end: THE SAME artifact  ✅ identical
   Node runtime, region, CDN: prod        Node runtime, region: identical  ✅
   content:   real, 6 years of it         content:   the Module 12 seeder  ❌ different
   secrets:   production                  secrets:   staging               ✅ on purpose
```

The front end is production-identical and **the content is not**, and that trade is correct. But
be honest about the consequence: **content-shaped bugs do not appear in preview unless staging
content covers them.** A page with an unusual block combination. A 4,000-word incident that pushes
the layout. A `de` translation somebody never filled in. A scapegoat term with 900 posts. None of
those are in the fixture unless somebody put them there.

Which makes fixture freshness a deployment concern rather than a testing concern. **Keeping
staging seeded from the Module 12 seeder rather than letting it rot is what makes previews
trustworthy**, and [Lesson 12.4](../12-your-first-tests/04-deterministic-test-data.md)'s
digest is the mechanism that tells you it has rotted: `wp blame fixture status` recomputes the
digest from the seeder code on disk, and comparing it with the digest in the dump's first line
tells you whether the state you are reviewing against is the state the code produces. A dump whose
digest does not match its seeder is a staging site nobody can reason about.

The corrective, when a content-shaped bug does reach production: **add it to the seeder**, not to
a manual checklist. That is the loop that makes preview coverage grow instead of decay.

### 6. `vercel.json` is deliberately small, and what is not in it matters more

Almost everything Vercel can be told is better told somewhere else in this repository, because
`next.config.ts` is reviewed by TypeScript and by every developer, and it works locally.

| Concern | Where it lives here | Why not `vercel.json` |
|---|---|---|
| Security headers | `next.config.ts` `async headers()` — 18.4, extended by 24.2 | two sources of headers is a debugging afternoon; `vercel.json` wins silently in production only |
| Redirects | `next.config.ts` `async redirects()` — 19.4 | the same, and 19.4's are tested locally |
| `trailingSlash` | `next.config.ts` — 19.4 | a mismatch between the two produces a redirect loop |
| Rewrites for i18n | `proxy.ts` + next-intl — 9.5, 20.3 | `config.matcher` is frozen for a reason (15.5 §4) |
| **Regions** | `vercel.json` | there is nowhere else. This is a platform fact |
| **Whether `main` deploys itself** | `vercel.json` | and it is the key that enforces Key Concept 1 |

`"git": { "deploymentEnabled": { "main": false } }` is the small line doing the large job. Left at
its default, Vercel deploys `main` itself, on push, **by building it** — which is precisely the
rebuild this lesson exists to prevent, arriving as a platform default rather than as a mistake
anybody made. With it set to `false`, the only route to production is the promote step.

**Regions, and the arithmetic.** Your Server Components fetch from WordPress on Fly.io, so the
distance from the function region to the origin is on the critical path of every uncached render:

| Function region | WordPress in `ams` | Two sequential GraphQL round trips add |
|---|---|---|
| `fra1` (Frankfurt) | ~10 ms RTT | ~20 ms |
| `arn1` (Stockholm) | ~30 ms RTT | ~60 ms |
| `iad1` (Washington, the common default) | ~90 ms RTT | **~180 ms** |

That is 180 ms of TTFB bought for nothing, on a route with a 2500 ms LCP budget
([Lesson 21.4](../21-core-web-vitals-and-performance/04-performance-budgets-and-guardrails.md)) —
7% of the whole budget spent on the Atlantic. Static and ISR responses are served from the edge
regardless and never pay it; the cost lands on cold renders, on-demand revalidation and every
Server Action, which are exactly the slow paths users notice. A defaulted region is a decision
somebody did not make.

### 7. The production smoke test is read-only, and that is not a preference

A smoke test after promotion answers one question: is the thing that is now live actually
serving? Five `GET` requests answer it.

| Assert | Proves |
|---|---|
| `/en` renders and contains a `<main>` | the root layout, the app shell, i18n loaded |
| `/en/incidents/incident-01` contains an `<h1>` | a dynamic route resolved against real WordPress |
| `/sitemap.xml` is XML | `app/sitemap.ts` (19.4, 20.4) executed, and did not 500 into an HTML error page |
| `/api/health` returns 200 with `status: "ok"` | Next can reach WordPress from the production region |
| `/robots.txt` names the sitemap | `app/robots.ts` used the production `metadataBase`, not localhost |

**Nothing in that list writes.** A smoke test that submits a form to prove the form works creates
a row in `wp_btt_leads` on every deploy, sends a real notification email, and pollutes the data
your analytics and your moderation queue are built on. Mutating flows are verified against the
preview, where the data is disposable — that is the *point* of Key Concept 3 — and production gets
reads only.

The honest gap: this does not prove `createIncident` works in production. Nothing safely can. What
covers it is that the mutation path is identical code exercised against staging by the same
artifact, plus error-rate alerting from [Lesson 24.3](03-observability-logging-and-error-tracking.md).
That is a smaller guarantee than "we tested it in production", and it is the one you can have.

### 8. Rollback: both tiers, in that order, rehearsed and timed

Two commands, and the order is not arbitrary.

```
   1. vercel promote <previous-deployment>        ← the tier users see
   2. flyctl deploy --image …btt-wp:<previous-sha>  ← the tier users do not
```

The front end goes first because it is the user-visible tier: it is where the broken page is, and
it is the faster of the two. WordPress second, and often not at all — a front-end bug needs no
WordPress rollback, and rolling both back by reflex doubles the change you are making during an
incident.

**And rehearse it, on a normal Tuesday, with a stopwatch.** A rollback procedure nobody has run is
a hypothesis. The things you discover on the rehearsal, not during the incident: the CLI needs a
token you do not have in your shell, `vercel promote` takes a deployment URL and you do not know
where to find a previous one, the Fly deploy needs the previous SHA and your only record of it is
a workflow log you have to page through. Write the measured number into `docs/runbook.md`, because
"about a minute" and "about fifteen minutes" lead to completely different decisions at 3am.

**What does not roll back**, and this is the list to have read before you need it:

| Not reversible by a rollback | Why |
|---|---|
| `wp core update-db` | forward-only. [Lesson 24.6](06-building-and-deploying-wordpress.md) Key Concept 6 |
| A build-time environment variable | it is inside the artifact you are rolling *away from* as well |
| Content edited in wp-admin since the deploy | the database moved on |
| A cache tag you already invalidated | `revalidateTag` has no inverse; the next request re-fetches |
| An email that was sent | — |

### 9. A runbook is written for a stranger, at 3am, with no context

`docs/runbook.md` was created by [Lesson 15.2](../15-authentication-and-sessions/02-wpgraphql-jwt-authentication.md)
for JWT secret rotation and appended to by 16.3, 17.2 and 18.4. You extend it. The test of every
entry is the same: **could somebody who has never seen this codebase execute it, at 3am, without
asking you?**

That test rules out a surprising amount of normal documentation. "Deploy as usual" fails it.
"Check the logs" fails it, because the reader does not know there are four log streams. A command
with a placeholder the reader cannot resolve fails it. Each entry needs a symptom, the exact
commands, the expected output, and what to do when the output is different.

**Where each stream actually lands** is the part people get wrong, and there is one trap specific
to this stack:

| Stream | Where | How to read it |
|---|---|---|
| Next.js server, edge, build | Vercel | `vercel logs <deployment>`, or the dashboard |
| Browser errors | Sentry (24.3) | grouped by issue, with the request id |
| PHP warnings and fatals, **in production** | container stderr | `fly logs` — because the production ini sets `error_log=/dev/stderr` |
| PHP warnings and fatals, **locally** | `wp-content/debug.log` | `docker compose exec wordpress tail -f /var/www/html/wp-content/debug.log`. **Not** `docker compose logs` |
| MySQL | the `btt-db` Fly app | `fly logs -a btt-db` |

The trap: `WP_DEBUG_LOG` diverts PHP output **to a file inside the container**. Set it in
production and your errors stop appearing in `fly logs` and start accumulating on an ephemeral
filesystem nobody can reach, which reads exactly like "the errors stopped". Lesson 02.4 noted
this for the dev stack; in production it is the difference between having logs and believing you
have logs.

### 10. What the promotion model costs

Naming the downside, because a model with no stated cost is a brochure.

| Cost | Detail |
|---|---|
| Two steps to ship | merge, then promote. Somebody has to do the second one, or a workflow does |
| A stale artifact can be promoted | the deployment for a three-week-old commit is still promotable, and the CLI will not stop you. The guard is matching the deployment's commit SHA to `main`'s tip before promoting |
| Preview builds cost money and minutes | one build per push per pull request. Path filtering (24.4) is what keeps that bearable |
| Build-time variables need a rebuild to rotate | Key Concept 3. There is no promote-based path to a new value |

None of these outweighs "the thing you tested is the thing that shipped". All of them are worth
knowing before somebody proposes simplifying the pipeline by rebuilding on `main`.

---

## Task

### Step 1: Link the project, and settle what Vercel infers

Vercel guesses well and its guesses are invisible until one of them is wrong. Make them explicit
before you configure anything else.

```bash
cd next-app
npx vercel@39 login
npx vercel@39 link
```

Pin the CLI major. `vercel@latest` in a workflow is the same mistake as `:latest` on an image
([Lesson 24.6](06-building-and-deploying-wordpress.md)): the tool that decides what production
runs would change without a pull request. `39` is the major this lesson was written against;
substitute the one you tested.

Three project settings, in the dashboard, and each is a decision:

| Setting | Value | Consequence of the default |
|---|---|---|
| Root Directory | `next-app` | Vercel builds the repository root, finds no `package.json`, and fails with a message about a missing framework |
| Node.js Version | **22.x** | a runtime that is not the one your `engines.node` and `.nvmrc` name, and a build that succeeds on a Node your tests never ran on |
| Framework Preset | Next.js | no ISR, no route handlers, no Server Actions — a static export of something that is not static |

```bash
# The Node version is already pinned twice in this repository. Confirm both
# agree with the dashboard rather than trusting any one of them.
cat ../.nvmrc
node -p "require('./package.json').engines.node"
```

**Verify §1:**

- [ ] `.vercel/` exists and `git check-ignore -v ../.vercel` names a rule from the root
      `.gitignore`. It holds your project and org ids; it is not a secret, and it is not yours to
      commit either.
- [ ] `.nvmrc` and `engines.node` both say 22, and the dashboard says 22.x. Three places, one
      number — and the reason `deploy-web.yml` reads `node-version-file: .nvmrc` rather than
      hard-coding it.
- [ ] The Root Directory is `next-app`. If a build ever mysteriously cannot find `next`, this is
      the first thing to check.

### Step 2: Write `next-app/vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["fra1"],
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  },
  "github": {
    "silent": true
  }
}
```

Four keys, and the file is short on purpose — Key Concept 6 explains what is deliberately absent.

`"regions": ["fra1"]` is chosen, not defaulted. WordPress runs in Fly's `ams`; Frankfurt is the
nearest Vercel region, so an uncached render pays about 10 ms per GraphQL round trip instead of
about 90 ms from `iad1`. On a route with two sequential fetches that is 20 ms versus 180 ms of
pure latency, against a 2500 ms LCP budget. Static and ISR responses come from the edge and never
pay it; cold renders, on-demand revalidation and every Server Action do.

`"git": { "deploymentEnabled": { "main": false } }` is the line that enforces the whole lesson.
Left at its default, Vercel deploys `main` on push **by building it** — the exact rebuild Key
Concept 1 forbids, arriving as a platform default. With it `false`, the only route to production
is Step 4's promote step.

`"github": { "silent": true }` stops Vercel's own bot commenting; `deploy-web.yml` posts the
preview URL, so two comments would just be noise.

> **What is not in this file, and why.** No `headers` — those are `next.config.ts`'s `async
> headers()` from Lesson 18.4, extended by Lesson 24.2. No `redirects` — Lesson 19.4's, in the
> same file. No `trailingSlash` — Lesson 19.4 set it there. Every one of those would *work* here,
> and each would create a second source of truth that wins **in production only**, which is the
> worst possible place for a configuration disagreement to first become visible.

### Step 3: Scope the environment variables, and prove they differ

Set them from your shell. Nothing here is typed into a file, and `.env.local` is never uploaded.

```bash
cd next-app

# Production points at production WordPress with the production app token.
printf '%s' "https://wp.blamethe.tech/graphql" | npx vercel@39 env add WP_GRAPHQL_ENDPOINT production
printf '%s' "$BTT_APP_TOKEN_PROD"              | npx vercel@39 env add WP_APP_TOKEN production

# Preview points at STAGING WordPress with a STAGING app token. Different host,
# different credential. Key Concept 3 — this is the structural half.
printf '%s' "https://wp-staging.blamethe.tech/graphql" | npx vercel@39 env add WP_GRAPHQL_ENDPOINT preview
printf '%s' "$BTT_APP_TOKEN_STAGING"                   | npx vercel@39 env add WP_APP_TOKEN preview

npx vercel@39 env ls
```

Then mark every credential **Sensitive** in the dashboard. The cost is that you can never read
the value back, only replace it; the benefit is that a screenshare does not leak a token. Applies
to `WP_APP_TOKEN`, `REVALIDATE_SECRET`, `PREVIEW_SHARED_SECRET`, `UPSTASH_*`, `RESEND_API_KEY`,
`TURNSTILE_SECRET_KEY` and `SENTRY_DSN`'s auth token — every row in
[appendix 04 §3.1](../appendix/04-env-reference.md#31-server-only-no-prefix) that is not a URL.

**Verify §3:**

```bash
# Pull both targets to /tmp — never into the repository, even though
# `.env.*` is gitignored — and compare DIGESTS rather than values.
npx vercel@39 env pull /tmp/btt-preview.env --environment=preview --yes
npx vercel@39 env pull /tmp/btt-prod.env    --environment=production --yes

digest() { grep -E "^$2=" "$1" | cut -d= -f2- | tr -d '"' | shasum -a 256 | cut -c1-12; }

echo "endpoint preview: $(grep -E '^WP_GRAPHQL_ENDPOINT=' /tmp/btt-preview.env | cut -d= -f2-)"
echo "endpoint prod:    $(grep -E '^WP_GRAPHQL_ENDPOINT=' /tmp/btt-prod.env    | cut -d= -f2-)"
test "$(digest /tmp/btt-preview.env WP_APP_TOKEN)" != "$(digest /tmp/btt-prod.env WP_APP_TOKEN)" \
  && echo "app tokens DIFFER — correct" || echo "app tokens MATCH — this is the failure"

rm -f /tmp/btt-preview.env /tmp/btt-prod.env
```

- [ ] The two endpoints are different hosts. A preview pointed at production WordPress puts
      mutating specs and an exploratory agent next to real user data.
- [ ] The two app-token digests differ. **Matching digests are the failure**, and it is the check
      that proves the isolation is structural rather than aspirational: with different tokens, a
      preview deployment's mutation against production WordPress fails `hash_equals()` in PHP
      whatever the test intended.
- [ ] Both pulled files are deleted. They are plaintext credentials on your disk.

### Step 4: Write the promote half of `.github/workflows/deploy-web.yml`

```yaml
# .github/workflows/deploy-web.yml
# A SEPARATE workflow, not an addition to ci.yml. It PROMOTES; it never
# builds. Lesson 24.6's deploy-wp.yml is its sibling for the other tier.
name: Deploy Web

on:
  workflow_run:
    workflows: ['ci']   # must match ci.yml's `name:` exactly — lower case
    types: [completed]
    branches: [main]
  # The rollback path: promote an existing deployment by URL. No rebuild, which
  # is why a rollback is seconds rather than minutes.
  workflow_dispatch:
    inputs:
      deployment_url:
        description: 'An existing deployment URL to promote (rollback)'
        required: true

permissions:
  contents: read

concurrency:
  # Two promotions racing means the alias ends up on whichever finished last,
  # which is not necessarily the newer one. Never cancel one in flight.
  group: deploy-web
  cancel-in-progress: false

env:
  # Pinned major. `latest` here would let the tool that decides what runs in
  # production change without a pull request. Lesson 24.6 makes the same
  # argument about an image tag.
  VERCEL_CLI: vercel@39

jobs:
  promote:
    environment: production
    runs-on: ubuntu-latest
    if: >
      github.event_name == 'workflow_dispatch' ||
      github.event.workflow_run.conclusion == 'success'
    outputs:
      url: ${{ steps.resolve.outputs.url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc

      - name: Find the deployment that already passed every gate
        id: resolve
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
          SHA: ${{ github.event.workflow_run.head_sha }}
          MANUAL_URL: ${{ inputs.deployment_url }}
        run: |
          set -euo pipefail
          if [ -n "${MANUAL_URL:-}" ]; then
            echo "url=$MANUAL_URL" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          # The deployment Vercel built for THIS commit, which is the artifact
          # Playwright drove, Lighthouse measured and axe scanned.
          # Reasoned, not executed: the CLI's list output has changed shape
          # between majors — check `vercel ls --help` for the one you pinned.
          url=$(npx --yes "$VERCEL_CLI" ls \
                  --meta "githubCommitSha=$SHA" --yes | grep -m1 'https://')
          test -n "$url" || { echo "::error::No deployment for $SHA"; exit 1; }
          echo "url=$url" >> "$GITHUB_OUTPUT"

      - name: Promote
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
          URL: ${{ steps.resolve.outputs.url }}
        run: |
          # THERE IS NO `next build` IN THIS JOB, AND THAT IS THE POINT.
          # Building here would produce a NEW artifact — new dependency
          # resolution, new build id — and every green check in this pull
          # request was about the old one. Key Concept 1.
          npx --yes "$VERCEL_CLI" promote "$URL" --yes
          echo "### Promoted $URL" >> "$GITHUB_STEP_SUMMARY"
```

**Verify §4:**

- [ ] `grep -c 'next build\|vercel build\|--prod' .github/workflows/deploy-web.yml` is `0`.
      `vercel --prod` *builds* and deploys; `vercel promote` moves an alias. One of those two
      words is this lesson.
- [ ] `environment: production` is present, and that GitHub environment holds `VERCEL_TOKEN` with
      at least one required reviewer.
- [ ] Every `${{ }}` sits in an `env:` block, never inside a `run:` line — the injection rule from
      [Lesson 24.5](05-quality-gates-and-branch-protection.md) Step 7.

### Step 5: Add the read-only smoke test

```yaml
# .github/workflows/deploy-web.yml
# FRAGMENT — a second job in the same file, appended after `promote`.
  smoke:
    needs: promote
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      SITE: https://blamethe.tech
    steps:
      - name: Five GETs and nothing else
        run: |
          set -euo pipefail

          # EVERY request below is a GET. There is no POST, no Server Action
          # invocation, no mutation. A smoke test that submits a form to prove
          # the form works writes a row into wp_btt_leads on every deploy and
          # sends a real notification email. Key Concept 7.

          # 1. The home page renders through the app shell
          curl -fsS -o /tmp/home.html "$SITE/en"
          grep -q '<main' /tmp/home.html

          # 2. A dynamic route resolved against real WordPress
          curl -fsS -o /tmp/incident.html "$SITE/en/incidents/incident-01"
          grep -q '<h1' /tmp/incident.html

          # 3. app/sitemap.ts executed and did not 500 into an HTML page
          curl -fsS "$SITE/sitemap.xml" | head -c 80 | grep -q '<?xml'

          # 4. Next can reach WordPress from the production region. No -f:
          #    /api/health answers 503 when degraded and that is a real answer.
          code=$(curl -sS -o /tmp/health.json -w '%{http_code}' "$SITE/api/health")
          test "$code" = "200" || { echo "::error::/api/health -> $code"; cat /tmp/health.json; exit 1; }
          jq -e '.status == "ok"' /tmp/health.json

          # 5. robots.txt used the production metadataBase, not localhost
          curl -fsS "$SITE/robots.txt" | grep -q 'Sitemap: https://blamethe.tech'
```

A failing `smoke` job is the alert; it does not attempt a rollback. An automated rollback on a
smoke-test failure sounds attractive and is a bad idea at this size: the failure is as likely to
be the test, or a WordPress hiccup, and an automatic alias flip during a partial outage removes
the one thing a human needs, which is a stable system to look at.

### Step 6: Rehearse the rollback, and write the number down

Do this now, on a normal Tuesday, not during an incident.

```bash
cd next-app

# The previous production deployment. Find it BEFORE you need it — discovering
# that you do not know this command is the point of the rehearsal.
npx vercel@39 ls --yes | head -5

# Time it. Both tiers, front end first, because it is the tier users see.
time npx vercel@39 promote <previous-deployment-url> --yes
time gh workflow run deploy-wp.yml -f image_sha=<previous-40-char-sha>

# Then put it back the same way, and time that too.
```

**Verify §6:**

- [ ] You have two measured numbers, in seconds, and they are in `docs/runbook.md`. "About a
      minute" and "about fifteen minutes" lead to completely different decisions at 3am.
- [ ] The rollback used **no rebuild** on either tier. If either one took minutes, something in
      your pipeline is building during a rollback and Step 4's grep should have caught it.
- [ ] You know where a previous deployment URL and a previous image SHA come from, without
      asking anybody. That is the actual deliverable of this step.

### Step 7: Extend `docs/runbook.md`

[Lesson 15.2](../15-authentication-and-sessions/02-wpgraphql-jwt-authentication.md) created this
file for JWT secret rotation; 16.3, 17.2 and 18.4 appended. **Append. Do not rewrite theirs** —
in particular, the three rotation procedures already in there are the authority for their
secrets, and your section indexes them rather than restating them.

```markdown
<!-- docs/runbook.md — append. Lesson 15.2 created this file. -->

## Deploy (Lesson 24.7)

**Normal path.** Merge to `main`. CI runs; `ci-required` goes green; `deploy-wp.yml` and
`deploy-web.yml` fire. You do nothing else.

**What actually happens, in order.** WordPress first, front end second — the reverse of the
rollback order, because a front end promoted before its API is ready renders errors, and an API
deployed before its front end serves nobody.

1. `deploy-wp.yml` copies the image manifest to Fly's registry and runs `flyctl deploy
   --strategy bluegreen`. `release_command` runs **before** any machine takes traffic and aborts
   the deploy on a non-zero exit.
2. `deploy-web.yml` finds the Vercel deployment for that commit and runs `vercel promote`. **It
   does not build.** The artifact is the one every gate ran against.
3. `smoke` runs five GETs against production. A failure is an alert, not an automatic rollback.

**To ship without a merge** (you almost never should): `gh workflow run deploy-web.yml
-f deployment_url=<url>`.

## Roll back (Lesson 24.7)

**Front end first. It is the tier users see, and it is the faster of the two.**

    # 1. Front end. Measured: __ seconds.
    npx vercel@39 ls --yes | head -5          # find the previous deployment
    npx vercel@39 promote <previous-url> --yes

    # 2. WordPress, and ONLY if the fault is on that side. Measured: __ seconds.
    gh workflow run deploy-wp.yml -f image_sha=<previous-40-char-sha>

Fill in both numbers from the rehearsal. Rolling both tiers back by reflex doubles the change you
are making during an incident.

**What a rollback does NOT undo:** `wp core update-db` (forward-only — Lesson 24.6); a build-time
environment variable, which is baked into both artifacts; content edited in wp-admin since the
deploy; a cache tag you already invalidated; an email that was sent.

**If the fault is a schema change:** restore the volume snapshot **first**, then deploy the
previous image SHA. The old image cannot read the new schema, so the other order gives you a
second outage on top of the first.

## Where the logs are (Lesson 24.7)

Four streams, two clocks. Start from the request id — Lesson 24.3 puts it on every log line and on
`X-BTT-Request-Id`, and it is the only thing that joins them.

| What | Where | Command |
|---|---|---|
| Next server / edge / build | Vercel | `npx vercel@39 logs <deployment-url>` |
| Browser and server exceptions | Sentry | filter by the request id |
| PHP warnings and fatals, production | container stderr | `fly logs -a btt-wp` |
| PHP warnings and fatals, locally | `wp-content/debug.log` | `docker compose exec wordpress tail -f /var/www/html/wp-content/debug.log` |
| MySQL | the database app | `fly logs -a btt-db` |

**The trap.** `WP_DEBUG_LOG` sends PHP output to a **file inside the container** rather than to
stderr. Set it in production and your errors vanish from `fly logs` and accumulate on an
ephemeral filesystem nobody can reach — which reads exactly like "the errors stopped". The
production image sets `error_log=/dev/stderr` and `WORDPRESS_DEBUG=0` for this reason. Do not
"turn on debugging to investigate" in production; you will turn the logs off.

## Purge a cache (Lesson 24.7)

Find the layer before you change anything — Lesson 18.4's five-step diagnosis is the authority and
this is the production addendum.

- **Next Data Cache / ISR:** the revalidation webhook, or `revalidateTag`. There is no dashboard
  button that does what a tag does.
- **Vercel CDN, one URL:** purge that path in the dashboard. `revalidateTag` will never do it
  (Lesson 18.4 §1).
- **Everything, as a last resort:** promote the deployment again. A new alias target invalidates
  its own CDN cache, and it is a smaller hammer than it looks because the artifact is unchanged.

## Rotate a secret (Lesson 24.7) — the index

Each secret has its own procedure and its own blast radius. Do not invent a fourth.

| Secret | Procedure | Production step |
|---|---|---|
| `GRAPHQL_JWT_AUTH_SECRET_KEY` | Lesson 15.2's section, above | `fly secrets set` — triggers a rolling restart |
| `BTT_PREVIEW_SHARED_SECRET` | Lesson 17.2's section, above | `fly secrets set` **and** the Vercel variable |
| `BTT_REVALIDATE_SECRET` | Lesson 18.4's section, above | both sides, same window, then redeploy Next |
| `BTT_APP_TOKEN` | Lesson 15.2's "what this does NOT fix" | both sides, same window. Every server-to-server mutation fails closed until they match |

**Build-time versus run-time.** A run-time variable takes effect on the next request after a
redeploy. Anything inlined at build time — every `NEXT_PUBLIC_*` — is inside the artifact, so
rotating it **requires a rebuild**, and promoting an old deployment brings the old value back.

## Escalation (Lesson 24.7)

| Symptom | First responder | Escalate to |
|---|---|---|
| Front end 5xx, `/api/health` says `ok` | whoever merged last | the on-call web owner |
| `/api/health` says `degraded` | the WordPress owner | the database owner if `checks.database` is false |
| A deploy aborted in `release_command` | whoever merged last | **do not retry blindly.** Read the release-command log first: a half-applied `update-db` is the one state with no rollback |
| A secret is in a log, a screenshot or git | **rotate first, investigate second** | security owner. Lesson 24.5 Key Concept 7 |

(Add your own row: what is the one symptom in this system that nobody currently owns?)
```

**Verify §7:**

- [ ] `grep -c 'Rotating GRAPHQL_JWT_AUTH_SECRET_KEY' docs/runbook.md` is `1`. Lesson 15.2's
      original section is still there — that grep is the only check that distinguishes appending
      from replacing.
- [ ] `grep -c 'A page is stale' docs/runbook.md` is `1` — Lesson 18.4's section survived too.
- [ ] Both rollback timings are filled in with real numbers, not `__`.
- [ ] You filled in the escalation parenthesis. An unowned symptom is an outage with no first
      responder.

```bash
git add -A
git commit -m "feat(ci): promote-not-rebuild deploys, prod smoke tests and the runbook"
```

---

## Verification

```bash
cd next-app

# 1. NEGATIVE — THE MOST IMPORTANT CHECK IN THE LESSON. The production path
#    promotes an artifact; it does not produce one.
grep -cE 'next build|vercel build|vercel --prod|vercel deploy --prod' ../.github/workflows/deploy-web.yml
# Expected: 0. `vercel --prod` BUILDS and deploys; `vercel promote` moves an
#           alias. One hit here and every green check in the pull request was
#           about an artifact that never shipped. Key Concept 1.
grep -c 'promote' ../.github/workflows/deploy-web.yml
# Expected: 2 or more — the step name and the command

# 2. NEGATIVE — and the platform's own default cannot rebuild main behind you
jq -r '.git.deploymentEnabled.main' vercel.json
# Expected: false. A `true` or a missing key means Vercel builds `main` on
#           push, by itself, and the promote job then promotes an artifact
#           that is no longer the one production is serving.

# 3. NEGATIVE — the region is chosen, not defaulted
jq -r '.regions | join(",")' vercel.json
# Expected: fra1  (or whichever region is nearest YOUR WordPress origin).
#           A defaulted region means iad1 for most accounts: ~90 ms RTT to
#           Fly's `ams` instead of ~10 ms, so a route with two sequential
#           GraphQL fetches spends ~180 ms of its 2500 ms LCP budget on the
#           Atlantic, on every cold render and every Server Action.
jq -e '.framework == "nextjs"' vercel.json
# Expected: true. Without it there is no ISR, no route handler and no Server
#           Action — a static export of something that is not static.

# 4. NEGATIVE — vercel.json holds no second source of truth for headers,
#    redirects or trailing slashes, and no credential
jq -r 'keys | join(",")' vercel.json
# Expected: $schema,framework,git,github,regions — and nothing else.
#           `headers` here would silently win over next.config.ts IN
#           PRODUCTION ONLY, which is the worst place for a configuration
#           disagreement to first appear.
grep -icE '(password|secret|token|key)"[[:space:]]*:' vercel.json
# Expected: 0

# 5. Preview and Production are scoped, and the endpoints are different hosts
npx vercel@39 env pull /tmp/btt-preview.env --environment=preview --yes
npx vercel@39 env pull /tmp/btt-prod.env    --environment=production --yes
grep -E '^WP_GRAPHQL_ENDPOINT=' /tmp/btt-preview.env /tmp/btt-prod.env
# Expected: two DIFFERENT hosts — wp-staging.… for preview, wp.… for
#           production. The same host in both is the failure.

# 6. NEGATIVE — the app tokens differ, compared as digests so nothing is
#    printed. Matching digests are the failure.
digest() { grep -E "^$2=" "$1" | cut -d= -f2- | tr -d '"' | shasum -a 256 | cut -c1-12; }
test "$(digest /tmp/btt-preview.env WP_APP_TOKEN)" != "$(digest /tmp/btt-prod.env WP_APP_TOKEN)" \
  && echo "differ — correct" || echo "MATCH — the isolation is not real"
# Expected: differ — correct. This is the check that turns Key Concept 3 from
#           a policy into a property.
rm -f /tmp/btt-preview.env /tmp/btt-prod.env
# Expected: no output — and two plaintext credential files gone from your disk

# 7. NEGATIVE — a preview's credential cannot write to production WordPress.
#    Send the STAGING app token to the PRODUCTION endpoint and read .errors.
curl -s -X POST https://wp.blamethe.tech/graphql \
  -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN_STAGING" \
  -d '{"query":"mutation{ registerDeveloper(input:{email:\"probe@example.test\"}){ clientMutationId } }"}' \
  | jq -r '.errors[0].message // "NO ERROR — THE ISOLATION IS BROKEN"'
# Expected: a permission error. GraphQL failures are HTTP 200 with an `errors`
#           array, so this checks `.errors` and never the status code.
#           "NO ERROR" means the two environments share a token.

# 8. NEGATIVE — the smoke test only reads
grep -nE 'POST|--data|-d |revalidate|createIncident|submitLead|registerDeveloper' \
  ../.github/workflows/deploy-web.yml
# Expected: no output inside the `smoke` job. A smoke test that submits a form
#           writes a row into wp_btt_leads on every deploy and sends a real
#           notification email.
sed -n '/^  smoke:/,$p' ../.github/workflows/deploy-web.yml | grep -c 'curl -fsS\|curl -sS'
# Expected: 5 — five GETs, and nothing else

# 9. The smoke assertions actually hold against production
SITE=https://blamethe.tech
curl -fsS "$SITE/en" | grep -c '<main'
# Expected: 1 or more
curl -fsS "$SITE/en/incidents/incident-01" | grep -c '<h1'
# Expected: 1 or more
curl -fsS "$SITE/sitemap.xml" | head -c 40
# Expected: an XML declaration, NOT `<!DOCTYPE html>`. HTML here means
#           app/sitemap.ts threw and Next served an error page with a 200.
curl -s -o /tmp/health.json -w '%{http_code}\n' "$SITE/api/health"
# Expected: 200
jq -r '.status' /tmp/health.json
# Expected: ok
curl -fsS "$SITE/robots.txt" | grep -c 'Sitemap: https://blamethe.tech'
# Expected: 1 — a `localhost` sitemap line means metadataBase resolved from
#           the wrong environment variable

# 10. NEGATIVE — production is not leaking a server-only value into the bundle
npm run build
grep -rl "$(printf '%s' "$BTT_APP_TOKEN_PROD" | cut -c1-12)" .next/static/ 2>/dev/null
# Expected: no output. The same check appendix 04 §3.2 froze, run against the
#           artifact rather than the source.

# 11. The rollback is rehearsed, timed, and needs no rebuild
npx vercel@39 ls --yes | head -3
# Expected: at least two deployments, the previous one identifiable
grep -cE '__ seconds|__' ../docs/runbook.md
# Expected: 0. A placeholder here means the rehearsal did not happen, and a
#           rollback procedure nobody has run is a hypothesis.

# 12. The runbook was EXTENDED, not replaced
grep -c 'Rotating GRAPHQL_JWT_AUTH_SECRET_KEY' ../docs/runbook.md
# Expected: 1 — Lesson 15.2's original section
grep -c 'Rotating the preview shared secret' ../docs/runbook.md
# Expected: 1 — Lesson 17.2's
grep -c 'A page is stale' ../docs/runbook.md
# Expected: 1 — Lesson 18.4's
grep -c '## Deploy (Lesson 24.7)' ../docs/runbook.md
# Expected: 1 — yours, appended

# 13. NEGATIVE — your runbook indexes the rotation procedures rather than
#     forking them
sed -n '/## Rotate a secret (Lesson 24.7)/,/## Escalation/p' ../docs/runbook.md | grep -c 'openssl rand'
# Expected: 0. A fourth copy of a rotation procedure is a fourth procedure to
#           drift, and the three that exist are the authority for their
#           secrets.

# 14. NEGATIVE — nothing in the deploy workflows holds a credential for the
#     other tier
grep -cE 'FLY_API_TOKEN' ../.github/workflows/deploy-web.yml
# Expected: 0 — the front-end deploy has no business holding the WordPress
#           deploy token, and vice versa
grep -cE 'VERCEL_TOKEN' ../.github/workflows/deploy-wp.yml
# Expected: 0
```

Check 1 is the one to run first and the one to run again in six months. Every other check in this
lesson protects a property; that one protects the only guarantee the pipeline actually makes —
that the artifact your gates approved is the artifact your users receive.

## Control Questions

1. A colleague replaces the promote step with `vercel --prod` and argues that it is simpler, that
   the build is deterministic, and that in two years it has never produced a different artifact.
   Grant every one of those claims and still make the case against it — then say what evidence
   would actually settle the argument, and why nobody has it.
2. Preview and Production hold different `WP_APP_TOKEN` values. Describe the concrete sequence by
   which a *single* shared token turns one careless Playwright spec into a production data
   incident, and name the layer that stops it today — the test, the reviewer, or the topology.
3. Environment parity is partial: the front end is production-identical and the content is not.
   Give two bug classes preview will reliably catch and two it structurally cannot, and say what
   you would change about the seeder to move one bug from the second list to the first.
4. `NEXT_PUBLIC_SITE_URL` is inlined at build time and `WP_GRAPHQL_ENDPOINT` is read at run time.
   For each, say what happens when you change the value and then promote a deployment built
   before the change — and explain which of the two can be rotated without a rebuild.
5. The rollback order is front end first, WordPress second. Construct a failure where that order
   is wrong, say what tells you which situation you are in from the outside in under a minute, and
   name the one operation in the whole system that makes the order irreversible.

## Learn More

- [Vercel — deployments](https://vercel.com/docs/deployments) — the immutability model Key
  Concept 2 depends on, and where a deployment URL comes from
- [Vercel — promoting a deployment](https://vercel.com/docs/deployments/promoting-a-deployment) —
  the difference between promoting and redeploying, in Vercel's own words, including what happens
  to the previous production alias
- [Vercel — environment variables](https://vercel.com/docs/environment-variables) — the three
  targets, the Sensitive flag, and the build-time versus run-time distinction that decides
  whether rotating a value needs a rebuild
- [Vercel — `vercel.json` configuration](https://vercel.com/docs/project-configuration) — the full
  key list, so "what is deliberately not in this file" is a decision you can defend
- [Vercel — regions](https://vercel.com/docs/edge-network/regions) — the region codes and their
  locations, which is what turns Key Concept 6's table into your own numbers
- [Vercel CLI reference](https://vercel.com/docs/cli) — `ls`, `promote`, `env pull` and `logs`;
  read the `--meta` filter, which is how Step 4 finds the deployment for a commit
- [GitHub Actions — using environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
  — required reviewers, wait timers and environment-scoped secrets, which is how `VERCEL_TOKEN`
  stops being a repository-wide secret
- [Google SRE Workbook — canarying releases](https://sre.google/workbook/canarying-releases/) —
  the general form of the argument in Key Concept 1, and the vocabulary for the next step beyond
  promotion when you outgrow one alias
- [MDN — `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) —
  worth rereading beside the runbook's purge section, because "which layer is stale" is answered
  by these directives and not by a dashboard
