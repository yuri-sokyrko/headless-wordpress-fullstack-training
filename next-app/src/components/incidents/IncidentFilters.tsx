// Two controlled selects and a clear button. Fully CONTROLLED: this component
// holds no state at all. In this lesson the state lives in the harness App,
// which is uncomfortable by design — Lesson 08.5 pays that discomfort off.
import type { ChangeEvent } from 'react';

import type { SeverityLevel } from '@/types/content';
import { SEVERITY_LABEL } from '@/types/content';

import { SCAPEGOAT_TERMS } from './fixtures';

/** The closed severity set, plus one sentinel meaning "do not filter". */
export type SeverityFilter = SeverityLevel | 'all';

/**
 * `scapegoat` is a FREE-FORM taxonomy (appendix 03 §2), so its slug is `string`
 * and there is no union to be had. The types mirror the content model exactly:
 * closed set becomes a union, open set stays a string. That asymmetry is the
 * model showing through, not sloppiness.
 */
export type ScapegoatFilter = string;

function isSeverityLevel(value: string): value is SeverityLevel {
  return value in SEVERITY_LABEL;
}

/** Narrow a <select> value back into the union. A real check, never an `as` cast. */
export function isSeverityFilter(value: string): value is SeverityFilter {
  return value === 'all' || isSeverityLevel(value);
}

// Derived from SEVERITY_LABEL, which is a Record over SeverityLevel (Lesson 07.4).
// Add a fifth severity term to the union and SEVERITY_LABEL stops compiling until
// you give it a row — at which point this option list picks the term up with no
// edit here. Object.keys() is typed string[], and the guard is what restores the
// union without a cast.
const SEVERITY_OPTIONS: readonly SeverityLevel[] =
  Object.keys(SEVERITY_LABEL).filter(isSeverityLevel);

type IncidentFiltersProps = {
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  readonly onSeverityChange: (next: SeverityFilter) => void;
  readonly onScapegoatChange: (next: ScapegoatFilter) => void;
  readonly onClear: () => void;
};

export function IncidentFilters({
  severity,
  scapegoat,
  onSeverityChange,
  onScapegoatChange,
  onClear,
}: IncidentFiltersProps) {
  function handleSeverity(event: ChangeEvent<HTMLSelectElement>): void {
    // event.target.value is `string`, and it is a string even though every
    // <option> below carries a SeverityLevel — the DOM knows nothing about your
    // union. Narrow it with the guard. Do NOT write `as SeverityFilter`: that
    // would be a claim, and a claim is exactly what you cannot make about a
    // value that arrived from the browser.
    const value = event.target.value;
    if (isSeverityFilter(value)) {
      onSeverityChange(value);
    }
  }

  function handleScapegoat(event: ChangeEvent<HTMLSelectElement>): void {
    onScapegoatChange(event.target.value);
  }

  return (
    <div className="incidentfilters">
      <label htmlFor="filter-severity">Severity</label>
      <select id="filter-severity" value={severity} onChange={handleSeverity}>
        <option value="all">All severities</option>
        {SEVERITY_OPTIONS.map((slug) => (
          <option key={slug} value={slug}>
            {SEVERITY_LABEL[slug]}
          </option>
        ))}
      </select>

      <label htmlFor="filter-scapegoat">Blamed on</label>
      <select id="filter-scapegoat" value={scapegoat} onChange={handleScapegoat}>
        <option value="all">Anyone</option>
        {SCAPEGOAT_TERMS.map((term) => (
          <option key={term.slug} value={term.slug}>
            {term.name}
          </option>
        ))}
      </select>

      {/* type="button" is not optional. The HTML default is "submit", and this
          component ends up inside a <form> in Module 16. */}
      <button type="button" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
