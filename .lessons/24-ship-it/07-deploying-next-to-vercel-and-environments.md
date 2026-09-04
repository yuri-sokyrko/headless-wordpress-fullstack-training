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
