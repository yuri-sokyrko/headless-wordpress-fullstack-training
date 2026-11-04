import { expect, test } from '@playwright/test';

test('registration displays complete server validation messages before field interaction', async ({
  page,
}) => {
  await page.goto('/en/register');
  await page.getByRole('button', { name: 'Register', exact: true }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: /^Enter your email address\.$/ })
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: /^Enter a display name\.$/ })
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toBeFocused();

  await page.getByRole('textbox', { name: 'Display name', exact: true }).focus();

  await expect(
    page.getByRole('alert').filter({ hasText: /^Enter a display name\.$/ })
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: /^Enter your email address\.$/ })
  ).toBeVisible();
});
