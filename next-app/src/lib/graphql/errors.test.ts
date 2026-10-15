import { describe, expect, it } from 'vitest';

import {
  GraphQLRequestError,
  categoryOf,
  formatGraphQLErrors,
  isGraphQLRequestError,
} from '@/lib/graphql/errors';
import type { GraphQLErrorEntry } from '@/lib/graphql/errors';

// `verbatimModuleSyntax` (Lesson 07.3) is why the type import above is separate.

const userError: GraphQLErrorEntry = {
  message: 'Sorry, you are not allowed to create incidents.',
  path: ['createIncident', 'incident'],
  extensions: { category: 'user' },
};

const internalError: GraphQLErrorEntry = {
  // No `path`. WPGraphQL omits it for an error raised before resolution starts
  message: 'Internal server error',
  extensions: { category: 'internal' },
};

const validationError: GraphQLErrorEntry = {
  message: 'Cannot query field "downtimeMinutes" on type "Incident".',
  // Offsets into YOUR query text. The formatter must never emit these.
  locations: [{ line: 12, column: 7 }],
  extensions: { category: 'graphql' },
};

describe('formatGraphQLErrors', () => {
  it('says something rather than nothing for an empty array', () => {
    // An empty log line is worse than a useless one: you cannot search for it.
    expect(formatGraphQLErrors([])).toBe('no error detail');
  });

  it('formats one entry as [category] at path message', () => {
    expect(formatGraphQLErrors([userError])).toBe(
      '[user] at createIncident.incident Sorry, you are not allowed to create incidents.'
    );
  });

  it('omits the " at ..." fragment entirely when there is no path', () => {
    expect(formatGraphQLErrors([internalError])).toBe('[internal] Internal server error');
  });

  it('also omits it for an emoty path array', () => {
    expect(formatGraphQLErrors([{ message: 'x', path: [] }])).toBe('[unknown] x');
  });

  it('joins multiple entries with " | "', () => {
    expect(formatGraphQLErrors([internalError, userError])).toBe(
      '[internal] Internal server error | ' +
        '[user] at createIncident.incident Sorry, you are not allowed to create incidents.'
    );
  });

  it('NEVER include `locations` - they are offsets into your query text', () => {
    // This is a security assertion, not a formatting one. This string is logged,
    // and from Module 24 it is shipped to Sentry. `locations` would put fragments
    // of your own query shape into a third-party log.
    const formatted = formatGraphQLErrors([validationError]);

    expect(formatted).toBe('[graphql] Cannot query field "downtimeMinutes" on type "Incident".');
    expect(formatted).not.toContain('column');
    expect(formatted).not.toContain('12');
  });
});

describe('categoryOf', () => {
  it('passes throug the three categories WPGraphQL actually sets', () => {
    expect(categoryOf(userError)).toBe('user');
    expect(categoryOf(internalError)).toBe('internal');
    expect(categoryOf(validationError)).toBe('graphql');
  });

  it('returns "unknown" for a missing extensions bag', () => {
    expect(categoryOf({ message: 'x' })).toBe('unknown');
  });

  it('returns "unknown" for a category nobody recognises', () => {
    expect(categoryOf({ message: 'x', extensions: { category: 'teapot' } })).toBe('unknown');
  });
});

describe('GraphQLRequestError', () => {
  it('prefixes the operation name onto the message', () => {
    const error = new GraphQLRequestError('IncidentBySlug', 200, [userError]);

    expect(error.message.startsWith('IncidentBySlug: ')).toBe(true);
    expect(error.operationName).toBe('IncidentBySlug');
  });

  it('treats HTTP 200 with an errors array as a failure - the WPGraphQL shape', () => {
    // The single most important assertion in this file. WPGraphQL answers 200 and
    // puts the failure in `errors`, so a client that branches on response.ok
    // reports success on a permission denial. `status` is 200 AND this is an Error.
    const error = new GraphQLRequestError('CreateIncident', 200, [userError]);

    expect(error.status).toBe(200);
    expect(error).toBeInstanceOf(Error);
    expect(isGraphQLRequestError(error)).toBe(true);
  });

  it('carries the entries through untouched for a caller that wants them', () => {
    const error = new GraphQLRequestError('CreateIncident', 200, [userError]);

    expect(error.errors).toHaveLength(1);
    expect(error.errors).toEqual([userError]);
  });

  it('has a log-safe toString(): no query text, no locations no stach', () => {
    const error = new GraphQLRequestError('IncidentBySlug', 200, [validationError]);
    const line = error.toString();

    expect(line).toBe(
      'GraphQLRequestError(IncidentBySlug, HTTP 200): ' +
        '[graphql] Cannot query field "downtimeMinutes" on type "Incident".'
    );
    expect(line).not.toContain('column');
  });

  it('narrows an unknown from a catch block, nd rejects everything else', () => {
    expect(isGraphQLRequestError(new Error('plain'))).toBe(false);
    expect(isGraphQLRequestError('IncidentBySlug: nope')).toBe(false);
    expect(isGraphQLRequestError(null)).toBe(false);
  });
});
