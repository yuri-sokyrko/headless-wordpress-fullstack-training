import Link from 'next/link';
import type { GraphQLPayload, PostsQueryResponse } from '@/types/graphql-responses';

const POSTS_LIST = /* GraphQL */ `
  query PostsList($first: Int!, $after: String) {
    posts(
      first: $first
      after: $after
      where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }
    ) {
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

// The fifth copy of these twelve lines. Lesson 10.1 deletes four of them.
async function fetchPosts(first: number): Promise<PostsQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint)
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: POSTS_LIST, variables: { first } }),
  });

  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<PostsQueryResponse>;

  if (payload.errors?.length) {
    console.error('[btt] PostsList errors:', payload.errors.map((e) => e.message).join('; '));
  }

  if (!payload.data) throw new Error('WPGraphQL returned no data for PostsList');

  return payload.data;
}

export default async function BlogPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { posts } = await fetchPosts(10);

  return (
    <main>
      <h1>Blog</h1>
      <ul>
        {posts.nodes.map((post) => (
          <li key={post.id}>
            {/* Compose the href from the locale you already awaited. Never a bare '/blog'. */}
            <Link href={`/${locale}/blog/${post.slug}`}>{post.title}</Link>
            <time dateTime={post.date}>{post.date.slice(0, 10)}</time>
          </li>
        ))}
      </ul>
    </main>
  );
}
