// One incident, from props.
//
// The field set is deliberate and narrow: title, date, the severity term, the
// first scapegoat term, and downtimeMinutes + environment from incidentDetails.
// That is exactly the selection set of the `IncidentCardFields` GraphQL fragment
// from Lesson 05.3, and Lesson 10.2 narrows this component's props to the type
// codegen produces from it. A field rendered here that the fragment does not
// select compiles today and breaks then.
//
// So: no blameScore (computed, detail page), no stackTrace (detail page), no
// reporterDisplayName. Lesson 09.3 renders those on /incidents/[slug].
import Link from 'next/link';
import type { IncidentCardFieldsFragment } from '@/gql/graphql';
import { SEVERITY_LABEL, type SeverityLevel } from '@/types/content';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components//ui/card';

function asSeverityLevel(slug: string | null | undefined): SeverityLevel | null {
  return slug != null && slug in SEVERITY_LABEL ? (slug as SeverityLevel) : null;
}

export function IncidentCard({ incident }: { readonly incident: IncidentCardFieldsFragment }) {
  // Pull the nullable and possibly-absent values out once, at the top, so the
  // JSX below is about layout rather than about narrowing.
  const severity = asSeverityLevel(incident.severities?.nodes?.[0]?.slug);
  const scapegoat = incident.scapegoats?.nodes[0];
  const downtime = incident.incidentDetails?.downtimeMinutes;

  return (
    // `group` lets the title react to a hover anywhere on the card (Key Concept 6).
    // `transition-colors motion-reduce:transition-none` is the reduced-motion habit
    // Lesson 11.4 audits — start it here rather than retrofitting it there.
    <Card>
      <article className="group text-card-foreground hover:border-ring transition-colors motion-reduce:transition-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            {severity !== null ? (
              <Badge variant={severity}>{SEVERITY_LABEL[severity]}</Badge>
            ) : null}

            {typeof downtime === 'number' ? (
              <span className="text-muted-foreground text-xs">{downtime} min down</span>
            ) : null}
          </div>
        </CardHeader>

        <CardTitle className="px-6">
          <h3 className="mt-3 text-lg leading-snug font-semibold">
            <Link
              // The locale is hard-coded because there is exactly one, and
              // NEXT_PUBLIC_DEFAULT_LOCALE is `en` (appendix 04 §3.2). Module 20
              // replaces every literal like this with next-intl's navigation
              // helpers; do not invent a mapper for it now.
              href={`/en/incidents/${incident.slug}`}
              className="underline-offset-4 group-hover:underline focus-visible:underline"
            >
              {incident.title}
            </Link>
          </h3>
        </CardTitle>

        <CardContent>
          <dl className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {scapegoat ? (
              <div className="flex gap-1">
                <dt>Blamed:</dt>
                <dd className="text-foreground font-medium">{scapegoat.name}</dd>
              </div>
            ) : null}
            {incident.date !== null && incident.date !== undefined ? (
              <div className="flex gap-1">
                <dt>Reported:</dt>
                <dd>
                  <time dateTime={incident.date}>{incident.date.slice(0, 10)}</time>
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </article>
    </Card>
  );
}
