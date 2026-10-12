import type { ReactNode } from 'react';
import { fetchGraphQL } from '@/lib/graphql/client';
import { siteTag } from '@/lib/graphql/tags';
import { SiteChromeDocument } from '@/gql/graphql';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

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
        <Header locale={locale} siteTitle={chrome.generalSettings?.title ?? 'Blame The Tech'} />
        {children}
        <Footer />
      </body>
    </html>
  );
}
