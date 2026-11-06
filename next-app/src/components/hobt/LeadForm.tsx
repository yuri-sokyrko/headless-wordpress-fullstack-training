'use client';

import Script from 'next/script';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { submitLead, type LeadFormState } from '@/actions/leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

const INITIAL: LeadFormState = { status: 'idle' };

export function LeadForm({
  source,
  locale,
  demoBookingUrl,
}: {
  readonly source: (typeof LEAD_SOURCES)[number];
  readonly locale: string;
  readonly demoBookingUrl: string | null;
}) {
  const [state, formAction, isPending] = useActionState(submitLead, INITIAL);
  // useId(), so two copies of this form on one page do not share label ids
  // (Lesson 16.1 §7). /hobt renders it twice: in the dialog and inline.
  const ids = useId();
  const [turnstileReady, setTurnstileReady] = useState(false);
  // Rendered on the CLIENT at mount, so it reflects when this visitor got the
  // form rather than when the page was cached. It is also UNSIGNED and
  // therefore forgeable — the authoritative timestamp is Cloudflare's
  // challenge_ts, checked server-side (Lesson 16.3 §5).
  const renderedAt = useRef(Date.now());

  useEffect(() => {
    if (state.status === 'success' && demoBookingUrl) {
      window.location.assign(demoBookingUrl);
    }
  }, [state.status, demoBookingUrl]);

  if (state.status === 'success') {
    return (
      <p role="status" className="text-sm font-medium">
        Thanks. We will be in touch about a demo.
      </p>
    );
  }

  return (
    <>
      {/* afterInteractive: the widget is not needed for first paint, and it must
          not block it. The SITE key is public by design — appendix 04 §3.2. */}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={() => setTurnstileReady(true)}
      />

      {/* No onSubmit. This posts natively with JavaScript off — although with
          JavaScript off there is no Turnstile token either, so the action
          refuses. Named in Key Concept 10: a spam control that requires
          JavaScript is a spam control that requires JavaScript. */}
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="renderedAt" value={String(renderedAt.current)} />

        {/*
          THE HONEYPOT. Off-screen, out of the tab order, hidden from assistive
          technology, autocomplete off, and NEVER `required` — a hidden required
          field makes Chrome refuse to submit the form at all. `type="hidden"`
          would be skipped by any bot worth the name. Lesson 16.3 §5.
        */}
        <div
          aria-hidden="true"
          className="absolute top-auto left-[-9999px] h-px w-px overflow-hidden"
        >
          <label htmlFor={`${ids}-website`}>Website</label>
          <input
            id={`${ids}-website`}
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-fullName`}>Your name</Label>
          <Input
            id={`${ids}-fullName`}
            name="fullName"
            autoComplete="name"
            maxLength={190}
            required
          />
          <p role="alert" className="text-destructive text-sm font-medium">
            {state.status === 'error' ? (state.fieldErrors?.fullName?.[0] ?? '') : ''}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-email`}>Work email</Label>
          <Input
            id={`${ids}-email`}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={190}
            required
          />
          <p role="alert" className="text-destructive text-sm font-medium">
            {state.status === 'error' ? (state.fieldErrors?.email?.[0] ?? '') : ''}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-company`}>Company</Label>
          <Input id={`${ids}-company`} name="company" autoComplete="organization" maxLength={190} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-teamSize`}>Team size</Label>
          <Input id={`${ids}-teamSize`} name="teamSize" maxLength={32} placeholder="e.g. 5-20" />
        </div>

        <div className="flex items-start gap-2">
          <input id={`${ids}-consent`} name="consent" type="checkbox" className="mt-1" required />
          <Label htmlFor={`${ids}-consent`} className="text-sm font-normal">
            You may email me about Blame The Tech. The consent is recorded with the submission.
          </Label>
        </div>
        <p role="alert" className="text-destructive text-sm font-medium">
          {state.status === 'error' ? (state.fieldErrors?.consent?.[0] ?? '') : ''}
        </p>

        {/* The widget writes its token into a hidden input named
            cf-turnstile-response, so the form field name is fixed by Cloudflare.
            We copy it to `turnstileToken`, which is the name leadSchema knows. */}
        <div
          className="cf-turnstile"
          data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          data-response-field-name="turnstileToken"
          data-theme="auto"
        />

        {state.status === 'error' && state.message && !state.fieldErrors ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" variant="blame" size="xl" disabled={isPending || !turnstileReady}>
          {isPending ? 'Sending…' : 'Request a demo'}
        </Button>
      </form>
    </>
  );
}
