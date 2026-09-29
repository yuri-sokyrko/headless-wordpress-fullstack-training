import { IncidentBrowser } from '@/components/incidents/IncidentBrowser';
import { IncidentFilterProvider } from '@/components/incidents/IncidentFilterProvider';
import { INCIDENTS } from '@/components/incidents/fixtures';

export default async function IncidentsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  console.log(`[btt] /${locale}/incidents rendered on the server`);

  return (
    <main>
      <h1>Incidents</h1>
      <p>
        {INCIDENTS.length} incidents, still from the Lesson 08.2 fixtures. Lesson 09.3 replaces this
        array with a live WPGraphQL query and does not touch a single component.
      </p>

      {/* The provider wraps the island and NOTHING ELSE. Not the layout, not this <main>,
          not the heading. See Key Concept 8 — Step 6 measures the difference. */}
      <IncidentFilterProvider>
        <IncidentBrowser incidents={INCIDENTS} />
      </IncidentFilterProvider>
    </main>
  );
}
