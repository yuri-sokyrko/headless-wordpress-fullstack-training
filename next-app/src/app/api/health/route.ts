// A cached health check is a recording, not a check. In Next 16 GET handlers are
// uncached by default; this states the intent so no future default or refactor can
// quietly turn this endpoint into a file. Key Concept 4.
export const dynamic = 'force-dynamic';

/**
 * The entire public contract of this endpoint. Two keys, identical shape in both
 * branches. Nothing about the dependency, the environment, or the failure.
 * Module 15's Starting State asserts on `status: "ok"` — do not rename either key.
 */
interface HealthBody {
  readonly status: 'ok' | 'degraded';
  readonly checkedAt: string;
}

/**
 * Cheapest possible round trip to WordPress: `{ __typename }` resolves without
 * touching the database, so a slow query cannot make a live site look dead.
 */
async function wordpressIsReachable(): Promise<boolean> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;

  // Deliberately does not say WHICH variable is missing. That belongs in the log,
  // not in a response anyone on the internet can read.
  if (!endpoint) {
    console.error('[btt] health: WP_GRAPHQL_ENDPOINT is not set');
    return false;
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      // Explicit here even though it is the Next 16 default: a health check must
      // never read a cache, and this line says so to the next reader.
      cache: 'no-store',
      // Without a timeout, a hung WordPress hangs your health check, and the monitor
      // that was supposed to detect the outage times out instead of reporting it.
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      console.error(`[btt] health: WPGraphQL transport failure HTTP ${res.status}`);
      return false;
    }

    const payload = (await res.json()) as {
      data?: { __typename?: string };
      errors?: readonly unknown[];
    };

    if (payload.errors?.length) {
      console.error('[btt] health: WPGraphQL returned errors for { __typename }');
      return false;
    }

    // Checking the shape rather than a literal type name: the assertion is
    // "a GraphQL server answered a GraphQL question", which is all this proves.
    return typeof payload.data?.__typename === 'string';
  } catch (error) {
    // AbortError (timeout), DNS failure, connection refused. The reason goes to the
    // log; the caller gets one word.
    console.error('[btt] health: WordPress unreachable —', error);
    return false;
  }
}

export async function GET(): Promise<Response> {
  const healthy = await wordpressIsReachable();

  const body: HealthBody = {
    status: healthy ? 'ok' : 'degraded',
    checkedAt: new Date().toISOString(),
  };

  // The status code is what a load balancer reads. 503 means "do not send me traffic".
  return Response.json(body, { status: healthy ? 200 : 503 });
}
