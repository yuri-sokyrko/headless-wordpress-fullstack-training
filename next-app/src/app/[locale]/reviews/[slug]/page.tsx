import { notFound } from 'next/navigation';
import { ReviewBySlugDocument, ReviewSlugsDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await fetchGraphQL(ReviewSlugsDocument, { first: 20 });

  return (data.techReviews?.nodes ?? []).flatMap((review) =>
    review.slug === null ? [] : [{ locale: 'en', slug: review.slug }]
  );
}

export default async function ReviewsPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { techReview } = await fetchGraphQL(ReviewBySlugDocument, { slug });

  if (!techReview) notFound();

  const f = techReview.techReviewFields;

  return (
    <main>
      <h1>{techReview.title ?? 'Untitled review'}</h1>
      <p>
        {f?.companyName ?? 'Unknown company'} · reviewed {f?.reviewedAt ?? 'date unknown'} · verdict{' '}
        <strong>{f?.verdict ?? 'unrated'}</strong>
      </p>
      {/* STRUCTURED: four numbers this page can sort, badge, chart or hide. */}
      <dl>
        <dt>Overall</dt>
        <dd>{f?.ratingOverall ?? '-'}/10</dd>
        <dt>Developer experience</dt>
        <dd>{f?.ratingDx ?? '-'}/10</dd>
        <dt>Documentation</dt>
        <dd>{f?.ratingDocs ?? '-'}/10</dd>
        <dt>Incident response</dt>
        <dd>{f?.ratingIncidentResponse ?? '-'}/10</dd>
      </dl>

      {/* STRUCTURED: the repeaters. Every level nullable — Key Concept 7. */}
      <h2>Pros</h2>
      <ul>{f?.pros?.map((row) => (row?.item ? <li key={row.item}>{row.item}</li> : null))}</ul>

      <h2>Cons</h2>
      <ul>{f?.cons?.map((row) => (row?.item ? <li key={row.item}>{row.item}</li> : null))}</ul>

      {/* DEBT (Module 09 → Module 14): and here is the same content model's other half —
          the review body as one opaque HTML string. Everything above this line is data.
          This line is a blob. That contrast is the argument for Module 14. */}
      <div dangerouslySetInnerHTML={{ __html: techReview.content ?? '' }} />
    </main>
  );
}
