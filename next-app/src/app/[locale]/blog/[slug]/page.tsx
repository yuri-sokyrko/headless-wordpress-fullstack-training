import { notFound } from 'next/navigation';
import type {
  GraphQLPayload,
  PostBySlugQueryResponse,
  PostsQueryResponse,
} from '@/types/graphql-responses';

const POST_BY_SLUG = /* GraphQL */ `
  query PostBySlug($slug: ID!) {
    post(id: $slug, idType: SLUG) {
      id
      title
      slug
      date
      content
    }
  }
`;

const POST_SLUGS = /* GraphQL */ `
  query PostsSlug($first: Int!) {
    posts(first: $first, where: { status: PUBLISH }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        slug
        date
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

// Runs at build time. Both params, because [locale] is dynamic too.
export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await query<PostsQueryResponse>(POST_SLUGS, { first: 50 });
  return data.posts.nodes.map((post) => ({ locale: 'en', slug: post.slug }));
}

export default async function PostPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { post } = await query<PostBySlugQueryResponse>(POST_BY_SLUG, { slug });

  if (!post) notFound();

  return (
    <main>
      <h1>{post.title}</h1>
      <time dateTime={post.date}>{post.date.slice(0, 10)}</time>

      {/* DEBT (Module 09 → Module 14): the post body as one opaque HTML string. The same
          debt Lesson 09.3 took on the incident route, taken again here on purpose. */}
      <div dangerouslySetInnerHTML={{ __html: post.content ?? '' }} />
    </main>
  );
}
