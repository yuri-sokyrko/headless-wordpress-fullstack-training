'use client';
// THE ONLY 'use client' in src/components/blocks/, and Verification asserts the
// count is exactly one. The directive marks a BOUNDARY, not a file: ui/button.tsx
// has no directive of its own and is compiled into the client graph because this
// file imports it. Key Concept 6 — which is also why this renders ONE Button and
// not a whole band: the smallest thing below the boundary is the cheapest
// boundary.
//
// There is no onClick yet. Lesson 16.3 turns this into a Dialog trigger backed by
// a validated Server Action, and `leadSource` becomes the value it submits. The
// directive lands here now so the boundary is visible and the attribute
// serialisation is proved rather than assumed.
import Link from 'next/link';

import type { BlockComponentProps } from '@/components/blocks/registry';
import { Button } from '@/components/ui/button';

export function HobtCta({ block, locale }: BlockComponentProps<'BttHobtCta'>) {
  const attributes = block.attributes;
  const label = attributes?.label ?? 'Get Demo';
  const href = attributes?.href ?? '';

  // An editor inserted the block and never set a target. Render nothing: a CTA
  // that goes nowhere is worse than no CTA, and UnknownBlock is the wrong signal
  // — the block type IS known, its data is incomplete. Key Concept 2.
  if (href === '') return null;

  // `variant` maps onto Button's own variants. `blame` is the course's primary
  // CTA style from Lesson 11.2, and it is what HobtCtaBand's "Start Now" uses,
  // so a primary block CTA and a page-mounted one look like the same product.
  const variant = attributes?.variant === 'outline' ? 'outline' : 'blame';

  // Kebab-case, matching the wp_btt_leads.source column and the SCF select
  // convention. Module 16 maps it to the LeadSource GraphQL enum
  // (hobt-cta-block → HOBT_CTA_BLOCK) when it calls submitHobtLead. Carried as a
  // data attribute so it is inspectable now and wired up in Lesson 16.3.
  const leadSource = attributes?.leadSource ?? 'hobt-cta-block';

  // A site-relative href gets the locale prefix and next/link; anything else is
  // off-site and gets a plain anchor. The seeded block stores `/hobt`, so this
  // branch is exercised by real content — and it is costs 1 and 4 of Lesson
  // 14.1's renderedHtml argument, avoided, which is what `locale` is a prop for.
  const internal = href.startsWith('/') && !href.startsWith('//');

  return (
    <div data-block={block.__typename} data-lead-source={leadSource} className="my-8">
      {/* asChild, so this renders ONE anchor rather than an <a> inside a
          <button> — Lesson 11.2 Key Concept 7. */}
      <Button asChild variant={variant} size="xl">
        {internal ? (
          <Link href={`/${locale}${href}`}>{label}</Link>
        ) : (
          <a href={href} rel="noopener noreferrer">
            {label}
          </a>
        )}
      </Button>
    </div>
  );
}
