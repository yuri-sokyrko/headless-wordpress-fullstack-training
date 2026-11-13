// The Faust equivalent of archive-incident.php. Registered under both
// 'archive-incident' and 'archive' in the map, so the hierarchy resolves it
// either way.
import { gql } from "@apollo/client";

export default function ArchiveIncident(props) {
  const nodes = props?.data?.incident?.nodes ?? [];

  return (
    <main>
      <p>Rendered by Faust, from wp-templates/archive-incident.js.</p>
      <h1>Incidents</h1>
      <ul>
        {nodes.map((n) => (
          <li key={n.slug}>{n.title}</li>
        ))}
      </ul>
    </main>
  );
}

ArchiveIncident.query = gql`
  query GetIncidents {
    incidents(first: 10, where: { status: PUBLISH }) {
      nodes {
        slug
        title
      }
    }
  }
`;
