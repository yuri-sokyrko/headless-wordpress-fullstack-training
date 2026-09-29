import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import type { GraphQLPayload, IncidentsQueryResponse } from '@/types/graphql-responses';

const INCIDENTS_LIST = /* GraphQL */ `
  query IncidentsList($first: Int!, $after: String, $search: String) {
    incidents(
      first: $first
      after: $after
      where: { status: PUBLISH, search: $search, orderby: { field: DATE, order: DESC } }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        databaseId
        title
        slug
        date
        blameScore
        incidentDetails {
          occurredAt
          downtimeMinutes
          estimatedCostUsd
          environment
          resolutionStatus
          blameConfidence
          stackTrace
          reporterDisplayName
          isVerified
        }
        severities(first: 1) {
          nodes {
            id
            name
            slug
            count
          }
        }
        scapegoats(first: 1) {
          nodes {
            id
            name
            slug
            count
          }
        }
        techStacks(first: 5) {
          nodes {
            id
            name
            slug
            count
          }
        }
      }
    }
  }
`;

// These twelve lines are about to appear in six route files. That duplication is the
// argument for Lesson 10.1's src/lib/graphql/client.ts — do not extract it yet.
async function fetchIncidents(first: number): Promise<IncidentsQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;

  if (!endpoint) {
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: INCIDENTS_LIST, variables: { first } }),
  });

  // Catches a wrong URL and a dead PHP process. Catches nothing else — Key Concept 3.
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<IncidentsQueryResponse>;

  // Server-side log. Never rendered: an error message can name internal fields.
  if (payload.errors?.length) {
    console.error('[btt] IncidentsList errors:', payload.errors.map((e) => e.message).join('; '));
  }

  if (!payload.data) throw new Error('WPGraphQL returned no data for IncidentsList');

  return payload.data;
}

export default async function IncidentsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const data = await fetchIncidents(40);
  const incidents = data.incidents.nodes;

  console.log(`[btt] /${locale}/incidents rendered on the server`);

  return (
    <main>
      <h1>Incidents</h1>
      <p>
        {incidents.length} incidents, still from the Lesson 08.2 fixtures. Lesson 09.3 replaces this
        array with a live WPGraphQL query and does not touch a single component.
      </p>

      {/* The provider wraps the island and NOTHING ELSE. Not the layout, not this <main>,
          not the heading. See Key Concept 8 — Step 6 measures the difference. */}
      <IncidentFilterProvider>
        <IncidentBrowser incidents={incidents} />
      </IncidentFilterProvider>
    </main>
  );
}
