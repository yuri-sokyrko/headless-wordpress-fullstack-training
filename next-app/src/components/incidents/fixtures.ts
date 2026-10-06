// Typed incident fixtures in REAL WPGraphQL response shape.
//
// Six incidents are hand-written; INCIDENTS expands them to forty, which is what
// `wp blame seed` produces (appendix 03 §9) and what makes the Lesson 08.3 filter
// worth writing. Lesson 09.3 deletes the INCIDENTS import from the page and puts a
// live query in its place; no component changes, because the shape here is the
// shape the API returns.
import type { IncidentCardFieldsFragment } from '@/gql/graphql';

// What the card, list and filters render is exactly the `IncidentCardFields` fragment, so a
// fixture is that shape and nothing more. A field the query never selects is deleted here:
// nothing could render it, and an excess property is a compile error.
type Incident = IncidentCardFieldsFragment;

// content.ts no longer exports term types (codegen owns them), so the fixture terms are local.
type FixtureTerm = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly count: number;
};

/**
 * Index a non-empty array and narrow away `undefined`.
 *
 * `noUncheckedIndexedAccess` (Lesson 07.3) types `items[i]` as `T | undefined`,
 * and it is right to: nothing about an array type promises a length. Here an
 * empty array is a programming error rather than a state to render, so this
 * throws instead of returning a fallback.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];

  if (item === undefined) {
    throw new Error('at(): the array is empty');
  }

  return item;
}

/* ── Terms ────────────────────────────────────────────────────────────────
   `id` is an opaque base64 Relay global ID in the real API. Nothing in the UI
   parses it, which is exactly why a readable placeholder is safe in a fixture.
   `count` is wp_term_taxonomy.count — the leaderboard in Module 11 reads it. */

export const SEVERITY_TERMS: readonly FixtureTerm[] = [
  { id: 'fixture:severity:s1', name: 'S1 — Catastrophic', slug: 's1-catastrophic', count: 10 },
  { id: 'fixture:severity:s2', name: 'S2 — Major', slug: 's2-major', count: 10 },
  { id: 'fixture:severity:s3', name: 'S3 — Minor', slug: 's3-minor', count: 10 },
  { id: 'fixture:severity:s4', name: 'S4 — Cosmetic', slug: 's4-cosmetic', count: 10 },
];

// The ten terms the plugin creates on activation. `scapegoatProfile` is omitted
// rather than set to null: it is declared `?:` on the type, `exactOptionalPropertyTypes`
// is on, and "the query did not select it" is a different statement from "the
// field is empty". No Module 08 component reads it.

export const SCAPEGOAT_TERMS: readonly FixtureTerm[] = [
  { id: 'fixture:scapegoat:1', name: 'The Intern', slug: 'the-intern', count: 4 },
  { id: 'fixture:scapegoat:2', name: 'Mercury Retrograde', slug: 'mercury-retrograde', count: 4 },
  { id: 'fixture:scapegoat:3', name: 'Legacy jQuery', slug: 'legacy-jquery', count: 4 },
  { id: 'fixture:scapegoat:4', name: 'DNS', slug: 'dns', count: 4 },
  { id: 'fixture:scapegoat:5', name: 'Solar Flares', slug: 'solar-flares', count: 4 },
  { id: 'fixture:scapegoat:6', name: 'The Cache', slug: 'the-cache', count: 4 },
  {
    id: 'fixture:scapegoat:7',
    name: 'Daylight Saving Time',
    slug: 'daylight-saving-time',
    count: 4,
  },
  { id: 'fixture:scapegoat:8', name: 'That One Regex', slug: 'that-one-regex', count: 4 },
  { id: 'fixture:scapegoat:9', name: 'Kubernetes', slug: 'kubernetes', count: 4 },
  {
    id: 'fixture:scapegoat:10',
    name: 'The Previous Contractor',
    slug: 'the-previous-contractor',
    count: 4,
  },
];

/** The seeder's ten headlines, cycled with `(#n)` appended. Lesson 04.5. */
const SEED_HEADLINES: readonly string[] = [
  'Deployed on a Friday',
  'The certificate expired',
  'Someone rotated the wrong key',
  'The cron job ran twice',
  'A regex ate the payload',
  'The cache never invalidated',
  'DNS propagated to nowhere',
  'The migration ran backwards',
  'Autoscaling scaled to zero',
  'A leap second in the log parser',
];

/* ── The six hand-written incidents ──────────────────────────────────────
   Three fields deviate from `wp blame seed` ON PURPOSE, and the deviation is
   the point. The seeder fills every field of all forty rows, so it can never
   produce a null or a zero. The Module 16 submission form will, because SCF
   cannot promise a sub-field was filled. A fixture set that only covers the
   happy path is a fixture set that hides your nullability bugs until Module 16.

   Coverage in this array:  downtimeMinutes 0 · downtimeMinutes null ·
   an empty scapegoat connection · incidentDetails null entirely.
   (estimatedCostUsd and stackTrace nulls are no longer represented: the card fragment
   does not select them.) */

export const SEED_INCIDENTS: readonly Incident[] = [
  {
    id: 'fixture:incident:1',
    slug: 'incident-01',
    title: 'Deployed on a Friday (#1)',
    date: '2024-09-02T11:00:00',
    incidentDetails: {
      // ZERO, not null. A hot fix that caused no measurable outage. This single
      // value is what makes `{downtime && …}` print a bare 0 in Step 3.
      downtimeMinutes: 0,
      environment: 'PRODUCTION',
    },
    severities: { nodes: [at(SEVERITY_TERMS, 0)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 0)] },
  },
  {
    id: 'fixture:incident:2',
    slug: 'incident-02',
    title: 'The certificate expired (#2)',
    date: '2024-09-03T11:00:00',
    incidentDetails: {
      // NULL. Nobody measured. Distinct from zero, and the card must say so.
      downtimeMinutes: null,
      environment: 'STAGING',
    },
    severities: { nodes: [at(SEVERITY_TERMS, 1)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 1)] },
  },
  {
    id: 'fixture:incident:3',
    slug: 'incident-03',
    title: 'Someone rotated the wrong key (#3)',
    date: '2024-09-04T11:00:00',
    incidentDetails: {
      downtimeMinutes: 79,
      environment: 'DEVELOPMENT',
    },
    severities: { nodes: [at(SEVERITY_TERMS, 2)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 2)] },
  },
  {
    id: 'fixture:incident:4',
    slug: 'incident-04',
    title: 'The cron job ran twice (#4)',
    date: '2024-09-05T11:00:00',
    incidentDetails: {
      downtimeMinutes: 116,
      environment: 'WORKS_ON_MY_MACHINE',
    },
    severities: { nodes: [at(SEVERITY_TERMS, 3)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 3)] },
  },
  {
    id: 'fixture:incident:5',
    slug: 'incident-05',
    title: 'A regex ate the payload (#5)',
    date: '2024-09-06T11:00:00',
    incidentDetails: {
      downtimeMinutes: 153,
      environment: 'PRODUCTION',
    },
    severities: { nodes: [at(SEVERITY_TERMS, 0)] },
    // EMPTY CONNECTION. Nobody has been blamed yet. `nodes[0]` is `undefined`
    // here, and that is a state, not an error.
    scapegoats: { nodes: [] },
  },
  {
    id: 'fixture:incident:6',
    slug: 'incident-06',
    title: 'The cache never invalidated (#6)',
    date: '2024-09-07T11:00:00',
    // THE WHOLE SCF GROUP IS NULL. This is what an incident created before the
    // field group existed looks like, and what WPGraphQL for SCF returns when
    // no field in the group has ever been saved. Every `incidentDetails.x`
    // access in every component has to survive it.
    incidentDetails: null,
    severities: { nodes: [at(SEVERITY_TERMS, 1)] },
    scapegoats: { nodes: [at(SCAPEGOAT_TERMS, 5)] },
  },
];

/**
 * Forty incidents from six, deterministically.
 *
 * Cycles the four severity terms and the ten scapegoat terms exactly the way
 * `wp blame seed` does (`$i % 4` and `$i % 10`, Lesson 04.5), so severity and
 * scapegoat coverage matches the real site: ten incidents per severity, four per
 * scapegoat. Slugs follow the seeder's `incident-NN` pattern and are unique,
 * which is what makes them usable as React keys.
 *
 * No randomness anywhere. A fixture that differs between two runs is a fixture
 * you cannot write a test against — Lesson 12.4 makes the same argument in PHP.
 */
export function expandFixtures(seed: readonly Incident[], total: number): readonly Incident[] {
  return Array.from({ length: total }, (_unused, i): Incident => ({
    ...at(seed, i),
    id: `fixture:incident:${i + 1}`,
    slug: `incident-${String(i + 1).padStart(2, '0')}`,
    title: `${at(SEED_HEADLINES, i)} (#${i + 1})`,
    severities: { nodes: [at(SEVERITY_TERMS, i)] },
    // The one incident with an empty scapegoat connection keeps it. Losing the
    // edge case to the expansion would defeat the purpose of having written it.
    scapegoats:
      (at(seed, i).scapegoats?.nodes.length ?? 0) === 0
        ? { nodes: [] }
        : { nodes: [at(SCAPEGOAT_TERMS, i)] },
  }));
}

/** What the components actually render. Lesson 09.3 replaces this with a query. */
export const INCIDENTS: readonly Incident[] = expandFixtures(SEED_INCIDENTS, 40);
