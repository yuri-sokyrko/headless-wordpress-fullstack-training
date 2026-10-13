import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

export function HobtHero({
  locale,
  headline,
  subheadline,
  priceUsd,
  seatsLeft,
  children,
}: {
  readonly locale: string;
  readonly headline: string | null;
  readonly subheadline: string | null;
  readonly priceUsd: number | null;
  readonly seatsLeft: number | null;
  // The one `children` slot on this page. Key Concept 1: the hero does not care
  // what goes here, and the page decides.
  readonly children?: ReactNode;
}) {
  // `locale` is why page.tsx awaits params. Module 20 makes this matter; today
  // it is the difference between "$1,499" and a bare number.
  const price =
    typeof priceUsd === 'number'
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        }).format(priceUsd)
      : null;

  return (
    // A named region, so it is a real landmark rather than a decorative
    // <section> — Lesson 11.4 Key Concept 2.
    <section aria-labelledby="hobt-hero-heading" className="py-12 sm:py-20">
      <div className="flex flex-wrap items-center gap-3">
        {/* typeof, not `&&` and not a ternary on truthiness. Key Concept 4:
            "0 seats left" is the value that matters most and both of the
            shorter spellings get it wrong. */}
        {typeof seatsLeft === 'number' ? (
          <Badge variant={'s1-catastrophic'}>{seatsLeft} seats left</Badge>
        ) : null}
        {price !== null ? <span className="text-muted-foreground text-sm">{price}</span> : null}
      </div>

      {/* The page's only <h1>. Falls back rather than rendering an empty
          heading, which jsx-a11y/heading-has-content would reject anyway. */}
      <h1
        id="hobt-hero-heading"
        className="mt-4 max-w-3xl text-4xl font-semibold tracking-tighter sm:text-5xl"
      >
        {headline ?? 'How To Omit Blaming Tech'}
      </h1>

      {subheadline !== null && subheadline !== '' ? (
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg">{subheadline}</p>
      ) : null}

      {children !== undefined ? <div className="mt-8">{children}</div> : null}
    </section>
  );
}
