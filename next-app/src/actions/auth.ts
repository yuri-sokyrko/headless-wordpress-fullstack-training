'use server';

import { RegisterDeveloperDocument, VerifyDeveloperDocument } from '@/gql/graphql';
import { fetchGraphQLAuthed } from '@/lib/graphql/client';

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
