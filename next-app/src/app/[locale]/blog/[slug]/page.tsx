import { notFound } from 'next/navigation';
import { fetchGraphQL, untypedDocument } from '@/lib/graphql/client';
import type { PostBySlugQueryResponse, PostsQueryResponse } from '@/types/graphql-responses';

const PostBySlugDocument = untypedDocument<PostBySlugQueryResponse, { slug: string }>(
  /* GraphQL */ `
    query PostBySlug($slug: ID!) {
      post(id: $slug, idType: SLUG) {
        id
        title
        slug
        date
        content
      }
    }
  `
);

const PostSlugsDocument = untypedDocument<PostsQueryResponse, { first: number }>(/* GraphQL */ `
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
`);

// Runs at build time. Both params, because [locale] is dynamic too.
export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await fetchGraphQL(PostSlugsDocument, { first: 50 });
  return data.posts.nodes.map((post) => ({ locale: 'en', slug: post.slug }));
}

export default async function PostPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { post } = await fetchGraphQL(PostBySlugDocument, { slug });

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
