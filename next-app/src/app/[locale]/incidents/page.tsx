import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { IncidentsListDocument } from '@/gql/graphql';

export default async function IncidentsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const data = await fetchGraphQL(
    IncidentsListDocument,
    { first: 12 },
    { revalidate: 300, tags: [listTag('incident')] }
  );
  const incidents = data.incidents?.nodes ?? [];

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
