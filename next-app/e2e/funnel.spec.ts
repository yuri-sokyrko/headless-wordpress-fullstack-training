// THE FUNNEL, end to end, across both applications.
//
// Locators are getByRole + accessible name ONLY, with one documented exception:
// <input type="password"> has no ARIA role, so getByRole('textbox') cannot
// match it in any browser and password fields use getByLabel. No data-testid,
// no CSS class, no nth-child, no XPath — a data-testid locator passes while the
// control is invisible, unlabelled and unreachable by keyboard, which is the
// opposite of what an end-to-end test is for.
//
// 127.0.0.1 for Next (baseURL, from playwright.config.ts — since Node 17
// `localhost` may resolve to ::1). localhost:8080 for WordPress, because
// WP_HOME is http://localhost:8080 and WordPress canonical-redirects anything
// else. Two hosts, two reasons, both deliberate.
//
// Playwright does NOT read .env.local (appendix 04 §3.1), so the two passwords
// come from the invoking shell:
//   BTT_REPORTER_PASSWORD=… BTT_EDITOR_PASSWORD=… npx playwright test e2e/funnel.spec.ts
//
// Cleanup is Lesson 12.4's e2e/global-setup.ts fixture reset, gated on
// E2E_MODE=1. This spec deletes nothing itself; run it without E2E_MODE and you
// accumulate one probe incident and one probe user per run.
import { expect, test } from '@playwright/test';

const WP = 'http://localhost:8080';
const MAILPIT = 'http://localhost:8025';

const REPORTER_PASSWORD = process.env.BTT_REPORTER_PASSWORD ?? '';
const EDITOR_PASSWORD = process.env.BTT_EDITOR_PASSWORD ?? '';

test.describe('the incident funcnel', () => {
  test.skip(
    REPORTER_PASSWORD === '' || EDITOR_PASSWORD === '',
    'BTT_REPORTER_PASSWORD and BTT_EDITOR_PASSWORD must be in the invoking shell — appendix 04 §2'
  );

  test('a developer registers, submits, an editor approves and the public sees it', async ({
    page,
    request,
  }) => {
    // Two applications, two logins, a cache and an email server. It is slow on
    // purpose rather than flaky on purpose.
    test.setTimeout(120_000);

    // A per-run identity. Registration MUST use a fresh address, because
    // registerDeveloper returns the same payload for an already-registered one
    // (Lesson 06.2 §8) and the spec would then assert nothing.
    const runId = `${Date.now().toString(36)}`;
    const email = `funnel-${runId}@example.test`;
    const title = `Funnel probe ${runId}`;
    // DERIVED from the title, not guessed. Unique, so WordPress never has to
    // append `-2` and the assertion below cannot drift.
    const slug = `funnel-probe-${runId}`;

    // ── 1. REGISTER ──────────────────────────────────────────────────
    await page.goto('/en/register');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Display name' }).fill(`Funnel ${runId}`);
    await page.getByRole('button', { name: 'Register' }).click();

    await expect(page.getByRole('status')).toContainText('Check your inbox');

    // ── 2. VERIFY, using the link WordPress actually mailed ──────────
    // Read it out of Mailpit rather than constructing it: the point of the
    // check is that the mail carries a working link.
    const inbox = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    expect(inbox.ok()).toBeTruthy();

    const messages = (await inbox.json()) as { messages: { ID: string; Subject: string }[] };
    expect(messages.messages.length).toBeGreaterThan(0);
    expect(messages.messages[0]?.Subject).toContain('Confirm your');

    const body = await request.get(`${MAILPIT}/api/v1/message/${messages.messages[0]?.ID}`);
    const text = ((await body.json()) as { Text: string }).Text;

    // The mailed URL is BTT_FRONTEND_URL-based — host.docker.internal:3000
    // locally, which the browser cannot resolve (Lesson 16.4 §4). Take the two
    // parameters and rebuild the path against baseURL.
    const uid = /[?&]uid=(\d+)/.exec(text)?.[1];
    const token = /[?&]token=([A-Za-z0-9]+)/.exec(text)?.[1];
    expect(uid, 'the verification mail carries a uid').toBeTruthy();
    expect(token, 'the verification mail carries a token').toBeTruthy();

    await page.goto(`/en/verify?uid=${uid}&token=${token}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByLabel(/password/i).fill(REPORTER_PASSWORD);
    await page.waitForTimeout(4000); // wait for 1 second before clicking the button
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();

    // ── 3. LOG IN as the SEEDED reporter ─────────────────────────────
    // Not as the account just registered: registerDeveloper generates a
    // password with wp_generate_password() and deliberately never returns it
    // (Lesson 06.2 Step 4), so there is no credential for that account until
    // the reset flow. Step 1 proved registration and verification work; this
    // step needs a password that exists.
    await page.goto('/en/login');
    await page.getByRole('textbox', { name: /username|email/i }).fill(email);
    // The documented exception: password inputs expose no ARIA role.
    await page.getByLabel(/password/i).fill(REPORTER_PASSWORD);
    await page.waitForTimeout(4000); // wait for 1 second before clicking the button
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    await expect(page).not.toHaveURL(/\/login/);

    // ── 4. SUBMIT ────────────────────────────────────────────────────
    await page.goto('/en/incidents/submit');
    await expect(page.getByRole('heading', { level: 1, name: 'Submit an incident' })).toBeVisible();

    await page.getByRole('textbox', { name: 'What happened' }).fill(title);
    await page
      .getByRole('textbox', { name: 'The full story' })
      .fill('Reproduced by e2e/funnel.spec.ts.');

    // Radix Select renders a combobox and a listbox of options, both with
    // accessible names. This is why the locator rule is not a burden.
    await page.getByRole('combobox', { name: 'Who is to blame' }).click();
    await page.getByRole('option', { name: 'The Intern' }).click();
    await page.getByRole('combobox', { name: 'How bad' }).click();
    await page.getByRole('option', { name: 'S2 — Major' }).click();

    await page.getByRole('textbox', { name: 'When it happened' }).fill('2024-06-01T09:00');
    await page.getByRole('spinbutton', { name: 'Downtime (minutes)' }).fill('42');

    await page.getByRole('button', { name: 'Submit for review' }).click();

    await expect(page.getByRole('heading', { name: 'Queued for review' })).toBeVisible();

    // ── 5. APPROVE, as a real editor, in real wp-admin ───────────────
    await page.goto(`${WP}/wp-login.php`);
    await page.getByRole('textbox', { name: /username or email/i }).fill('editor');
    await page.getByLabel(/^password$/i).fill(EDITOR_PASSWORD);
    await page.getByRole('button', { name: /log in/i }).click();

    // The queue defaults to `post_status=pending` for anyone who can publish,
    // so no query string is needed — which is also an assertion about Step 1.
    await page.goto(`${WP}/wp-admin/edit.php?post_type=incident`);

    const row = page.getByRole('row', { name: new RegExp(title) });
    await expect(row).toBeVisible();

    // WordPress hides `.row-actions` until the row is hovered or focused, so a
    // bare click would time out waiting for a visible element. Hover first.
    // This is the sort of thing that makes the spec fragile, and the remedy is
    // still a user-facing interaction rather than a CSS locator.
    await row.hover();
    await row.getByRole('link', { name: 'Approve' }).click();

    // ── 6. THE PUBLIC SEES IT ────────────────────────────────────────
    // The DETAIL page has never been rendered, so it has no cache entry and is
    // rendered on demand: visible immediately. The ARCHIVE does have a cache
    // entry and will not contain it until the revalidate window expires — which
    // is why this spec asserts the detail page and Lesson 18.3 fixes the rest.
    await page.goto(`/en/incidents/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // The reporter was told. Assert on the PATH, not on clickability: the URL
    // is BTT_FRONTEND_URL-based and points at host.docker.internal locally.
    const notice = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent('subject:Your incident is live')}`
    );
    const notices = (await notice.json()) as { messages: { ID: string }[] };
    expect(notices.messages.length).toBeGreaterThan(0);

    const noticeBody = await request.get(`${MAILPIT}/api/v1/message/${notices.messages[0]?.ID}`);
    const noticeText = ((await noticeBody.json()) as { Text: string }).Text;
    expect(noticeText).toContain('/en/account');
    expect(noticeText).not.toContain('wp-admin');
  });
});
