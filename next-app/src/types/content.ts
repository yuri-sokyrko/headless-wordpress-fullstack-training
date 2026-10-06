// Lesson 10.2 deleted everything codegen derives from wordpress-headless/schema.graphql.
// What is left is the part codegen CANNOT produce: closed sets that live in the content,
// not in the schema. WPGraphQL types a term slug as String, so the severity union is a
// domain invariant the plugin enforces and the front end asserts. Module 12 tests it.

export type SeverityLevel = 's1-catastrophic' | 's2-major' | 's3-minor' | 's4-cosmetic';

// Exhaustive by construction: add a fifth severity term and this stops compiling.
export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  's1-catastrophic': 'S1 — Catastrophic',
  's2-major': 'S2 — Major',
  's3-minor': 'S3 — Minor',
  's4-cosmetic': 'S4 — Cosmetic',
};

// Ordering for the severity taxonomy. Not derivable from the schema: term order is
// editorial, and `slug` is a String on the wire. Module 12 unit-tests this.
export const SEVERITY_ORDER: readonly SeverityLevel[] = [
  's1-catastrophic',
  's2-major',
  's3-minor',
  's4-cosmetic',
];

/** Sort comparator for anything carrying a severity slug. Worst first. */
export function compareSeverity(a: SeverityLevel, b: SeverityLevel): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

export function isSeverityLevel(value: string): value is SeverityLevel {
  return SEVERITY_ORDER.some((level) => level === value);
}
