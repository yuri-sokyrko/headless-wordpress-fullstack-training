// Rebuilt in Lesson 16.1. Lesson 15.3's version validated with hand-written
// checks inside src/actions/auth.ts, which is the debt 15.4 labelled with this
// lesson's number.
import { RegisterForm } from '@/components/auth/RegisterForm';

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  return (
    <section className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Register as a reporter</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Reporters submit incidents for moderation. Submissions are reviewed before they appear.
      </p>

      {/* A plain serialisable prop. No session context, no token, no endpoint. */}
      <RegisterForm locale={locale} />
    </section>
  );
}
