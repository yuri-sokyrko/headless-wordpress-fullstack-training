---
title: 'Public Registration & Roles'
module: 15
lesson: 3
teaches: [register-developer-mutation, map-meta-cap, structural-authorization, role-hardening, email-verification]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php', 'next-app/src/app/[locale]/(auth)/register/page.tsx', 'next-app/src/app/[locale]/(auth)/verify/page.tsx']
requires: [3.4, 6.3, 15.2]
---

# Lesson 15.3 — Public Registration & Roles

## Quick Overview

Public developers need accounts, and WordPress has a perfectly good registration system you are
about to deliberately not use. `users_can_register` stays **off** and `/wp-login.php?action=register`
stays closed, because opening it would create a second door into the same user table — one that
assigns `get_option('default_role')` instead of the role this app actually needs, and one you
would then have to remember to harden separately. Registration goes through the custom
`registerDeveloper` mutation from Module 06 instead, which assigns `incident_reporter`
explicitly, sets `btt_verified = 0`, and sends a verification mail. One door, not two.

The role itself is where the real lesson is. Look at the capability matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) and notice
what `incident_reporter` does **not** have: `publish_incidents`. That single omission is what
makes moderation structural rather than procedural. There is no code path by which a public user
publishes an incident — not because a check in the mutation catches them, but because
WordPress's own authorization layer has no capability to grant. Compare that with the version of
this feature you have probably written before: an `if ( $status === 'publish' ) { wp_die(); }`
somewhere in a handler, which is correct exactly as long as every future contributor remembers
it exists and no second handler is ever added. In this lesson you will also strip
`edit_posts` from the role so it cannot reach the block editor or upload media, turn off its
admin bar, and redirect it away from wp-admin on `admin_init` — public users get a front end,
not a dashboard.

By the end of this lesson you will have:

- `users_can_register` confirmed off, with a `curl` showing `/wp-login.php?action=register` does
  not offer a registration form
- A hardened `incident_reporter` role in `includes/roles.php`: no `edit_posts`, no
  `upload_files`, no `publish_incidents`, no admin bar, redirected out of wp-admin
- A working `registerDeveloper` call that creates the user with the right role and queues a
  verification mail, visible in Mailpit on `:8025`
- `/en/register` and `/en/verify` pages wired to the mutation through a Server Action, with the
  app token sent server-side only
- A capability probe — a `curl` proving a freshly registered reporter's token cannot publish,
  and cannot even read `/wp-admin/`
- A note in your own words on why `registerUser` (WPGraphQL's built-in) is the wrong mutation here

## Classic WP Analogy

You have configured this exact feature before, from Settings → General → "Anyone can register",
with `default_role` set to Subscriber. Under the hood that path runs `register_new_user()` →
`wp_create_user()` → `wp_new_user_notification()`, and every membership plugin you have installed
has hooked `user_register` to bolt extra behaviour onto it. `registerDeveloper` is the same
sequence, called from a mutation resolver instead of from a form handler, with the role passed
explicitly instead of read from an option.

The capability model is not an analogy at all — it is *literally the same system*. `add_role()`,
`WP_Role::add_cap()`, `current_user_can()`, `map_meta_cap` and the generated
`edit_incident` / `publish_incidents` / `edit_others_incidents` family behave in the headless
build exactly as they behave in a classic theme. If you have ever debugged why a Contributor
could not publish, you already understand the moderation queue in this application. The
difference is only that the check now runs inside a GraphQL resolver rather than inside
`wp-admin/post.php`.

**Where the analogy breaks down:** in a classic site, "logged in" and "in wp-admin" are nearly
the same state. A Subscriber who logs in lands on the dashboard, sees the admin bar on the front
end, and has a profile screen. Here, `incident_reporter` is a **front-end-only identity**. It has
a WordPress user row, a password hash and a set of capabilities, but it must never see wp-admin —
so `show_admin_bar_front` is off and `admin_init` redirects it away. That inverts a reflex: in
classic WordPress you *grant* capabilities to let a role do its job in the dashboard; here you
withhold nearly everything and let the role act only through mutations your own code exposes.
Anything you forget to remove is reachable surface.

The second break: `wp_new_user_notification()` mails a password-reset link into wp-login. That is
the wrong destination for a user who is not allowed into wp-admin, so this lesson replaces the
notification with one that links to `/en/verify` on the Next app. Mail is captured by Mailpit
locally, which is why Module 02 put it in the Compose file.

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
