'use client';
// The incident board's filter state, published to a subtree.
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

import type { ScapegoatFilter, SeverityFilter } from './IncidentFilters';

// SEVEN members and not one more. Everything a consumer can DERIVE, a consumer
// derives: `isFiltered` is one line in whoever displays it, and the debounced
// query is one hook call in whoever pays for the filtering. A context value is
// an interface, and the smallest one that works is the one to publish.
export type IncidentFilterValue = {
  readonly severity: SeverityFilter;
  readonly scapegoat: ScapegoatFilter;
  /** What the search input displays. Updates on every keystroke. */
  readonly query: string;
  readonly setSeverity: (next: SeverityFilter) => void;
  readonly setScapegoat: (next: ScapegoatFilter) => void;
  readonly setQuery: (next: string) => void;
  /** Resets all three. Not `reset`, not `clearFilters` — consumers destructure it by name. */
  readonly clear: () => void;
};

// `undefined`, deliberately. A plausible default — 'all' plus no-op setters —
// would turn "there is no provider above me" into a UI that renders, responds
// to clicks and filters nothing, forever, silently. See Key Concept 3.
const IncidentFilterContext = createContext<IncidentFilterValue | undefined>(undefined);

export function IncidentFilterProvider({ children }: { readonly children: ReactNode }) {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [scapegoat, setScapegoat] = useState<ScapegoatFilter>('all');
  const [query, setQuery] = useState('');

  function clear(): void {
    setSeverity('all');
    setScapegoat('all');
    setQuery('');
  }

  const value: IncidentFilterValue = {
    severity,
    scapegoat,
    query,
    // The raw setters, narrowed to "set a value". Consumers do not need the
    // updater form (Lesson 08.3 Key Concept 3) and giving it to them would be
    // one more thing they could get wrong.
    setSeverity,
    setScapegoat,
    setQuery,
    clear,
  };

  return <IncidentFilterContext.Provider value={value}>{children}</IncidentFilterContext.Provider>;
}

/**
 * The ONLY way to read this context. The context object itself is not exported.
 *
 * Throws rather than returning `undefined`, so a missing provider is an error
 * with a fix in it instead of a component that silently does nothing.
 */
export function useIncidentFilters(): IncidentFilterValue {
  const value = useContext(IncidentFilterContext);

  if (value === undefined) {
    throw new Error('useIncidentFilters must be used inside <IncidentFilterProvider>');
  }

  return value;
}
