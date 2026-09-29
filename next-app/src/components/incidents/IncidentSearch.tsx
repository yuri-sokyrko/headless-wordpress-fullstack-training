'use client';
// A controlled search box. Holds no state: the query lives with the other
// filters, further up the tree. The only thing it owns is a ref to its own input.
import { useRef } from 'react';
import type { ChangeEvent } from 'react';

// `value` and `onChange`, matching the names the DOM element uses. Lesson 09.2's
// client island renders this component and passes exactly these two.
type IncidentSearchProps = {
  readonly value: string;
  readonly onChange: (next: string) => void;
};

export function IncidentSearch({ value, onChange }: IncidentSearchProps) {
  // A DOM node, not a displayed value. `null` until React commits the element.
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value);
  }

  function handleClear(): void {
    onChange('');

    // In an event handler, after the commit, so the node exists. Never during
    // render. A button that clears a field and keeps focus has stranded every
    // keyboard user — Module 22 audits exactly this.
    inputRef.current?.focus();
  }

  return (
    <div className="incident-search">
      <label htmlFor="incident-search">Search titles</label>
      <input
        id="incident-search"
        ref={inputRef}
        type="search"
        value={value}
        onChange={handleChange}
        placeholder="regex, certificate, cron"
      />
      <button type="button" onClick={handleClear} disabled={value === ''}>
        Clear search
      </button>
    </div>
  );
}
