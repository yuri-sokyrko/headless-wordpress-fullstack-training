---
title: 'Auth Concepts for WordPress Developers'
module: 15
lesson: 1
teaches: [jwt-anatomy, session-vs-token, threat-modelling, credential-inventory, trust-boundaries]
produces: []
requires: [10.1]
---

# Lesson 15.1 — Auth Concepts for WordPress Developers

## Quick Overview

Blame The Tech has two audiences that both need to be authenticated, and they have almost
nothing in common. The first is **editors**, who log into wp-admin with a username and a
password, get a WordPress session cookie, compose blocks, and — from Module 17 — hit Preview
and expect Next.js to render their draft. The second is **public developers**, who register on
the Next.js app, never see wp-admin at all, and exist only so they can file an incident that an
editor will later moderate. One audience authenticates *to WordPress*; the other authenticates
*to Next.js, which then acts on their behalf against WordPress*. Every design decision in this
module follows from keeping those two paths separate.

This lesson writes no code. It builds the vocabulary and the threat model you need before you
touch a cookie attribute, because auth is the one area of the stack where a plausible-looking
implementation and a correct one are indistinguishable until someone attacks it. You will take
apart a JWT by hand, name what is and is not protected by a signature, and produce a written
inventory of every credential in the system — which of them represents a human, which
represents the application, where each one is allowed to be stored, and what an attacker gets
if they steal it. The two credentials in [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials)
are the ones you must never confuse; confusing them is the most consequential mistake this
architecture permits.

By the end of this lesson you will have:

- A decoded JWT, split into header / payload / signature, with the payload read as plain
  base64url — proving that a JWT is **signed, not encrypted**
- A written credential inventory: user JWT, refresh token, application token, revalidation
  HMAC secret, preview token — each with its lifetime, transport, storage location and blast radius
- A two-column threat model for the editor path and the public-developer path, with the
  attacker capability each control actually removes
- A one-paragraph note in your own words on why the browser never talks to `/graphql`, and why
  that removes CORS, introspection and rate-limiting problems rather than hiding them
- A list of the four storage locations this course forbids for any session credential, and the
  single documented exception (Lesson 17.2)

## Classic WP Analogy

You already know WordPress's authentication stack better than you think. `wp_signon()` checks a
password against the `wp_users.user_pass` hash, `wp_set_auth_cookie()` writes
`wordpress_logged_in_<hash>` — an httpOnly cookie signed with `AUTH_KEY` and `AUTH_SALT` —
`wp_validate_auth_cookie()` re-checks it on every request, and `current_user_can()` answers the
authorization question separately from the authentication one. `wp_create_nonce()` handles CSRF
for form posts and admin-ajax calls.

The headless equivalents line up almost suspiciously well:

| Classic WordPress | This stack |
|---|---|
| `wp_signon( $creds )` | the WPGraphQL `login` mutation (Lesson 15.2) |
| `wp_set_auth_cookie()` | `cookies().set('btt_at', …)` in a Server Action (Lesson 15.4) |
| `wordpress_logged_in_*` cookie | the `btt_at` httpOnly cookie — **also** unreadable by JavaScript |
| `wp_validate_auth_cookie()` | WordPress re-verifying the `Authorization: Bearer` JWT on every call |
| `current_user_can( 'publish_posts' )` | `current_user_can( 'publish_incidents' )` — unchanged, still in PHP |
| `wp_create_nonce()` / `check_admin_referer()` | Next's Origin/Host check on Server Action POSTs plus `SameSite` (Lesson 15.5) |
| `is_user_logged_in()` in a template | `getSession()` reading `cookies()` in a Server Component |

**Where the analogy breaks down, and it breaks in the direction that matters:** a WordPress auth
cookie is *stateful by convention* — it is validated against a user row and a session token
stored in `wp_usermeta`, so `wp_destroy_current_session()` genuinely revokes it. A JWT is
**stateless**: it is a signed claim with an expiry, and nothing you do in Next.js can un-issue
one. That single property drives three decisions you will otherwise find arbitrary. It is why
`btt_at` lives for 300 seconds instead of a fortnight — the expiry *is* the revocation
mechanism. It is why logout deletes cookies and is honest with you that a stolen token stays
valid until it expires. And it is why the eight WordPress salts are the real emergency brake:
rotating them logs everyone out at once, which is an incident-response procedure rather than a
bug.

The second break is subtler. In Classic WordPress, one credential does everything — the same
cookie proves who you are for reading, writing and administering. Here, "who the user is" and
"which application is calling" are two separate credentials with different transports, different
lifetimes and different storage rules, and code that reaches for the wrong one usually still
works. That is exactly what makes it dangerous.

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
