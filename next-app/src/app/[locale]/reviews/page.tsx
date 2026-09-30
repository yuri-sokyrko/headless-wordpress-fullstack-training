import Link from 'next/link';
import type { GraphQLPayload, ReviewsQueryResponse } from '@/types/graphql-responses';

const REVIEWS_LIST = /* GraphQL */ `
  query ReviewsList($first: Int!, $after: String) {
    techReviews(first: $first, after: $after, where: { status: PUBLISH }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        slug
        date
        techReviewFields {
          companyName
          ratingOverall
          ratingDx
          ratingDocs
          ratingIncidentResponse
          verdict
          reviewedAt
        }
      }
    }
  }
`;

async function fetchReviews(first: number): Promise<ReviewsQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint)
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: REVIEWS_LIST, variables: { first } }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<ReviewsQueryResponse>;
  if (payload.errors?.length) {
    console.error('[btt] ReviewsList errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data for ReviewsList');
  return payload.data;
}

export default async function ReviewsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { techReviews } = await fetchReviews(8);

  return (
    <main>
      <h1>Tech Reviews</h1>
      <ul>
        {techReviews.nodes.map((review) => {
          const f = review.techReviewFields;
          return (
            <li key={review.id}>
              <Link href={`/${locale}/reviews/${review.slug}`}>{review.title}</Link>
              <p>
                {f.companyName} — verdict <strong>{f.verdict}</strong>, overall {f.ratingOverall}
                /10 (DX {f.ratingDx}, docs {f.ratingDocs}, incident response{' '}
                {f.ratingIncidentResponse})
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
