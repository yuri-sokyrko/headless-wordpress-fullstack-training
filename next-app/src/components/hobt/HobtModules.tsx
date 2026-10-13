import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type HobtModule = {
  readonly title: string | null;
  readonly summary: string | null;
  readonly durationMinutes: number | null;
};

export function HobtModules({
  heading,
  modules,
}: {
  readonly heading: string;
  // Three levels of null, exactly as codegen types it. Key Concept 3.
  readonly modules: readonly (HobtModule | null)[] | null;
}) {
  // Drop null rows once, at the top, so the JSX below has one shape to handle.
  const rows = (modules ?? []).filter((m): m is HobtModule => m !== null);

  return (
    <section aria-labelledby="hobt-modules-heading" className="border-border border-t py-12">
      <h2 id="hobt-modules-heading" className="text-2xl font-semibold tracking-tight">
        {heading}
      </h2>

      {rows.length === 0 ? (
        // The empty state. A section with no rows renders a sentence, not an
        // empty grid with a stray gap — and never nothing at all, because
        // "nothing rendered" is indistinguishable from "the query broke".
        <p className="text-muted-foreground mt-4 text-sm">
          The curriculum is being finalised. Check back shortly.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((module, i) => (
            <li key={`${module.title ?? 'module'}-${i}`}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">{module.title ?? 'Untitled module'}</CardTitle>
                  {typeof module.durationMinutes === 'number' ? (
                    <p className="text-muted-foreground text-xs">{module.durationMinutes} min</p>
                  ) : null}
                </CardHeader>
                {/* A sub-field is null independently of its siblings: an editor
                    who typed a title and saved produces exactly this row. */}
                {module.summary !== null && module.summary !== '' ? (
                  <CardContent className="text-muted-foreground text-sm">
                    {module.summary}
                  </CardContent>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
