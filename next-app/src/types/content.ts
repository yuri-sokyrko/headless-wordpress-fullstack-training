// The Blame The Tech content model, by hand, from the contract in appendix 03.
// Module 10 generates MOST of this from wordpress-headless/schema.graphql and deletes what it
// replaces. What survives is the part codegen cannot produce: the severity term slugs, which
// are taxonomy DATA rather than schema enums. Writing the rest once by hand is what makes that
// generated output readable — and Module 09 deliberately shows you what happens when a
// hand-written type drifts from the schema.

/* ── Registered GraphQL enums (appendix 03 §3) ────────────────────────────
   SCREAMING_SNAKE on the wire; the underlying SCF select values are kebab-case and
   the PHP resolver maps between them (Lesson 06.1). A client only sees the wire. */
export type IncidentEnvironment = 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'WORKS_ON_MY_MACHINE';

export type IncidentResolutionStatus = 'OPEN' | 'MITIGATED' | 'BLAMED' | 'WONTFIX';

export type TechReviewVerdict = 'ADOPT' | 'TRIAL' | 'ASSESS' | 'HOLD';

export type LeadSource = 'HOBT_HERO' | 'HOBT_CTA_BLOCK' | 'HOBT_FOOTER' | 'INCIDENT_SIDEBAR';

/* ── Taxonomy terms (appendix 03 §2) ─────────────────────────────────── */

// The `severity` taxonomy is a CLOSED set: four terms, created on activation, term UI
// locked to radio buttons, never extended. So it is a union, not a string.
export type SeverityLevel = 's1-catastrophic' | 's2-major' | 's3-minor' | 's4-cosmetic';

// `scapegoat` and `tech_stack` are free-form, so their slugs stay `string`.
export type Term = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly count: number | null; // wp_term_taxonomy.count — the leaderboard reads this
};

export type SeverityTerm = {
  readonly id: string;
  readonly name: string;
  readonly slug: SeverityLevel;
  readonly count: number | null;
};

/* ── Incident Details (appendix 03 §4.1) ─────────────────────────────── */
export type IncidentDetails = {
  readonly occurredAt: string | null; // ISO 8601 string. There is no Date over JSON.
  readonly downtimeMinutes: number | null;
  readonly estimatedCostUsd: number | null;
  readonly environment: IncidentEnvironment | null;
  readonly resolutionStatus: IncidentResolutionStatus | null;
  readonly blameConfidence: number | null; // Range 0–100, default 73
  readonly stackTrace: string | null; // rendered in <pre>, ESCAPED. Never as HTML.
  readonly reporterDisplayName: string | null; // denormalised — reporters are not WP authors
  readonly isVerified: boolean | null;
};

export type Incident = {
  readonly id: string; // the global relay ID
  readonly databaseId: number; // the WP post ID
  readonly slug: string;
  readonly title: string;
  readonly date: string | null;
  readonly blameScore: number | null; // registered in Lesson 06.1, computed server-side
  readonly incidentDetails: IncidentDetails | null;
  // In the schema these are Relay CONNECTIONS, not arrays, and `scapegoats` carries an
  // SCF term field group. Lesson 07.4 fixes both — flat `Term[]` is a placeholder.
  readonly severities: readonly SeverityTerm[];
  readonly scapegoats: readonly Term[];
  readonly techStacks: readonly Term[];
  readonly content?: string | null; // only when you select it
};

/* ── The response shape of the BlameBoard query from Lesson 07.2 ─────── */

// `incidents` is nullable because a GraphQL error arrives with HTTP 200 and no data.
export type BlameBoardData = {
  readonly incidents: { readonly nodes: readonly Incident[] } | null;
};
