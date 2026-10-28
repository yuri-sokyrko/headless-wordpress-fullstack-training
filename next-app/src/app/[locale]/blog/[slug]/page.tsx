import { notFound } from 'next/navigation';
import { fetchGraphQL } from '@/lib/graphql/client';
import { PostBySlugDocument, PostsSlugDocument } from '@/gql/graphql';
import { postTag, listTag } from '@/lib/graphql/tags';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';

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
  const { locale, slug } = await params;
  const { post } = await fetchGraphQL(
    PostBySlugDocument,
    { slug },
    { revalidate: 3600, tags: [postTag(slug), listTag('post')] }
  );

  if (post == null) notFound();

  return (
    <>
      <h1>{post.title ?? 'Untitled post'}</h1>
      {post.date ? <time dateTime={post.date}>{post.date.slice(0, 10)}</time> : null}

      <BlockRenderer blocks={post.editorBlocks} locale={locale} />
    </>
  );
}
