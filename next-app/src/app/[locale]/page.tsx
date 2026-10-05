import { IncidentCard } from '@/components/incidents/IncidentCard';
import { fetchGraphQL, untypedDocument } from '@/lib/graphql/client';
import type { HomepageFeedsQueryResponse } from '@/types/graphql-responses';

// One request, two aliases: the home page stops paying for two round trips.
const HomepageFeedsDocument = untypedDocument<
  HomepageFeedsQueryResponse,
  { featuredCount: number; recentCount: number }
>(/* GraphQL */ `
  query HomepageFeeds($featuredCount: Int!, $recentCount: Int!) {
    catastrophic: incidents(first: $featuredCount, where: { status: PUBLISH }) {
      nodes {
        ...IncidentCardFields
      }
    }
    recent: incidents(
      first: $recentCount
      where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }
    ) {
      nodes {
        ...IncidentCardFields
      }
    }
  }

  fragment IncidentCardFields on Incident {
    id
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
`);

export default async function HomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { catastrophic, recent } = await fetchGraphQL(HomepageFeedsDocument, {
    featuredCount: 3,
    recentCount: 6,
  });

  return (
    <main>
      <h1>Blame The Tech</h1>
      <p>Live from WordPress. Locale: {locale}.</p>

      <h2>Most catastrophic</h2>
      <ul>
        {catastrophic.nodes.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>

      <h2>Most recent</h2>
      <ul>
        {recent.nodes.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </main>
  );
}
