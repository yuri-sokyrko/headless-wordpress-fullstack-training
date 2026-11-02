'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { RegisterDeveloperDocument, VerifyDeveloperDocument, LoginDocument } from '@/gql/graphql';
import { clearSessionCookies, setSessionCookies } from '@/lib/auth/cookies';
import { fetchGraphQLAuthed, fetchGraphQL } from '@/lib/graphql/client';

/**
 * EVERY EXPORT OF A 'use server' MODULE MUST BE AN ASYNC FUNCTION.
 *
 * Next turns each export into a callable endpoint, so a `const` export is a
 * build error. A `type` export is fine — types are erased before the bundler
 * sees the file. That is why the idle state lives in AuthForm.tsx and not here.
 *
 * The shape is what useActionState needs: previous state in, next state out.
 * Module 23.3 unit-tests these two functions by that signature.
 */
export type AuthFormState = {
  readonly status: 'idle' | 'error' | 'sent' | 'verified';
  readonly message: string;
  /** Keyed by the form field's `name`. Rendered as a summary; Lesson 16.1 puts them beside the inputs. */
  readonly fieldErrors: Readonly<Record<string, string>>;
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DATED DEBT — replaced in Lesson 16.1 by src/lib/validation/schemas.ts (Zod).
 *
 * `zod` is not a dependency yet, on purpose: it arrives with react-hook-form and
 * @hookform/resolvers so the whole form story lands in one lesson. Until then
 * this is fifty lines of hand-written checking, and it has the two weaknesses
 * you would expect. It does not narrow types (every value stays `string`), and
 * the rules live here instead of in a schema the client could share. Both are
 * exactly what 16.1 fixes. Do not extend this helper; replace it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type FieldRule = {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly email?: boolean;
  /** Passwords only. Trimming a passphrase changes it, and the user could then never sign in. */
  readonly keepWhitespace?: boolean;
};

type FieldResult = { readonly value: string; readonly error: string | null };

// Deliberately loose. An email regex that tries to implement RFC 5322 rejects
// valid addresses; WordPress's is_email() is the real check and it runs in PHP
// on every one of these values (Lesson 06.2 §6). This one catches typos.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function field(formData: FormData, name: string, rule: FieldRule): FieldResult {
  const raw = formData.get(name);

  // FormData values are `string | File | null`. A File would stringify to
  // "[object File]" and pass a length check, so `typeof` is the only honest test.
  if (typeof raw !== 'string') {
    return { value: '', error: `${rule.label} is required.` };
  }

  const value = rule.keepWhitespace === true ? raw : raw.trim();

  if (value.length < rule.min) {
    return { value, error: `${rule.label} must be at least ${rule.min} character(s).` };
  }

  if (value.length > rule.max) {
    return { value, error: `${rule.label} must be ${rule.max} characters or fewer.` };
  }

  if (rule.email === true && !EMAIL_RE.test(value)) {
    return { value, error: `${rule.label} does not look like an email address.` };
  }

  return { value, error: null };
}

function errorsOf(fields: Readonly<Record<string, FieldResult>>): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};

  for (const [name, result] of Object.entries(fields)) {
    if (result.error !== null) {
      errors[name] = result.error;
    }
  }

  return errors;
}

/** One sentence, one reason. See the comment inside `register`. */
const REGISTER_SENT =
  'Check your inbox for a confirmation link. If you already have an account, sign in instead.';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DATED DEBT — DELETED in Lesson 16.2, replaced by src/lib/rate-limit.ts
 * (Upstash Redis, shared by every Server Action, failing closed).
 *
 * A Map in a serverless function does not survive a cold start and does not
 * span instances, so the real limit is (this number) × (instances) and it
 * resets whenever the platform starts a new one. `x-forwarded-for` is
 * client-controlled unless a trusted proxy rewrites it, so a determined
 * attacker rotates the header and is never limited at all. And this Map grows
 * without bound: one entry per distinct IP string, never evicted.
 *
 * What it IS worth: the rate-limit STEP is now the first thing every action
 * does, so Lesson 16.2 is an import swap rather than a redesign. Lesson 15.5's
 * entry-point matrix records it as "in-memory, per instance", not as "yes".
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();

  // Locally this header is usually absent, so every request shares the
  // 'unknown' bucket and the limit is effectively global in development. That
  // is honest, and it makes the limiter trivial to exercise by hand.
  return first === undefined || first === '' ? 'unknown' : first;
}

function allowAttempt(key: string): boolean {
  const now = Date.now();
  const entry = ATTEMPTS.get(key);

  if (entry === undefined || entry.resetAt <= now) {
    ATTEMPTS.set(key, { count: 1, resetAt: now + WINDOW_MS });

    return true;
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return false;
  }

  entry.count += 1;

  return true;
}

const TOO_MANY = 'Too many attempts. Wait a minute and try again.';

/** One message for a wrong password AND an unknown account. Lesson 15.3 §1. */
const INVALID_CREDENTIALS = 'That email and password combination was not recognised.';

/**
 * OPEN REDIRECT DEFENCE.
 *
 * `?next=` arrives from the query string, so it is attacker-chosen. Only a
 * same-origin absolute path is accepted. The second character may not be `/`
 * or `\`: browsers treat `//evil.test` and `/\evil.test` as absolute URLs with
 * a host, and a redirect to either one is a phishing primitive with your domain
 * in the address bar of the page that sent the user there.
 */
function safeNextPath(raw: FormDataEntryValue | null, fallback: string): string {
  if (typeof raw !== 'string' || !/^\/(?![/\\])[\w\-./?=&%]*$/.test(raw)) {
    return fallback;
  }

  return raw;
}

/** One locale today. Module 20 replaces this with the real list. */
function safeLocale(raw: FormDataEntryValue | null): string {
  return raw === 'en' ? 'en' : 'en';
}

/**
 * Create an unverified `incident_reporter`.
 *
 * `{ kind: 'app' }` — there is no user yet, so the APPLICATION proves itself.
 * The token is read from WP_APP_TOKEN inside the client and cannot be passed
 * in from here (Lesson 15.2 §6).
 */
export async function register(
  _previous: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!allowAttempt(`register:${await clientIp()}`)) {
    return { status: 'error', message: TOO_MANY, fieldErrors: {} };
  }

  const fields = {
    displayName: field(formData, 'displayName', { label: 'Display name', min: 1, max: 80 }),
    email: field(formData, 'email', { label: 'Email', min: 5, max: 190, email: true }),
  };

  const fieldErrors = errorsOf(fields);

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  try {
    const data = await fetchGraphQLAuthed(
      RegisterDeveloperDocument,
      {
        email: fields.email.value,
        displayName: fields.displayName.value,
        // Module 20 reads the real locale from the route segment. Hard-coded
        // here, and WordPress falls back to `en` for anything it does not know.
        locale: 'en',
      },
      { kind: 'app' }
    );

    if (data.registerDeveloper?.accepted !== true) {
      return { status: 'error', message: 'Registration could not be completed.', fieldErrors: {} };
    }
  } catch (error) {
    // Detail to the log, one sentence to the wire — the policy Lesson 10.4 wrote
    // into docs/api-contract.md.
    console.error('[btt] registerDeveloper failed', error);

    return { status: 'error', message: 'Registration could not be copleted.', fieldErrors: {} };
  }

  // ONE success message, for a new address and for an already-registered one.
  // WordPress returns the same payload on purpose (Lesson 06.2 §8); rendering
  // two different sentences here would rebuild the enumeration oracle in
  // TypeScript. The user-experience cost is real and accepted: someone who
  // forgot they registered gets this message and no email.

  return { status: 'sent', message: REGISTER_SENT, fieldErrors: {} };
}

/**
 * Consume the emailed code, set the chosen password, mark the email verified.
 *
 * Called from a POST, never from rendering the /verify page. A GET must not
 * mutate: an email client that prefetches links would otherwise burn the code
 * before the human ever clicked it.
 */
export async function verify(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const fields = {
    uid: field(formData, 'uid', { label: 'Account reference', min: 1, max: 20 }),
    token: field(formData, 'token', { label: 'Confirmation code', min: 8, max: 200 }),
    password: field(formData, 'password', {
      label: 'Password',
      min: 12,
      max: 200,
      keepWhitespace: true,
    }),
  };

  const fieldErrors = errorsOf(fields);

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  const userId = Number.parseInt(fields.uid.value, 10);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { status: 'error', message: 'That confirmation link is not valid.', fieldErrors: {} };
  }

  try {
    const data = await fetchGraphQLAuthed(
      VerifyDeveloperDocument,
      { userId, code: fields.token.value, password: fields.password.value },
      { kind: 'app' }
    );

    if (data.verifyDeveloper?.verified !== true) {
      // ONE message for invalid, expired and already-used, mirroring the single
      // generic payload WordPress returns.
      return {
        status: 'error',
        message:
          'That confirmation link is invalid, expired or already used. Register again to get a new one.',
        fieldErrors: {},
      };
    }
  } catch (error) {
    // A thrown error here is a UserError from PHP — in practice, the password
    // rule. WordPress is the authority on its own rules, so surface its message.
    console.error('[btt] verifyDeveloper failed', error);

    return {
      status: 'error',
      message: 'That password was rejected. Use at least 12 characters and try again.',
      fieldErrors: {},
    };
  }

  return {
    status: 'verified',
    message: 'Your account is confirmed and your password is set. You can sign in now.',
    fieldErrors: {},
  };
}

/**
 * Trade an email and a password for a cookie pair.
 *
 * `fetchGraphQL`, not `fetchGraphQLAuthed`: there is no credential to present.
 * This is the call that CREATES one. The password travels in the mutation
 * variables over the server-to-server connection and is never stored, logged or
 * echoed. No `options` argument, so no `revalidate` and no `tags` — and Next
 * 15's fetch default is `cache: 'no-store'`, so nothing is cached.
 */
export async function login(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // ── 1. RATE LIMIT, first, before any work ──────────────────────────
  if (!allowAttempt(`login:${await clientIp()}`)) {
    return { status: 'error', message: TOO_MANY, fieldErrors: {} };
  }

  // ── 2. VALIDATE ────────────────────────────────────────────────────
  const locale = safeLocale(formData.get('locale'));
  const nextPath = safeNextPath(formData.get('next'), `/${locale}`);

  const fields = {
    email: field(formData, 'email', { label: 'Email', min: 5, max: 190, email: true }),
    // min: 1, not 12. This is a LOGIN: an old account may have a short password
    // and refusing to even try would lock out a user WordPress would accept.
    // Password policy belongs where the password is set, not where it is used.
    password: field(formData, 'password', {
      label: 'Password',
      min: 1,
      max: 200,
      keepWhitespace: true,
    }),
  };

  const fieldErrors = errorsOf(fields);

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  // ── 3. ASK WORDPRESS ───────────────────────────────────────────────
  let authToken: string;
  let refreshToken: string;

  try {
    // `username` carries an EMAIL. wp_authenticate_email_password resolves it,
    // and registerDeveloper never tells the user their generated login, so an
    // email is the only identifier a public developer has (Lesson 15.2 Step 5).
    const data = await fetchGraphQL(LoginDocument, {
      username: fields.email.value,
      password: fields.password.value,
    });

    const payload = data.login;

    if (
      payload?.authToken === null ||
      payload?.authToken === undefined ||
      payload?.refreshToken === null ||
      payload?.refreshToken === undefined
    ) {
      return { status: 'error', message: INVALID_CREDENTIALS, fieldErrors: {} };
    }

    authToken = payload.authToken;
    refreshToken = payload.refreshToken;
  } catch (error) {
    // WordPress returns HTTP 200 with an `errors` array for a bad password, and
    // the client turns that into a throw. One message covers a wrong password,
    // an unknown account and WordPress being unreachable — the first two must
    // be indistinguishable, and the third is not worth a separate oracle.
    console.error('[btt] login failed', error);

    return { status: 'error', message: INVALID_CREDENTIALS, fieldErrors: {} };
  }

  // ── 4. SET THE COOKIES ─────────────────────────────────────────────
  await setSessionCookies(authToken, refreshToken);

  // ── 5. REDIRECT ────────────────────────────────────────────────────
  // OUTSIDE the try/catch, and this is not a style choice: redirect() works by
  // THROWING a NEXT_REDIRECT error. Call it inside the block above and the
  // catch swallows it, the user stays on the login page, and the cookies are
  // set — a bug that looks like "login does nothing" while login worked.
  redirect(nextPath);
}

/**
 * End the session for THIS browser.
 *
 * Honest about its limits: a copy of `btt_at` taken earlier keeps working until
 * `exp`. There is no revocation list in WPGraphQL JWT Authentication and
 * nothing in Next can un-issue a signed claim (Lesson 15.4 §9). That is exactly
 * why the access token lives 300 seconds.
 *
 * Takes no arguments. `<form action={logout}>` passes a FormData that this
 * function does not want, and a zero-parameter function is assignable to the
 * form's one-parameter action type.
 */
export async function logout(): Promise<void> {
  await clearSessionCookies();

  // '/' rather than '/en': Lesson 09.5's proxy normalises the locale
  // prefix, so the two gates compose instead of duplicating the locale list.
  redirect('/');
}
