# Testing strategy — Blame The Tech

Written in Lesson 12.1. Extended in Lesson 23.1, which adds component and PHP suites, the
RSC testing rule and a coverage threshold. Everything here is a decision, not a description:
if you change one, change it here first.

Two applications, two languages, one GraphQL contract and a cache in between. No single
suite covers that, so this document says which suite owns what — and, more usefully, what
nothing owns.

## 1. Scope: which suite owns what

| Suite                             | Runs in                                              | Answers                                                                   | Does not answer                                        |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| Vitest — `src/**/*.test.ts`       | milliseconds, no server, no DB                       | is this function correct for these inputs                                 | whether anything calls it, or whether the page renders |
| Playwright — `e2e/`               | tens seconds, real browser,real Next, real WordPress | can a user reach a page and see things right                              | why it broke and anything not on a route listed        |
| `## Verification` blocks          | on demand, once                                      | did this code land                                                        | anything after it was implemented                      |
| Pest / wp-phpunit (Module 23)     | seconds, WordPress bootstrapped                      | does the plugin enforce capabilities and sanitise inut                    | anything in a browser and anything in TypeScript       |
| Manual review on the running site | minutes, by a person                                 | does it feel tight and what does real editorial content do to the leayout | anything you did not think to look at                  |

Rule: a test that could live in two rows belongs in the cheaper one. "Cheaper" means fewer
people have to be involved when it fails.

## 2. The five most expensive failures

| #   | Failure                                                                 | How it presents                                                                       | Cheapest suite that would catch it                                                                 | Exists today?                   |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | A cache tag built in PHP does not match the one built in TypeScript     | HTTP 200, no log line, pages stale for ever                                           | Vitest on `tags.ts` (12.2) pins one side; a contract test (23.5) pins both                         | 12.2 pins one side              |
| 2   | A route 500s because an SCF field group returned `null`                 | One page throws; the rest of the site is fine, so nobody notices until an editor does | Vitest on the mapper with a null group (12.2); Playwright on the seeded null-group incident (12.4) | Not yet — needs the 12.4 seeder |
| 3   | The webhook signature is computed over a differently-serialised payload | Every revalidation rejected as a forgery; looks exactly like a caching bug            | Contract test (23.5), with signature tests in 23.3 and 23.4                                        | Nothing catches this yet        |
| 4   | A query selects a field the schema no longer has                        | Codegen passes against a stale `schema.graphql`; the page fails at runtime            | `npm run codegen:check` for staleness; a real schema contract test (23.5)                          | Partly — `codegen:check` only   |
| 5   | `wp core update-db` runs against a database nobody backed up            | `wp_postmeta` rewritten in place, no down migration, no way back                      | None — only a restorable backup and a change that was correct before it ran (Module 24)            | Nothing catches this yet        |

## 3. Deliberately not tested

- `src/components/ui/` that we have not edited — Radix ships its own suite; asserting a Dialog opens tests somebody else's library
- Tailwind class strings — `flex gap-4` is not behaviour, and the test fails on every design change
- `src/gql/` — generated; a failure there is not fixable here, and `npm run codegen:check` already proves it is not stale
- The exact rendered markup of any page — a snapshot diff is Tailwind noise everyone approves; Playwright asserts roles and accessible names, which is what a user gets
- Third-party plugin behaviour (SCF, WPGraphQL) — they have their own suites and we cannot fix their bugs here; pinned versions and the committed schema snapshot tell us when their output changes
- WordPress core — `wp_insert_post()` works, and the core team and twenty years of use cover it

**No snapshot tests of markup, anywhere in this codebase.** A 400-line diff of Tailwind
utilities is a changelog nobody reads, and everybody approves it. Snapshots of small, stable,
human-readable strings are fine.

## 4. Toolchain decisions

### Vitest, not Jest

This project is native ESM — `package.json` declares `"type": "module"` (07.1) and
`tsconfig.json` resolves like a bundler (08.1). `next-intl` (20.3) and MSW v2 (23.2) publish
ESM only. Jest would need a Babel or SWC transform pipeline to import them, configured and
maintained by us for ever. Vitest shares Vite's transform pipeline and imports ESM natively.

Conceded: Jest is the larger ecosystem and `next/jest` exists. The cost we accept is writing
~20 lines of `vitest.config.ts` ourselves — That is a fair trade: twenty lines is a one-off cost we
understand fully, whereas `next/jest` would hide the module-resolution question, and that
question is exactly what goes wrong when an ESM-only dependency arrives.

### Playwright, not Cypress

Three reasons:

1. **`getByRole` is in the core API**, so the accessible locator is the easy one to write and
   specs assert what a user gets rather than CSS selectors.
2. **`webServer` starts and waits for Next** from the config with a readiness URL, instead of a
   plugin or a separate process we manage.
3. **Traces open after the fact.** A CI failure produces a trace zip we can open with
   `npx playwright show-trace`; `workers` and `--shard` also parallelise in the open-source runner.

Conceded: Cypress's interactive time-travel runner is a better _live_ debugging experience, and
its plugin ecosystem is larger and older. The cost we accept is a smaller ecosystem and a weaker
live-replay story, mitigated by `--ui` locally.

## 5. What this module's suites will not catch

- Anything about the PHP half. There is no PHP test suite until Lesson 23.4
- Contract drift between the two halves — see §2 row 1; Lesson 23.5 owns it
- Whether the page feels right — no assertion notices a hero with too much whitespace or a CTA below the fold; that stays a manual review
- What real editorial content does to the layout — fixtures are polite; an editor will paste a 140-character title and a testimonial with no author

## 6. Flake policy

A flaky test is a broken test. It gets fixed or deleted in the pull request that noticed it —
never re-run until green, and never left with a comment saying it is known to be flaky. A
suite that fails one run in forty teaches people to ignore red, which is worse than having no
suite at all.
