'use server';

// ONE export, and it is the action. Every export in a 'use server' file is a
// public HTTP endpoint (Lesson 16.2 §1).
//
// NOTHING in this file logs an email address, an IP, a token or a request
// body. A log line is a database you did not mean to create (Lesson 16.3 §7).
import { SubmitHobtLeadDocument, type SubmitHobtLeadInput } from '@/gql/graphql';
import { fetchGraphQLAuthed } from '@/lib/graphql/client';
import { formatGraphQLErrors, isGraphQLRequestError } from '@/lib/graphql/errors';
import { limit } from '@/lib/rate-limit';
import { leadSchema, type LeadInput } from '@/lib/validation/schemas';
import { headers } from 'next/headers';

export type LeadFormState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    }
  | { readonly status: 'success' };

/**
 * ONE message for every SPAM refusal — steps 1 to 3.
 *
 * Not "honeypot filled", not "too fast", not "captcha failed". A precise
 * message tells a spammer which control tripped and therefore which one to
 * tune. Same rule as Lesson 06.2 §8.
 *
 * Note the boundary: this covers the spam stack. WordPress's own field
 * messages, which arrive from step 4, ARE surfaced verbatim — they are
 * validation answers, not spam-control signals, and Lesson 06.2 §8 fixed them
 * to single safe sentences.
 */
const REFUSED = 'We could not accept that submission. Please try again.';

/** Kebab (stored, and what leadSchema validates) → the GraphQL enum NAME. */
const SOURCE: Record<LeadInput['source'], NonNullable<SubmitHobtLeadInput['source']>> = {
  'hobt-hero': 'HOBT_HERO',
  'hobt-cta-block': 'HOBT_CTA_BLOCK',
  'hobt-footer': 'HOBT_FOOTER',
  'incident-sidebar': 'INCIDENT_SIDEBAR',
};

/** The rate-limit key only. Never stored here, never logged, never returned. */
async function clientIp(): Promise<string> {
  const store = await headers();

  return store.get('x-forwarded-for')?.split(',')[0]?.trim() || store.get('x-real-ip') || '0.0.0.0';
}

type TurnstileVerdict =
  { readonly ok: false } | { readonly ok: true; readonly challengeTs: number };

/**
 * Verify a Turnstile token SERVER-SIDE.
 *
 * The site key is public by design and lives in the client bundle; the secret
 * key is in TURNSTILE_SECRET_KEY and never leaves this process
 * (appendix 04 §3.2). A client-side "the widget said OK" is not a check.
 *
 * The response carries `challenge_ts` — the time CLOUDFLARE recorded the
 * challenge being solved. That is the authoritative render timestamp: the
 * client never touches it, so unlike the `renderedAt` hidden field it cannot
 * be forged. Free, from a call we were already making (Lesson 16.3 §5).
 */
async function verifyTurnstile(token: string, ip: string): Promise<TurnstileVerdict> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    // FAIL CLOSED on a missing secret, exactly like the limiter and exactly
    // like require_app_token()'s empty-token branch. A forgotten env var must
    // not switch a control off.
    return { ok: false };
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      cache: 'no-store',
    });

    const result = (await response.json()) as { success?: boolean; challenge_ts?: string };

    if (result.success !== true || !result.challenge_ts) {
      return { ok: false };
    }

    return { ok: true, challengeTs: Date.parse(result.challenge_ts) };
  } catch {
    // No `console.error(error)`. A fetch error object can carry the request
    // options, and the request options carry the secret key.
    return { ok: false };
  }
}

/** Record a HOBT demo lead. The same five steps as Lesson 16.2, in order. */
export async function submitLead(
  _previous: LeadFormState,
  formData: FormData
): Promise<LeadFormState> {
  // ── 1. RATE LIMIT ──────────────────────────────────────────────────
  const ip = await clientIp();
  const verdict = await limit(`lead:${ip}`);

  if (!verdict.ok) {
    // Both reasons get the generic message. "Too many requests" tells a
    // spammer their budget; "unavailable" tells them Redis is down.
    return { status: 'error', message: REFUSED };
  }

  // ── 2. VALIDATE ────────────────────────────────────────────────────
  // The honeypot and the timestamp are FIELDS IN THE SCHEMA. `website` is
  // z.literal(''), so anything in it is a parse failure — and the error is
  // remapped to the generic message below rather than surfaced on a field
  // nobody can see.
  const parsed = leadSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;

    if (fieldErrors.website || fieldErrors.renderedAt || fieldErrors.turnstileToken) {
      return { status: 'error', message: REFUSED };
    }

    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  const input = parsed.data;

  // ── 3. AUTHENTICATE, then AUTHORISE ────────────────────────────────
  // There is no user. The APPLICATION authenticates, in step 4, with the app
  // token — §8. What this step does instead is the spam stack, because these
  // are the checks that decide whether the caller is entitled to write.
  const turnstile = await verifyTurnstile(input.turnstileToken, ip);

  if (!turnstile.ok) {
    return { status: 'error', message: REFUSED };
  }

  // The AUTHORITATIVE timing check: Cloudflare's timestamp, not the client's.
  const elapsedMs = Date.now() - turnstile.challengeTs;

  if (elapsedMs < 2_000 || elapsedMs > 300_000) {
    // Too fast to be a human filling in five fields, or a token so old the
    // page has been sitting open for five minutes and may have been harvested.
    return { status: 'error', message: REFUSED };
  }

  // The weak signal, checked second because it proves less. An unsigned hidden
  // field is forgeable and this app says so out loud (§5).
  const renderedAt = Number(input.renderedAt);

  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < 2_000) {
    return { status: 'error', message: REFUSED };
  }

  // ── 4. CALL WORDPRESS ──────────────────────────────────────────────
  // { kind: 'app' } — there is no logged-in user, so the application proves
  // itself with X-BTT-App-Token. The union carries no credential field at all —
  // fetchGraphQLAuthed reads WP_APP_TOKEN from the environment, so an app
  // credential can never arrive from a call site, and therefore never from a
  // form field, a request or a client component.
  try {
    const data = await fetchGraphQLAuthed(
      SubmitHobtLeadDocument,
      {
        input: {
          email: input.email,
          fullName: input.fullName,
          company: input.company === '' ? null : input.company,
          teamSize: input.teamSize === '' ? null : input.teamSize,
          source: SOURCE[input.source],
          locale: input.locale,
          consent: true,
        },
      },
      { kind: 'app' }
    );

    if (data.submitHobtLead?.accepted !== true) {
      // Defensive only. A refusal is THROWN, not returned: Lesson 15.2 made
      // fetchGraphQLAuthed strict, so any `errors` entry becomes a
      // GraphQLRequestError. A DUPLICATE never reaches here either —
      // submitHobtLead returns accepted: true for one on purpose (§9), so
      // there is no error to surface and no oracle to leak.
      return { status: 'error', message: REFUSED };
    }
  } catch (error) {
    if (isGraphQLRequestError(error)) {
      // WordPress spoke. Its message set is fixed and safe (Lesson 06.2 §8):
      // "A valid email address is required.", "Consent is required.",
      // "Not authorized." — single sentences, no path, no plugin, no SQL.
      // Surfacing "Not authorized." verbatim is what turns a misconfigured
      // WP_APP_TOKEN from an undiagnosable outage into a one-glance answer.
      return { status: 'error', message: formatGraphQLErrors(error.errors) };
    }

    // A timeout, a DNS failure, a proxy hanging up. There is no WordPress
    // sentence to surface. `error` is READ FOR NOTHING and never logged,
    // stringified or interpolated: a fetch error object can carry the request
    // options, and the request options carry the lead and the app token.
    return { status: 'error', message: REFUSED };
  }

  // ── 5. REVALIDATE, then return ─────────────────────────────────────
  // NOTHING is revalidated, and that is the whole comment. A lead is not
  // content: no page renders it, no cache tag covers it, and wp_btt_leads is
  // invisible to WordPress's content APIs by construction. The step is written
  // out anyway so a reviewer can see it was CONSIDERED rather than skipped —
  // which is the only thing that makes a fixed skeleton worth having.
  return { status: 'success' };
}
