// Runs ONCE, before any spec, in Playwright's own Node process.
//
// That process does NOT read next-app/.env.local — that file is loaded by Next,
// for the app. `process.env.E2E_MODE` here comes from the shell you typed in, and
// that is the safety property, not a limitation. Key Concept 9.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { FullConfig } from '@playwright/test';

const DIGEST_PREFIX = '-- btt-seed-digest: ';
const GRAPHQL = process.env.WP_GRAPHQL_ENDPOINT ?? 'http://localhost:8080/graphql';

/** One readable failure instead of nine specs failing one at a time. */
function fail(lines: readonly string[]): never {
  throw new Error(['', '[e2e] global setup failed:', ...lines.map((l) => `  ${l}`), ''].join('\n'));
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // THE INTERLOCK. Anything other than exactly '1' does nothing at all — a global
  // setup that silently drops a colleague's database the first time they run
  // `npx playwright test` is a hostile default.
  if (process.env.E2E_MODE !== '1') {
    console.log(
      '[e2e] E2E_MODE is not "1", so the database was NOT reset. Specs will run ' +
        'against whatever WordPress holds right now. To arm the reset:\n' +
        '      E2E_MODE=1 E2E_SECRET="$E2E_SECRET" npx playwright test'
    );
    return;
  }

  // Declared here, used by the test-only revalidation hook Module 18 builds. It is
  // checked now because an armed destructive run with a half-configured
  // environment is a run whose result you cannot trust.
  if ((process.env.E2E_SECRET ?? '') === '') {
    fail([
      'E2E_MODE=1 but E2E_SECRET is empty or unset.',
      'Export one into this shell: export E2E_SECRET="$(openssl rand -base64 32)"',
      'Never write it to a file — appendix 04 §1.',
    ]);
  }

  // Anchor on the config file, not config.rootDir: rootDir follows testDir
  // (./e2e) here, which put repoRoot at next-app/ instead of the repo root.
  // Neither depends on where you invoked the command from.
  const configDir = config.configFile ? dirname(config.configFile) : process.cwd();
  const repoRoot = resolve(configDir, '..');
  const wpDir = resolve(repoRoot, 'wordpress-headless');
  const dump = resolve(repoRoot, 'fixtures/seeded.sql');

  const wp = (args: readonly string[]): string =>
    execFileSync('docker', ['compose', 'run', '--rm', '-T', 'wpcli', 'wp', ...args], {
      cwd: wpDir,
      encoding: 'utf8',
    })
      .replace(/\r/g, '')
      .trim();

  // 1. Is WordPress there at all? This is the check that turns Lesson 12.3's
  //    120-second webServer timeout into one sentence in under a second.
  let status = 0;

  try {
    const response = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: AbortSignal.timeout(5000),
    });

    status = response.status;
  } catch {
    // Only a TRANSPORT failure lands here. Calling fail() inside the try would
    // be caught by this block and reported as "did not answer", which is a
    // different diagnosis and would send you to the wrong place.
    fail([
      `${GRAPHQL} did not answer.`,
      'Start the stack: cd wordpress-headless && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d',
    ]);
  }

  if (status !== 200) {
    fail([
      `${GRAPHQL} answered HTTP ${status}.`,
      'WordPress is up but WPGraphQL is not — check the plugin is active.',
    ]);
  }

  if (!existsSync(dump)) {
    fail([
      `${dump} does not exist.`,
      'Export it: cd wordpress-headless && docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql',
    ]);
  }

  // 2. Staleness. Read only the first 200 bytes — never load a multi-megabyte
  //    dump into memory to look at one line.
  const fd = openSync(dump, 'r');
  const head = Buffer.alloc(200);
  readSync(fd, head, 0, 200, 0);
  closeSync(fd);

  const dumpDigest = (head.toString('utf8').split('\n')[0] ?? '').trim();
  const codeDigest = wp(['blame', 'fixture', 'status']);

  if (!dumpDigest.startsWith(DIGEST_PREFIX)) {
    fail(['The dump has no digest on its first line. Re-export it.']);
  }

  // REFUSE, not warn. A warning in the middle of a CI log is a warning nobody
  // reads, and importing a stale fixture produces failures that blame the code.
  if (dumpDigest !== codeDigest) {
    fail([
      'fixtures/seeded.sql is stale: the seeder has changed since it was exported.',
      `  dump: ${dumpDigest}`,
      `  code: ${codeDigest}`,
      'Rebuild it: wp blame seed --fresh, then wp blame fixture export.',
    ]);
  }

  // 3. Import, streaming the file straight into the container's STDIN.
  const input = openSync(dump, 'r');
  try {
    execFileSync(
      'docker',
      ['compose', 'run', '--rm', '-T', 'wpcli', 'wp', 'blame', 'fixture', 'load'],
      { cwd: wpDir, stdio: [input, 'inherit', 'inherit'] }
    );
  } finally {
    closeSync(input);
  }

  // 4. Assert the state the specs are about to rely on.
  const count = wp(['post', 'list', '--post_type=incident', '--format=count']);

  if (count !== '40') {
    fail([`Expected 40 incidents after the import, found ${count}.`]);
  }

  console.log('[e2e] database reset from fixtures/seeded.sql — 40 incidents.');
}
