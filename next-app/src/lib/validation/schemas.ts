// The single source of validation shape for the whole app. Imported by client
// forms AND by Server Actions — Lesson 16.1 §2.
//
// NO `import 'server-only'` here, deliberately. This module holds no endpoint,
// no credential and no secret; it holds rules, and both sides need them. The
// guard belongs on src/lib/graphql/client.ts and on src/lib/auth/*, which hold
// all three. Lesson 10.1 drew that line.
//
// EVERY bound below is mirrored by a check in PHP, named per field. WordPress
// re-validates independently (Lesson 06.2) and is the authority. If you widen a
// bound here, widen it there FIRST, or you have built a form that promises
// something the API refuses.
import { z } from 'zod';

/** The three locales the app ships. Module 20 makes them routable. */
export const LOCALES = ['en', 'uk', 'de'] as const;

/** kebab-case term slugs. SHAPE ONLY — existence is §5, and refineTerms(). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * FormData carries strings, and Number('') is 0. So require a non-empty string
 * FIRST and coerce SECOND. `z.coerce.number()` on its own is absint('abc'), and
 * a silent zero is a legitimate-looking downtime figure. Lesson 16.1 §3.
 */
function requiredNumber(label: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .pipe(z.coerce.number({ invalid_type_error: `${label} must be a number.` }));
}

/** Same, but an empty field means "not supplied" rather than an error. */
function optionalNumber(label: string) {
  return z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .pipe(z.coerce.number({ invalid_type_error: `${label} must be a number.` })),
    ])
    .transform((v) => (v === '' ? undefined : v));
}

// mutation-register-developer.php: sanitize_email() then is_email().
// 190 is wp_btt_leads.email VARCHAR(190) — appendix 03 §5.
const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(190, 'That email address is too long.')
  .email('That does not look like an email address.');

// mutation-register-developer.php: '' === $name || mb_strlen( $name ) > 80.
const displayName = z
  .string()
  .trim()
  .min(1, 'Enter a display name.')
  .max(80, 'Keep the display name to 80 characters or fewer.');

const locale = z.enum(LOCALES).default('en');

export const registerSchema = z.object({ email, displayName, locale });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  // No length or complexity rule on a LOGIN password. WordPress decides whether
  // it is correct; a client-side minimum here only tells an attacker how short
  // a password is worth trying, and locks out a legacy account with a shorter one.
  username: z.string().trim().min(1, 'Enter your username or email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifySchema = z.object({
  // mutation-register-developer.php mails wp_generate_password( 32, false, false ).
  uid: requiredNumber('a user id').pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
  token: z.string().trim().length(32, 'That verification link is not complete.'),
  password: z
    .string()
    .min(12, 'Choose a password of at least 12 characters.')
    .max(200, 'Keep the password to 200 characters or fewer.'),
});
export type VerifyInput = z.infer<typeof verifySchema>;

export const incidentSchema = z.object({
  // mutation-create-incident.php: '' === $title, then mb_strlen( $title ) > 200.
  title: z
    .string()
    .trim()
    .min(1, 'Give the incident a title.')
    .max(200, 'Keep the title to 200 characters or fewer.'),
  // wp_kses_post() in PHP decides which HTML survives. There is no Zod
  // equivalent and there should not be: the sanitiser belongs where the value
  // is stored. All this bound does is refuse a novel.
  body: z.string().trim().max(20000, 'That is too long for one incident.').default(''),
  scapegoatSlug: z.string().trim().regex(SLUG, 'Choose a scapegoat.'),
  severitySlug: z.string().trim().regex(SLUG, 'Choose a severity.'),
  // require_past_datetime() in PHP: strtotime(), then reject the future.
  occurredAt: z
    .string()
    .trim()
    .min(1, 'When did it happen?')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'That is not a date we understand.')
    .refine((v) => Date.parse(v) <= Date.now(), 'An incident cannot have happened in the future.'),
  // mutation-create-incident.php: $downtime > 100000.
  downtimeMinutes: requiredNumber('the downtime in minutes').pipe(
    z
      .number()
      .int('Whole minutes, please.')
      .min(0, 'Downtime cannot be negative.')
      .max(100000, 'Downtime must be 100000 minutes or fewer.')
  ),
  // mutation-create-incident.php: $cost < 0 || $cost > 1000000000.
  estimatedCostUsd: optionalNumber('the estimated cost').pipe(
    z
      .number()
      .min(0, 'Cost cannot be negative.')
      .max(1_000_000_000, 'That cost is out of range.')
      .optional()
  ),
  // Real GraphQL enums (appendix 03 §3). The STORED kebab values, because that
  // is what the mutation input maps from — Lesson 06.1 §4.
  environment: z.enum(['production', 'staging', 'development', 'works-on-my-machine']),
  resolutionStatus: z.enum(['open', 'mitigated', 'blamed', 'wontfix']).default('open'),
  // mutation-create-incident.php: $blame < 0 || $blame > 100, default 73.
  blameConfidence: requiredNumber('a blame confidence')
    .pipe(z.number().min(0, 'Between 0 and 100.').max(100, 'Between 0 and 100.'))
    .default('73'),
  stackTrace: z.string().trim().max(5000, 'Trim the stack trace to 5000 characters.').default(''),
  reporterDisplayName: displayName.optional(),
  locale,
});
export type IncidentInput = z.infer<typeof incidentSchema>;

/** Term slugs that actually exist, fetched from WordPress at submit time. */
export type IncidentTermAllowlist = {
  readonly scapegoats: readonly string[];
  readonly severities: readonly string[];
};

/**
 * incidentSchema plus existence checks. A regex proves a slug is slug-shaped;
 * only a lookup proves it is a term, and `s9-apocalyptic` is the counterexample
 * (Lesson 16.1 §5, Lesson 06.2 §6).
 *
 * A FUNCTION rather than a refinement inside incidentSchema, because the schema
 * cannot know the terms and must not fetch them: a schema that performs I/O is
 * a schema you cannot unit-test and cannot import into a client component
 * without dragging WP_GRAPHQL_ENDPOINT with it.
 */
export function refineTerms(allowed: IncidentTermAllowlist) {
  return incidentSchema.superRefine((value, ctx) => {
    if (!allowed.scapegoats.includes(value.scapegoatSlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scapegoatSlug'],
        message: 'That scapegoat does not exist.',
      });
    }

    if (!allowed.severities.includes(value.severitySlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severitySlug'],
        message: 'That severity does not exist.',
      });
    }
  });
}

/**
 * Lead sources, stored KEBAB-case, matching wp_btt_leads.source and the SCF
 * select convention. The block attribute `leadSource` on btt/hobt-cta uses the
 * same values. The GraphQL enum is LeadSource (appendix 03 §3) in
 * SCREAMING_SNAKE, and src/actions/leads.ts maps between them.
 */
export const LEAD_SOURCES = [
  'hobt-hero',
  'hobt-cta-block',
  'hobt-footer',
  'incident-sidebar',
] as const;

export const leadSchema = z.object({
  email,
  // wp_btt_leads.full_name varchar(190), and mutation-submit-hobt-lead.php
  // checks '' === $full_name || mb_strlen( $full_name ) > 190.
  fullName: z.string().trim().min(1, 'Enter your name.').max(190, 'That name is too long.'),
  company: z.string().trim().max(190, 'That company name is too long.').default(''),
  // varchar(32). A free-text bucket rather than an enum, because marketing
  // changes the brackets and a schema change is the wrong cost for that.
  teamSize: z.string().trim().max(32).default(''),
  source: z.enum(LEAD_SOURCES),
  locale,
  // A checkbox posts 'on' when ticked and is ABSENT when not, so a boolean
  // schema would see `undefined` and a `z.boolean()` would reject it with a
  // type error rather than "consent is required". Model what FormData sends.
  consent: z.literal('on', {
    errorMap: () => ({ message: 'Please confirm you are happy to be contacted.' }),
  }),
  // The HONEYPOT. A human never fills this, so anything at all is a refusal.
  // Validated, not ignored: a schema that drops the field cannot refuse on it.
  website: z.literal('').default(''),
  // The UNSIGNED render timestamp. Weak by construction (§5) — a bot can
  // rewrite it. Kept because it costs one hidden input.
  renderedAt: z.string().trim().default(''),
  // The Turnstile token. Shape only; the verdict comes from siteverify.
  turnstileToken: z.string().trim().default(''),
});
export type LeadInput = z.infer<typeof leadSchema>;
