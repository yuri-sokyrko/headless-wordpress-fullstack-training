// Loud in development, silent in production, and NEVER an HTML fallback.
// Lesson 14.1's decision record explains why the fallback is refused; this file
// is what makes refusing it survivable.
export function UnknownBlock({ name }: { readonly name: string }) {
  // NODE_ENV is inlined by the bundler, so in a production build this whole
  // component collapses to `return null` and the markup below is eliminated.
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div
      data-block="UnknownBlock"
      className="border-destructive bg-destructive/10 my-4 rounded-md border-2 border-dashed p-4 text-sm"
    >
      <p className="text-destructive font-semibold">Unmapped block: {name}</p>
      <p className="text-muted-foreground mt-1">
        Nothing is registered for this block, so it renders nothing in production. Add an inline
        fragment to <code>src/graphql/fragments/editorBlocks.graphql</code> and a matching entry to{' '}
        <code>src/components/blocks/registry.ts</code> — the compiler will insist on both.
      </p>
    </div>
  );
}
