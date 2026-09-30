// next-app/src/app/[locale]/scapegoats/page.tsx
import type { GraphQLPayload, ScapegoatLeaderboardQueryResponse } from '@/types/graphql-responses';

const SCAPEGOAT_LEADERBOARD = /* GraphQL */ `
  query ScapegoatLeaderboard($first: Int!) {
    scapegoats(first: $first, where: { orderby: COUNT, order: DESC, hideEmpty: false }) {
      nodes {
        id
        name
        slug
        count
        scapegoatProfile {
          tagline
          defensiveness
        }
      }
    }
  }
`;

async function fetchLeaderboard(first: number): Promise<ScapegoatLeaderboardQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint)
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SCAPEGOAT_LEADERBOARD, variables: { first } }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<ScapegoatLeaderboardQueryResponse>;
  if (payload.errors?.length) {
    console.error(
      '[btt] ScapegoatLeaderboard errors:',
      payload.errors.map((e) => e.message).join('; ')
    );
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data for ScapegoatLeaderboard');
  return payload.data;
}

export default async function ScapegoatsPage() {
  // The ten seeded terms from appendix 03 §2, ordered by wp_term_taxonomy.count.
  const { scapegoats } = await fetchLeaderboard(10);

  return (
    <main>
      <h1>The Blame Leaderboard</h1>
      <ol>
        {scapegoats.nodes.map((scapegoat) => (
          <li key={scapegoat.id}>
            <strong>{scapegoat.name}</strong> — blamed {scapegoat.count} times
            {scapegoat.scapegoatProfile?.tagline ? (
              <em> “{scapegoat.scapegoatProfile.tagline}”</em>
            ) : null}
            {/* Both levels nullable: the term may have no profile, and the profile may
                have no value. `typeof` covers both in one readable check. */}
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
