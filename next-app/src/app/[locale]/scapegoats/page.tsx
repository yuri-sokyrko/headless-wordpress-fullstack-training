// next-app/src/app/[locale]/scapegoats/page.tsx
import { fetchGraphQL } from '@/lib/graphql/client';
import { ScapegoatLeaderboardDocument } from '@/gql/graphql';

export default async function ScapegoatsPage() {
  // The ten seeded terms from appendix 03 §2, ordered by wp_term_taxonomy.count.
  const { scapegoats } = await fetchGraphQL(ScapegoatLeaderboardDocument, { first: 10 });

  return (
    <main>
      <h1>The Blame Leaderboard</h1>
      <ol>
        {(scapegoats?.nodes ?? []).map((scapegoat) => (
          <li key={scapegoat.id}>
            <strong>{scapegoat.name ?? 'Unnamed'}</strong> — blamed {scapegoat.count ?? 0} times
            {scapegoat.scapegoatProfile?.tagline ? (
              <em> “{scapegoat.scapegoatProfile.tagline}”</em>
            ) : null}
            {typeof scapegoat.scapegoatProfile?.defensiveness === 'number' ? (
              <span> (defensiveness {scapegoat.scapegoatProfile.defensiveness}/10)</span>
            ) : null}
          </li>
        ))}
      </ol>
      <p>
        There is no per-scapegoat page yet — <code>scapegoats/[slug]</code> arrives with the
        rendering-strategy pass in Module 18, together with the pagination this list does not need.
      </p>
    </main>
  );
}
