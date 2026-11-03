import Link from 'next/link';

import { requireCapability } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

// A STATIC segment beats a dynamic sibling: /en/incidents/submit resolves here
// and not through [slug]/page.tsx with slug="submit". Worth knowing, because the
// symptom of getting it wrong is a 404 for a page that plainly exists.
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

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">File an incident</h1>

      <p className="text-muted-forefround mt-2 text-sm">
        Signed in as {session.displayName}. Every submission is created as <code>pending</code> and
        reviewed by an editor before it appears — that is enforced in WordPress, not here.
      </p>

      <p className="border-border mt-6 rounded-md border border-dashed p-4 text-sm">
        The submission form arrives in Module 16, with Zod validation, a shared rate limiter and an
        accessible error pattern. The <strong>guard</strong> you just walked through is finished:
        Lesson 16.2 replaces this shell and leaves it alone.
      </p>

      <p className="mt-6 text-sm">
        <Link href={`/${locale}/account`} className="underline">
          Back to your account
        </Link>
      </p>
    </section>
  );
}
