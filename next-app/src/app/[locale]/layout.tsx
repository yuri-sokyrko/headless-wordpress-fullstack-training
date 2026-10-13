import type { ReactNode } from 'react';
import { fetchGraphQL } from '@/lib/graphql/client';
import { siteTag } from '@/lib/graphql/tags';
import { SiteChromeDocument } from '@/gql/graphql';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { SkipLink } from '@/components/layout/SkipLink';

import './globals.css';

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
  const chrome = await fetchGraphQL(SiteChromeDocument, undefined, {
    revalidate: 3600,
    tags: [siteTag()],
  });

  return (
    <html lang={locale}>
      {/* No className, no font import, no globals.css. Module 11 owns all three. */}
      <body className="bg-background text-foreground min-h-dvh">
        {/* FIRST child of <body>, before the header — so it is the first thing
            Tab reaches. Anything above it makes it useless. */}
        <SkipLink />

        <Header locale={locale} siteTitle={chrome.generalSettings?.title ?? 'Blame The Tech'} />

        {/* tabIndex={-1} is the detail everyone misses. Without it, following
            href="#main" scrolls the page but does NOT move keyboard focus in
            several browsers, so the next Tab continues from the skip link —
            straight back into the nav the user was skipping. Key Concept 6. */}
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>

        <Footer />
      </body>
    </html>
  );
}
