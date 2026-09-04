---
title: 'Security Hardening: WordPress'
module: 24
lesson: 1
teaches: [wp-hardening, disallow-file-mods, xmlrpc-off, rest-lockdown, graphql-introspection-off, query-depth-limits, persisted-queries, least-privilege-db-user]
produces: ['wordpress-headless/wp-content/mu-plugins/000-btt-hardening.php']
requires: [23.5, 06.4]
---

# Lesson 24.1 — Security Hardening: WordPress

## Quick Overview

Going headless changes your WordPress threat model in both directions at once. It removes
surface — no public theme rendering user input, no comment form, no search query hitting the
database from the open internet, no front-end plugin scripts. And it adds one large new opening
that no WordPress hardening guide written before 2019 mentions: **a GraphQL endpoint that will
happily describe your entire schema and execute arbitrarily nested queries against your
database.** This lesson closes the classic surface and then spends its second half on the new one.

The classic half is familiar work applied properly: lock `/wp-admin` and `/wp-login.php` at the
edge rather than with a plugin, disable XML-RPC, require authentication for REST routes that do
not need to be anonymous, set `DISALLOW_FILE_EDIT` and `DISALLOW_FILE_MODS` so wp-admin cannot
execute or install code, run as a least-privilege database user with no `GRANT`, `FILE` or
`SUPER` — and never as `root`, in any environment — and write down an update policy that says
who applies core and plugin updates and how fast. The GraphQL half is the new material:
introspection **off** in production with `graphql_debug` off alongside it, query depth and
complexity limits rejecting anything past depth 10, and then the strongest control available —
**persisted queries via WPGraphQL Smart Cache**, where the front end registers its operations by
hash at build time and production executes **only** hash-registered operations. An attacker with
your endpoint URL and a hand-written query gets nothing to execute.

And one honest caveat, per [appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin):
**keeping `WP_GRAPHQL_ENDPOINT` server-only is not security.** Media `sourceUrl` values are
public, so your WordPress host is discoverable regardless. The controls below are the ones doing
actual work.

By the end of this lesson you will have:

- `mu-plugins/000-btt-hardening.php` — environment-aware, branching on `WP_ENVIRONMENT_TYPE`, so
  local development is not crippled by production settings
- wp-admin and `wp-login.php` restricted at the edge, with a documented break-glass path for admins
- XML-RPC disabled, anonymous REST limited to what Gutenberg needs, user enumeration closed, and
  `DISALLOW_FILE_EDIT` / `DISALLOW_FILE_MODS` set in production — so plugins are installed by
  rebuilding the image, not from wp-admin
- A least-privilege MySQL user with the exact grants WordPress needs and nothing more
- GraphQL introspection off in production, depth and complexity limits set, and persisted queries
  enforced with a documented allowlist-registration step in the build
- A written update policy and a written statement of what hiding the origin does and does not buy

## Classic WP Analogy

Almost everything here is a hardening task you have done before, which makes the one genuinely
new item easier to spot.

| Classic WordPress hardening | Headless equivalent |
|---|---|
| Wordfence / iThemes login limiting | Edge rules at Cloudflare in front of Fly.io |
| `.htaccess` deny on `wp-login.php` | The same idea, one layer further out |
| `add_filter('xmlrpc_enabled', '__return_false')` | Identical, in the hardening mu-plugin |
| `define('DISALLOW_FILE_EDIT', true)` | Identical, from the environment |
| Hiding the WordPress version | Still worth doing, still not security |
| A security plugin's firewall | The edge, plus a WordPress that renders no front end |
| — | **GraphQL introspection, depth limits, persisted queries** |

The empty cell is the lesson. There is no Classic analogue for the GraphQL controls, because in a
Classic site the only query interface reachable by a stranger was a search box and an
`?author=1` enumeration. `POST /graphql` is a general-purpose, self-describing query interface —
run an introspection query and you receive every type, field, argument and mutation, formatted
for a code generator. That is exactly what makes WPGraphQL productive, and it is exactly why it
must be turned off in production.

Where the analogy breaks in a way worth stating plainly: **the classic instinct is to reduce
surface by hiding, and it does not work here.** Obscuring the login URL, removing the generator
tag, moving `wp-config.php` up a directory — these were cheap and marginally useful. The
equivalent instinct with GraphQL is "keep the endpoint secret", and it fails on contact with your
own media URLs. The controls that do work are all **allowlists**: a query allowlist (persisted
queries), a capability allowlist (the matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities)), and a
grant allowlist on the database user. Hiding is not a control. Enumerating what is permitted is.

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
