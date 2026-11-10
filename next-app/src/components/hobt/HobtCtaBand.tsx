import { GetDemoDialog } from '@/components/hobt/GetDemoDialog';
import { StartNowButton } from '@/components/hobt/StartNowButton';
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
        <StartNowButton startNowUrl={startNowUrl} locale={locale} leadSource={leadSource} />
        <GetDemoDialog source={leadSource} locale={locale} demoBookingUrl={demoBookingUrl} />
      </div>
    </div>
  );
}
