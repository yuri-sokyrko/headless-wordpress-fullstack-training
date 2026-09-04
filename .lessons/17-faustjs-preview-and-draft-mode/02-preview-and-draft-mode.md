---
title: 'Preview & Draft Mode'
module: 17
lesson: 2
teaches: [draft-mode, preview-post-link, single-use-tokens, as-preview-revisions, preview-banner]
produces: ['next-app/src/app/api/preview/route.ts', 'next-app/src/app/api/preview/exit/route.ts', 'next-app/src/components/preview/PreviewBanner.tsx', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Preview.php']
requires: [15.2, 17.1]
---

# Lesson 17.2 — Preview & Draft Mode

## Quick Overview

This is the lesson in Module 17 that actually ships. Everything in it survives Lesson 17.4's
verdict, because it is built on Next's own `draftMode()` rather than on Faust. An editor clicks
Preview in wp-admin; the `preview_post_link` filter sends them to `/api/preview` on the Next app
with a single-use token; the route handler exchanges that token server-to-server at
`/wp-json/btt/v1/preview/verify`, receives the post identity and a short-lived preview JWT, calls
`draftMode().enable()`, sets `btt_preview_jwt` as an httpOnly cookie for 300 seconds, and redirects
to the real front-end route. That route sees `draftMode().isEnabled`, switches its query to
`asPreview: true` with `cache: 'no-store'` and the editor's Bearer token, and renders the draft
through the same `BlockRenderer` the published page uses. A `PreviewBanner` makes the state
unmissable with an exit link to `/api/preview/exit`.

Two details are where the bugs live. First, the token: it is 32 random bytes, stored as a
120-second transient keyed by a **hash** of the token rather than the token itself, deleted the
moment it is redeemed, and never a session credential. This is the **one** permitted exception to
"no credential in a URL" in [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials),
and the rule it does not break is worth restating precisely: *no **session** credential in a URL,
ever* — URLs leak through `Referer` headers, browser history, server access logs and chat clients.
Second, and this one has cost every headless WordPress developer an afternoon: **`asPreview: true`
reads the latest *revision*.** For a post that has never been published, the draft is the post row
and a normal query finds it. For an already-published post, the editor's unsaved changes live in
`wp_posts` as a **`revision` row**, and the post row still holds the published content. Omit
`asPreview` and the query succeeds, returns the published version, and preview looks broken with no
error anywhere. Note also who decides access: the preview JWT is scoped to the previewing user, so
WordPress's own `edit_post` capability check remains the authority. Next does not decide who may
see a draft.

By the end of this lesson you will have:

- `includes/Preview.php` — the `preview_post_link` filter, a token minted per preview click, and a
  `/wp-json/btt/v1/preview/verify` endpoint guarded by `X-BTT-App-Token` and `hash_equals()`
- `src/app/api/preview/route.ts` — token exchange, `draftMode().enable()`, `btt_preview_jwt` set
  httpOnly, and a redirect that validates its own destination against an allowlist
- `src/app/api/preview/exit/route.ts` — `draftMode().disable()` and cookie cleanup
- Every content route branching on `draftMode().isEnabled` to add `asPreview: true`, `no-store` and
  the editor's Bearer token
- `PreviewBanner.tsx` rendered from the layout whenever draft mode is on, with a working exit link
- Negative proofs: a replayed token returns `401`, a token 121 seconds old returns `401`, an
  anonymous request for a draft route still returns `404`, and no preview response is ever cached

## Classic WP Analogy

You know this feature inside out from the other side. In Classic WordPress, Preview appends
`?preview=true&preview_id=123` (plus a nonce) to the permalink, `_show_post_preview()` hooks
`the_preview`, and `_set_preview()` swaps the post's fields for those of the latest autosave or
revision before the template renders. Access control is `current_user_can( 'edit_post', $id )` — the
same check the editor screen uses. And critically: **the preview content comes from
`wp_get_post_autosave()` or the revisions table, not from the post row.**

| Classic WordPress | This stack |
|---|---|
| `?preview=true&preview_id=123` + nonce | `/api/preview?token=…` — single-use, 120 s, exchanged server-side |
| `_set_preview()` / the `the_preview` filter | `asPreview: true` on the WPGraphQL query |
| `wp_get_post_autosave()` reading a revision | **the same revision**, surfaced through WPGraphQL |
| `current_user_can( 'edit_post', $id )` | unchanged — the preview JWT is scoped to that editor |
| `preview_post_link` filter | unchanged — this is exactly the hook you use |
| "Preview in new tab" | unchanged, and it must land on `:3000`, not `:8080` |
| no caching of a preview response, ever | `cache: 'no-store'` plus `draftMode()` opting the route out of ISR |

The revisions row in that table is the whole gotcha. If you have ever debugged a classic theme
where preview showed stale content because a plugin queried the post directly instead of letting
`_set_preview()` do its work, you have already had this bug once. `asPreview: true` is the same fix.

**Where the analogy breaks down:** in Classic WordPress, preview is protected by the fact that the
*same PHP process* has your logged-in cookie and can call `current_user_can()` before rendering a
byte. Here the editor's browser arrives at a completely different origin with no WordPress session,
so the authority has to be transported. Hence the token exchange: something short-lived and
single-use travels in the URL, is redeemed once server-to-server for a user-scoped JWT, and only
then does WordPress get asked "may this person see this draft?". The credential in the URL is a
bearer of *one* claim — "whoever holds this may start one preview session in the next two minutes"
— and never of an identity.

The second break: `?preview=true` is stateless per request, so nothing about it can leak into a
cache. `draftMode()` sets cookies (`__prerender_bypass`, `__next_preview_data`) that persist, and a
route that forgets to opt out of caching can serve a draft to the public. That is why the exit
route exists and why the banner is loud — an editor who wanders off with draft mode enabled is a
disclosure risk, not just a confused user.

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
