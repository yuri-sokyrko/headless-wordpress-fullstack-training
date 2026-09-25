// An array of incidents, keyed by slug. Lesson 08.5 refactors this to read its
// filters from context instead of taking them as props.
import type { Incident } from '@/types/content';

import { IncidentCard } from './IncidentCard';

type IncidentListProps = {
  readonly incidents: readonly Incident[];
};

export function IncidentList({ incidents }: IncidentListProps) {
  // The empty state gets its own return, above the list. A component that
  // renders an empty <ul> is a bug report waiting to be filed.
  if (incidents.length === 0) {
    return <p>No incidents on the board. Somebody, somewhere is relieved.</p>;
  }

  return (
    <ul className="incident-list">
      {incidents.map((incident) => (
        // The key goes on the OUTERMOST element the callback returns — this
        // <li>, not the card inside it. `slug` is unique per post type and
        // stable across filters, which the array index is not.
        <li key={incident.slug}>
          <IncidentCard incident={incident} />
        </li>
      ))}
    </ul>
  );
}
