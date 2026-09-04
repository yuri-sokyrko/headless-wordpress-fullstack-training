<!--
  Blame The Tech — pull request template.

  This is the REFERENCE version of the Lesson 24.8 deliverable, shipped so that any PR you
  open against the course repo itself gets a template. Write your own first from the lesson's
  checklist, then diff it against this one — the gaps are the interesting part.

  It is deliberately long: a headless build has two runtimes, one shared schema and two
  caching layers, so the things that break are not the things a generic template asks about.

  Delete sections that genuinely do not apply. Do not delete the Security section.
-->

## What & why

<!-- One sentence. Link the lesson or issue. -->

## Type

- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] docs
- [ ] test
- [ ] chore / ci

## Surface touched

- [ ] WordPress plugin (PHP)
- [ ] Gutenberg block
- [ ] GraphQL schema
- [ ] Next.js — server (RSC, Server Action, route handler)
- [ ] Next.js — client (`'use client'`)
- [ ] Infra / CI
- [ ] i18n messages
- [ ] Auth / session

## Schema & contract

- [ ] `schema.graphql` regenerated and committed — or: no schema change
- [ ] `npm run codegen` run; `src/gql/` committed
- [ ] Breaking for existing Next queries? If yes, describe the migration below.
- [ ] ACF field **keys** unchanged (a key rename is a public contract change and will fail the integration tests)

<!-- Migration notes, if breaking: -->

## Data & caching

- [ ] Every new connection has an explicit, bounded `first:`
- [ ] Every new `fetch` has a deliberate `revalidate` and `tags` policy — or a comment saying why `no-store`
- [ ] Mutations call `revalidateTag`/`revalidatePath` for the data they change
- [ ] New tags are added to `src/lib/graphql/tags.ts`, not inlined as string literals
- [ ] No authenticated response can enter the shared Data Cache (`fetchGraphQLAuthed` only)

## Security

**Do not delete this section.**

- [ ] No new `NEXT_PUBLIC_*` variable carries anything secret
- [ ] No secret in code, fixtures, `.env.example`, Docker build args, or logs
- [ ] WordPress HTML rendered through `RichText.tsx`, not a new `dangerouslySetInnerHTML`
- [ ] New GraphQL mutations check `current_user_can()` — WPGraphQL does **not** do this for you
- [ ] New route handlers authenticate, verify a signature, or are explicitly public with a reason
- [ ] User input validated with Zod at the Next boundary **and** re-validated in WordPress
- [ ] Any SQL uses `$wpdb->prepare()` with format specifiers
- [ ] No PII or token in a log line

## Performance & accessibility

- [ ] No new N+1 (a per-item `await` inside a `.map()`, or a per-node `get_field()` in a resolver)
- [ ] `'use client'` only on components that actually need state or events
- [ ] New interactive elements are reachable and operable by keyboard, with a visible focus state
- [ ] New form errors use `role="alert"` and `aria-describedby`
- [ ] Images go through `next/image` with `alt` and explicit sizing

## Tests

- [ ] Unit tests for new logic
- [ ] E2E for any new user-visible flow
- [ ] The negative case is tested, not just the happy path
- [ ] Seeder updated if this adds a content type or field
- [ ] Locators use `getByRole`/`getByLabel`/`getByTestId` — no CSS chains

Preview URL / screenshots:

## Rollback

<!-- How do we undo this if it is bad in production? If it includes a schema or DB change,
     say so explicitly — those are forward-only. -->
