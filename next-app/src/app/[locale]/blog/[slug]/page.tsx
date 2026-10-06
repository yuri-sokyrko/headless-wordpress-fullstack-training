import { notFound } from 'next/navigation';
import { fetchGraphQL } from '@/lib/graphql/client';
import { PostBySlugDocument, PostsSlugDocument } from '@/gql/graphql';

// Runs at build time. Both params, because [locale] is dynamic too.
export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await fetchGraphQL(PostsSlugDocument, { first: 50 });

  return (data.posts?.nodes ?? []).flatMap((post) =>
    post.slug === null ? [] : [{ locale: 'en', slug: post.slug }]
  );
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
      <h1>{post.title ?? 'Untitled post'}</h1>
      {post.date ? <time dateTime={post.date}>{post.date.slice(0, 10)}</time> : null}

      {/* DEBT (Module 09 → Module 14): the post body as one opaque HTML string. The same
          debt Lesson 09.3 took on the incident route, taken again here on purpose. */}
      <div dangerouslySetInnerHTML={{ __html: post.content ?? '' }} />
    </main>
  );
}
