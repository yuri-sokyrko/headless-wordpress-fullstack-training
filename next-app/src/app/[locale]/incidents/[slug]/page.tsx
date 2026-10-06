import { notFound } from 'next/navigation';
import { IncidentBySlugDocument, IncidentSlugsDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { incidentTag, listTag } from '@/lib/graphql/tags';

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  // 40 seeded incidents (appendix 03 §9). `first: 100` is a CEILING, not a page size:
  // Lesson 06.4 caps every connection at 50. Lesson 18.1 adds the cursor loop.
  const data = await fetchGraphQL(IncidentSlugsDocument, { first: 100 });

  // EDITED: `incidents` and each `slug` are nullable. flatMap drops a null slug (a route
  // with no slug cannot be built) and narrows string | null -> string without a cast.
  return (data.incidents?.nodes ?? []).flatMap((incident) =>
    incident.slug === null ? [] : [{ locale: 'en', slug: incident.slug }]
  ); // EDITED
}

export default async function IncidentPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { incident } = await fetchGraphQL(
    IncidentBySlugDocument,
    { slug },
    { revalidate: 3600, tags: [incidentTag(slug), listTag('incident')] }
  );

  // Throws. Nothing below runs, and TypeScript narrows `incident` for the rest of the file.
  if (!incident) notFound();

  const details = incident.incidentDetails;
  const severity = incident.severities?.nodes[0];
  const scapegoat = incident.scapegoats?.nodes[0];
  const downtime = details?.downtimeMinutes;
  const confidence = details?.blameConfidence;

  return (
    <main>
      <h1>{incident.title}</h1>

      <dl>
        <dt>Severity</dt>
        <dd>{severity?.name ?? 'unclassified'}</dd>

        <dt>Blamed on</dt>
        <dd>{scapegoat?.name ?? 'nobody, yet'}</dd>

        <dt>Environment</dt>
        <dd>{details?.environment ?? 'Unknown'}</dd>

        <dt>Downtime</dt>
        <dd>{downtime == null ? 'Not recorded' : `${downtime} minutes`}</dd>

        <dt>Blame confidence</dt>
        <dd>{confidence == null ? 'Not recorded' : `${confidence}$`}</dd>
      </dl>

      {details?.stackTrace ? <pre>{details.stackTrace}</pre> : null}

      {/* DEBT (Module 09 → Module 14): the entire post body as one opaque HTML string.
          Module 14 replaces this with BlockRenderer over structured block data. Never
          render `renderedHtml`, and never put a user-supplied string in here. */}
      <div dangerouslySetInnerHTML={{ __html: incident.content ?? '' }} />
    </main>
  );
}
