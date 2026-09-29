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
