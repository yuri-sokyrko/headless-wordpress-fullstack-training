'use client';

import { useEffect } from 'react';

type Props = {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
};

export default function RouteError({ error, reset }: Props) {
  useEffect(() => {
    // Module 24 replaces this with a Sentry call.
    console.log(error);
  }, [error]);

  return (
    <main>
      <h1>Something broke on our side.</h1>
      <p>
        The incident log is having an incident. Appropriate, and still annoying. Tyr again - if it
        keeps failing, the problem is our and we can see it.
      </p>
      {/* `digest` is the only server-side identifier that is safe to show: a hash you can
          quote to us and we can grep for. The message itself is replaced by Next in a
          production build, and shown here only in development. */}
      {error.digest !== undefined ? <p>Reference: {error.digest}</p> : null}
      {process.env.NODE_ENV !== 'production' ? <pre>{error.message}</pre> : null}
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
