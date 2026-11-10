'use server';

// EVERY EXPORT IN THIS FILE IS A PUBLIC HTTP ENDPOINT (Lesson 16.2 §1).
// One action is exported. Everything else below has no `export` keyword, and
// that is a security decision, not a style one — Verification counts them.
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import {
  CreateIncidentDocument,
  IncidentTermOptionsDocument,
  SiteChromeDocument,
  type CreateIncidentInput,
} from '@/gql/graphql';
import { readAccessToken } from '@/lib/auth/cookies';
import { getSession } from '@/lib/auth/session';
import { fetchGraphQLAuthed, fetchGraphQL } from '@/lib/graphql/client';
import { formatGraphQLErrors, isGraphQLRequestError } from '@/lib/graphql/errors';
import { listTag, taxonomyListTag, siteTag } from '@/lib/graphql/tags';
import { limit } from '@/lib/rate-limit';
import {
  refineTerms,
  type IncidentInput,
  type IncidentTermAllowlist,
} from '@/lib/validation/schemas';

/** Serialisable, because `useActionState` sends it across the wire (§2). */
export type IncidentFormState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    }
  | { readonly status: 'success'; readonly databaseId: number; readonly title: string };

/**
 * The stored kebab-case SCF value → the GraphQL enum NAME on the wire.
 * Appendix 03 §3: enum values are SCREAMING_SNAKE, the SCF select values are
 * kebab, and the resolver maps between them. So the wire format is the enum.
 *
 * If your codegen emits TypeScript `enum`s rather than string unions, these
 * values are `IncidentEnvironment.Production` and friends. Check
 * src/gql/graphql.ts and use whichever your generator produced.
 */
const ENVIRONMENT: Record<
  IncidentInput['environment'],
  NonNullable<CreateIncidentInput['environment']>
> = {
  production: 'PRODUCTION',
  staging: 'STAGING',
  development: 'DEVELOPMENT',
  'works-on-my-machine': 'WORKS_ON_MY_MACHINE',
};

const RESOLUTION: Record<
  IncidentInput['resolutionStatus'],
  NonNullable<CreateIncidentInput['resolutionStatus']>
> = {
  open: 'OPEN',
  mitigated: 'MITIGATED',
  blamed: 'BLAMED',
  wontfix: 'WONTFIX',
};

/**
 * The caller's IP, for the rate-limit key.
 *
 * `x-forwarded-for` is set by the proxy in front of the app. It is trustworthy
 * on Vercel, where the platform overwrites it, and forgeable behind a proxy
 * that merely appends to it — so this is a load-shedding key, never an identity.
 * Locally the header is absent and every submit shares one bucket, which is
 * exactly why the limit is easy to observe in development.
 */
async function clientIp(): Promise<string> {
  const store = await headers();

  return store.get('x-forwarded-for')?.split(',')[0]?.trim() || store.get('x-real-ip') || '0.0.0.0';
}

/**
 * The term allowlist, from WordPress, at submit time.
 *
 * NOT from the form, and not hard-coded. `severity` is closed at four terms;
 * `scapegoat` is free-form and editors add to it, so a hard-coded list means a
 * content change needs a deploy. Cached for 60 seconds and tagged, so a term
 * deleted a moment ago is still accepted here for up to a minute — and then
 * refused by WordPress, which is the authority (Lesson 16.1 §5).
 */
async function termAllowlist(): Promise<IncidentTermAllowlist> {
  const data = await fetchGraphQL(IncidentTermOptionsDocument, undefined, {
    revalidate: 60,
    tags: [taxonomyListTag('scapegoat'), taxonomyListTag('severity')],
  });

  return {
    scapegoats: (data.scapegoats?.nodes ?? []).flatMap((n) => (n?.slug ? [n.slug] : [])),
    severities: (data.severities?.nodes ?? []).flatMap((n) => (n?.slug ? [n.slug] : [])),
  };
}

/**
 * Submit an incident for moderation.
 *
 * The five steps, in this order, with the numbers as comments. Module 23's
 * src/actions/incidents.test.ts imports this function by name.
 */
export async function submitIncident(
  _previous: IncidentFormState,
  formData: FormData
): Promise<IncidentFormState> {
  // ── 1. RATE LIMIT ──────────────────────────────────────────────────
  // Before parsing, because parsing eleven fields is real CPU on an endpoint
  // anybody can reach. Fails CLOSED (§5).
  const verdict = await limit(`incident:${await clientIp()}`);

  if (!verdict.ok) {
    return {
      status: 'error',
      message:
        verdict.reason === 'exceeded'
          ? `Too main submissions. Try again in ${verdict.retryAfterSeconds} seconds.`
          : 'Submissions are temporarily unavailable. Try again shortly.',
    };
  }

  // ── 1b. KILL SWITCH ────────────────────────────────────────────────
  // Lesson 04.3 promised this refuses BEFORE it validates anything, so it sits
  // here rather than inside step 3. It is a CONTENT setting, not an
  // authorisation decision (Lesson 16.4 §5) — which is why it is read here and
  // deliberately not in createIncident.
  const chrome = await fetchGraphQL(SiteChromeDocument, undefined, {
    revalidate: 60,
    tags: [siteTag()],
  });

  // `!== false`, not `=== true`. TWO optional links, because the shape is two
  // levels: `siteSettings` is the SCF options PAGE and `siteChrome` is the field
  // group on it (Lesson 04.3 §5). Either can be null on an install nobody has
  // saved, and treating null as "closed" gives a fresh environment a dead
  // submission form for a reason no error message mentions. Compare the rate
  // limiter above, which fails CLOSED on a missing variable, because that one
  // IS a security control. Lesson 16.4 §5 has the test for telling them apart.
  if (chrome.siteSettings?.siteChrome?.incidentSubmissionOpen === false) {
    return {
      status: 'error',
      message:
        'Incident submitssion is paused right now. Nothing you typed was sent - try again later.',
    };
  }

  // ── 2. VALIDATE ────────────────────────────────────────────────────
  // safeParse, never parse: a throw here becomes a generic error boundary and
  // the user loses eleven fields of typing (Lesson 16.1 §6).
  const parsed = refineTerms(await termAllowlist()).safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the fields below.',
      fieldErrors: parsed.error?.flatten().fieldErrors,
    };
  }

  const input = parsed.data;

  // ── 3. AUTHENTICATE, then AUTHORISE ────────────────────────────────
  const session = await getSession();

  if (!session.isLoggedIn) {
    // Deliberately NOT a redirect. The 300-second access token can expire
    // while somebody fills in a long form, and a redirect would throw their
    // answers away. 15.5's route guard already stopped the anonymous case
    // from ever rendering this form.
    return {
      status: 'error',
      message: 'Your session expired. Sign in again in another tab, then submit.',
    };
  }

  const jwt = await readAccessToken();

  if (jwt === null) {
    return {
      status: 'error',
      message: 'Your session expired. Sign in again in another tab, then submit.',
    };
  }

  // A UX check, NOT a security boundary. `session.roles` is honest — it came
  // from WordPress — but this code runs on a machine an attacker can skip.
  // The enforcement is current_user_can('create_incidents') in PHP (§7).
  if (
    !session.roles.some(
      (role) => role === 'incident_reporter' || role === 'editor' || role === 'administrator'
    )
  ) {
    return { status: 'error', message: 'Your account is not allowed to submit incidents.' };
  }

  // ── 4. CALL WORDPRESS ──────────────────────────────────────────────
  // { kind: 'user', jwt } — never the app token. Lesson 15.2 made the wrong
  // one a compile error (§9).
  try {
    const data = await fetchGraphQLAuthed(
      CreateIncidentDocument,
      {
        input: {
          title: input.title,
          body: input.body,
          scapegoatSlug: input.scapegoatSlug,
          severitySlug: input.severitySlug,
          occurredAt: input.occurredAt,
          downtimeMinutes: input.downtimeMinutes,
          estimatedCostUsd: input.estimatedCostUsd,
          environment: ENVIRONMENT[input.environment],
          resolutionStatus: RESOLUTION[input.resolutionStatus],
          blameConfidence: input.blameConfidence,
          stackTrace: input.stackTrace,
          reporterDisplayName: input.reporterDisplayName,
          // NOT SENT: `status` and `isVerified`. They are in the input type and
          // WordPress discards them (§7). Not sending them is not a control —
          // it is honesty about what this caller is asking for.
        },
      },
      { kind: 'user', jwt }
    );

    const incident = data.createIncident?.incident;

    // Pending posts can have an empty slug until publication. The database ID
    // confirms creation without requiring a public URL for moderated content.
    if (!incident || !Number.isInteger(incident.databaseId) || incident.databaseId <= 0) {
      console.error('[btt] submitIncident: WordPress returned no incident database ID');

      return {
        status: 'error',
        message:
          'WordPress did not confirm the submission. Check your account before submitting again.',
      };
    }

    // ── 5. REVALIDATE, then return ───────────────────────────────────
    // The new incident is `pending`, so NO public page changes and the public
    // list tag is deliberately left alone (§8). What is stale is the browser's
    // Router Cache entry for the reporter's own account page.
    revalidatePath(`/${input.locale}/account`);

    // Named for the reader: this is the tag Module 18's webhook expires when an
    // editor publishes. It is NOT expired here, and that is the decision.
    void listTag('incident');

    return { status: 'success', databaseId: incident.databaseId, title: input.title };
  } catch (error) {
    if (isGraphQLRequestError(error)) {
      // WORDPRESS SPOKE. Lesson 15.2 made fetchGraphQLAuthed strict — writes do
      // not tolerate a partial response — so a UserError from
      // create_incident_payload() arrives here rather than as a null payload.
      // Surface its own wording: Lesson 06.2 §8 fixed the message set, and
      // every one is a single safe sentence. "Too many submissions. Try again
      // later." is worth ten times a generic string to the person reading it.
      return { status: 'error', message: formatGraphQLErrors(error.errors) };
    }

    // NOT a GraphQL failure: a timeout, a DNS failure, a proxy hanging up.
    // There is no WordPress sentence to surface, so the caller gets an opaque
    // one — and `error` is deliberately not logged here, because a fetch error
    // object can carry the request options and those carry a Bearer token.
    return {
      status: 'error',
      message: 'We could not confirm the submission. Check your account before submitting again.',
    };
  }
}
