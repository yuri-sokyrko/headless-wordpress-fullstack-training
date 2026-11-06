import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  headers: vi.fn(),
  readAccessToken: vi.fn(),
  getSession: vi.fn(),
  fetchGraphQL: vi.fn(),
  fetchGraphQLAuthed: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/auth/cookies', () => ({ readAccessToken: mocks.readAccessToken }));
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/graphql/client', () => ({
  fetchGraphQL: mocks.fetchGraphQL,
  fetchGraphQLAuthed: mocks.fetchGraphQLAuthed,
}));
vi.mock('@/lib/rate-limit', () => ({ limit: mocks.limit }));

import { GraphQLRequestError } from '@/lib/graphql/errors';

import { submitIncident } from './incidents';

function validForm(): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    title: 'The cache stopped working',
    body: '',
    scapegoatSlug: 'dns',
    severitySlug: 's2-major',
    occurredAt: '2024-06-01T09:00',
    downtimeMinutes: '42',
    estimatedCostUsd: '',
    environment: 'production',
    resolutionStatus: 'open',
    blameConfidence: '73',
    stackTrace: '',
    locale: 'en',
  })) {
    data.set(name, value);
  }

  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.limit.mockResolvedValue({ ok: true });
  mocks.fetchGraphQL.mockResolvedValue({
    scapegoats: { nodes: [{ slug: 'dns' }] },
    severities: { nodes: [{ slug: 's2-major' }] },
  });
  mocks.getSession.mockResolvedValue({
    isLoggedIn: true,
    displayName: 'Reporter',
    roles: ['incident_reporter'],
  });
  mocks.readAccessToken.mockResolvedValue('test-jwt');
});

describe('submitIncident creation confirmation', () => {
  it.each(['', null, 'the-cache-stopped-working'])(
    'reports a saved pending incident as success with slug %j',
    async (slug) => {
      mocks.fetchGraphQLAuthed.mockResolvedValue({
        createIncident: {
          incident: {
            databaseId: 123,
            slug,
            title: 'The cache stopped working',
            status: 'pending',
          },
        },
      });

      expect(await submitIncident({ status: 'idle' }, validForm())).toEqual({
        status: 'success',
        databaseId: 123,
        title: 'The cache stopped working',
      });
      expect(mocks.fetchGraphQLAuthed).toHaveBeenCalledTimes(1);
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/en/account');
    }
  );

  it.each([null, { databaseId: 0 }, { databaseId: -1 }, { databaseId: 1.5 }])(
    'reports missing confirmation without claiming nothing was saved: %j',
    async (incident) => {
      mocks.fetchGraphQLAuthed.mockResolvedValue({ createIncident: { incident } });
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const result = await submitIncident({ status: 'idle' }, validForm());

        expect(result).toEqual({
          status: 'error',
          message:
            'WordPress did not confirm the submission. Check your account before submitting again.',
        });
        expect(log).toHaveBeenCalledWith(
          '[btt] submitIncident: WordPress returned no incident database ID'
        );
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    }
  );

  it('still surfaces a WordPress refusal', async () => {
    mocks.fetchGraphQLAuthed.mockRejectedValue(
      new GraphQLRequestError('CreateIncident', 200, [
        { message: 'You are not allowed to submit incidents.', extensions: { category: 'user' } },
      ])
    );

    expect(await submitIncident({ status: 'idle' }, validForm())).toEqual({
      status: 'error',
      message: '[user] You are not allowed to submit incidents.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('does not claim the write failed when a response is interrupted', async () => {
    mocks.fetchGraphQLAuthed.mockRejectedValue(new Error('Connection interrupted'));

    expect(await submitIncident({ status: 'idle' }, validForm())).toEqual({
      status: 'error',
      message: 'We could not confirm the submission. Check your account before submitting again.',
    });
  });
});
