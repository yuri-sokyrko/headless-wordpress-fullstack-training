# ADR 0009 — Adopt Faust.js's preview patterns, decline Faust the framework

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Yurii S.
- **Supersedes:** —
- **Superseded by:** —

## Context

Blame The Tech is a headless WordPress build with a Next.js App Router front end. By Module 17 it
has: a typed `fetch` GraphQL client with cache tags (Module 10), a block renderer (Module 14),
httpOnly-cookie sessions with WordPress as the only authority on capability (Module 15), and
Server Actions for submission and moderation (Module 16). Module 18 will add per-route rendering
strategies and tag invalidation driven by a signed WordPress webhook.

Faust.js is WP Engine's Next.js framework for headless WordPress. It offers three things: a
WordPress template hierarchy in React, editor preview, and auth. It was evaluated as a spike —
`faust-spike/`, a sibling application on port 3001 against the same WordPress, with no change to
`next-app/`'s lockfile — across Lessons 17.1 and 17.3. Measurements are in `docs/architecture.md`.

At the time of the spike, `@faustwp/core` and `@faustwp/cli` were at 4.1.1 (published
2026-11-03; 4.1.0 on 2026-10-26, 4.0.0 on 2026-10-22), with `@apollo/client` 4.3.8. The peer range
for `next` is `^16.4.2`, so Faust now installs against the Next major we run — but the spike only
works through the Pages Router (`pages/[...wordpressNode].js`, `pages/api/faust/[route]`); there
is no App Router support, and Apollo is the fixed data layer. All three packages are MIT.

## Decision

We adopt Faust.js's preview _patterns_ — `draftMode()`, a `preview_post_link` filter, an
`asPreview` query flag, a single-use transient and an httpOnly cookie — and write them ourselves
in `next-app/`. We decline Faust the framework: routing, data layer and auth stay ours. The
capability whose loss drove the answer is **`revalidateTag` / on-demand invalidation**: Faust's
Apollo-backed catch-all route has no call site for it, and Module 18 is built on it.

## Options Considered

| Option                                             | How it would work                                                                                                                                                  | Why not, or why                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adopt Faust wholesale**                          | `pages/[...wordpressNode].js` resolves every URL through a seed query; `wp-templates/` replaces `src/app/[locale]/**`; Apollo replaces `src/lib/graphql/client.ts` | Forfeits per-route rendering strategies, `generateStaticParams` and tag invalidation — the whole of Module 18. Apollo's cache is client-side and `revalidateTag` has no call site to attach to (17.3 Step 6). Server Actions fight the catch-all route. A client-side `useAuth` needs a token JavaScript can read, which appendix 04 §4 forbids |
| **Adopt Faust for preview only, as a dependency**  | keep our routes; mount Faust's preview handler                                                                                                                     | Impossible: preview resolves the node through the same seed query and renders through `WordPressTemplate`. Layer 1 is not optional (17.1 §1)                                                                                                                                                                                                    |
| **Adopt Faust's preview PATTERNS, write the code** | `draftMode()`, `preview_post_link`, `asPreview`, a single-use transient, an httpOnly cookie                                                                        | **Chosen.** About 120 lines, no new dependency, and every primitive belongs to Next or WordPress core. Lesson 17.2                                                                                                                                                                                                                              |
| **No preview at all**                              | editors check content after publishing                                                                                                                             | Rejected. Editors will not accept it, and they are right not to                                                                                                                                                                                                                                                                                 |
| **Verdict**                                        | —                                                                                                                                                                  | **adopt the preview patterns; keep our own routing, data layer and auth**                                                                                                                                                                                                                                                                       |

## When this decision is wrong

Faust is the correct choice for real projects. Four conditions, and the threshold:

| Condition                                                          | True here?                      |
| ------------------------------------------------------------------ | ------------------------------- |
| The team is WP-first with limited Next.js depth                    | No                              |
| Editors must control routing or template selection from wp-admin   | No                              |
| No requirement for sub-minute, per-node content freshness          | No (a requirement exists)       |
| No Server Actions and no bespoke auth requirement                  | No (we have both)               |
| **Threshold: two or more true → adopt Faust and do not hand-roll** | **0 of 4 are true → hand-roll** |

- **WP-first team:** false. The whole course is Next.js App Router depth — RSC, Server Actions
  (Module 16), caching (Modules 10 and 18) — so Faust's abstraction would hide skills we already use.
- **Editors control templates:** false. Routes are `src/app/[locale]/**`; editors choose content,
  not templates. Faust's `wp-templates/` hierarchy is its strongest feature and we do not need it.
- **No freshness requirement:** false. Module 18's signed webhook invalidates `incident:<slug>`
  tags per node; Faust's route offers no place to attach `revalidateTag` (17.3 Step 6).
- **No Server Actions or bespoke auth:** false. Module 15's httpOnly-cookie sessions and Module 16's
  Server Actions are core; Faust's `useAuth` is client-side and needs a token JavaScript can read.

## Consequences

### Positive

- Per-route rendering and tag invalidation survive: pages are cacheable under `incident:<slug>`
  and `incidents`, which the Faust route cannot do (no call site passes `next: { tags }`).
- Auth stays server-side: tokens live in httpOnly cookies (`btt_at`, `btt_preview_jwt`) and
  `/en/account` is a 307 with no HTML, versus Faust's browser-side `useAuth` gate.
- No new runtime dependency or copyleft exposure in `next-app/`; preview is about 120 lines of
  Next and WordPress core primitives. One round trip fewer than Faust, which needs a seed query
  before the template query (two before first byte).
- No `__NEXT_DATA__` hydration payload; App Router sends RSC flight data instead.

### Negative

- **Editorial cost: no editor can change a template without a developer.** The developer pays,
  on every template change request — an unknown but probably small number per quarter for a
  single-site editorial team. Faust would let editors and WP-first developers do it in `wp-templates/`.
- We own the preview code (~120 lines): upgrades to WordPress, Next's `draftMode` and the
  `preview_post_link` contract are our responsibility to track.
- We forgo Faust's maintained template hierarchy, so a new post type needs a route, a query and
  a renderer written by hand.
- Faust's community, docs and WP Engine support do not apply; problems are debugged from first
  principles, and a new hire cannot lean on Faust knowledge.

### Neutral

- **Content lock-in: none, either way.** A page builder locks in _content_; Faust locks in _code_.
  Post types, SCF fields, taxonomies and block markup are identical whichever front end reads
  them, and stay queryable by whatever we point at `/graphql` next. This is why the verdict is
  "not for this application" rather than "never".
- Two GraphQL clients' worth of knowledge is avoided: ours is a typed `fetch` wrapper (ADR 0007);
  Apollo's normalised cache is a different model, neither better nor worse for server rendering.

### Licence finding (Lesson 07.1 §9)

- `@faustwp/core`: MIT (`npm view @faustwp/core license`, version 4.1.1)
- `@faustwp/cli`: MIT
- `@apollo/client`: MIT (4.3.8)
- `npx license-checker --production --summary` over the spike tree: MIT 182, Apache-2.0 19,
  BlueOak-1.0.0 7, ISC 7, BSD-3-Clause 6, BSD-2-Clause 3, LGPL-3.0-or-later 1, GPL-2.0-or-later 1,
  CC-BY-4.0 1, UNLICENSED 1 (the spike itself), 0BSD 1. Copyleft entries: `@wordpress/hooks`
  (GPL-2.0-or-later) and `@img/sharp-libvips-darwin-arm64` (LGPL-3.0-or-later, a Next image
  optimisation binary). No AGPL, SSPL or BUSL.
- Installing into `next-app/`, which is MIT, would have added a GPL-2.0-or-later dependency
  (`@wordpress/hooks`) to its tree, which is not compatible with an MIT distribution. The spike
  living **outside** `next-app/` is what made running it safe, and the verdict does not rest on it.

## Reversal Conditions

Rewrite this decision — as a NEW ADR that supersedes this one, never by editing this file — if:

- Two or more of the conditions in §When this decision is wrong become true for a project, or
  for this one — e.g. the team becomes WP-first or editors must pick templates in wp-admin.
- Module 18's requirement is dropped: per-node freshness no longer matters and no webhook-driven
  `revalidateTag` is used.
- Server Actions and bespoke cookie auth are both removed from the product.
- A `@faustwp/core` release documents App Router support (not merely a peer range including our
  Next major, which 4.1.1 already does) and lets us supply our own data layer instead of Apollo,
  with a call site for `revalidateTag`.
- The editorial cost reaches 6 or more template-change tickets per quarter for two consecutive
  quarters, or a client contract requires editors to change templates without a developer.

## Related

- Lesson 17.1 — the spike, and why it lived outside `next-app/`
- Lesson 17.2 — the code this decision kept
- Lesson 17.3 — the measurements every row above cites
- ADR 0007 — the hand-rolled GraphQL client this decision keeps
- ADR 0008 — shadcn copied rather than depended on; the same reversibility argument, one tier down
- `docs/architecture.md` — the evidence log and the four-column table
