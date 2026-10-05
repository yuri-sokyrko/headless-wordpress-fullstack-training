import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import { fetchGraphQL, untypedDocument } from '@/lib/graphql/client';
import type { IncidentsQueryResponse } from '@/types/graphql-responses';

const IncidentsListDocument = untypedDocument<
  IncidentsQueryResponse,
  { first: number; after?: string; search?: string }
>(/* GraphQL */ `
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
        severities(first: 1) {
          nodes {
            name
            slug
          }
        }
        scapegoats(first: 1) {
          nodes {
            name
            slug
          }
        }
        incidentDetails {
          downtimeMinutes
          environment
        }
      }
    }
  }
`);

export default async function IncidentsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const data = await fetchGraphQL(IncidentsListDocument, { first: 12 });
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
