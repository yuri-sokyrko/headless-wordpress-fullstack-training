// The session, as the browser is allowed to see it.
//
// This exists so the ROOT LAYOUT does not have to read cookies(). Reading them
// there made every route in the application dynamic (Lesson 15.4 Step 6 named
// that cost); reading them here confines the dynamic part to one 200-byte JSON
// response that nothing renders.
//
// The response is a PROJECTION, not the Session object. `roles` stays on the
// server, where requireCapability() uses it — the header needs a name, not a
// capability list, and the smallest answer that works is the one to publish.
import { getSession } from '@/lib/auth/session';

// Redundant in Next 16 for a handler that reads cookies, and written anyway:
// a statement of intent that survives a future default change, exactly as
// /api/health does (Lesson 09.5 §4).
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();

  const body = session.isLoggedIn
    ? { isLoggedIn: true, displayName: session.displayName }
    : { isLoggedIn: false };

  return Response.json(body, {
    headers: {
      // `private` so no shared cache may hold it, `no-store` so no cache may.
      // Lesson 18.4 is where the difference between those two words matters.
      'Cache-Control': 'private, no-store',
    },
  });
}
