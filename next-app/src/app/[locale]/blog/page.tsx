import Link from 'next/link';
import { fetchGraphQL, untypedDocument } from '@/lib/graphql/client';
import type { PostsQueryResponse } from '@/types/graphql-responses';

const PostsListDocument = untypedDocument<PostsQueryResponse, { first: number; after?: string }>(
  /* GraphQL */ `
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
  `
);

export default async function BlogPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { posts } = await fetchGraphQL(PostsListDocument, { first: 10 });

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
