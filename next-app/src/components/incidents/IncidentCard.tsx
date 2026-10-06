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
import type { IncidentCardFieldsFragment } from '@/gql/graphql';
import { SEVERITY_LABEL, isSeverityLevel } from '@/types/content';

export function IncidentCard({ incident }: { readonly incident: IncidentCardFieldsFragment }) {
  // Pull the nullable and possibly-absent values out once, at the top, so the
  // JSX below is about layout rather than about narrowing.
  const severity = incident.severities?.nodes[0];
  const scapegoat = incident.scapegoats?.nodes[0];
  const details = incident.incidentDetails;
  const downtime = details?.downtimeMinutes;

  const severitySlug = severity?.slug;
  const severityLabel =
    severitySlug != null && isSeverityLevel(severitySlug)
      ? SEVERITY_LABEL[severitySlug]
      : 'Unclassified';

  return (
    <article className="incident-card">
      <h2>{incident.title ?? 'Untitled incident'}</h2>

      {incident.date === null ? null : (
        <p>
          Reported <time dateTime={incident.date}>{incident.date.slice(0, 10)}</time>
        </p>
      )}

      <p className="incident-cart_severity">{severityLabel}</p>

      <dl>
        <dt>Blamed on</dt>
        <dd>{scapegoat?.name ?? 'Nobody yet'}</dd>

        <dt>Downtime</dt>
        <dd>{downtime != null ? `${downtime} min` : 'Not recorded'}</dd>

        <dt>Environment</dt>
        <dd>{details?.environment ?? 'Unknown'}</dd>
      </dl>
    </article>
  );
}
