// The GraphQL error shape, one error class, one formatter. Imported by client.ts and,
// from Module 16, by the Server Actions.
//
// No `import 'server-only'` here, deliberately: this file is pure data mapping with no
// secret and no I/O, Module 12 unit-tests it in a plain Node process where the
// `server-only` module throws on purpose, and `error.tsx` is a Client Component that
// may want `isGraphQLRequestError`.

/** One entry from a GraphQL `errors` array. Only `message` is guaranteed by the spec. */
export type GraphQLErrorEntry = {
  readonly message: string;
  readonly location?: readonly { readonly line: number; readonly column: number }[];
  readonly path?: readonly (string | number)[];
  readonly extensions?: Readonly<Record<string, unknown>>;
};

/** WPGraphQL's own classification, in `extensions.category`. */
export type WpGraphQLCategory = 'user' | 'internal' | 'graphql';

export function categoryOf(entry: GraphQLErrorEntry): WpGraphQLCategory | 'unknown' {
  const value = entry.extensions?.['category'];

  if (value === 'user' || value === 'internal' || value === 'graphql') {
    return value;
  }

  return 'unknown';
}

/**
 * One line per error: category, response path, message. Deliberately does NOT include
 * `locations`, because those are offsets into your query text and this string ends up
 * in logs.
 */
export function formatGraphQLErrors(errors: readonly GraphQLErrorEntry[]): string {
  if (errors.length === 0) {
    return 'no error detail';
  }

  return errors
    .map((entry) => {
      const at =
        entry.path !== undefined && entry.path.length > 0 ? ` at ${entry.path.join('.')}` : '';
      return `[${categoryOf(entry)}]${at} ${entry.message}`;
    })
    .join(' | ');
}

/** Every failure `fetchGraphQL` reports, transport and protocol alike. */
export class GraphQLRequestError extends Error {
  readonly operationName: string;
  readonly status: number;
  readonly errors: readonly GraphQLErrorEntry[];

  constructor(
    operationName: string,
    status: number,
    errors: readonly GraphQLErrorEntry[],
    options?: { readonly cause?: unknown }
  ) {
    super(`${operationName}: ${formatGraphQLErrors(errors)}`, options);
    this.name = 'GraphQLRequestError';
    this.operationName = operationName;
    this.status = status;
    this.errors = errors;
  }

  /** One log-safe line. No query text, no `locations`, no stack. */
  toString(): string {
    return `GraphQLRequestError(${this.operationName}, HTTP ${this.status}): ${formatGraphQLErrors(this.errors)}`;
  }
}

/** `catch` gives you `unknown`. One narrowing helper beats nineteen `instanceof` checks. */
export function isGraphQLRequestError(value: unknown): value is GraphQLRequestError {
  return value instanceof GraphQLRequestError;
}
