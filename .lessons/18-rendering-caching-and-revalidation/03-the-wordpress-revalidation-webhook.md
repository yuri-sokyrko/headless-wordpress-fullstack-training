---
title: 'The WordPress Revalidation Webhook'
module: 18
lesson: 3
teaches: [hmac-signed-webhooks, replay-window, timing-safe-compare, wp-remote-post, host-docker-internal]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Revalidate.php', 'next-app/src/app/api/revalidate/route.ts', 'wordpress-headless/.env.example', 'next-app/.env.example']
requires: [18.2]
---

# Lesson 18.3 — The WordPress Revalidation Webhook

## Quick Overview

This is the lesson that closes the gap you have been living with since Module 16: an editor clicks
Publish and the public site changes within seconds. WordPress hooks `transition_post_status`,
`saved_term` and `acf/save_post`, builds a small JSON payload — type, post type, slug, locale —
and `wp_remote_post()`s it to `BTT_FRONTEND_URL . '/api/revalidate'` with two headers:
`X-BTT-Timestamp` and `X-BTT-Signature: sha256=<HMAC(ts + "." + body, BTT_REVALIDATE_SECRET)>`.
Two arguments to that call matter as much as the signature: `blocking => false` and
`timeout => 2`. An editor's Publish must never wait on a network call to Vercel, and a slow or
down front end must never become an editorial outage. The consequence is that WordPress does not
see the response, which you should notice now rather than during debugging.

The Next side is a route handler that does four things in a fixed order, and each one has a
specific failure code. First, the timestamp must be within ±300 seconds of now, or `400` — that is
the replay guard, and without it a captured request stays valid forever. Second, recompute the HMAC
over `ts + "." + body` and compare with `timingSafeEqual`, returning `401` with **no reason
echoed**, because a helpful error message on a signature check is an oracle. Third, `Zod.parse` the
body and return `400` on anything unexpected — a valid signature proves the sender knows the
secret, not that the payload is sane. Only then `revalidateTag`, using the functions from
`tags.ts` so the vocabulary cannot drift. Note what this endpoint does *not* have: cookies. It is
cookieless by design, so CSRF against it is structurally impossible rather than merely blocked —
a browser cannot forge the signature, and there is no ambient credential for it to ride on.

By the end of this lesson you will have:

- `includes/Revalidate.php` — the three hooks, the payload builder, `hash_hmac()`, and
  `wp_remote_post()` with `blocking => false, timeout => 2`
- `src/app/api/revalidate/route.ts` — the four ordered checks, tags derived from `tags.ts`, and a
  `200 {"revalidated":[…]}` response listing what it actually invalidated
- `BTT_REVALIDATE_SECRET` / `REVALIDATE_SECRET` in both `.env.example` files as `__CHANGE_ME__`,
  with real values only in gitignored files
- `BTT_FRONTEND_URL` set to `host.docker.internal:3000`, plus `extra_hosts` in the Compose file if
  you are on Linux
- Four negative proofs: unsigned request → `401`; wrong signature → `401`; correct signature with a
  ten-minute-old timestamp → `400`; valid signature with a malformed body → `400`
- The end-to-end result: change a title in wp-admin, reload the public page, see the new title
  without a deploy and without waiting for a timer

## Classic WP Analogy

The hook side is completely familiar. `transition_post_status` is the hook you reach for whenever
"do something when a post is published" comes up, and you already know why it beats `save_post`:
it gives you both the old and new status, so you can act on `draft → publish` without also firing
on every autosave. `wp_remote_post()` is `wp_remote_*`, the same function you use to call any
third-party API from WordPress, with the same `blocking` and `timeout` arguments and the same
`WP_Error` return. Webhooks out of WordPress are not new — WooCommerce, Jetpack and every CRM
integration you have installed do exactly this.

| Classic WordPress | This stack |
|---|---|
| `transition_post_status` → clear a page cache | `transition_post_status` → `POST /api/revalidate` |
| `wp_remote_post()` to a third-party API | unchanged — same function, same arguments |
| `blocking => false` on analytics pings | unchanged, and load-bearing here |
| `hash_hmac( 'sha256', … )` for a payment callback | unchanged — this is the standard webhook pattern |
| `hash_equals()` on an incoming signature | `crypto.timingSafeEqual()` on the Next side |
| a nonce for a same-origin form | **not applicable** — this request has no browser and no cookie |
| verifying a Stripe/PayPal IPN signature | verifying your own signature, in the other direction |

If you have ever implemented a payment-gateway callback properly, you have written the receiving
half of this before: verify the signature over the **raw** body, check a timestamp, then and only
then parse. The order is not stylistic. Parsing before verifying means running a parser on
attacker-controlled input, and reading the body twice in a way that lets the signed bytes and the
parsed bytes differ is its own vulnerability class.

**Where the analogy breaks down:** cache invalidation in Classic WordPress is an **internal**
operation. `delete_transient()` or a page-cache plugin's flush runs in the same process, needs no
credential, and cannot be triggered by a stranger. Here invalidation is a **public HTTP endpoint on
a different machine**, and an unauthenticated one would be a free denial-of-service lever: an
attacker who can invalidate your entire cache in a loop makes every request a cache miss and
points all of that traffic at your WordPress origin. That is why the signature is not optional and
why the `Zod` parse is not paranoia.

The second break, and it is the one that eats an afternoon: in Classic WordPress the cache is
inside the container, so networking never enters the picture. Here Next runs on the **host** and
WordPress runs in Compose, so `localhost:3000` inside the container is the container itself.
`BTT_FRONTEND_URL` must be `http://host.docker.internal:3000`, and on Linux that name only resolves
if you added `extra_hosts: ["host.docker.internal:host-gateway"]`. Combined with `blocking => false`
throwing away the response, this is the number-one cause of "my revalidation webhook silently does
nothing" — see [appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv).

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
