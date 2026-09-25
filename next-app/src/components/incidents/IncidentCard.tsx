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
import type { Incident } from '@/types/content';
import { SEVERITY_LABEL } from '@/types/content';

export function IncidentCard({ incident }: { readonly incident: Incident }) {
  // Pull the nullable and possibly-absent values out once, at the top, so the
  // JSX below is about layout rather than about narrowing.
  const severity = incident.severities.nodes[0];
  const scapegoat = incident.scapegoats.nodes[0];
  const details = incident.incidentDetails;
  const downtime = details?.downtimeMinutes;
  const cost = details?.estimatedCostUsd;

  return (
    <article className="incident-card">
      <h2>{incident.title}</h2>

      {incident.date === null ? null : (
        <p>
          Reported <time dateTime={incident.date}>{incident.date.slice(0, 10)}</time>
        </p>
      )}

      <p className="incident-cart_severity">
        {/* SEVERITY_LABEL is a Record over the closed four-term set, so there is
            no missing-label case. There IS a missing-TERM case. */}
        {severity === undefined ? 'Unclassified' : SEVERITY_LABEL[severity.slug]}
      </p>

      <dl>
        <dt>Blamed on</dt>
        <dd>{scapegoat?.name ?? 'Nobody yet'}</dd>

        <dt>Downtime</dt>
        {/* WRONG ON PURPOSE. Step 4 observes what this does to incident-01,
            whose downtimeMinutes is 0, and then fixes it. */}
        <dd>{downtime != null ? `${downtime} min` : 'Not recorded'}</dd>

        {/* A DEBT, named and dated. `estimatedCostUsd` is NOT in the
            IncidentCardFields fragment, so this row is one field of
            overfetching. It is here because the null-versus-zero branch is
            worth writing twice, and Lesson 10.5's overfetching audit is where
            it comes out. */}
        <dt>Estimated cost</dt>
        <dd>{cost != null ? `$${cost.toLocaleString('en-US')}` : 'No cost recorded'}</dd>

        <dt>Environment</dt>
        <dd>{details?.environment ?? 'Unknown'}</dd>
      </dl>
    </article>
  );
}
