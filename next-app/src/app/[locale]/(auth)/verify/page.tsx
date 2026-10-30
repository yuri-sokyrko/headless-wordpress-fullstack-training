import Link from 'next/link';

import { verify } from '@/actions/auth';
import { AuthForm } from '@/components/auth/AuthForm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default async function VerifyPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ readonly uid?: string; readonly token?: string }>;
}) {
  // Next 16: BOTH are Promises.
  const { locale } = await params;
  const { uid = '', token = '' } = await searchParams;

  if (uid === '' || token === '') {
    return (
      <section className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Confirmation link incomplete</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Open the link from your email exactly as it was sent, or{' '}
          <Link href={`/${locale}/register`} className="underline">
            register again
          </Link>{' '}
          for a new one.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Confirm your account</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Choose a password to finish. Your registration created an account with a random password
        nobody has ever seen, so this is the first one you own.
      </p>

      {/* Rendering this page does NOT verify anything. The code is consumed by a
          POST, because a GET must not mutate — an email client or a link
          previewer that prefetches would otherwise burn the code before the
          human clicked it. */}
      <AuthForm action={verify} submitLabel="Confirm and sign in" pendingLabel="Confirming...">
        <input type="hidden" name="uid" value={uid} />
        <input type="hidden" name="token" value={token} />

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
          <p className="text-muted-foreground text-xs">At least 12 characters.</p>
        </div>
      </AuthForm>
    </section>
  );
}
