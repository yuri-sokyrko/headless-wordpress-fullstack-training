import Link from 'next/link';

import { register } from '@/actions/auth';
import { AuthForm } from '@/components/auth/AuthForm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// The (auth) route group has NO layout.tsx and needs none: parentheses group
// files without adding a URL segment, and src/app/[locale]/layout.tsx is still
// the only layout above these pages. Do not go looking for one.
export default async function RegisterPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Register as a developer</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        An acount let you file incidents for an editor to moderate. You will get a confirmation
        email; the link in it is single use and expires in 24 hours.
      </p>

      <AuthForm action={register} submitLabel="Create account" pendingLabel="Creating account...">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" name="displayName" maxLength={80} autoComplete="name" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          {/* type="email" gives a keyboard hint and a free browser check. It is
              not validation: the Server Action re-checks, and WordPress checks
              again with is_email(). Three layers, one of them load-bearing. */}
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
      </AuthForm>

      <p className="text-muted-foreground mt-6 text-sm">
        {/* This link 404s until Lesson 15.4 creates the page. It is the last
            deliberately broken thing in this module. */}
        Already registered?{' '}
        <Link href={`/${locale}/login`} className="underline">
          Sign in
        </Link>
      </p>
    </section>
  );
}
