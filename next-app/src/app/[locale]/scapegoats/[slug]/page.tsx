import { notFound } from 'next/navigation';

import { IncidentCard } from '@/components/incidents/IncidentCard';
import { ScapegoatBySlugDocument, ScapegoatSlugsDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag, termTag } from '@/lib/graphql/tags';

export const revalidate = 3600;
export const dynamicParams = true;

/** Ten seeded terms (appendix 03 §9). A taxonomy grows slower than the content that uses it. */
const PRERENDER_LIMIT = 20;

/** Below Lesson 06.4's 50-node connection cap, so this is one query. */
const INCIDENT_SHOWN = 24;

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await fetchGraphQL(
    ScapegoatSlugsDocument,
    { first: PRERENDER_LIMIT },
    // A FIRST APPROXIMATION, and a deliberate one. `incidents` is roughly
    // right — a new scapegoat term usually arrives attached to a newly
    // published incident — but it is not what this query depends on. The set of
    // scapegoat SLUGS changes when a TERM changes, which is a different
    // WordPress hook and a different tag. Lesson 18.2's tag audit is where
    // every read in the app gets the tag it actually depends on; this lesson is
    // about rendering strategy, and mixing the two passes would hide both.
    { revalidate: 3600, tags: [listTag('incident')] }
  );

  const params = (data.scapegoats?.nodes ?? []).flatMap((node) =>
    typeof node?.slug === 'string' ? [{ locale: 'en', slug: node.slug }] : []
  );

  // The build-time receipt. Verification reads this line; do not delete it.
  console.log(`[btt] prerender scapegoats: ${params.length} of at most ${PRERENDER_LIMIT}`);

  return params;
}

export default async function ScapegoatPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;

  const data = await fetchGraphQL(
    ScapegoatBySlugDocument,
    { slug, first: INCIDENT_SHOWN },

    // TWO tags. The term page changes when the term changes, and when an
    // incident is published that carries it — which moves `count` and adds a
    // card. Lesson 18.3's webhook sends both.
    { revalidate: 3600, tags: [termTag('scapegoat', slug), listTag('incident')] }
  );

  const scapegoat = data.scapegoat;

  if (scapegoat === null) {
    notFound();
  }

  const profile = scapegoat.scapegoatProfile;
  const incidents = scapegoat.incidents?.nodes ?? [];

  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">{scapegoat.name}</h1>

      {typeof profile?.tagline === 'string' && profile.tagline !== '' ? (
        <p className="text-muted-foreground mt-2 text-lg italic">{profile.tagline}</p>
      ) : null}

      <dl className="mt-6 grid gap-2 sm:grid-cols-2">
        <dt>Times blamed</dt>
        <dd>{scapegoat.count ?? 0}</dd>

        {/* typeof, not a truthiness check: `defensiveness` is a Float and 0 is
            a legitimate value. Lesson 08.1 Step 4 made exactly this mistake
            with downtimeMinutes and then fixed it. */}

        {typeof profile?.defensiveness === 'number' ? (
          <>
            <dt>Defensiveness</dt>
            <dd>{profile.defensiveness}/10</dd>
          </>
        ) : null}

        {typeof profile?.firstBlamedOn === 'string' && profile.firstBlamedOn !== '' ? (
          <>
            <dt>First blamed</dt>
            <dd>{profile.firstBlamedOn}</dd>
          </>
        ) : null}

        {profile?.isSentient === true ? (
          <>
            <dt>Sentient</dt>
            <dd>Allegedly</dd>
          </>
        ) : null}
      </dl>

      {typeof profile?.officialExcuse === 'string' && profile.officialExcuse !== '' ? (
        <blockquote className="mt-6 border-l-2 pl-4">{profile.officialExcuse}</blockquote>
      ) : null}

      <h2 className="mt-10 text-2xl font-semibold">Incidents blamed on {scapegoat.name}</h2>

      {incidents.length === 0 ? (
        <p className="text-muted-foreground mt-2">Nothing yet. Give it time.</p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {incidents.flatMap((incident) =>
            incident == null
              ? []
              : [
                  <li key={incident.id}>
                    {/* IncidentCard's props type IS IncidentCardFieldsFragment
                    (Lesson 10.5), which is why this compiles with no mapping. */}
                    <IncidentCard incident={incident} />
                  </li>,
                ]
          )}
        </ul>
      )}
    </section>
  );
}
