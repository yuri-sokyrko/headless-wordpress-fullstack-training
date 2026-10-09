import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// import { fetchGraphQL } from '@/lib/graphql/client';
// import { siteTag } from '@/lib/graphql/tags';
// import { SiteChromeDocument } from '@/gql/graphql';
import { NavLink } from '@/components/layout/NavLink';

export const metadata: Metadata = {
  title: 'Blame The Tech',
  description: 'incident reports, blame assignment, and reviews nobody asked for.',
  // Makes relative URLs in Open Graph tags absolute. Module 19 KEEPS this export —
  // it is the parent every route's generateMetadata merges into — and adds
  // generateMetadata to the ROUTE files, reading Yoast's output per node.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
};

// One locale today. Module 20 adds 'uk' and 'de' — and the translated content to
// justify them. A locale listed here with no content is an indexed English page
// on a foreign URL.
// `Array`, not `ReadonlyArray`. Next validates this signature at build time and
// accepts only `any[] | Promise<any[]>`; a readonly array is a build error, not a
// type warning — "is not a valid generateStaticParams return type". It is the one
// place in this codebase where the house preference for readonly types loses.
export function generateStaticParams(): Array<{ locale: string }> {
  return [{ locale: 'en' }];
}

export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>; // Next 16: params is a Promise. See Key Concept 4.
}) {
  const { locale } = await params;
  // const chrome = await fetchGraphQL(SiteChromeDocument, undefined, {
  //   revalidate: 3600,
  //   tags: [siteTag()],
  // });

  return (
    <html lang={locale}>
      {/* No className, no font import, no globals.css. Module 11 owns all three. */}
      <body>
        {/* HARD-CODED, deliberately. Lesson 11.3 replaces this with <Header /> reading
            WordPress menus via `menuItems(where: { location: PRIMARY })`. Five labels in
            a layout is the right amount of wrong for one module. */}
        <nav aria-label="Primary">
          <ul>
            <li>
              <NavLink href={`/${locale}`}>Home</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/incidents`}>Incidents</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/blog`}>Blog</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/reviews`}>Reviews</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/scapegoats`}>Scapegoats</NavLink>
            </li>
          </ul>
        </nav>

        {children}
      </body>
    </html>
  );
}
