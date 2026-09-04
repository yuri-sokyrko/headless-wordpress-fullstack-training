---
title: 'The Moderation Loop & the Start Now CTA'
module: 16
lesson: 4
teaches: [moderation-workflow, status-transitions, structural-authorization, kill-switch, conversion-cta]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/admin/moderation-queue.php', 'next-app/src/components/hobt/StartNowButton.tsx']
requires: [3.4, 16.3]
---

# Lesson 16.4 — The Moderation Loop & the Start Now CTA

## Quick Overview

Everything is in place except the last link. Registered developers can submit incidents; those
incidents sit at `pending`; nobody has yet made it pleasant for an editor to do something about
them. This lesson builds the wp-admin side of the moderation queue — a filtered list view, an
admin column showing scapegoat and severity at a glance, row actions for Approve and Reject, and
a mail to the reporter on transition — and then closes the loop: **editor approves in wp-admin →
`transition_post_status` fires → the webhook posts to Next (Module 18) → the incident appears
publicly.** Until Module 18 lands that webhook, the incident appears at the end of the ISR window
instead of within a second, and watching the difference is the best possible motivation for the
next-but-one module.

Notice what you do **not** build: a permission check on the Approve action. `incident_reporter`
has no `publish_incidents` capability at all
([appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)), so the
row action simply does not render for it, and a hand-crafted POST to `post.php` fails inside
WordPress's own authorization layer before your code runs. That is what structural authorization
buys: there is no code path to audit, because there is no capability to abuse. The second half of
the lesson wires the **Start Now** CTA on `/hobt` to `start_now_url` from the HOBT Promo field
group, honours the `incident_submission_open` kill switch from
[appendix 03 §4.5](../appendix/03-content-model-reference.md#45-site-settings-options-page) in the
submit action, and adds the Playwright spec that walks the whole funnel end to end.

By the end of this lesson you will have:

- `includes/admin/moderation-queue.php` — a pending-incidents view with scapegoat and severity
  columns, Approve and Reject row actions, and a reporter notification on transition
- A `transition_post_status` handler that notifies the reporter by mail, visible in Mailpit, and
  that Module 18 will extend into the revalidation webhook
- `StartNowButton.tsx` reading `startNowUrl` from the block-composed HOBT page, with the outbound
  link attributed so conversions are attributable
- The `incident_submission_open` kill switch honoured by `submitIncident` — flip it off in wp-admin
  and the form refuses politely instead of erroring
- A Playwright spec covering the full loop: register, log in, submit, approve as editor, assert the
  incident is publicly visible
- A proof that a reporter cannot publish: their token against `/graphql`, and a direct POST to
  `post.php` with `post_status=publish`, both refused

## Classic WP Analogy

This is the most familiar lesson in Phase 3, because it is pure Classic WordPress. A Contributor
writes a post, it lands as `pending`, an Editor sees it under Posts → Pending, reviews it, and
clicks Publish. That workflow has shipped in core since 2003 and it is the reason `pending` exists
as a status. Everything in this lesson is `manage_edit-incident_columns`,
`manage_incident_posts_custom_column`, `post_row_actions`, `pre_get_posts` on the list screen, and
`transition_post_status` — hooks you have all used.

| Classic WordPress | This stack |
|---|---|
| Contributor → `pending` → Editor publishes | unchanged, and deliberately so |
| `post_row_actions` + `admin_action_*` | unchanged — moderation stays in wp-admin |
| `manage_edit-{$type}_columns` | unchanged |
| `transition_post_status` → `wp_mail()` | unchanged, plus `wp_remote_post()` to Next in Module 18 |
| an option-based feature flag | `incident_submission_open` in Site Settings, honoured by the Server Action |
| the post appears the moment you publish | it appears when Next's cache is invalidated — Module 18 |

The design decision worth naming: moderation stays in **wp-admin**, not in a bespoke Next.js
dashboard. Editors already know that screen, it already has revisions, autosave, the block editor,
capability enforcement, keyboard shortcuts and bulk actions, and rebuilding a worse version of it
in React would be several weeks of work that makes the product worse. Headless does not mean
"reimplement the admin".

**Where the analogy breaks down:** in Classic WordPress, publishing *is* the deploy. `wp_publish_post()`
runs, the object cache entry is invalidated, and the very next front-end request renders the new
post — the loop closes inside one PHP process. Here, publishing changes state in a system that has
no idea what Next.js has cached. Next holds a static page it is perfectly happy with, and no amount
of clicking Publish tells it otherwise. That gap between "published in WordPress" and "visible to
the public" is new, it is the single most common complaint about headless CMS setups, and it does
not close until Lesson 18.3 signs a webhook. Feel the delay in this lesson so that the webhook
lands as a fix rather than a formality.

The second break: `wp_mail()` to a reporter now needs to link to `/en/account`, not to wp-admin —
the recipient has no dashboard. Every editorial notification in a headless build needs its
destination re-pointed at the front end, and it is easy to miss because the mail still sends
perfectly.

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
