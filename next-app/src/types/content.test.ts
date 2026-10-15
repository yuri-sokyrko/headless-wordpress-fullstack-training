import { describe, expect, it } from 'vitest';

import { SEVERITY_LABEL, SEVERITY_ORDER, compareSeverity } from '@/types/content';
import type { SeverityLevel } from '@/types/content';

describe('SEVERITY_ORDER is a permutation of the labelled set', () => {
  it('has one entry per label, with no duplicates and nothing missing', () => {
    expect(SEVERITY_ORDER).toHaveLength(4);
    expect(new Set(SEVERITY_ORDER).size).toBe(SEVERITY_ORDER.length);
    expect([...SEVERITY_ORDER].sort()).toEqual(Object.keys(SEVERITY_LABEL).sort());
  });
});

describe('compareSeverity is a total order', () => {
  it('is antisymmentric', () => {
    for (const a of SEVERITY_ORDER) {
      for (const b of SEVERITY_ORDER) {
        // Summed rather than negated: Math.sign(0) is 0 and -Math.sign(0) is -0,
        // and toBe uses Object.is, for which Object.is(0, -0) is false.
        expect(Math.sign(compareSeverity(a, b)) + Math.sign(compareSeverity(b, a))).toBe(0);
      }
    }
  });

  it('returns 0 only for equal levels', () => {
    for (const a of SEVERITY_ORDER) {
      for (const b of SEVERITY_ORDER) {
        expect(compareSeverity(a, b) === 0).toBe(a === b);
      }
    }
  });

  it('is transitive', () => {
    for (const a of SEVERITY_ORDER) {
      for (const b of SEVERITY_ORDER) {
        for (const c of SEVERITY_ORDER) {
          if (compareSeverity(a, b) <= 0 && compareSeverity(b, c) <= 0) {
            expect(compareSeverity(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });

  it('sorts the worst severity first, whatever order it started in', () => {
    const shuffled: readonly SeverityLevel[] = [
      's3-minor',
      's1-catastrophic',
      's4-cosmetic',
      's2-major',
    ];

    expect([...shuffled].sort(compareSeverity)).toEqual([...SEVERITY_ORDER]);
  });
});
