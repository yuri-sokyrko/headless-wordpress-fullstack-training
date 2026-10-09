import Link from 'next/link';
import { ReviewsListDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';

export default async function ReviewsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { techReviews } = await fetchGraphQL(
    ReviewsListDocument,
    { first: 8 },
    { revalidate: 3600, tags: [listTag('review')] }
  );

  return (
    <main>
      <h1>Tech Reviews</h1>
      <ul>
        {(techReviews?.nodes ?? []).map((review) => {
          if (review.slug === null) return null;
          const f = review.techReviewFields;
          return (
            <li key={review.id}>
              <Link href={`/${locale}/reviews/${review.slug}`}>{review.title ?? review.slug}</Link>
              <p>
                {f?.companyName ?? 'Unknown company'} — verdict{' '}
                <strong>{f?.verdict ?? 'unrated'}</strong>, overall {f?.ratingOverall ?? '-'}/10
                (DX{' '}
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
