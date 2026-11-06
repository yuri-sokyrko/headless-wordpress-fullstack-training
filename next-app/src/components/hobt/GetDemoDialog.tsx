'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { LeadForm } from '@/components/hobt/LeadForm';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

/**
 * Radix Dialog from Lesson 11.2 gives the six behaviours a hand-rolled modal
 * always gets wrong: focus in on open, a real focus trap, Escape to close,
 * focus RESTORED to the trigger, the aria wiring with matching ids, and the
 * rest of the page inert to assistive technology. Lesson 16.3 §10.
 *
 * With JavaScript off, this trigger renders as a button that does nothing —
 * which is why /hobt also renders an always-visible copy of LeadForm at
 * #lead and this trigger is not the only route to it.
 */
export function GetDemoDialog({
  source,
  locale,
  demoBookingUrl,
}: {
  readonly source: (typeof LEAD_SOURCES)[number];
  readonly locale: string;
  readonly demoBookingUrl: string | null;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* asChild, so this is ONE <button>, not a button inside a button
            (Lesson 11.2 Key Concept 7). */}
        <Button variant="outline" size="xl">
          Get Demo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book a demo</DialogTitle>
          <DialogDescription>
            Four fields. We do not store your IP address, only keyed hash of it.
          </DialogDescription>
        </DialogHeader>
        <LeadForm source={source} locale={locale} demoBookingUrl={demoBookingUrl} />
      </DialogContent>
    </Dialog>
  );
}
