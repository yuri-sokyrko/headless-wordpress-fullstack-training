//
// HAND-WRITTEN GraphQL response types, transcribed by eye from the GraphiQL result
// panel in Module 05.
//
// ⚠️ EVERY TYPE IN THIS FILE IS AN ASSERTION, NOT A CHECK. Nothing verifies it against
// wordpress-headless/schema.graphql. Lesson 10.2 DELETES this file and generates its
// replacement from the committed schema, in one commit. Lesson 09.4 makes it longer,
// on purpose, because length is the argument.
import type {
  IncidentEnvironment,
  IncidentResolutionStatus,
  PageInfo,
  SeverityLevel,
  TechReviewVerdict,
} from './content';

/** A `severity` term as selected by the incident queries. */
interface SeverityNode {
  readonly id: string;
  readonly name: string;
  readonly slug: SeverityLevel;
  readonly count: number;
}

/** A `scapegoat` or `tech_stack` term as selected by the incident queries. */
interface TermNode {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly count: number;
}

/**
 * The `incidentDetails` SCF group.
 *
 * Every field here is declared non-null because every field had a value in the response
 * that was on screen when this was written. The schema disagrees about all nine of them —
 * see appendix 03 §4.1. `downtimeMinutes` is the one this lesson makes you feel.
 */
interface IncidentDetailsResponse {
  readonly occurredAt: string;
  readonly downtimeMinutes: number; // ⚠️ schema says Float — NULLABLE. Key Concept 5.
  readonly estimatedCostUsd: number;
  readonly environment: IncidentEnvironment;
  readonly resolutionStatus: IncidentResolutionStatus;
  readonly blameConfidence: number;
  readonly stackTrace: string;
  readonly reporterDisplayName: string;
  readonly isVerified: boolean;
}

/** One node of the `IncidentsList` connection. Shaped to satisfy `Incident`. */
export interface IncidentNodeResponse {
  readonly id: string;
  readonly databaseId: number;
  readonly title: string;
  readonly slug: string;
  readonly date: string;
  readonly blameScore: number;
  readonly incidentDetails: IncidentDetailsResponse;
  readonly severities: { readonly nodes: readonly SeverityNode[] };
  readonly scapegoats: { readonly nodes: readonly TermNode[] };
  readonly techStacks: { readonly nodes: readonly TermNode[] };
}

/** `query IncidentsList($first: Int!, $after: String, $search: String)` */
export interface IncidentsQueryResponse {
  readonly incidents: {
    readonly pageInfo: PageInfo;
    readonly nodes: readonly IncidentNodeResponse[];
  };
}

/** `query IncidentBySlug($slug: ID!)` — `incident` is null for an unknown slug. */
export interface IncidentBySlugQueryResponse {
  readonly incident: (IncidentNodeResponse & { readonly content: string | null }) | null;
}

/** The envelope every WPGraphQL response arrives in. Key Concept 3. */
export interface GraphQLPayload<TData> {
  readonly data?: TData;
  readonly errors?: readonly { readonly message: string }[];
}

/* ── Blog ─────────────────────────────────────────────────────────────── */

export interface PostNodeResponse {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly date: string;
}

/** `query PostsList($first: Int!, $after: String)` */
export interface PostsQueryResponse {
  readonly posts: {
    readonly pageInfo: PageInfo;
    readonly nodes: readonly PostNodeResponse[];
  };
}

/** `query PostBySlug($slug: ID!)` */
export interface PostBySlugQueryResponse {
  readonly post: (PostNodeResponse & { readonly content: string | null }) | null;
}

/* ── Tech reviews ─────────────────────────────────────────────────────── */

/**
 * One row of an SCF repeater. NOT a string — appendix 03 §4.3.
 * All three levels are nullable: the list, the row, and the sub-field.
 */
export interface RepeaterItemResponse {
  readonly item: string | null;
}

export interface TechReviewFieldsResponse {
  readonly companyName: string;
  readonly ratingOverall: number;
  readonly ratingDx: number;
  readonly ratingDocs: number;
  readonly ratingIncidentResponse: number;
  readonly verdict: TechReviewVerdict;
  readonly pros: readonly RepeaterItemResponse[];
  readonly cons: readonly RepeaterItemResponse[];
  readonly reviewedAt: string;
}

export interface ReviewNodeResponse {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly date: string;
  readonly techReviewFields: TechReviewFieldsResponse;
}

/** `query ReviewsList($first: Int!, $after: String)` */
export interface ReviewsQueryResponse {
  readonly techReviews: {
    readonly pageInfo: PageInfo;
    readonly nodes: readonly ReviewNodeResponse[];
  };
}

/** `query ReviewBySlug($slug: ID!)` */
export interface ReviewBySlugQueryResponse {
  readonly techReview: (ReviewNodeResponse & { readonly content: string | null }) | null;
}

/* ── Scapegoats ───────────────────────────────────────────────────────── */
export interface ScapegoatNodeResponse {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  // ⚠️ Same lie as downtimeMinutes: the schema says `count` is nullable, and this
  // whole page is an ORDER BY on it. Lesson 10.2 removes the possibility.
  readonly count: number;
  readonly scapegoatProfile: {
    readonly tagline: string | null;
    readonly defensiveness: number | null;
  } | null;
}

/** `query ScapegoatLeaderboard($first: Int!)` */
export interface ScapegoatLeaderboardQueryResponse {
  readonly scapegoats: {
    readonly nodes: readonly ScapegoatNodeResponse[];
  };
}
