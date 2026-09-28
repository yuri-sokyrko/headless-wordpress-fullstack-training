// Reads its filters from context instead of being handed them by two ancestors.
// The `incidents` prop stays: the DATA is genuinely the caller's business, and
// Lesson 09.3 swaps that one prop from fixtures to a live WPGraphQL query.
import type { Incident } from '@/types/content';

import { IncidentCard } from './IncidentCard';
import { useIncidentFilters } from './IncidentFilterProvider';
import type { ScapegoatFilter, SeverityFilter } from './IncidentFilters';
import { useDebouncedValue } from './useDebouncedValue';

type IncidentListProps = {
  readonly incidents: readonly Incident[];
};

/** Pure, exported for Module 12, and outside the component because it closes over nothing. */
export function matchesFilters(
  incident: Incident,
  severity: SeverityFilter,
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

export function IncidentList({ incidents }: IncidentListProps) {
  const { severity, scapegoat, query } = useIncidentFilters();

  // The debounce lives HERE, in the component that pays for the work, rather
  // than in the provider. State colocation applied to a derived value: the
  // input's job is to feel instant, and re-filtering is this component's cost
  // to manage. Lesson 08.4 had it in the harness because there was nowhere
  // better; there is now.
  const debouncedQuery = useDebouncedValue(query, 250);

  const visible = incidents.filter((incident) =>
    matchesFilters(incident, severity, scapegoat, debouncedQuery)
  );

  if (incidents.length === 0) {
    return <p>No incidents on the board. Somebody, somewhere is relieved.</p>;
  }

  return (
    <>
      <p>{`${visible.length} of ${incidents.length} incidents`}</p>
      <ul className="incident-list">
        {visible.map((incident) => (
          <li key={incident.slug}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </>
  );
}
