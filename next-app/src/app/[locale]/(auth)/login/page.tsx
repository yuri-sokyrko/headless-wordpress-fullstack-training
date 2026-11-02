import Link from 'next/link';
import { redirect } from 'next/navigation';

import { login } from '@/actions/auth';
import { AuthForm } from '@/components/auth/AuthForm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSession } from '@/lib/auth/session';

export default async function LoginPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ readonly next?: string }>;
}) {
  const { locale } = await params;
  const { next = '' } = await searchParams;

  // Already signed in? There is nothing to do here. This is a UX redirect and
  // nothing more — the pages this sends people to guard themselves.
  const session = await getSession();

  if (session.isLoggedIn) {
    redirect(next !== '' && next.startsWith('/') ? next : `/${locale}`);
  }

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Use the email address you registered with. Sessions last five minutes and renew
        automatically while you are using the site.
      </p>

      <AuthForm action={login} submitLabel="Sign in" pendingLabel="Signing in...">
        {/* Both hidden fields are re-validated in the action. `next` is
            attacker-chosen and goes through safeNextPath(); `locale` goes
            through an allowlist. A hidden input is a request parameter, not a
            fact. */}
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="locale" value={locale} />

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </AuthForm>

      <p className="tex-sm text-muted-foreground mt-6">
        No account?{' '}
        <Link href={`/${locale}/register`} className="underline">
          Register
        </Link>
      </p>
    </section>
  );
}
