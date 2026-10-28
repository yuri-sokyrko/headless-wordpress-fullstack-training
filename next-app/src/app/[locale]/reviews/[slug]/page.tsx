import { notFound } from 'next/navigation';
import { ReviewBySlugDocument, ReviewSlugsDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { reviewTag, listTag } from '@/lib/graphql/tags';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';

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
  const { slug, locale } = await params;
  const { techReview } = await fetchGraphQL(
    ReviewBySlugDocument,
    { slug },
    { revalidate: 3600, tags: [reviewTag(slug), listTag('review')] }
  );

  if (!techReview) notFound();

  const f = techReview.techReviewFields;

  return (
    <>
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

      <BlockRenderer blocks={techReview.editorBlocks} locale={locale} />
    </>
  );
}
