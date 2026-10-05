import Link from 'next/link';
import { fetchGraphQL, untypedDocument } from '@/lib/graphql/client';
import type { ReviewsQueryResponse } from '@/types/graphql-responses';

const ReviewsListDocument = untypedDocument<
  ReviewsQueryResponse,
  { first: number; after?: string }
>(/* GraphQL */ `
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
`);

export default async function ReviewsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { techReviews } = await fetchGraphQL(ReviewsListDocument, { first: 8 });

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
