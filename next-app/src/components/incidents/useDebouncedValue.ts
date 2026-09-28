// The module's only legitimate effect. A debounce touches a browser timer, which
// is outside React, keeps running on its own, and must be cancelled.
import { useEffect, useState } from 'react';

/**
 * Returns `value`, but no sooner than `delayMs` after it last changed.
 *
 * Generic on purpose: nothing in here knows or cares that the value is a search
 * string. Module 16 debounces a different type with the same hook.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    // Do not annotate the handle as `number`. With @types/node in scope this is
    // NodeJS.Timeout, and `ReturnType<typeof setTimeout>` is the portable way to
    // say "whatever this platform returns". clearTimeout accepts either.
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    // THE POINT OF THE HOOK. Every keystroke cancels the pending update before
    // scheduling a new one, so only the last one in a burst survives. Delete
    // this return and the hook stops being a debounce.
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
