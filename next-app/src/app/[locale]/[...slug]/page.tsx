// Every WordPress page, rendered through the same BlockRenderer. This is the PURE
// case: a title and a block tree, no field group. Read it next to hobt/page.tsx —
// Key Concept 8 is the contrast between the two.
import { notFound } from 'next/navigation';

import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { PageByUriDocument, PageUrisDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag, pageTag } from '@/lib/graphql/tags';

// Lesson 10.3's policy table. Pages change by editorial action, so 3600 until
// Module 18's webhook makes it immediate.
export const revalidate = 3600;

/**
 * First segments that a dedicated route file already owns. Next resolves the
 * specific segment first, so a WordPress page at one of these URIs is
 * unreachable through this route — excluding them here stops
 * generateStaticParams claiming to pre-render something it cannot. Key Concept 7.
 */
const RESERVED = new Set(['hobt', 'blog', 'incidents', 'reviews', 'scapegoats']);

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string[] }>> {
  const data = await fetchGraphQL(
    PageUrisDocument,
    { first: 50 },
    { revalidate: 3600, tags: [listTag('page')] }
  );

  return (
    (data.pages?.nodes ?? [])
      .map((node) => (node?.uri ?? '').split('/').filter((segment) => segment !== ''))
      // length 0 is the front page, whose uri is "/". [locale]/page.tsx owns that,
      // and a catch-all cannot match zero segments anyway — [[...slug]] would.
      .filter((segments) => segments.length > 0 && !RESERVED.has(segments[0] ?? ''))
      .map((segments) => ({ locale: 'en', slug: segments }))
  );
}

export default async function WordPressPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: readonly string[] }>;
}) {
  // Next 16: params is a Promise, and every access is awaited.
  const { locale, slug } = await params;

  // Leading AND trailing slash, which is what WordPress stores in `uri`.
  const uri = `/${slug.join('/')}/`;

  // The LAST segment is the WordPress post_name, which is what Module 18's
  // webhook will build its tag from — pageTag('hobt') in Lesson 11.5, same shape.
  // noUncheckedIndexedAccess (Lesson 07.3) is why this needs the `??`.
  const name = slug[slug.length - 1] ?? 'index';

  const data = await fetchGraphQL(
    PageByUriDocument,
    { uri },
    { revalidate: 3600, tags: [pageTag(name), listTag('page')] }
  );

  // A URI with no page behind it. 404 rather than an empty shell, so Module 19
  // never puts it in a sitemap. Lesson 10.4's not-found.tsx renders it.
  if (data.page == null) notFound();

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{data.page.title}</h1>
      <BlockRenderer blocks={data.page.editorBlocks} locale={locale} />
    </>
  );
}
