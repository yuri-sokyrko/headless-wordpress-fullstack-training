import Image from 'next/image';

import type { MediaFieldsFragment } from '@/gql/graphql';

type HobtTestimonial = {
  readonly quote: string | null;
  readonly author: string | null;
  readonly role: string | null;
  // The SCF image field is a CONNECTION, so the node is one level down. HobtHero
  // receives an already-unwrapped node because page.tsx can write
  // `promo.heroImage?.node`; an avatar is nested inside a a testimorepeater ROW, so there
  // is nowhere for the page to unwrap it and this component does it instead.
  readonly avatar: { readonly node: MediaFieldsFragment | null } | null;
};

export function HobtTestimonials({
  heading,
  testimonials,
}: {
  readonly heading: string;
  readonly testimonials: readonly (HobtTestimonial | null)[] | null;
}) {
  // A testimonial with no quote is not nial, so the filter drops rows
  // on a sub-field as well as on the row itself. Not every section can do that
  // — HobtModules keeps a row with only a title — and deciding which sub-field
  // is load-bearing is the section's own business.
  const rows = (testimonials ?? []).filter(
    (t): t is HobtTestimonial => t !== null && t.quote !== null && t.quote !== ''
  );

  if (rows.length === 0) {
    return (
      <section aria-labelledby="hobt-testimonials-heading" className="border-border border-t py-12">
        <h2 id="hobt-testimonials-heading" className="text-2xl font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="text-muted-foreground mt-4 text-sm">No testimonials yet.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="hobt-testimonials-heading" className="border-border border-t py-12">
      <h2 id="hobt-testimonials-heading" className="text-2xl font-semibold tracking-tight">
        {heading}
      </h2>

      <ul className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        {rows.map((t, i) => (
          <li key={`${t.author ?? 'anon'}-${i}`}>
            {/* <blockquote> + <figcaption> inside a <figure> is the semantic
                pairing for "a quote and who said it". A <div> would need ARIA
                to say the same thing — Lesson 11.4 Key Concept 1. */}
            <figure className="border-border bg-card rounded-lg border p-6">
              <blockquote className="text-sm leading-relaxed">{t.quote}</blockquote>
              {t.author !== null && t.author !== '' ? (
                <figcaption className="mt-4 text-sm font-medium">
                  {/* A FIXED size, so `sizes` is a fixed `40px` and the browser
                    chooses from imageSizes (48, 96) rather than from eight
                    device widths. No `priority`: twelve avatars, all below the
                    fold. `mediaDetails` is selected and ignored here, which is
                    honest overfetch — Key Concept 9's last row. */}
                  {t.avatar?.node?.sourceUrl !== null && t.avatar?.node?.sourceUrl !== undefined ? (
                    <Image
                      src={t.avatar.node.sourceUrl}
                      // Decorative: the author's name is right next to it, so an
                      // alt would be announced twice. Empty string, not missing.
                      alt=""
                      width={40}
                      height={40}
                      sizes="40px"
                      className="mr-2 inline-block h-10 w-10 rounded-full object-cover align-middle"
                    />
                  ) : null}
                  {t.author}
                  {t.role !== null && t.role !== '' ? (
                    <span className="text-muted-foreground font-normal"> - {t.role}</span>
                  ) : null}
                </figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
