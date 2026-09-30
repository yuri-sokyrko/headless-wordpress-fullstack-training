import { notFound } from 'next/navigation';
import type {
  GraphQLPayload,
  ReviewBySlugQueryResponse,
  ReviewsQueryResponse,
} from '@/types/graphql-responses';

const REVIEW_BY_SLUG = /* GraphQL */ `
  query ReviewBySlug($slug: ID!) {
    techReview(id: $slug, idType: SLUG) {
      id
      title
      slug
      date
      content
      techReviewFields {
        companyName
        ratingOverall
        ratingDx
        ratingDocs
        ratingIncidentResponse
        verdict
        reviewedAt
        pros {
          item
        }
        cons {
          item
        }
      }
    }
  }
`;

const REVIEW_SLUGS = /* GraphQL */ `
  query ReviewSlugs($first: Int!) {
    techReviews(first: $first, where: { status: PUBLISH }) {
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

async function query<TData>(document: string, variables: Record<string, unknown>): Promise<TData> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint)
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: document, variables }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<TData>;
  if (payload.errors?.length) {
    console.error('[btt] GraphQL errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data');
  return payload.data;
}

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await query<ReviewsQueryResponse>(REVIEW_SLUGS, { first: 20 });
  return data.techReviews.nodes.map((review) => ({ locale: 'en', slug: review.slug }));
}

export default async function ReviewsPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { techReview } = await query<ReviewBySlugQueryResponse>(REVIEW_BY_SLUG, { slug });

  if (!techReview) notFound();

  const f = techReview.techReviewFields;

  return (
    <main>
      <h1>{techReview.title}</h1>
      <p>
        {f.companyName} · reviewed {f.reviewedAt} · verdict <strong>{f.verdict}</strong>
      </p>
      {/* STRUCTURED: four numbers this page can sort, badge, chart or hide. */}
      <dl>
        <dt>Overall</dt>
        <dd>{f.ratingOverall}/10</dd>
        <dt>Developer experience</dt>
        <dd>{f.ratingDx}/10</dd>
        <dt>Documentation</dt>
        <dd>{f.ratingDocs}/10</dd>
        <dt>Incident response</dt>
        <dd>{f.ratingIncidentResponse}/10</dd>
      </dl>

      {/* STRUCTURED: the repeaters. Every level nullable — Key Concept 7. */}
      <h2>Pros</h2>
      <ul>{f.pros?.map((row) => (row.item ? <li key={row.item}>{row.item}</li> : null))}</ul>

      <h2>Cons</h2>
      <ul>{f.cons?.map((row) => (row.item ? <li key={row.item}>{row.item}</li> : null))}</ul>

      {/* DEBT (Module 09 → Module 14): and here is the same content model's other half —
          the review body as one opaque HTML string. Everything above this line is data.
          This line is a blob. That contrast is the argument for Module 14. */}
      <div dangerouslySetInnerHTML={{ __html: techReview.content ?? '' }} />
    </main>
  );
}
