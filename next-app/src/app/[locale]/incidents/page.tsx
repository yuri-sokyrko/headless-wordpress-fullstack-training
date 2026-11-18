import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { IncidentsListDocument } from '@/gql/graphql';

// A FLOOR for the route, matching the per-fetch value from Lesson 10.3 so the
// two agree on purpose. NOT `dynamic = 'force-dynamic'`: that would flip the
// default cache of every fetch in this segment to no-store, and the cached
// fetch is the entire point of this route (Key Concept 1).
export const revalidate = 300;

export default async function IncidentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;

  // One facet, in the URL, deep-linkable and shareable. `?q=friday` and
  // `?q=cache` are two Data Cache entries; two visitors asking for the same
  // one share it. `undefined` rather than '' so the no-search case stays a
  // single entry instead of splitting on an empty string.
  const search = typeof q === 'string' && q.trim() !== '' ? q.trim() : undefined;

  const data = await fetchGraphQL(
    IncidentsListDocument,
    { first: 12, search },
    { revalidate: 300, tags: [listTag('incident')] }
  );
  const incidents = data.incidents?.nodes ?? [];

  console.log(`[btt] /${locale}/incidents rendered on the server`);

  return (
    <>
      <h1>Incidents</h1>
      <p>{incidents.length} incidents.</p>

      {/* The provider wraps the island and NOTHING ELSE. Not the layout, not this <main>,
          not the heading. See Key Concept 8 — Step 6 measures the difference. */}
      <IncidentFilterProvider>
        <IncidentBrowser incidents={incidents} />
      </IncidentFilterProvider>
    </>
  );
}
