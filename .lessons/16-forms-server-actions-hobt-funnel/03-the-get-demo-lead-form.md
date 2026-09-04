---
title: 'The Get Demo Lead Form'
module: 16
lesson: 3
teaches: [custom-table-writes, turnstile, honeypot-and-timing, pii-minimization, app-token]
produces: ['next-app/src/actions/leads.ts', 'next-app/src/components/hobt/LeadForm.tsx', 'next-app/src/components/hobt/GetDemoDialog.tsx']
requires: [6.3, 16.2]
---

# Lesson 16.3 — The Get Demo Lead Form

## Quick Overview

The Get Demo button on `/hobt` has been inert since Module 11. Now it opens a dialog, captures a
lead, and writes it into `wp_btt_leads` — a **custom table**, not a custom post type. That choice
is made in [appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads)
and the reasoning is worth internalising, because it is the one place in this course where the
WordPress-shaped answer is the wrong one. A CPT is one misconfigured `show_in_rest` or
`show_in_graphql` away from publishing every lead you have ever collected; a custom table is
invisible to WordPress's content APIs by construction. It also gives you a database-enforced
`UNIQUE KEY (email, source)`, which has no CPT equivalent, and it avoids eight `wp_postmeta` rows
per lead.

This form is public, which means it is a spam target and a PII store at the same time. Four
controls stack, cheapest first: a **honeypot** field that real users never fill, a **render-timing**
check that rejects submissions arriving impossibly fast after the form was served, **Cloudflare
Turnstile** verified server-side against `siteverify` (the site key is public by design, the
secret key is not — [appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-four-of-them)),
and the per-IP rate limiter from Lesson 16.2. On the data side there are two absolute rules.
`ip_hash` is an **HMAC** keyed with `BTT_LEAD_IP_HMAC_KEY`, never a raw address — it exists to
deduplicate and to spot abuse, not to identify a person. And **never log PII or tokens**: no email
in a `console.log`, no request body in an error path, no Bearer token in a Sentry breadcrumb. A
log line is a database you did not mean to create, with no retention policy and much wider read
access.

By the end of this lesson you will have:

- `src/actions/leads.ts` — `submitLead`, the same five steps as Lesson 16.2, calling
  `submitHobtLead` with `X-BTT-App-Token` because there is no logged-in user
- `GetDemoDialog.tsx` and `LeadForm.tsx` — a Radix dialog with focus trapping and a form that
  still submits without JavaScript
- Honeypot plus render-timestamp fields, and a server-side Turnstile `siteverify` call whose
  failure path returns a generic message
- Rows in `wp_btt_leads` you can read in Adminer on `:8081`, with `ip_hash` as 64 hex characters
  and no raw IP anywhere
- A duplicate-submission test proving the database rejects the second `(email, source)` pair
  rather than your PHP remembering to
- A grep-based check over your own logs and error paths confirming no email address, IP or token
  is ever written

## Classic WP Analogy

You have built this form before, most likely with Contact Form 7, WPForms or Gravity Forms, and
those plugins do exactly what this lesson does: validate, check a spam signal, store the entry,
notify someone. Gravity Forms even stores entries in its **own tables** — `wp_gf_entry` and
friends — for precisely the reasons in §5 above. `submitHobtLead` is a hand-rolled version of
that, and the PHP is the PHP you already know: `dbDelta()` on activation, `$wpdb->insert()` with
format specifiers, `$wpdb->prepare()` for reads.

| Classic WordPress | This stack |
|---|---|
| a CF7 / Gravity Forms form | `LeadForm.tsx` + `submitLead` Server Action |
| Gravity Forms entries in `wp_gf_entry` | `wp_btt_leads`, created with `dbDelta()` |
| Akismet | Turnstile + honeypot + render-timing + rate limit |
| `wp_mail()` on submit, caught by Mailpit | unchanged — `wp_mail()`, optionally Resend in production |
| a `nonce` on the AJAX submit | `X-BTT-App-Token` on the mutation + the Origin check on the action |
| `$wpdb->insert( $table, $data, ['%s','%s'] )` | unchanged — this is the one place you write real SQL |

**Where the analogy breaks down:** a form plugin's submit handler runs *inside* WordPress, as
whichever user happens to be browsing — usually nobody, which is fine because there is no
authorization question. Here the write crosses a network boundary to an endpoint that must
authenticate *something*, and the something cannot be a user, because leads come from anonymous
visitors. That is the whole reason the application token exists: `submitHobtLead` is authorised by
`X-BTT-App-Token`, proving "the Next.js app is calling", which is a completely different claim
from "this human is calling". WordPress compares it with `hash_equals()`, not `==`, and it never
travels to a browser under any circumstances. Reach for the user JWT here and it will not work;
reach for the app token in `createIncident` and it will work in a way you very much do not want.

The second break is legal rather than technical. A CF7 entry sitting in `wp_postmeta` on a client
site is somebody else's compliance problem. A leads table you designed, with a `consent` column
and an `ip_hash` column, is yours. That is why the column is `ip_hash CHAR(64)` and not
`ip VARCHAR(45)` — the schema encodes the retention decision, so the wrong thing cannot be stored
by accident later.

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
