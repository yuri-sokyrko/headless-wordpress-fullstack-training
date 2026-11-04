// schemas.ts is pure and has no `server-only` guard, so it unit-tests in plain
// Node exactly like tags.ts and errors.ts (Lesson 12.2 §6).
import { describe, expect, it } from 'vitest';

import { incidentSchema, refineTerms, registerSchema } from '@/lib/validation/schemas';

const ALLOWED = {
  scapegoats: ['the-intern', 'dns', 'legacy-jquery'],
  severities: ['s1-catastrophic', 's2-major', 's3-minor', 's4-cosmetic'],
} as const;

/** A submission that passes, so each failing case differs by exactly one field. */
function validIncident(overrides: Record<string, unknown> = {}) {
  return {
    title: 'The cache served last Tuesday for six hours',
    body: '',
    scapegoatSlug: 'the-intern',
    severitySlug: 's2-major',
    occurredAt: '2024-06-01T09:00',
    downtimeMinutes: '42',
    estimatedCostUsd: '',
    environment: 'production',
    resolutionStatus: 'open',
    blameConfidence: '73',
    stackTrace: '',
    locale: 'en',
    ...overrides,
  };
}

describe('registerSchema', () => {
  it('accepts a plausible registration', () => {
    expect(
      registerSchema.safeParse({ email: 'dev@example.test', displayName: 'Dev', locale: 'en' })
        .success
    ).toBe(true);
  });

  it('rejects an email with no @', () => {
    const result = registerSchema.safeParse({ email: 'dev.example.test', displayName: 'Dev' });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.email?.[0]).toBe(
      'That does not look like an email address.'
    );
  });

  it('rejects a display name over 80 characters, the bound PHP also enforces', () => {
    const result = registerSchema.safeParse({
      email: 'dev@example.test',
      displayName: 'x'.repeat(81),
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.displayName?.[0]).toContain('80 characters');
  });

  it('trims before it measures, so whitespace is not a name', () => {
    expect(
      registerSchema.safeParse({ email: 'dev@example.test', displayName: '   ' }).success
    ).toBe(false);
  });
});

describe('incidentSchema', () => {
  it('accepts the happy path and coerces the numeric strings FormData gives it', () => {
    const result = incidentSchema.safeParse(validIncident());

    expect(result.success).toBe(true);
    expect(result.data?.downtimeMinutes).toBe(42);
  });

  it('rejects a 201-character title', () => {
    const result = incidentSchema.safeParse(validIncident({ title: 'x'.repeat(201) }));

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.title?.[0]).toContain('200 characters');
  });

  // THE absint TEST. Number('') is 0, and 0 is a legitimate-looking downtime.
  // Lesson 16.1 §3 — this is the case a bare z.coerce.number() gets wrong.
  it('rejects an EMPTY downtime instead of silently reading it as zero', () => {
    const result = incidentSchema.safeParse(validIncident({ downtimeMinutes: '' }));

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.downtimeMinutes?.[0]).toContain('Enter');
  });

  it('accepts an explicit zero downtime, which is a real answer', () => {
    expect(incidentSchema.safeParse(validIncident({ downtimeMinutes: '0' })).success).toBe(true);
  });

  it('rejects a downtime above 100000, the bound mutation-create-incident.php enforces', () => {
    expect(incidentSchema.safeParse(validIncident({ downtimeMinutes: '100001' })).success).toBe(
      false
    );
  });

  it('rejects an occurredAt in the future rather than clamping it to now', () => {
    expect(
      incidentSchema.safeParse(validIncident({ occurredAt: '2099-01-01T00:00' })).success
    ).toBe(false);
  });

  it('rejects an environment outside the enum', () => {
    expect(
      incidentSchema.safeParse(validIncident({ environment: 'works-on-your-machine' })).success
    ).toBe(false);
  });
});

describe('refineTerms', () => {
  it('accepts a slug that is in the allowlist', () => {
    expect(refineTerms(ALLOWED).safeParse(validIncident()).success).toBe(true);
  });

  // SHAPE versus EXISTENCE. 's9-apocalyptic' matches the slug regex perfectly.
  it('rejects a well-shaped severity slug that is not a term', () => {
    const result = refineTerms(ALLOWED).safeParse(
      validIncident({ severitySlug: 's9-apocalyptic' })
    );

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.severitySlug?.[0]).toBe(
      'That severity does not exist.'
    );
  });

  it('rejects a well-shaped scapegoat slug that is not a term', () => {
    const result = refineTerms(ALLOWED).safeParse(
      validIncident({ scapegoatSlug: 'the-security-researcher' })
    );

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.scapegoatSlug?.[0]).toBe(
      'That scapegoat does not exist.'
    );
  });

  it('lets the base schema through unchanged, so one bad field yields one error', () => {
    const result = refineTerms(ALLOWED).safeParse(
      validIncident({ severitySlug: 's9-apocalyptic' })
    );

    expect(Object.keys(result.error?.flatten().fieldErrors ?? {})).toEqual(['severitySlug']);
  });
});
