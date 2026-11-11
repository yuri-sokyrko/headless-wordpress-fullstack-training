// faust-spike/wp-templates/single-incident.js
// The Faust equivalent of single-incident.php. Compare with
// next-app/src/app/[locale]/incidents/[slug]/page.tsx, which this lesson does
// not touch.
import { gql } from "@apollo/client";

export default function SingleIncident(props) {
  // props.data is what Faust's Apollo client returned for the query below.
  const incident = props?.data?.incident;

  if (!incident) {
    return <main>Not found.</main>;
  }

  return (
    <main>
      <p>
        Rendered by Faust, on port 3001, from wp-templates/single-incident.js.
      </p>
      <h1>{incident.title}</h1>
      <p>Slug: {incident.slug}</p>
      <p>Blame score: {String(incident.blameScore)}</p>
      <p>
        Downtime: {String(incident.incidentDetails?.downtimeMinutes)} minutes
      </p>
    </main>
  );
}

// The template owns its own query, and its own variables mapper. This is the
// second round trip from Key Concept 4 — it cannot start until the seed query
// has told Faust that this URI is an Incident with this databaseId.
SingleIncident.query = gql`
  query GetIncident($databaseId: ID!, $asPreview: Boolean = false) {
    incident(id: $databaseId, idType: DATABASE_ID, asPreview: $asPreview) {
      title
      slug
      blameScore
      incidentDetails {
        downtimeMinutes
      }
    }
  }
`;

SingleIncident.variables = ({ databaseId }, ctx) => ({
  databaseId,
  asPreview: ctx?.asPreview,
});
