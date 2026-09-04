# Module 17 — Faust.js, Preview & Draft Mode

## Prerequisites

Before starting this module you should have completed:

- **Module 14** — `BlockRenderer`, because a preview is only useful if drafts render like published pages
- **Module 15** — JWT configuration, httpOnly cookies, and the entry-point matrix from Lesson 15.5
- **Module 16** — the core loop, so the content you are previewing is content someone actually made
- **Appendix 04 §4** — the [credential and cookie contract](../appendix/04-env-reference.md#4-the-two-credentials), including `btt_preview_jwt`

> ⚠️ **This module evaluates a framework and then declines most of it.** That is the intended
> outcome, written up as an ADR in Lesson 17.4, not a failure to finish. If you want only the part
> that ships, you still have to build the spike first — a verdict you did not earn is an opinion.

## Starting State

Module 16 complete: a registered developer submits an incident through a Server Action, it lands
as `pending`, an editor approves it in wp-admin and it becomes publicly visible; the Get Demo
dialog writes rows into `wp_btt_leads`; `incident_submission_open` works as a kill switch; both
suites are green.

```bash
# 1. The funnel spec passes end to end
cd next-app && npx playwright test e2e/funnel.spec.ts
# Expected: 1 passed

# 2. Leads land in the custom table, not in wp_posts
docker compose exec -T db mysql -u btt -p"$WORDPRESS_DB_PASSWORD" btt \
  -e 'SELECT COUNT(*) FROM wp_btt_leads;'
# Expected: a count of 1 or more

# 3. A draft is invisible to the public site — this is the problem this module solves
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents/a-draft-slug
# Expected: 404
```

## What You'll Learn

- **What Faust.js actually is** — a Next.js framework layer with WP templates, preview and auth built in
- **Next `draftMode()`** — the App-Router-native mechanism, and the two cookies it manages for you
- **`preview_post_link`** — repointing WordPress's own Preview button at your front end
- **Single-use preview tokens** — the *one* documented exception to "no credential in a URL", and why it is safe
- **`asPreview: true`** — reading the latest **revision**, and the silent failure when you forget it
- **Faust auth and templates** — the `faustjs` template hierarchy and its Apollo coupling
- **Writing an ADR that says no** — a decision table with a verdict, and the conditions that would reverse it

## What You'll Build

- A `/faust` spike: Faust installed **beside** the existing app in its own route group, sharing the
  same WordPress, touching none of your routes
- `src/app/api/preview/route.ts` and `preview/exit/route.ts` — token exchange, `draftMode().enable()`
- `includes/Preview.php` — issue and verify endpoints, with a 120-second single-use transient
- `PreviewBanner.tsx` — an unmissable indicator with a working exit link
- An ADR recording preview-only adoption, and the deletion of the spike that justified it

After this module editors hit Preview in wp-admin and see their unpublished draft rendered by
Next.js, with your components, your styles and your block registry.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [What Faust Actually Gives You](01-what-faust-actually-gives-you.md) | Faust.js, `faustjs` templates | The `/faust` spike, running beside your app |
| 02 | [Preview & Draft Mode](02-preview-and-draft-mode.md) | `draftMode()`, `preview_post_link` | **The lesson that ships** — working editor preview |
| 03 | [Faust Auth & Templates](03-faust-auth-and-templates.md) | Faust auth, Apollo, WP-controlled routing | The same page twice, measured against each other |
| 04 | [When Not to Use Faust](04-when-not-to-use-faust.md) | ADRs, decision tables | The written verdict, and the spike removed |

## The Preview Flow

```
Editor in wp-admin                 WordPress                    Next.js (:3000)
        │                              │                              │
        │ clicks Preview               │                              │
        ├─────────────────────────────▶│ preview_post_link filter     │
        │                              │  mint token: 32 random bytes │
        │                              │  set_transient(              │
        │                              │    'btt_pv_' . hash(token),  │
        │                              │    [post_id, user_id], 120 )  │
        │◀── 302 to BTT_FRONTEND_URL ──┤                              │
        │    /api/preview?token=…&id=… │                              │
        │                              │                              │
        ├──────────────── GET /api/preview?token=… ───────────────────▶│
        │                              │◀── POST /wp-json/btt/v1/     │  server-to-
        │                              │    preview/verify            │  server, app
        │                              │    { token }                 │  token header
        │                              ├── { postId, previewJwt } ───▶│  DELETE the
        │                              │   transient consumed — once  │  transient
        │                              │                              │  draftMode()
        │                              │                              │   .enable()
        │                              │                              │  set btt_preview_jwt
        │◀── 307 → /en/incidents/dns ──────────────────────────────────┤   httpOnly 300s
        │                              │                              │
        ├──────────────── GET /en/incidents/dns ──────────────────────▶│ isEnabled → true
        │                              │◀── query asPreview: true ────┤ cache: 'no-store'
        │                              │    Bearer previewJwt         │ Bearer = the editor
        │                              ├── the latest REVISION ──────▶│ WP checks edit_post
        │◀── the draft, in your components, with a PreviewBanner ─────┤
```

The token in that URL is single-use, expires in 120 seconds, is exchanged server-to-server, and is
not a session credential. The rule from [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials)
is precise: **no *session* credential in a URL, ever** — because URLs leak through `Referer`
headers, browser history, access logs and chat clients.

## The Faust Scorecard

Filled in during Lessons 17.1–17.3 and defended in 17.4. This is the module's real deliverable.

| Capability | Faust.js | This app's own stack |
|---|---|---|
| WP template hierarchy in React | ✅ built in | ❌ you write routes |
| Editor preview | ✅ built in | ✅ Lesson 17.2, ~120 lines |
| Login / auth flows | ✅ built in | ✅ Module 15, and more tightly scoped |
| Data layer | ❌ Apollo, coupled | ✅ `fetch` + codegen, cache-tag aware |
| `revalidateTag` / on-demand ISR | ❌ abstracted away | ✅ Module 18, the whole point |
| Server Actions | ❌ fights its routing | ✅ Module 16 |
| App Router currency | ❌ trails it; maintenance mode | ✅ current |
| **Verdict** | **adopt for preview patterns only** | **keep — it is what makes Module 18 possible** |

## How to Work

1. **Read `## Quick Overview` and `## Classic WP Analogy`.** Lesson 17.2's analogy — `wp_get_post_autosave()`
   and the revision table — is what makes the `asPreview` gotcha make sense before it bites you.
2. **Work `## Task` in order.** The spike in 17.1 and 17.3 exists to make 17.4's verdict evidence-based.
   Build it, run it, then form the opinion.
3. **Run `## Verification`, negatives included.** Preview must fail for an anonymous visitor, for a
   replayed token, and for a token older than 120 seconds. A preview endpoint that leaks drafts is
   an unauthenticated content API.
4. **Commit after every lesson.** `git commit -m "feat(preview): repoint the WP preview link at Next"`
