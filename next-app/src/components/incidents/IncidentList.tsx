// Now owns the filtering, the count and the empty state — the three things that
// are statements about the list rather than about whoever renders it.
//
// Three of these four props are filter values being handed down from two levels
// up. That is prop drilling, it is about to get worse, and Lesson 08.5 removes
// all three from this signature.
import type { Incident } from '@/types/content';

import { IncidentCard } from './IncidentCard';
import type { ScapegoatFilter, SeverityFilter } from './IncidentFilters';

type IncidentListProps = {
  readonly incidents: readonly Incident[];
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  readonly query: string;
};

/** Pure, exported for Module 12, and outside the component because it closes over nothing. */
export function matchesFilters(
  incident: Incident,
  severity: ScapegoatFilter,
  scapegoat: ScapegoatFilter,
  query: string
): boolean {
  const bySeverity =
    severity === 'all' || incident.severities.nodes.some((term) => term.slug === severity);
  const byScapegoat =
    scapegoat === 'all' || incident.scapegoats.nodes.some((term) => term.slug === scapegoat);
  const needle = query.trim().toLowerCase();
  const byQuery = needle === '' || incident.title.toLowerCase().includes(needle);

  return bySeverity && byScapegoat && byQuery;
}

export function IncidentList({ incidents, severity, scapegoat, query }: IncidentListProps) {
  // DERIVED during render — Lesson 08.3 Key Concept 7, one level lower down.
  const visible = incidents.filter((incident) =>
    matchesFilters(incident, severity, scapegoat, query)
  );

  // The empty state gets its own return, above the list. A component that
  // renders an empty <ul> is a bug report waiting to be filed.
  if (incidents.length === 0) {
    return <p>No incidents on the board. Somebody, somewhere is relieved.</p>;
  }

  return (
    <>
      <p>{`${visible.length} of ${incidents.length} incidents`}</p>
      <ul className="incident-list">
        {visible.map((incident) => (
          // The key goes on the OUTERMOST element the callback returns — this
          // <li>, not the card inside it. `slug` is unique per post type and
          // stable across filters, which the array index is not.
          <li key={incident.slug}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </>
  );
}
