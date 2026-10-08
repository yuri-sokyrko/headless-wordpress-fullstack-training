import { Suspense } from 'react';
import { fetchGraphQL } from '@/lib/graphql/client';
import { HomepageFeedsDocument } from '@/gql/graphql';
import { listTag, siteTag } from '@/lib/graphql/tags';
import { IncidentCard } from '@/components/incidents/IncidentCard';

// Deliberately ugly and deliberately temporary. Lesson 11.2 replaces this with the
// shadcn `skeleton` component, at the same box dimensions as the real list.
function FeedSkeleton() {
  return <div aria-hidden="true">░░░░░░░░ ░░░░░ ░░░░░░░░░</div>;
}

async function HomepageFeeds() {
  const { catastrophic, recent } = await fetchGraphQL(
    HomepageFeedsDocument,
    {
      featuredCount: 3,
      recentCount: 6,
    },
    { revalidate: 300, tags: [listTag('incident'), siteTag()] }
  );

  const catastrophicNodes = catastrophic?.nodes ?? [];
  const recentNodes = recent?.nodes ?? [];

  return (
    <>
      <h2>Most catastrophic</h2>
      <ul>
        {catastrophicNodes.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>

      <h2>Most recent</h2>
      <ul>
        {recentNodes.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function HomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <main>
      <h1>Blame The Tech</h1>
      <p>Live from WordPress. Locale: {locale}.</p>

      <Suspense fallback={<FeedSkeleton />}>
        <HomepageFeeds />
      </Suspense>
    </main>
  );
}
