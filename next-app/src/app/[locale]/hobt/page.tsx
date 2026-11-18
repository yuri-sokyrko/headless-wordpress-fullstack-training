import { notFound } from 'next/navigation';

import { HobtCtaBand } from '@/components/hobt/HobtCtaBand';
import { HobtHero } from '@/components/hobt/HobtHero';
import { HobtModules } from '@/components/hobt/HobtModules';
import { HobtTestimonials } from '@/components/hobt/HobtTestimonials';
import { HobtPromoDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { pageTag } from '@/lib/graphql/tags';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { LeadForm } from '@/components/hobt/LeadForm';

// STATIC, and the reason is commercial rather than technical (Key Concept 8).
// Conversion is measured on this page, so it must change when an editor changes
// it and at no other time. `false` means "cached until a tag drops it", and the
// tag is dropped by the webhook in Lesson 18.3.
//
// This makes the webhook LOAD-BEARING: there is no timer behind it any more.
// Lesson 18.4's runbook entry is the response to that, and it is not optional.
export const revalidate = false;

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
    { revalidate: false, tags: [pageTag('hobt')] }
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
        heroImage={promo.heroImage?.node ?? null}
      >
        {/* HobtCtaBand, instance one — inside the hero, via `children`. */}
        <HobtCtaBand
          heading="Stop blaming DNS. Start shipping."
          blurb={null}
          startNowUrl={promo.startNowUrl}
          demoBookingUrl={promo.demoBookingUrl}
          locale={locale}
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
          heading="Ready to omit blaming tech?"
          blurb="Nine modules. One incident-free quarter. Probably."
          startNowUrl={promo.startNowUrl}
          demoBookingUrl={promo.demoBookingUrl}
          locale={locale}
          leadSource="hobt-footer"
        />
      </section>

      <section id="lead" className="mx-auto w-full max-w-md py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Book a demo</h2>
        <LeadForm source="hobt-footer" locale={locale} demoBookingUrl={promo.demoBookingUrl} />
      </section>
    </>
  );
}
