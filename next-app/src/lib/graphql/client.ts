// The only place in this app that talks to WordPress. Two exported functions and no
// third. Regenerate nothing here: this file is hand-written and stays that way.
//
// Lesson 10.3 adds the cache-tag builders that feed `options.tags`.
// Lesson 10.4 replaces the plain `Error` throws with `GraphQLRequestError`.
import 'server-only';

import { Kind, print } from 'graphql';
import type { DocumentNode } from 'graphql';
import { GraphQLRequestError } from './errors';
import type { GraphQLErrorEntry } from './errors';

/** Longer than any query in this app needs; shorter than a reader will wait. */
const TIMEOUT_MS = 8_000;

/**
 * A `DocumentNode` that also remembers what it returns and what it takes.
 *
 * `__apiType` is never assigned and never called — it is a phantom property whose
 * only job is to carry the two type parameters so a call site can recover them.
 * Codegen's client preset emits exactly this shape, so from Lesson 10.2 the
 * generated documents satisfy this type structurally, with no adapter.
 */
export type TypedDocumentNode<TResult, TVariables> = DocumentNode & {
  readonly __apiType?: (variables: TVariables) => TResult;
};

/** Everything `fetchGraphQL` accepts. Note what is absent: `cache`, `headers`, `method`. */
export type FetchGraphQLOptions = {
  /** Seconds. `false` caches until a tag invalidates it. Omit and Next 16 does not cache. */
  readonly revalidate?: number | false;
  /** Built by `src/lib/graphql/tags.ts` from Lesson 10.3 — never hand-typed at a call site. */
  readonly tags?: readonly string[];
};

type GraphQLResponseBody<TData> = {
  readonly data?: TData | null;
  readonly errors?: readonly GraphQLErrorEntry[];
};

type ErrorPolicy = 'partial' | 'strict';

/**
 * WHICH credential is calling. A discriminated union rather than a `string`,
 * because both credentials ARE strings and substituting one for the other
 * usually still returns HTTP 200 (Lesson 15.2 §5).
 *
 * `kind: 'app'` deliberately carries NO token: this function reads WP_APP_TOKEN
 * from the environment itself. So an app token can never arrive from a call
 * site — and therefore never from a request, a form field, a query parameter,
 * or a client component that was handed one by accident. Appendix 04 §4.
 */
export type Credential = { readonly kind: 'user'; readonly jwt: string } | { readonly kind: 'app' };

// A type predicate: a claim about shape, not a validation. Lesson 07.4 Key Concept 3.
function isGraphQLResponseBody<TData>(value: unknown): value is GraphQLResponseBody<TData> {
  return typeof value === 'object' && value !== null && ('data' in value || 'errors' in value);
}

/**
 * Read the endpoint once, when this module is first imported. A missing endpoint is a
 * deployment mistake, so it should stop the process that noticed rather than the
 * request that happened to be first. An empty string counts as missing.
 */
function requireEndpoint(): string {
  const value = process.env.WP_GRAPHQL_ENDPOINT;

  if (value === undefined || value === '') {
    throw new Error(
      'WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local and fill it in.'
    );
  }

  return value;
}

const ENDPOINT = requireEndpoint();

/** The operation name, for error messages and logs. */
function operationNameOf(document: DocumentNode): string {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION && definition.name !== undefined) {
      return definition.name.value;
    }
  }

  return '(anonymous)';
}

/** Only the two keys Next reads, so a typo in `revalidat` is a compile error. */
function nextOptions(options: FetchGraphQLOptions | undefined): {
  revalidate?: number | false;
  tags?: string[];
} {
  const next: { revalidate?: number | false; tags?: string[] } = {};

  if (options?.revalidate !== undefined) {
    next.revalidate = options.revalidate;
  }

  if (options?.tags !== undefined) {
    // Next wants a mutable array; the caller gave us a readonly one. Copy, do not cast.
    next.tags = [...options.tags];
  }

  return next;
}

/** One request, one response, two failure classes. Both public functions funnel here. */
async function execute<TResult>(
  operationName: string,
  body: string,
  init: RequestInit,
  policy: ErrorPolicy
): Promise<TResult> {
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      ...init,
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new GraphQLRequestError(
      operationName,
      0, // no response, so no status
      [{ message: `no response from WordPress within ${TIMEOUT_MS} ms` }],
      { cause }
    );
  }

  if (!response.ok) {
    // Also TRANSPORT, and never a GraphQL error: a proxy 502, or Apache on fire.
    throw new GraphQLRequestError(operationName, response.status, [
      { message: `HTTP ${response.status} ${response.statusText}` },
    ]);
  }

  const parsed: unknown = await response.json();

  if (!isGraphQLResponseBody<TResult>(parsed)) {
    throw new GraphQLRequestError(operationName, response.status, [
      { message: 'the response was not a GraphQL envelope' },
    ]);
  }

  const hasErrors = parsed.errors !== undefined && parsed.errors.length > 0;
  const hasData = parsed.data !== undefined && parsed.data !== null;

  // OPTION A, for authenticated calls: ANY errors entry throws, even alongside
  // data. A refused mutation is `data: { createIncident: null }` WITH an errors
  // array, and the caller must be able to show WordPress's own sentence.
  // Lesson 15.2 §7.
  if (hasErrors && policy === 'strict') {
    throw new GraphQLRequestError(operationName, response.status, parsed.errors ?? []);
  }

  // OPTION B, for public reads: unchanged from Lesson 10.4 Key Concept 3.
  if (hasErrors && !hasData) {
    throw new GraphQLRequestError(operationName, response.status, parsed.errors ?? []);
  }

  if (hasErrors) {
    console.error(
      new GraphQLRequestError(operationName, response.status, parsed.errors ?? []).toString()
    );
  }

  if (!hasData) {
    throw new GraphQLRequestError(operationName, response.status, [
      { message: 'the response contained neither data nor errors' },
    ]);
  }

  return parsed.data;
}

/**
 * Public reads. Cacheable, shareable, no credential. Every Server Component,
 * `generateStaticParams` and public Route Handler in this app uses this one.
 */
export function fetchGraphQL<TResult, TVariables extends Record<string, unknown>>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables?: TVariables,
  options?: FetchGraphQLOptions
): Promise<TResult> {
  return execute<TResult>(
    operationNameOf(document),
    JSON.stringify({ query: print(document), variables: variables ?? {} }),
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      next: nextOptions(options),
    },
    'partial'
  );
}

/**
 * The only place in this application that reads WP_APP_TOKEN **for a GraphQL
 * call**. Lesson 17.2 adds a second reader for the REST preview exchange, and
 * replaces this invariant with a checkable one: `grep -rn 'WP_APP_TOKEN' src/`
 * must name exactly two files.
 */
function creadentialHeaders(credential: Credential): Record<string, string> {
  if (credential.kind === 'user') {
    return { Authorization: `Bearer ${credential.jwt}` };
  }

  const appToken = process.env.WP_APP_TOKEN;
  // Fail CLOSED. A misconfigured deployment must refuse the call, not send an
  // empty header and let WordPress decide — hash_equals('', '') is true, and
  // Lesson 06.2's guard is the only reason that is not exploitable there.
  if (appToken === undefined || appToken === '') {
    throw new Error(
      'WP_APP_TOKEN is not set. Copy it from wordpress/headless/.env — Lesson 15.2 Step 4.'
    );
  }

  return { 'X-BTT-App-Token': appToken };
}

/**
 * Authenticated calls. `cache: 'no-store'` is written HERE, not passed in, and
 * there is still no options parameter — so no caller can put an authenticated
 * response into the shared Data Cache. Lesson 15.5 §10 and Module 18 both rely
 * on that being unrepresentable rather than merely discouraged.
 */
export function fetchGraphQLAuthed<TResult, TVariables extends Record<string, unknown>>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  credential: Credential
): Promise<TResult> {
  return execute<TResult>(
    operationNameOf(document),
    JSON.stringify({ query: print(document), variables }),
    {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...creadentialHeaders(credential),
      },
    },
    // OPTION A. The word 'strict' appears exactly once in the codebase, and it
    // appears HERE rather than in a parameter, so no call site can opt an
    // authenticated write back into Option B. Lesson 15.2 §7.
    'strict'
  );
}
