type HobtTestimonial = {
  readonly quote: string | null;
  readonly author: string | null;
  readonly role: string | null;
};

export function HobtTestimonials({
  heading,
  testimonials,
}: {
  readonly heading: string;
  readonly testimonials: readonly (HobtTestimonial | null)[] | null;
}) {
  // A testimonial with no quote is not a testimonial, so the filter drops rows
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
