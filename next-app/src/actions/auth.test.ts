import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
  fetchGraphQL: vi.fn(),
  fetchGraphQLAuthed: vi.fn(),
  setSessionCookies: vi.fn(),
  clearSessionCookies: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/graphql/client', () => ({
  fetchGraphQL: mocks.fetchGraphQL,
  fetchGraphQLAuthed: mocks.fetchGraphQLAuthed,
}));
vi.mock('@/lib/auth/cookies', () => ({
  setSessionCookies: mocks.setSessionCookies,
  clearSessionCookies: mocks.clearSessionCookies,
}));

import { login, register, verify, type AuthFormState } from './auth';

const IDLE: AuthFormState = { status: 'idle', message: '', fieldErrors: {} };

function formData(values: Record<string, string>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }

  return data;
}

let requestId = 0;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ 'x-forwarded-for': `test-${++requestId}` }));
});

describe('register validation', () => {
  it('returns complete first messages as strings without calling WordPress', async () => {
    expect(await register(IDLE, new FormData())).toEqual({
      status: 'error',
      message: 'Check the fields below.',
      fieldErrors: {
        email: 'Enter your email address.',
        displayName: 'Enter a display name.',
      },
    });
    expect(mocks.fetchGraphQLAuthed).not.toHaveBeenCalled();
  });

  it.each(['uk', undefined])(
    'passes normalized values and locale %s to WordPress',
    async (locale) => {
      mocks.fetchGraphQLAuthed.mockResolvedValue({ registerDeveloper: { accepted: true } });
      const data = formData({ email: ' dev@example.test ', displayName: ' Dev ' });
      if (locale !== undefined) data.set('locale', locale);

      expect((await register(IDLE, data)).status).toBe('sent');
      expect(mocks.fetchGraphQLAuthed).toHaveBeenCalledWith(
        expect.anything(),
        { email: 'dev@example.test', displayName: 'Dev', locale: locale ?? 'en' },
        { kind: 'app' }
      );
    }
  );

  it('rejects file fields and unsupported locales', async () => {
    const data = formData({ email: 'dev@example.test', displayName: 'Dev', locale: 'xx' });
    data.set('displayName', new Blob(['Dev']), 'name.txt');

    const result = await register(IDLE, data);

    expect(result.status).toBe('error');
    expect(result.fieldErrors).toHaveProperty('displayName');
    expect(result.fieldErrors).toHaveProperty('locale');
    expect(mocks.fetchGraphQLAuthed).not.toHaveBeenCalled();
  });
});

describe('verify validation', () => {
  const valid = { uid: '42', token: 'a'.repeat(32), password: '  passphrase  ' };

  it('coerces the id and preserves password whitespace', async () => {
    mocks.fetchGraphQLAuthed.mockResolvedValue({ verifyDeveloper: { verified: true } });

    expect((await verify(IDLE, formData(valid))).status).toBe('verified');
    expect(mocks.fetchGraphQLAuthed).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 42, code: valid.token, password: valid.password },
      { kind: 'app' }
    );
  });

  it.each(['42junk', '', '0', '1.5', '9007199254740992'])(
    'rejects invalid user id %s',
    async (uid) => {
      const result = await verify(IDLE, formData({ ...valid, uid }));

      expect(result.fieldErrors).toHaveProperty('uid');
      expect(mocks.fetchGraphQLAuthed).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['token', 'a'.repeat(31)],
    ['password', 'a'.repeat(11)],
    ['password', 'a'.repeat(201)],
  ])('rejects invalid %s before consuming the code', async (name, value) => {
    const result = await verify(IDLE, formData({ ...valid, [name]: value }));

    expect(result.fieldErrors).toHaveProperty(name);
    expect(mocks.fetchGraphQLAuthed).not.toHaveBeenCalled();
  });
});

describe('login validation', () => {
  it('maps username validation errors back to the email input', async () => {
    expect(await login(IDLE, new FormData())).toEqual({
      status: 'error',
      message: 'Check the fields below.',
      fieldErrors: {
        email: 'Enter your username or email address.',
        password: 'Enter your password.',
      },
    });
    expect(mocks.fetchGraphQL).not.toHaveBeenCalled();
    expect(mocks.setSessionCookies).not.toHaveBeenCalled();
  });

  it.each(['/en/account', '//evil.test'])(
    'preserves cookies and safe redirect behavior for %s',
    async (next) => {
      mocks.fetchGraphQL.mockResolvedValue({
        login: { authToken: 'access-token', refreshToken: 'refresh-token' },
      });
      mocks.redirect.mockImplementation(() => {
        throw new Error('NEXT_REDIRECT');
      });

      await expect(
        login(IDLE, formData({ email: ' dev ', password: ' ', locale: 'en', next }))
      ).rejects.toThrow('NEXT_REDIRECT');
      expect(mocks.fetchGraphQL).toHaveBeenCalledWith(expect.anything(), {
        username: 'dev',
        password: ' ',
      });
      expect(mocks.setSessionCookies).toHaveBeenCalledWith('access-token', 'refresh-token');
      expect(mocks.redirect).toHaveBeenCalledWith(next === '/en/account' ? next : '/en');
    }
  );
});
