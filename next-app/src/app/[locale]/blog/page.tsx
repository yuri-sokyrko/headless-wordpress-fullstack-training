import Link from 'next/link';
import { fetchGraphQL } from '@/lib/graphql/client';
import { PostsListDocument } from '@/gql/graphql';
import { listTag } from '@/lib/graphql/tags';

export default async function BlogPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { posts } = await fetchGraphQL(
    PostsListDocument,
    { first: 10 },
    { revalidate: 3600, tags: [listTag('post')] }
  );

  return (
    <main>
      <h1>Blog</h1>
      <ul>
        {(posts?.nodes ?? []).map((post) =>
          post.slug === null ? null : (
            <li key={post.id}>
              {/* Compose the href from the locale you already awaited. Never a bare '/blog'. */}
              <Link href={`/${locale}/blog/${post.slug}`}>{post.title ?? post.slug}</Link>
              {post.date ? <time dateTime={post.date}>{post.date.slice(0, 10)}</time> : null}
            </li>
          )
        )}
      </ul>
    </main>
  );
}
