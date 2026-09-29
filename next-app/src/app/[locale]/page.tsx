import { IncidentCard } from '@/components/incidents/IncidentCard';
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

export default async function HomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Module 10 replaces this with `HomepageFeeds`, one request with `catastrophic:` and
  // `recent:` aliases, so the home page stops paying for two round trips.
  const data = await fetchIncidents(6);

  return (
    <main>
      <h1>Blame The Tech</h1>
      <p>
        Six incidents, rendered from the fixtures you wrote in Lesson 08.2. Locale: {locale}. Lesson
        09.3 replaces this array with live WordPress data.
      </p>

      <ul>
        {data.incidents.nodes.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </main>
  );
}
