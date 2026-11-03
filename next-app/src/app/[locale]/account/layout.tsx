import type { ReactNode } from 'react';

// Redundant in Next 16 for a route that reads cookies(), and written anyway:
// a statement of intent that survives a future default change. Lesson 15.5 §10.
import { requireSession } from '@/lib/auth/guards';

export default async function AccountLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // ONCE, here, for every page under /account. A page-level guard is one
  // forgotten file away from an unguarded page (Lesson 15.5 §6).
  //
  // A layout cannot see the child's pathname, so the `next` value is the
  // section root. The precise path is carried by the proxy redirect; this
  // is the fallback for the case proxy did not catch — an RSC payload
  // request, say.
  await requireSession(locale, `/${locale}/account`);

  return <>{children}</>;
}
