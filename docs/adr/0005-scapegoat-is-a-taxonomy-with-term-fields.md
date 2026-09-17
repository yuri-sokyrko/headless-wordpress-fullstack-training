<!-- docs/adr/0005-scapegoat-is-a-taxonomy-with-term-fields.md -->

# ADR 0005 — Scapegoat is a taxonomy with a term field group

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Yuri Sokyrko
- **Supersedes:** —
- **Superseded by:** —

## Context

Every incident names a scapegoat — `the-intern`, `dns`, `mercury-retrograde` — and the leaderboard
in Lesson 05.4 has to rank scapegoats by how many incidents blame them, while each scapegoat also
carries editorial content: a tagline, an "official excuse", a defensiveness rating and whether it
is sentient. Two shapes can hold that: a `scapegoat` custom post type with a Relationship field
pointing at `incident`, or a `scapegoat` taxonomy (ADR-adjacent decision already made in Lesson
03.3) carrying an SCF term field group. Lesson 04.3 Key Concept 3 lays out the general version of
this choice — SCF's Post Object, Relationship and Page Link field types versus a taxonomy — purely
in terms of what each makes cheap or expensive to query, not which is more powerful.

## Decision

`scapegoat` stays a taxonomy on `incident` (Lesson 03.3), and its editorial fields live in the
`Scapegoat Profile` SCF field group, located with `taxonomy == scapegoat`, storing into
`wp_termmeta` and resolving in GraphQL as `Scapegoat.scapegoatProfile` — a different root field, a
different type and a different id strategy (`idType: SLUG`) from every post-type field group in
this project. No Relationship field is added anywhere to connect `incident` back to a `scapegoat`
CPT.

## Alternatives Considered

| Alternative | How it would work | Why not |
|---|---|---|
| `scapegoat` custom post type + Relationship field on `incident` | Each scapegoat is a post; `incident` gets a Relationship field storing an array of scapegoat post ids in `wp_postmeat`, editable with SCF's two-pane search-and-add UI | "Which incidents blame this scapegoat" requires `LIKE '%id%'` over a serialised `meta_value` — no index, no `tax_query`. There is no maintained count, so the leaderboard would need a `COUNT(*)` scan instead of reading `wp_term_taxonomy.count`, and revisions/long-form bodies on a CPT buy nothing this content needs |
| `scapegoat` taxonomy + term field group | **Chosen.** Terms give the indexed `tax_query` in both directions and a maintained `count`; the SCF term field group adds the editorial fields terms don't otherwise have | What I pay is below |

## Consequences

### Positive

- **The leaderboard is a maintained counter, not a query.** `wp_term_taxonomy.count` updates on
  every save via `wp_update_term_count()`, so "top scapegoat" is `ORDER BY count DESC`, not a scan
  over every incident.
- **The relation is answered in both directions for free**, with the same indexed `tax_query`
  reversed — `tech_stack` on `incident`/`tech_review`/`post` is the general case this pattern
  reuses (Lesson 04.3 Key Concept 3's table).
- **Term archives and admin-column filtering come from core**, with no code, because a taxonomy is
  what WordPress already knows how to list, count and filter by.

### Negative

- **Terms have no revisions.** Editing a scapegoat's tagline overwrites it with no history, unlike
  a CPT's post history.
- **No long-form editorial body.** A term has no `post_content`; the profile is fixed fields only —
  fine for a tagline and an excuse, wrong for a multi-paragraph writeup.
- **No editorial ordering.** Terms are unordered, so "feature these three scapegoats in this
  sequence" cannot be expressed here, unlike a Relationship field's drag-to-reorder UI.

## Trigger to revisit

A requirement for a curated, ordered list of incidents per scapegoat or per review — "the three
incidents we want featured, in this order" — is editorial content a taxonomy cannot hold. That is
exactly the case Lesson 04.3 Key Concept 3 names as the honest argument for a Relationship field,
and it is the point at which this decision should be reopened, not worked around with more terms.

## Related

- Lesson 03.3 — taxonomies and the scapegoat model, the decision that made `scapegoat` a taxonomy
- Lesson 04.3 Key Concept 2 — term field groups, `wp_termmeta`, and the `Scapegoat.scapegoatProfile`
  GraphQL attachment point
- Lesson 04.3 Key Concept 3 — the Post Object / Relationship / Page Link / Taxonomy comparison
  table this ADR's evidence is drawn from
