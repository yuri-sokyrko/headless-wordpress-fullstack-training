import { describe, expect, it } from 'vitest';

import { INCIDENTS, SEED_INCIDENTS } from '@/components/incidents/fixtures';
import { matchesFilters } from '@/components/incidents/IncidentList';

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`nth(${index}): out of range, length is ${items.length}`);
  }

  return item;
}

describe('matchesFilters - the "all" sentinels', () => {
  it('matches every fixture when nothing is filtered', () => {
    const matched = SEED_INCIDENTS.filter((incident) => matchesFilters(incident, 'all', 'all', ''));

    expect(matched).toHaveLength(SEED_INCIDENTS.length);
  });

  it('matches an incident with an EMPTY scapegoat connection under "all"', () => {
    // Fixture 5 has `scapegoats: { nodes: [] }` — nobody blamed yet. "all" must
    // still match it, and any specific scapegoat must not.
    const unblamed = nth(SEED_INCIDENTS, 4);

    expect(matchesFilters(unblamed, 'all', 'all', '')).toBe(true);
    expect(matchesFilters(unblamed, 'all', 'the-intern', '')).toBe(false);
  });
});

describe('matchesFilters — severity and scapegoat', () => {
  it('keeps exactly ten of the forty incidents per severity', () => {
    // The seeder assigns severities with $i % 4 (Lesson 04.5) and the fixture
    // expansion mirrors it, so ten per severity is an invariant of both.
    const catastrophic = INCIDENTS.filter((incident) =>
      matchesFilters(incident, 's1-catastrophic', 'all', '')
    );

    expect(catastrophic).toHaveLength(10);
  });

  it('matches on the term slug, not the term name', () => {
    const first = nth(SEED_INCIDENTS, 0);

    expect(matchesFilters(first, 'all', 'the-intern', '')).toBe(true);
    expect(matchesFilters(first, 'all', 'The Intern', '')).toBe(false);
  });
});

describe('matchesFilters — the query', () => {
  it('is case-insensitive and trims the needle', () => {
    const certificate = nth(SEED_INCIDENTS, 1);

    expect(certificate.title).toBe('The certificate expired (#2)');
    expect(matchesFilters(certificate, 'all', 'all', '  CERTIFICATE  ')).toBe(true);
  });

  it('matches against the title only, and finds the four headline repeats', () => {
    // Ten headlines cycled over forty incidents, so one headline appears four times.
    const hits = INCIDENTS.filter((incident) =>
      matchesFilters(incident, 'all', 'all', 'certificate')
    );

    expect(hits).toHaveLength(4);
  });

  it('ANDs the three filters rather than ORing them', () => {
    const certificate = nth(SEED_INCIDENTS, 1);

    expect(matchesFilters(certificate, 's2-major', 'all', 'certificate')).toBe(true);
    expect(matchesFilters(certificate, 's1-catastrophic', 'all', 'certificate')).toBe(false);
  });
});
