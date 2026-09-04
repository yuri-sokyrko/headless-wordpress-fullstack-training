# Module 24 — Ship It: Security, CI/CD, Deployment & Code Review

## Prerequisites

Before starting this module you should have completed:

- **Module 02** — Docker and Compose; the production image deliberately deferred everything that
  makes an image production-ready
- **Module 06** — the GraphQL API, because it is the attack surface Lesson 24.1 hardens
- **Modules 21 and 22** — the performance and accessibility gates, which become required checks here
- **Module 23** — all five suites green; a pipeline is only worth building around tests you trust

> ⚠️ **Read [appendix 04](../appendix/04-env-reference.md) §1, §6 and §7 again before you set a
> single secret.** Every irreversible mistake in this module is a secrets mistake: a token in a
> build arg, a `.env` committed once, a production credential shared with a preview environment.
> A secret that has been in git is compromised even after deletion — rotate it, do not just remove it.

## Starting State

Module 23 complete: five green suites, plus an agent that finds bugs you didn't think to look for.

```bash
# 1. Every suite is green
cd next-app && npm test -- --run && npx playwright test
docker compose -f ../wordpress-headless/docker-compose.yml exec -T wordpress \
  composer test:unit && composer test:integration
# Expected: all four commands exit 0

# 2. The schema contract holds, and no secret reached the client bundle
npm run codegen:check && git diff --exit-code -- ../wordpress-headless/schema.graphql src/gql
npm run build && grep -r "$REVALIDATE_SECRET" .next/static/ 2>/dev/null
# Expected: no output from either command
```

## What You'll Learn

- **Hardening WordPress** — wp-admin at the edge, XML-RPC and anonymous REST off, file
  modification disabled, a least-privilege DB user, and the **new** GraphQL attack surface:
  introspection, depth and complexity limits, and **persisted queries** as the strongest control
- **Hardening Next.js** — CSP and security headers, boundary validation, output encoding, CSRF on
  Server Actions, rate-limited route handlers, `npm audit`, and a **licence allowlist**
- **Observability** — structured logs carrying no PII or tokens, **Sentry** on both sides, source
  maps, request IDs correlating Next → WPGraphQL, uptime checks and alert thresholds
- **GitHub Actions from zero** — for someone whose deployment history is an FTP client: caching,
  `dorny/paths-filter`, reusable workflows, and one aggregation job branch protection can point at
- **Quality gates** — the full table, a threshold per gate, an honest "does this block a merge?"
- **Deployment** — a production `Dockerfile` and **Fly.io** for WordPress with a gating
  `release_command`; **Vercel** preview-per-PR, artifact promotion and rollback for Next
- **Code review** — a headless-WordPress-specific checklist, conventional commits enforced, and
  an AI review gate that is a second net and never the only net

## What You'll Build

- `mu-plugins/000-btt-hardening.php`, a hardened `next.config.ts` with a real CSP, Sentry on both
  applications, structured logging and correlated request IDs
- A pipeline of reusable workflows with path filtering, a contract job, sharded E2E against the
  **built** WordPress image, Lighthouse and axe on the Vercel preview, `docs/quality-gates.md`, and
  one `ci-required` job that branch protection points at
- `wordpress-headless/Dockerfile`, `fly.toml`, `railway.json`, and a release that runs
  `wp core update-db`, activates plugins, flushes rewrites and ensures languages before traffic
- `vercel.json`, env scoping across Preview and Production, prod smoke tests, and a one-command
  rollback for each side
- A pull request template, a 14-point review checklist, commitlint with Husky and lint-staged, an
  advisory AI review job, `docs/runbook.md` and a going-further backlog

After this module Blame The Tech is live: WordPress on Fly.io, Next.js on Vercel, every pull
request gated, both sides rolling back with one command, a runbook for whoever gets paged.
## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Security Hardening: WordPress](01-security-hardening-wordpress.md) | Hardening mu-plugin, WPGraphQL Smart Cache | Locked admin, persisted queries, no introspection |
| 2 | [Security Hardening: Next.js](02-security-hardening-next.md) | CSP, security headers, licence checks | Headers, sanitisation policy, licence allowlist |
| 3 | [Observability, Logging & Error Tracking](03-observability-logging-and-error-tracking.md) | Sentry, structured logging, request IDs | Correlated traces, alerts, a retention policy |
| 4 | [CI with GitHub Actions](04-ci-with-github-actions.md) | GitHub Actions, `dorny/paths-filter` | Reusable workflows, sharded E2E, `ci-required` |
| 5 | [Quality Gates & Branch Protection](05-quality-gates-and-branch-protection.md) | PHPStan baseline, Codecov, gitleaks, Trivy | `docs/quality-gates.md`, branch protection |
| 6 | [Building & Deploying WordPress](06-building-and-deploying-wordpress.md) | Multi-stage Dockerfile, GHCR, Fly.io | The production image and a gated release |
| 7 | [Deploying Next.js to Vercel & Environments](07-deploying-next-to-vercel-and-environments.md) | Vercel envs, promotion, rollback | Preview per PR, prod deploy, `docs/runbook.md` |
| 8 | [Code Review & Handover](08-code-review-and-handover.md) | Commitlint, Husky, an AI review gate | The checklist, the PR template, the backlog |

## The Pipeline

Lesson 24.4 builds this; Lesson 24.5 decides which boxes block a merge.

```
  push / pull_request
        │
        ▼
  ┌──────────┐  dorny/paths-filter
  │ detect   │──┬─ web? ────────┬─ php? ────────┬─ docker-wp? ──┬─ always ──┐
  └──────────┘  ▼               ▼               ▼               ▼           │
       ┌────────────┐ ┌─────────────┐ ┌────────────────┐ ┌───────────┐      │
       │ _web.yml   │ │ _php.yml    │ │ _docker-wp.yml │ │ gitleaks  │      │
       │ tsc strict │ │ PHPCS       │ │ build image    │ │ licences  │      │
       │ eslint 0w  │ │ PHPStan L6  │ │ Trivy scan     │ └─────┬─────┘      │
       │ vitest+cov │ │ Pest        │ │ push to GHCR   │       │            │
       │ next build │ │ wp-phpunit  │ └───────┬────────┘       │            │
       └─────┬──────┘ └──────┬──────┘         │                │            │
             └───────┬───────┴────────────────┘                │            │
                     ▼                                         │            │
   ┌───────────────────────────────────────┐                   │            │
   │ contract: schema + codegen drift      │                   │            │
   ├───────────────────────────────────────┤                   │            │
   │ e2e (sharded 1..4) against the BUILT  │                   │            │
   │ WP image — CI tests what deploys      │                   │            │
   ├───────────────────────────────────────┤                   │            │
   │ vercel preview → lighthouse-ci + axe  │                   │            │
   └──────────────────┬────────────────────┘                   ▼            ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │ ci-required — aggregates ALL of the above; skipped counts as pass   │
        │ branch protection points at THIS job and nothing else               │
        └───────────────────────────────┬─────────────────────────────────────┘
                                        ▼  main only, environment-protected
                     ┌──────────────────────────────┐
                     │ deploy-wp  (Fly.io)          │
                     │ deploy-web (Vercel promote)  │
                     └──────────────────────────────┘
```

## How to Work

1. **Work 24.1 and 24.2 before anything is public.** Hardening a live site is an incident;
   hardening a local one is a Tuesday.
2. **Build the pipeline before the deployment.** Lessons 24.4 and 24.5 come before 24.6 and 24.7
   on purpose — what you promote to production should be an artifact that already passed.
3. **Never let a secret near a build arg or a log line.** `fly secrets set`, Vercel environment
   variables, GitHub Actions secrets, `::add-mask::` for anything derived. Nothing else.
4. **Commit after every lesson**, and by Lesson 24.8 a hook enforces the format.
   `git commit -m "ci: aggregate required checks into ci-required"`
