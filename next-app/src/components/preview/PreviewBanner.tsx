// Unmissable, and reversible in one click. Rendered from the root layout only
// when draft mode is on, so a public visitor never receives this markup.

export function PreviewBanner({ locale }: { readonly locale: string }) {
  return (
    <aside className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-sm text-neutral-950">
      <strong>Draft preview</strong>
      <span>
        You are viewing unpublished content. Nobody else can see this - it is your session, not the
        site.
      </span>
      {/*
        A plain <a>, deliberately NOT next/link. The exit must be a real document
        request: the route handler's Set-Cookie has to be applied and the client
        router's cache discarded, and a client-side navigation to a route handler
        does neither.
      */}
      <a className="ml-auto font-semibold underline" href={`/api/preview/exit?locale=${locale}`}>
        Exit preview
      </a>
    </aside>
  );
}
