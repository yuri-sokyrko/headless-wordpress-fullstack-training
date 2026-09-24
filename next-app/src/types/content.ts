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
  readonly severities: Connection<SeverityTerm>;
  readonly scapegoats: Connection<Scapegoat>;
  readonly techStacks: Connection<Term>;
  readonly content?: string | null; // only when you select it
};

/* ── The response shape of the BlameBoard query from Lesson 07.2 ─────── */

// `incidents` is nullable because a GraphQL error arrives with HTTP 200 and no data.
export type BlameBoardData = {
  readonly incidents: Connection<Incident> | null;
};

/* ── Relay connections (appendix 05 §2), as generics ─────────────────── */
export type PageInfo = {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
};

export type Edge<TNode> = {
  readonly cursos: string;
  readonly node: TNode;
};

export type Connection<TNode> = {
  readonly nodes: readonly TNode[];
  readonly pageInfo?: PageInfo; // Only whe you select it
  readonly edges?: readonly Edge<TNode>[]; // the long form - rarely needed
};

/* ── Media, and the SCF image edge (appendix 03 §4.2) ────────────────── */
export type MediaItem = {
  readonly id: string;
  readonly sourceUrl: string;
  readonly altText: string;
};

// SCF image fields do NOT arrive as a bare object. WPGraphQL for SCF returns an
// `AcfMediaItemConnectionEdge`, so the media item sits one level down, under `node`.
export type AcfMediaEdge = { readonly node: MediaItem } | null;

/* ── Scapegoat Profile (appendix 03 §4.2) — an SCF TERM field group ──── */

export type ScapegoatProfile = {
  readonly avatar: AcfMediaEdge;
  readonly tagline: string | null;
  readonly defensiveness: number | null; // Range 1–10 → Float
  readonly firstBlamedOn: string | null; // Date Picker → String
  readonly officialExuse: string | null;
  readonly isSentient: boolean | null;
};

export type Scapegoat = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly count: number | null;
  readonly scapegoatProfile?: ScapegoatProfile | null; // optional AND nullable
};

/* ── Tech Review Fields (appendix 03 §4.3) ───────────────────────────── */

// An SCF REPEATER is not a string array. It generates one object type per repeater with
// the sub-field as a property — `TechReviewFieldsPros`, never `string[]`. This is the
// most common "why is my generated type not what I expected?" moment in headless WP.
export type TechReviewPro = { readonly item: string | null };
export type TechReviewCon = { readonly item: string | null };

export type TechReviewFields = {
  readonly companyName: string | null;
  readonly logo: AcfMediaEdge;
  readonly ratingOverall: number | null;
  readonly ratingDx: number | null;
  readonly ratingDocs: number | null;
  readonly ratingIncidentResponse: number | null;
  readonly verdict: TechReviewVerdict | null;
  readonly pros: readonly TechReviewPro[] | null;
  readonly cons: readonly TechReviewCon[] | null;
  readonly reviewedAt: string | null;
};

export type TechReview = {
  readonly id: string;
  readonly databaseId: number;
  readonly slug: string;
  readonly title: string;
  readonly date: string | null;
  readonly techReviewFields: TechReviewFields | null;
  readonly techStacks: Connection<Term>;
};

/* ── Derived types (Key Concept 2) ───────────────────────────────────── */
export type IncidentCardFields = Pick<Incident, 'id' | 'slug' | 'title' | 'date' | 'blameScore'>;

export type IncidentDraft = Partial<IncidentDetails>;

// Exhaustive by construction: add a fifth severity term and this stops compiling.
export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  's1-catastrophic': 'S1 — Catastrophic',
  's2-major': 'S2 — Major',
  's3-minor': 'S3 — Minor',
  's4-cosmetic': 'S4 — Cosmetic',
};

/* ── Blocks as a discriminated union (Module 13's six, plus a core one) ─ */
type BlockOf<TName extends string, TAttributes> = {
  readonly __typename: TName; // the DISCRIMINANT. Never `name` - that is typed `string`.
  readonly clientId: string;
  readonly parentClientId: string | null;
  readonly attributes: TAttributes | null;
};

export type Block =
  | BlockOf<'CoreParagraph', { readonly content: string | null }>
  | BlockOf<'BttIncidentCallout', { readonly severity: SeverityLevel | null }>
  | BlockOf<'BttBlameQuote', { readonly attribution: string | null }>
  | BlockOf<'BttScapegoatPicker', { readonly termId: number | null }>
  | BlockOf<'BttIncidentTicker', { readonly count: number | null }>
  | BlockOf<'BttHobtCta', { readonly label: string | null }>
  | BlockOf<'BttTechVerdictCard', { readonly reviewSlug: string | null }>;
