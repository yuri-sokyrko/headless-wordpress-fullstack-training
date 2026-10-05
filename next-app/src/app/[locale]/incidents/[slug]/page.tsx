import { notFound } from 'next/navigation';
import { fetchGraphQL, untypedDocument } from '@/lib/graphql/client';
import type { IncidentBySlugQueryResponse } from '@/types/graphql-responses';

// `id: $slug, idType: SLUG` — a bare `id:` with a slug returns null (Lesson 05.3).
const IncidentBySlugDocument = untypedDocument<IncidentBySlugQueryResponse, { slug: string }>(
  /* GraphQL */ `
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
  `
);

interface IncidentSlugsResponse {
  readonly incidents: { readonly nodes: readonly { readonly slug: string }[] };
}

const IncidentSlugsDocument = untypedDocument<IncidentSlugsResponse, { first: number }>(
  /* GraphQL */ `
    query IncidentSlugs($first: Int!) {
      incidents(first: $first, where: { status: PUBLISH }) {
        nodes {
          slug
        }
      }
    }
  `
);

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  // 40 seeded incidents (appendix 03 §9). `first: 100` leaves room for the ones
  // Module 16 lets visitors submit — but Lesson 06.4 caps every connection at 50
  // nodes, so this is a CEILING and not a page size. Lesson 18.1 adds the cursor loop.
  const data = await fetchGraphQL(IncidentSlugsDocument, { first: 100 });

  return data.incidents.nodes.map((incident) => ({ locale: 'en', slug: incident.slug }));
}

export default async function IncidentPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { incident } = await fetchGraphQL(IncidentBySlugDocument, { slug });

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
