import { notFound } from 'next/navigation';

import { HobtCtaBand } from '@/components/hobt/HobtCtaBand';
import { HobtHero } from '@/components/hobt/HobtHero';
import { HobtModules } from '@/components/hobt/HobtModules';
import { HobtTestimonials } from '@/components/hobt/HobtTestimonials';
import { HobtPromoDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { pageTag } from '@/lib/graphql/tags';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';

// The ROUTE-SEGMENT cache: how long the rendered page may be reused. 60s because
// `seatsLeft` drives a live badge — Lesson 10.3's policy table. Everything else
// in the app is 3600.
export const revalidate = 60;

// From Step 1, read out of WordPress rather than assumed.
const HOBT_URI = '/hobt/';

// From Step 1, read out of WordPress rather than assumed.
export default async function HobtPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  // Next 16: params is a Promise.
  const { locale } = await params;

  const data = await fetchGraphQL(
    HobtPromoDocument,
    { uri: HOBT_URI },
    // The DATA cache: how long the GraphQL response may be reused. Matching the
    // segment value keeps the two honest — a long fetch cache under a short page
    // cache re-renders from stale data and looks like the page cache failing.
    { revalidate: 60, tags: [pageTag('hobt')] }
  );

  const promo = data.page?.hobtPromo;

  // Two different failures, one response. No page at that URI, or a page whose
  // field group was never saved — neither can render, and a 404 is honest.
  // Lesson 10.4's not-found.tsx renders it.
  if (data.page == null || promo == null) notFound();

  return (
    <>
      <HobtHero
        locale={locale}
        headline={promo.headline}
        subheadline={promo.subheadline}
        priceUsd={promo.priceUsd}
        seatsLeft={promo.seatsLeft}
      >
        {/* HobtCtaBand, instance one — inside the hero, via `children`. */}
        <HobtCtaBand
          idPrefix="hero"
          heading="Stop blaming DNS. Start shipping."
          blurb={null}
          startNowUrl={promo.startNowUrl}
          demoBookingUrl={promo.demoBookingUrl}
        />
      </HobtHero>

      <BlockRenderer blocks={data.page.editorBlocks} locale={locale} />

      <HobtModules heading="What you will learn" modules={promo.modules} />

      <HobtTestimonials heading="What graduates say" testimonials={promo.testimonials} />

      <section aria-labelledby="hobt-closing-heading" className="border-border border-t py-12">
        <h2 id="hobt-closing-heading" className="sr-only">
          Get started
        </h2>
        {/* HobtCtaBand, instance two — same component, different props, no
            positional flag anywhere. That is Key Concept 2, proved. */}
        <HobtCtaBand
          idPrefix="closing"
          heading="Ready to omit blaming tech?"
          blurb="Nine modules. One incident-free quarter. Probably."
          startNowUrl={promo.startNowUrl}
          demoBookingUrl={promo.demoBookingUrl}
        />
      </section>
    </>
  );
}
