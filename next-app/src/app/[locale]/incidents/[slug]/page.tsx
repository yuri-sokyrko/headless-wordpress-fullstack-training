/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { notFound } from 'next/navigation';
import { draftMode } from 'next/headers';

import {
  IncidentBySlugDocument,
  IncidentSlugsDocument,
  type IncidentSlugsQuery,
} from '@/gql/graphql';

import { fetchGraphQL, fetchGraphQLAuthed } from '@/lib/graphql/client';
import { incidentTag, listTag } from '@/lib/graphql/tags';
import { readPreviewToken } from '@/lib/auth/cookies';

import { BlockRenderer } from '@/components/blocks/BlockRenderer';

// Matches the per-fetch value from Lesson 10.3. `dynamicParams` is written
// once, explicitly, because the whole defence of a bounded generateStaticParams
// rests on it and a reader should not have to know the default.
export const revalidate = 3600;
export const dynamicParams = true;

const PAGE_SIZE = 50;

/**
 * 40 seeded incidents (appendix 03 §9), plus room for the ones Module 16 lets
 * visitors submit — Lesson 09.4's number and Lesson 09.4's reason, now actually
 * reachable because the loop below pages past the 50-node cap.
 *
 * `null` means "every slug WordPress will give you". Step 6 sets it to `null`
 * ON PURPOSE, to produce a number; Step 7 puts the bound back.
 */
const PRERENDER_LIMIT: number | null = 100;

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const slugs: string[] = [];
  let after: string | null = null;

  for (;;) {
    const data: IncidentSlugsQuery = await fetchGraphQL(
      IncidentSlugsDocument,
      { first: PAGE_SIZE, after },
      { revalidate: 3600, tags: [listTag('incident')] }
    );

    for (const node of data.incidents?.nodes ?? []) {
      if (typeof node?.slug === 'string') {
        slugs.push(node.slug);
      }
    }

    const info = data.incidents?.pageInfo;

    if (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      info?.hasNextPage !== true ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      typeof info.endCursor !== 'string' ||
      (PRERENDER_LIMIT !== null && slugs.length >= PRERENDER_LIMIT)
    ) {
      break;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    after = info.endCursor;
  }

  const bounded = PRERENDER_LIMIT === null ? slugs : slugs.slice(0, PRERENDER_LIMIT);

  // The build-time receipt, and the number Verification reads. `queries` is the
  // interesting one: it is what grows linearly with the archive.
  console.log(
    `[btt] prerender incidents: ${bounded.length} pages, ` +
      `${Math.ceil(slugs.length / PAGE_SIZE) || 1} GraphQL queries, bound ${PRERENDER_LIMIT ?? 'NONE'}`
  );

  return bounded.map((slug) => ({ locale: 'en', slug }));
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
