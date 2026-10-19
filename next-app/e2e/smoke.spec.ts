// The "did it boot" suite. One assertion set per route, table-driven.
//
// Locators are getByRole + accessible name ONLY. No CSS classes, no data-testid,
// no nth-child, no XPath — Key Concept 3. Verification proves their absence.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Route = {
  readonly path: string;
  /** The level-1 heading. Static strings are ours; the rest come from `wp blame seed`. */
  readonly heading: string;
};

const ROUTES: readonly Route[] = [
  { path: '/en', heading: 'Blame The Tech' },
  { path: '/en/incidents', heading: 'Incidents' },
  // Seeded content (appendix 03 §9): fixed slugs, fixed titles. Lesson 12.4 is
  // what makes these three rows true on a machine that is not yours.
  { path: '/en/incidents/incident-01', heading: 'Deployed on a Friday (#1)' },
  { path: '/en/blog', heading: 'Blog' },
  { path: '/en/blog/blog-01', heading: 'Blaming the tech, part 1' },
  { path: '/en/reviews', heading: 'Tech Reviews' },
  { path: '/en/reviews/review-01', heading: 'Hyperscale Cloud Co' },
  { path: '/en/scapegoats', heading: 'The Blame Leaderboard' },
  // The SCF `headline` field on the HOBT page, not a hard-coded string.
  { path: '/en/hobt', heading: 'How To Omit Blaming Tech' },
];

/**
 * Every tolerated console line gets ONE narrow entry, with the reason and the
 * lesson that removes it. A blanket /warn|error/ regex is one decision with no
 * reason attached, and it silently covers everything anyone adds later.
 *
 * Start this array EMPTY. Run the suite. Read what comes out. Only then add.
 */
const CONSOLE_ALLOWLIST: readonly RegExp[] = [
  // Chromium reports a missing subresource as a console error. There is no
  // favicon until Lesson 19.4 adds `src/app/icon.svg`, and proxy already excludes
  // the path from the locale redirect. Delete this entry in Module 19.
  /favicon\.ico/,
];

/** Collects console errors and uncaught page exceptions for one page. */
function collectPageErrors(page: Page): string[] {
  const problems: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;

    const text = message.text();

    if (CONSOLE_ALLOWLIST.some((pattern) => pattern.test(text))) return;

    problems.push(`console.error: ${text}`);
  });

  // A different channel: an uncaught exception in the page never reaches
  // console.error, so a listener on only one of the two misses half the bugs.
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });

  return problems;
}

test.describe('every route boots', () => {
  for (const route of ROUTES) {
    test(`${route.path} answers 200 with its own h1`, async ({ page }) => {
      const problems = collectPageErrors(page);

      const response = await page.goto(route.path);

      // The second argument is the failure message. With nine near-identical
      // tests, a message naming the route is worth the six characters.
      expect(response?.status(), `${route.path} must answer 200`).toBe(200);

      // Web-first: the locator goes INTO expect, so this retries. Key Concept 2.
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();

      // The three landmarks from Lesson 11.4, addressed by role. `banner` is the
      // page <header>, `contentinfo` the page <footer> — both are only landmarks
      // when they are not nested inside <article>/<section>/<main>/<aside>.
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();

      // EXACTLY ONE main landmark, and exactly one level-1 heading. Both are
      // promises Lesson 11.4 made in its Key Concepts 2 and 3, and both regress
      // silently the first time somebody copies a route file.
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

      // The header nav, addressed by its accessible name. Three <nav> elements
      // exist — Primary, Mobile, Social — which is why the name filter is not
      // optional. On the Desktop Chrome viewport the mobile drawer is hidden, and
      // hidden elements are excluded from role queries by default.
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

      // toEqual([]) rather than toHaveLength(0): an empty-array diff PRINTS the
      // offending lines, and a length mismatch does not.
      expect(problems, `${route.path} logged to the console`).toEqual([]);
    });
  }
});

test.describe('the app shell', () => {
  test('the skip link is the first focusable element', async ({ page }) => {
    await page.goto('/en');

    // One Tab from a fresh load. Anything above SkipLink in <body> makes it
    // useless, and this is the assertion that notices.
    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });

  test('/ redirects to /en with a 307, not a 302', async ({ request }) => {
    // The `request` fixture is an HTTP client with the same baseURL and no
    // browser. maxRedirects: 0 is how you see the redirect rather than its target.
    const response = await request.get('/', { maxRedirects: 0 });

    // 307 preserves the method and body. Lesson 09.5 chose it because Module 16
    // POSTs Server Actions through paths this proxy touches, and a 302 turns
    // a POST into a GET and loses the submission with no error anywhere.
    expect(response.status()).toBe(307);
    expect(response.headers()['location'] ?? '').toContain('/en');
  });

  test('/en/hobt shows both CTAs, with the demo button inert but announced', async ({ page }) => {
    await page.goto('/en/hobt');

    // Two CTA bands, so two of each control — Lesson 11.5 uses the component
    // twice on purpose. toHaveCount on the multi-element locator rather than
    // .first(), because the count IS the fact worth asserting.

    await expect(page.getByRole('link', { name: 'Start Now' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Get Demo' })).toHaveCount(2);

    // aria-disabled, NOT disabled: an inert control must stay in the tab order,
    // or a keyboard user never reaches the sentence explaining why it does
    // nothing. Lesson 11.5's `aria-*` inventory records the reasoning.
    await expect(page.getByRole('button', { name: 'Get Demo' }).first()).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  test('the seeded primary menu renders four top-level items', async ({ page }) => {
    await page.goto('/en');

    // Four roots; `Catastrophic only` is a child and the desktop nav renders one
    // level. Nobody typed these five items into this database — seed_menu() did.
    const nav = page.getByRole('navigation', { name: 'Primary' });

    await expect(nav.getByRole('link')).toHaveCount(4);
    await expect(nav.getByRole('link', { name: 'Incidents' })).toBeVisible();
  });

  test('the footer renders the seeded site settings', async ({ page }) => {
    await page.goto('/en');

    // `footer_blurb` from the SCF options page — the second gap seed_site_settings()
    // closed. On a database nobody hand-built, this was an empty footer.
    await expect(page.getByRole('contentinfo')).toContainText(
      'Blame The Tech is satire. The outages are real.'
    );
  });

  test('the incident archive shows the newest twelve, newest first', async ({ page }) => {
    await page.goto('/en/incidents');

    // The list query is `orderby: { field: DATE, order: DESC }` (Lesson 10.5) and
    // the route asks for `first: 12` (Lesson 10.3), and the seeder dates
    // incident-NN as seed_date($i, 3) — so incident-40 is newest and incident-01
    // is off the end of page one. Two assertions: one about ordering, one about
    // the page size. If your route fetches 40 or more, the second one fails
    // legitimately: change the number here or there, and say which is right.
    const main = page.getByRole('main');

    await expect(main).toContainText('A leap second in the log parser (#40)');
    await expect(main).not.toContainText('Deployed on a Friday (#1)');
  });

  test('/en/hobt renders the seeded SCF promo values', async ({ page }) => {
    await page.goto('/en/hobt');

    // seats_left = 12 and price_usd = 499, from seed_pages(). Formatted by
    // Intl.NumberFormat with maximumFractionDigits: 0 (Lesson 11.5).
    const main = page.getByRole('main');

    await expect(main).toContainText('12 seats left');
    await expect(main).toContainText('$499');
  });
});
