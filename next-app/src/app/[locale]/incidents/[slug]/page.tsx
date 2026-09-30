import { notFound } from 'next/navigation';
import type { GraphQLPayload, IncidentBySlugQueryResponse } from '@/types/graphql-responses';

const INCIDENT_BY_SLUG = /* GraphQL */ `
  query IncidentBySlug($slug: ID!) {
    incident(id: $slug, idType: SLUG) {
      id
      databaseId
      title
      slug
      date
      content
      blameScore
      incidentDetails {
        occurredAt
        downtimeMinutes
        estimatedCostUsd
        environment
        resolutionStatus
        blameConfidence
        stackTrace
        reporterDisplayName
        isVerified
      }
      severities(first: 1) {
        nodes {
          id
          name
          slug
          count
        }
      }
      scapegoats(first: 1) {
        nodes {
          id
          name
          slug
          count
        }
      }
      techStacks(first: 5) {
        nodes {
          id
          name
          slug
          count
        }
      }
    }
  }
`;

interface IncidentSlugsResponse {
  readonly incidents: { readonly nodes: readonly { readonly slug: string }[] };
}

const INCIDENT_SLUGS = /* GraphQL */ `
  query IncidentSlugs($first: Int!) {
    incidents(first: $first, where: { status: PUBLISH }) {
      nodes {
        slug
      }
    }
  }
`;

async function fetchIncident(slug: string): Promise<IncidentBySlugQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;

  if (!endpoint) {
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `id: $slug, idType: SLUG` — a bare `id:` with a slug returns null (Lesson 05.3).
    body: JSON.stringify({ query: INCIDENT_BY_SLUG, variables: { slug } }),
  });

  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<IncidentBySlugQueryResponse>;

  if (payload.errors?.length) {
    console.error('[btt] IncidentBySlug errors:', payload.errors.map((e) => e.message).join('; '));
  }

  if (!payload.data) throw new Error('WPGraphQL returned no data for IncidentBySlug');

  return payload.data;
}

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint)
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 40 seeded incidents (appendix 03 §9). `first: 100` leaves room for the ones
    // Module 16 lets visitors submit, without another edit here — but note that
    // Lesson 06.4 caps every connection at 50 nodes, so this is a CEILING and
    // not a page size. Lesson 18.1 adds the cursor loop that makes it reachable.
    body: JSON.stringify({ query: INCIDENT_SLUGS, variables: { first: 100 } }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<IncidentSlugsResponse>;
  if (!payload.data) throw new Error('WPGraphQL returned no data for IncidentSlugs');

  return payload.data.incidents.nodes.map((incident) => ({ locale: 'en', slug: incident.slug }));
}

export default async function IncidentPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { incident } = await fetchIncident(slug);

  // Throws. Nothing below runs, and TypeScript narrows `incident` for the rest of the file.
  if (!incident) notFound();

  const details = incident.incidentDetails;
  const severity = incident.severities.nodes[0];
  const scapegoat = incident.scapegoats.nodes[0];

  return (
    <main>
      <h1>{incident.title}</h1>

      <dl>
        <dt>Severity</dt>
        <dd>{severity?.name ?? 'unclassified'}</dd>

        <dt>Blamed on</dt>
        <dd>{scapegoat?.name ?? 'nobody, yet'}</dd>

        <dt>Environment</dt>
        <dd>{details.environment}</dd>

        <dt>Downtime</dt>
        {/* Step 6 breaks this line on purpose. The type says `number`; the schema says
            Float, which is nullable. Do not add `?.` — that would hide the lesson. */}
        <dd>{details.downtimeMinutes.toFixed(0)} minutes</dd>

        <dt>Blame confidence</dt>
        <dd>{details.blameConfidence}%</dd>
      </dl>

      <pre>{details.stackTrace}</pre>

      {/* DEBT (Module 09 → Module 14): the entire post body as one opaque HTML string.
          Module 14 replaces this with BlockRenderer over structured block data. Never
          render `renderedHtml`, and never put a user-supplied string in here. */}
      <div dangerouslySetInnerHTML={{ __html: incident.content ?? '' }} />
    </main>
  );
}
