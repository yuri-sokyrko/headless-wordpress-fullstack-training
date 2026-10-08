// The last line of defence. Renders its own <html>/<body> because it REPLACES the
// document — nothing above it will provide them. Keep it dependency-free: this runs
// when the app is already failing.
'use client';

type Props = {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
};

export default function GlobalError({ error }: Props) {
  return (
    <html lang="en">
      <body>
        <h1>Blame The Tech is down.</h1>
        <p>This on is genuinely our fault. Reload in a minute.</p>
        {error.digest !== undefined ? <p>Reference: {error.digest}</p> : null}
      </body>
    </html>
  );
}
