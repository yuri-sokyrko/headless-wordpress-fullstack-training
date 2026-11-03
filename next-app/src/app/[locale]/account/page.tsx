import Link from 'next/link';

import { requireSession } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

export default async function AccountPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<{ readonly denied?: string }>;
}) {
  const { locale } = await params;
  const { denied = '' } = await searchParams;

  // The SAME WordPress call the layout already made: getSession() memoizes the
  // viewer query with React's cache() (Lesson 15.4 §5). Two guards, one round
  // trip. Remove the cache() wrapper and this page costs two.
  const session = await requireSession(locale, `/${locale}/account`);

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>

      {denied !== '' ? (
        <p role="alert" className="border-border bg-muted/40 mt-4 rounded-md border p-3 text-sm">
          That page needs the <code>{denied}</code> role. If you have just confirmed your email, try
          again.
        </p>
      ) : null}

      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Display name</dt>
          <dd className="font-medium">{session.displayName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Roles</dt>
          {/* DISPLAY ONLY. WPGraphQL gates User.roles behind list_users, so this
              can legitimately be empty for your own account — Lesson 15.2 §1.
              Nothing in this app decides anything from it. */}
          <dd className="font-medium">
            {session.roles.length > 0 ? session.roles.join(', ') : 'not reported by WordPress'}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-sm">
        <Link href={`/${locale}/incidents/submit`} className="underline">
          File an incident
        </Link>
      </p>
    </section>
  );
}
