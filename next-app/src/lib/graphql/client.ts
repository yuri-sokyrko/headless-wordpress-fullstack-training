// The only place in this app that talks to WordPress. Two exported functions and no
// third. Regenerate nothing here: this file is hand-written and stays that way.
//
// Lesson 10.3 adds the cache-tag builders that feed `options.tags`.
// Lesson 10.4 replaces the plain `Error` throws with `GraphQLRequestError`.
import 'server-only';

import { Kind, parse, print } from 'graphql';
import type { DocumentNode } from 'graphql';

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

type GraphQLErrorEntry = { readonly message: string };

type GraphQLResponseBody<TData> = {
  readonly data?: TData | null;
  readonly errors?: readonly GraphQLErrorEntry[];
};

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
  init: RequestInit
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
    // TRANSPORT: connection refused, DNS, TLS, or our own deadline. `cause` keeps the
    // original for the server log without putting it in the message a page might show.
    throw new Error(`${operationName}: no response from WordPress within ${TIMEOUT_MS} ms`, {
      cause,
    });
  }

  if (!response.ok) {
    // Also TRANSPORT, and never a GraphQL error: a proxy 502, or Apache on fire.
    throw new Error(`${operationName}: HTTP ${response.status} ${response.statusText}`);
  }

  const parsed: unknown = await response.json();

  if (!isGraphQLResponseBody<TResult>(parsed)) {
    throw new Error(`${operationName}: the response was not a GraphQL envelope`);
  }

  // PROTOCOL: HTTP 200 carrying an `errors` array. This is the branch that fires.
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    throw new Error(`${operationName}: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }

  if (parsed.data === undefined || parsed.data === null) {
    throw new Error(`${operationName}: neither data nor errors came back`);
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
    }
  );
}

/**
 * Authenticated calls. `cache: 'no-store'` is written here, not passed in, and there is
 * no options parameter through which a caller could override it. Module 15 supplies a
 * user JWT; Module 16 supplies the app-token variant (appendix 04 section 4).
 */
export function fetchGraphQLAuthed<TResult, TVariables extends Record<string, unknown>>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  token: string
): Promise<TResult> {
  return execute<TResult>(
    operationNameOf(document),
    JSON.stringify({ query: print(document), variables }),
    {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );
}

/**
 * TEMPORARY. Lesson 10.2 deletes this export and every call to it.
 *
 * Turns a query string into a document whose result and variable types you supplied by
 * hand. No cast is needed, and that is the point: `__apiType` is optional, so a plain
 * `DocumentNode` satisfies `TypedDocumentNode<Anything, Anything>`. The type argument is
 * a promise with no evidence behind it — exactly the Lesson 09.3 problem, relocated.
 */
export function untypedDocument<TResult, TVariables extends Record<string, unknown>>(
  source: string
): TypedDocumentNode<TResult, TVariables> {
  return parse(source);
}
