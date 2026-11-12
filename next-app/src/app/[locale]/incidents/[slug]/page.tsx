import { notFound } from 'next/navigation';
import { draftMode } from 'next/headers';

import { IncidentBySlugDocument, IncidentSlugsDocument } from '@/gql/graphql';

import { fetchGraphQL, fetchGraphQLAuthed } from '@/lib/graphql/client';
import { incidentTag, listTag } from '@/lib/graphql/tags';
import { readPreviewToken } from '@/lib/auth/cookies';

import { BlockRenderer } from '@/components/blocks/BlockRenderer';

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
  const { slug, locale } = await params;

  const { isEnabled } = await draftMode();
  const previewJwt = isEnabled ? await readPreviewToken() : null;

  // fetchGraphQLAuthed, and BOTH of its hard-coded policies are right here
  // rather than incidentally:
  //   cache: 'no-store' — a draft must never enter the shared Data Cache. One
  //     editor's unpublished text served to the public is the highest-severity
  //     bug this architecture can produce, and the client makes it
  //     unrepresentable: there is no options parameter to pass a cache into.
  //   'strict' — any `errors` entry throws. A refused preview is
  //     `{ incident: null }` WITH an errors array, and silently rendering a 404
  //     would hide a capability problem the editor needs to see.
  //
  // No `revalidate` and no `tags` on the preview path, and none can be passed:
  // Next 16's fetch is uncached by default, so omitting the options IS the opt-out.
  const data =
    previewJwt === null
      ? await fetchGraphQL(
          IncidentBySlugDocument,
          { slug },
          { revalidate: 3600, tags: [incidentTag(slug), listTag('incident')] }
        )
      : await fetchGraphQLAuthed(
          IncidentBySlugDocument,
          { slug, asPreview: true },
          { kind: 'user', jwt: previewJwt }
        );

  const { incident } = data;

  // Throws. Nothing below runs, and TypeScript narrows `incident` for the rest of the file.
  if (!incident) notFound();

  const details = incident.incidentDetails;
  const severity = incident.severities?.nodes[0];
  const scapegoat = incident.scapegoats?.nodes[0];
  const downtime = details?.downtimeMinutes;
  const confidence = details?.blameConfidence;
  const estimtedCostUsd = details?.estimatedCostUsd;

  return (
    <>
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

        <dt>Estimated cost USD</dt>
        <dd>{estimtedCostUsd == null ? 'Not recorded' : `${estimtedCostUsd}$`}</dd>

        <dt>Blame confidence</dt>
        <dd>{confidence == null ? 'Not recorded' : `${confidence}%`}</dd>
      </dl>

      {details?.stackTrace ? <pre>{details.stackTrace}</pre> : null}

      <BlockRenderer blocks={incident.editorBlocks} locale={locale} />
    </>
  );
}
