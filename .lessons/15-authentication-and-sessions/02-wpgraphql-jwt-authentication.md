---
title: 'WPGraphQL JWT Authentication'
module: 15
lesson: 2
teaches: [wpgraphql-jwt, bearer-authorization, app-token, secret-separation, hash-equals]
produces: ['wordpress-headless/.env.example', 'next-app/.env.example', 'next-app/src/graphql/auth.graphql']
requires: [10.1, 15.1]
---

# Lesson 15.2 — WPGraphQL JWT Authentication

## Quick Overview

Install and configure **WPGraphQL JWT Authentication**, and WordPress gains three things: a
`login` mutation that trades a username and password for a signed token pair, a
`refreshJwtAuthToken` mutation that trades a long-lived refresh token for a fresh short-lived
one, and the ability to authenticate any GraphQL request that arrives with an
`Authorization: Bearer <jwt>` header. That is the whole surface. Everything else in this module
is you deciding where that token is allowed to live and who is allowed to trust it.

The configuration has one non-obvious requirement and one genuine trap. The requirement is that
`GRAPHQL_JWT_AUTH_SECRET_KEY` must be a value that appears nowhere else — in particular it must
differ from `AUTH_KEY`, for the blast-radius reason spelled out in
[appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key).
The trap is the second credential you add in this lesson: `BTT_APP_TOKEN`, which identifies
**the Next.js application** rather than any human, travels in `X-BTT-App-Token`, and exists
because `registerDeveloper` and `submitHobtLead` have to be callable when there is no logged-in
user at all. A user JWT and an app token are not interchangeable, and code that substitutes one
for the other frequently still returns `200`. You will build both, and you will build the check
that compares the app token with `hash_equals()` rather than `==`, so that a wrong guess cannot
be narrowed down by timing the response.

By the end of this lesson you will have:

- WPGraphQL JWT Authentication installed, with nine independent secrets generated and
  `GRAPHQL_JWT_AUTH_SECRET_KEY` verifiably different from `AUTH_KEY`
- `wordpress-headless/.env.example` and `next-app/.env.example` extended with `BTT_APP_TOKEN` /
  `WP_APP_TOKEN` as `__CHANGE_ME__` placeholders, and the real values only in gitignored files
- A working `login` mutation returning `authToken`, `refreshToken` and a `user` payload, proven
  from `curl` and from GraphiQL
- `next-app/src/graphql/auth.graphql` holding the `Login`, `RefreshToken` and `Viewer` documents,
  typed by codegen
- An app-token guard in PHP that rejects a missing or wrong `X-BTT-App-Token` with a constant-time
  comparison, plus a `curl` proof that a one-character-off token fails
- A `curl` transcript showing the same `viewer` query returning `null` anonymously and a real
  user with a Bearer token

## Classic WP Analogy

`wp-login.php` is the closest thing you have already used. A form POSTs credentials, WordPress
calls `wp_authenticate()`, and on success `wp_set_auth_cookie()` issues a cookie that is
validated on every subsequent request. The `login` mutation is that endpoint with the HTML
stripped off: same `wp_authenticate()` underneath, same filters, same failed-login hooks — but
instead of a `Set-Cookie` header it hands back a string, and it hands it to a *server*, not a
browser.

The application token has an analogy too, and it is one most WordPress developers have used
without naming: **Application Passwords**. Core's Application Passwords exist for exactly this
situation — a script that needs to call the REST API when nobody is sitting at a keyboard. They
are a machine credential, sent in a header, revocable independently of the user's password.
`BTT_APP_TOKEN` occupies the same slot in this architecture, with one deliberate difference:
core's Application Passwords are still *scoped to a user*, whereas the app token is scoped to
the *application* and grants only the two specific mutations that the app is allowed to perform
with no user present.

**Where the analogy breaks down:** the WordPress cookie is issued *to the browser* and the
browser is expected to keep presenting it, so a compromise of the browser is a compromise of the
session and nothing more. The JWT here is issued to your **server**, and the app token is a
credential your server holds permanently. That inverts the threat model. In Classic WordPress the
scariest place a credential can end up is a user's machine; in this stack the scariest place is
the client bundle — because a secret that reaches JavaScript has not leaked to one attacker, it
has been published to everyone who loads the page. That asymmetry is why `WP_APP_TOKEN` may
never take a `NEXT_PUBLIC_` prefix and why Lesson 09.5's `grep` over `.next/static/` becomes a
CI gate in Module 24.

The second break: WordPress validates its own cookie, so there is exactly one authority and no
question about who checks what. Here there are two runtimes, and the token is verified by
**WordPress only**. Next.js never holds `GRAPHQL_JWT_AUTH_SECRET_KEY` and therefore *cannot*
verify a token even if you wanted it to — which is the point, and which Lesson 15.5 makes into a
rule.

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
