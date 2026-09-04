---
title: 'Faust Auth & Templates'
module: 17
lesson: 3
teaches: [faust-auth, apollo-coupling, wp-controlled-routing, framework-lock-in, spike-evaluation]
produces: []
requires: [17.2]
---

# Lesson 17.3 — Faust Auth & Templates

## Quick Overview

You have now built preview twice: once with Faust's version in Lesson 17.1's spike, and once by
hand in 17.2. This lesson finishes the evaluation by putting the remaining two Faust features
under the same light — its **auth** flow and its **template hierarchy** — and measuring both
against what Module 15 and your own routes already do. Faust's auth is genuinely well made: a
`useAuth` hook, a redirect-based login against WordPress, and token handling you do not write.
Its templates are the reason people adopt it: `wp-templates/` resolves like `single-{post_type}.php`,
which means an editor changing a page's template in wp-admin changes what renders, with no deploy
and no route file.

Both come with the same string attached, and this lesson's job is to make that string visible
rather than to argue about it. Faust's data layer is **Apollo Client**, and its template resolution
is **its own router**. Every query in a Faust template flows through Apollo's cache, which is a
client-side normalised store with no relationship to Next's server-side Data Cache — so `next: { tags }`,
`revalidateTag` and on-demand ISR either do not apply or apply somewhere you cannot reach. You
will render the *same* incident three ways — your route, your route in preview mode, and the Faust
template — and compare four things that matter: what is in the HTML on first byte, what the client
bundle weighs, whether the response can be cached under a tag, and where the auth token lives. Do
the measurement before you form the opinion; Lesson 17.4 is where the opinion goes.

By the end of this lesson you will have:

- Faust auth working in the spike: login, `useAuth`, and a page that only renders for an
  authenticated WordPress user
- A second Faust template — an archive alongside the single — proving WP-controlled routing works
  as advertised
- A four-column measurement table for the same content rendered three ways: first-byte HTML,
  client JS weight, cacheability under a tag, token location
- A written note on where Faust's auth stores its token, and how that compares with the httpOnly
  cookie rules in [appendix 04 §4](../appendix/04-env-reference.md#session-cookies)
- The completed Faust scorecard from the module README, every row evidenced by something you ran
- A shortlist of the two or three team situations in which this trade is clearly the right one

## Classic WP Analogy

Faust's template hierarchy is the classic template hierarchy, ported. `wp-templates/single-incident.js`
is `single-incident.php`; `wp-templates/archive.js` is `archive.php`; the fallback chain behaves the
way you expect and the "seed query" that tells Faust which template to pick is `template-loader.php`
asking WordPress what this URI is. If you have ever explained to a client that changing the Page
Template dropdown changes the layout with no developer involved, Faust preserves that promise, and
your hand-written App Router routes do not.

Faust auth maps just as neatly. Its login redirect to `/wp-login.php` and back is what every
membership plugin does; `useAuth` is `is_user_logged_in()` with a loading state; and the "logged-in
users see more fields" pattern is a `current_user_can()` branch in a template. None of this is
exotic.

**Where the analogy breaks down — two places, both structural:**

The template hierarchy in Classic WordPress is free because rendering is server-side and
synchronous. Faust reproduces the *resolution* but not the *cost model*: the seed query is an extra
round trip, template resolution happens where Next would otherwise be deciding a route's rendering
strategy, and the data behind the template arrives through Apollo. A classic theme's flexibility
costs nothing at runtime. Faust's costs a request, a client cache, and your ability to declare
`revalidate` per route. This app's central claim — a static, tag-invalidated site that goes live
seconds after Publish — is built entirely out of what Faust abstracts away.

The second break is about auth storage. In Classic WordPress the auth cookie is set by PHP,
httpOnly, and unreachable from JavaScript; the browser is never trusted with anything readable.
Any client-side auth layer, Faust's included, has to keep something where the client code can reach
it, because a hook cannot read an httpOnly cookie. Module 15 spent a whole lesson keeping the token
out of JavaScript's reach; adopting a client-side auth layer would quietly hand back that property.
Check exactly where the spike stores its token before you decide how much that matters — and note
that this is a consequence of client-side rendering in general, not a bug in Faust.

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
