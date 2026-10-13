import { Button } from '@/components/ui/button';

export function HobtCtaBand({
  idPrefix,
  heading,
  blurb,
  startNowUrl,
  demoBookingUrl,
}: {
  // An identity, not a place. The component renders identically whichever
  // value it gets — Key Concept 2.
  readonly idPrefix: string;
  readonly heading: string;
  readonly blurb: string | null;
  readonly startNowUrl: string | null;
  readonly demoBookingUrl: string | null;
}) {
  const noteId = `${idPrefix}-demo-note`;

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

        {/* GET DEMO — deliberately inert. No <form>, no onClick, no fetch.
            `aria-disabled` rather than `disabled`: a disabled control leaves the
            tab order, so a keyboard user would never reach the button OR the
            sentence explaining it. Lesson 11.4 Key Concept 1. */}
        {demoBookingUrl !== null && demoBookingUrl !== '' ? (
          <Button variant="outline" size="xl" aria-disabled="true" aria-describedby={noteId}>
            Get Demo
          </Button>
        ) : null}
      </div>

      {demoBookingUrl !== null && demoBookingUrl !== '' ? (
        // VISIBLE, not just announced. A control that does nothing needs a
        // reason a sighted mouse user can also read.
        <p id={noteId} className="text-muted-foreground mt-3 text-xs">
          Demo booking opens in Module 16, once the lead form is validated and rate limited.
        </p>
      ) : null}
    </div>
  );
}
