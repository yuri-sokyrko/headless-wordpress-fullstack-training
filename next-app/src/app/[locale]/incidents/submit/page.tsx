import Link from 'next/link';

import { IncidentTermOptionsDocument, SiteChromeDocument } from '@/gql/graphql';
import { requireCapability } from '@/lib/auth/guards';
import { IncidentSubmitForm } from '@/components/incidents/IncidentSubmitForm';
import { fetchGraphQL } from '@/lib/graphql/client';
import { taxonomyListTag, siteTag } from '@/lib/graphql/tags';

export const dynamic = 'force-dynamic';

export default async function SubmitIncidentPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await requireCapability(
    locale,
    `/${locale}/incidents/submit`,
    'incident_reporter'
  );

  const chrome = await fetchGraphQL(SiteChromeDocument, undefined, {
    revalidate: 60,
    tags: [siteTag()],
  });

  if (chrome.siteSettings?.siteChrome?.incidentSubmissionOpen === false) {
    // POLITE, not an error. The route still resolves, the layout still renders,
    // and the reader is told a true thing. An error boundary here would look
    // like a bug and generate a support ticket.
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Submissions are paused</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          We are catching up on the moderation queue. Incident submission will reopen shortly —
          nothing you submitted before is affected.
        </p>
      </section>
    );
  }

  const terms = await fetchGraphQL(IncidentTermOptionsDocument, undefined, {
    revalidate: 60,
    tags: [taxonomyListTag('scapegoat'), taxonomyListTag('severity')],
  });

  const options = (
    nodes: ReadonlyArray<{ slug?: string | null; name?: string | null } | null> | null | undefined
  ) =>
    (nodes ?? []).flatMap((node) =>
      node?.slug && node?.name ? [{ slug: node.slug, name: node.name }] : []
    );

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Submit an incident</h1>

      <p className="text-muted-foreground mt-2 text-sm">
        Every submission is reviewed by a moderator before it appears. Nothing you send here is
        published automatically — your account has no publishing capability at all.
      </p>

      <IncidentSubmitForm
        locale={locale}
        scapegoats={options(terms.scapegoats?.nodes)}
        severities={options(terms.severities?.nodes)}
        reporterDisplayName={session.displayName}
      />

      <p className="mt-6 text-sm">
        <Link href={`/${locale}/account`} className="underline">
          Back to your account
        </Link>
      </p>
    </section>
  );
}
