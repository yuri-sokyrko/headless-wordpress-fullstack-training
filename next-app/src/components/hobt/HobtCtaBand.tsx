import { Button } from '@/components/ui/button';
// Anchored edit: replace the inert GET DEMO block and the explanatory <p>
// beneath it. `noteId` and the `aria-describedby` it fed go with them.
import { GetDemoDialog } from '@/components/hobt/GetDemoDialog';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

export function HobtCtaBand({
  heading,
  blurb,
  startNowUrl,
  demoBookingUrl,
  locale,
  // Kebab-case, matching wp_btt_leads.source and the btt/hobt-cta block's
  // `leadSource` attribute. The block component from Lesson 14.4 passes its
  // attribute straight through.
  leadSource = 'hobt-hero',
}: {
  // An identity, not a place. The component renders identically whichever
  // value it gets — Key Concept 2.
  readonly heading: string;
  readonly blurb: string | null;
  readonly startNowUrl: string | null;
  readonly demoBookingUrl: string | null;
  readonly locale: string;
  readonly leadSource?: (typeof LEAD_SOURCES)[number];
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-6">
      <p className="text-lh font-semibold tracking-tight">{heading}</p>
      {blurb !== null && blurb !== '' ? (
        <p className="text-muted-foreground mt-2 text-sm">{blurb}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* START NOW — a real link when the URL exists. asChild so this renders
            ONE <a>, not an anchor inside a button (Lesson 11.2 Key Concept 7).
            Plain <a href>, not next/link: the target is off-site. */}
        {startNowUrl !== null && startNowUrl !== '' ? (
          <Button asChild variant="blame" size="xl">
            <a href={startNowUrl} rel="noopener noreferrer">
              Start Now
            </a>
          </Button>
        ) : null}

        <GetDemoDialog source={leadSource} locale={locale} demoBookingUrl={demoBookingUrl} />
      </div>
    </div>
  );
}
