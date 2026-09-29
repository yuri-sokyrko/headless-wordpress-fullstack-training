'use client';

import { IncidentFilters } from './IncidentFilters';
import { useIncidentFilters } from './IncidentFilterProvider';
import { IncidentList } from './IncidentList';
import { IncidentSearch } from './IncidentSearch';
import type { Incident } from '@/types/content';

/**
 * The client boundary for the incident browser.
 *
 * Everything interactive on /[locale]/incidents lives under this file. The page above
 * it stays a Server Component; the data arrives as a plain serializable array.
 */
export function IncidentBrowser({ incidents }: { readonly incidents: readonly Incident[] }) {
  // The one call that forces this file to be a Client Component. Hooks need a browser
  // runtime, so a hook call is a boundary requirement, not a style choice.
  const { severity, scapegoat, query, setSeverity, setScapegoat, setQuery, clear } =
    useIncidentFilters();

  return (
    <section>
      <IncidentSearch value={query} onChange={setQuery} />

      {/* Controlled since Lesson 08.3. These five props include three functions, which
          is precisely why a Server Component could not render this component directly. */}
      <IncidentFilters
        severity={severity}
        scapegoat={scapegoat}
        onSeverityChange={setSeverity}
        onScapegoatChange={setScapegoat}
        onClear={clear}
      />

      {/* IncidentList reads the same context itself — see Lesson 08.5. It needs no
          directive of its own because only this client file imports it. */}

      <IncidentList incidents={incidents} />
    </section>
  );
}
