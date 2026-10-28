// The TypeScript half of the pair described in Key Concept 4. render.php in
// blame-the-tech-blocks/src/incident-ticker/ is the other half; it exists for the
// editor preview and its output is NEVER rendered here.
import Link from 'next/link';

import type { BlockComponentProps } from '@/components/blocks/registry';
import { Badge } from '@/components/ui/badge';
import { IncidentTickerDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import type { SeverityLevel } from '@/types/content';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '@/types/content';

// The block.json defaults, re-declared. A block serialised at its defaults omits
// them from the comment entirely, so the component has to know them — the same
// duplication as `tone` in Key Concept 2, tested in Lesson 23.5.
const DEFAULT_COUNT = 5;
const DEFAULT_SEVERITIES: readonly SeverityLevel[] = ['s1-catastrophic', 's2-major'];

export async function IncidentTicker({ block, locale }: BlockComponentProps<'BttIncidentTicker'>) {
  const attributes = block.attributes;

  // Clamp, do not trust. `count` is a Float on the wire and an editor with the
  // number control can type 500.
  const rawCount = attributes?.count;
  const first =
    typeof rawCount === 'number' && rawCount >= 1
      ? Math.min(Math.trunc(rawCount), 20)
      : DEFAULT_COUNT;

  // Drop nulls and anything that is not a real severity slug, then fall back.
  // An empty array here would reach `severityIn` and match nothing — the server
  // allowlist narrows to zero rather than widening to everything (Lesson 06.1
  // §9) — which reads as "the ticker is broken" rather than "the editor cleared
  // the filter". So the fallback happens here, on the way out.
  const chosen = (attributes?.severities ?? [])
    .map((value) => SEVERITY_ORDER.find((slug) => slug === value))
    .filter((slug): slug is SeverityLevel => slug !== undefined);

  const severities = chosen.length > 0 ? chosen : DEFAULT_SEVERITIES;

  const data = await fetchGraphQL(
    IncidentTickerDocument,
    { first, severities: [...severities] },
    // The same policy as /[locale]/incidents in Lesson 10.3's table, for the same
    // reason: publishing an incident changes this list.
    { revalidate: 300, tags: [listTag('incident')] }
  );

  const rows = (data.incidents?.nodes ?? []).filter(
    (node): node is NonNullable<typeof node> => node !== null
  );

  if (rows.length === 0) return null;

  return (
    <section data-block={block.__typename} className="border-border my-6 rounded-lg border p-4">
      {/* h2 is wrong here — the body's headings are h2 and this is subordinate to
          whatever precedes it. h3, like IncidentCallout. */}
      <h3 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
        Latest incidents
      </h3>

      <ul className="divide-border mt-3 divide-y">
        {rows.map((incident) => {
          const slug = incident.severities?.nodes[0]?.slug;
          const severity = SEVERITY_ORDER.find((value) => value === slug) ?? 's3-minor';

          return (
            <li key={incident.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
              <Badge variant={severity}>{SEVERITY_LABEL[severity]}</Badge>
              <Link href={`/${locale}/incidents/${incident.slug}`}>{incident.title}</Link>
              <span className="text-muted-foreground">
                {incident.incidentDetails?.downtimeMinutes ?? 0} min
                {incident.incidentDetails?.environment !== null &&
                incident.incidentDetails?.environment !== undefined
                  ? ` · ${incident.incidentDetails.environment}`
                  : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
