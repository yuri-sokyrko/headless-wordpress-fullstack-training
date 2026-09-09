# Appendix 06 — Troubleshooting

Failure modes that actually happen, in the order you are likely to hit them.

**Before anything else, try these three:**

```bash
# 1. Is the stack actually healthy?
docker compose ps
# Expected: wordpress, db, adminer, mailpit — all "running", db "(healthy)"

# 2. What does WordPress say?
docker compose logs --tail=50 wordpress

# 3. Re-run the PREVIOUS lesson's Verification block.
#    Most breakage is upstream of where it surfaces.
```

---

## 1. Docker & the stack

**`Cannot connect to the Docker daemon`**
Docker Desktop is not running. Start it and wait for the whale to stop animating.

**`port is already allocated` / `bind: address already in use`**
Something else owns the port — often a previous MAMP/Local install, or a stale container.

```bash
lsof -i :8080
docker compose down            # then retry
docker ps -a                   # look for stopped containers holding the port
```

**WordPress container restarts in a loop**
Almost always the database. `depends_on` alone does not wait for MySQL to be *ready*, only for
it to *start* — you need the healthcheck condition.

```bash
docker compose logs db | tail -30
# Expected eventually: "ready for connections"
```

**`Error establishing a database connection`**
`WORDPRESS_DB_HOST` is `localhost`. Inside Compose it must be the **service name** — `db:3306`.
`localhost` inside the WordPress container means the WordPress container.

**Changes to a plugin file do nothing**
The bind mount is missing or wrong. `docker compose exec wordpress ls -la /var/www/html/wp-content/plugins`
should show your plugin. If it does not, the mount path in `docker-compose.yml` is wrong.

**Everything is inexplicably broken after editing `docker-compose.yml`**
`docker compose up -d` does not always recreate containers. Force it:

```bash
docker compose up -d --force-recreate
```

**I ran `docker compose down -v` and all my content is gone**
That is what `-v` does — it deletes the volumes. Re-seed:

```bash
docker compose up -d --wait
docker compose run --rm wpcli wp blame seed --fresh
```

---

## 2. WordPress & the plugin

**The block editor is a white screen**
The post type is missing `show_in_rest => true`. The Gutenberg editor is a REST client; this is
not optional even in a headless build. See
[appendix 03 §1](03-content-model-reference.md#1-post-types).

**A new post type or taxonomy 404s on the front end**
Rewrite rules are cached.

```bash
docker compose run --rm wpcli wp rewrite flush --hard
```

**`incident_reporter` can see wp-admin**
The `admin_init` redirect is not registered, or the role has `edit_posts`. It must not — see
[appendix 03 §6](03-content-model-reference.md#6-roles-and-capabilities).

**ACF fields do not appear in wp-admin**
The location rule does not match. `HOBT Promo` requires **both** `page` **and**
`page_template == templates/hobt.php`, and that template file must exist in the theme for
WordPress to offer it in the Page Attributes box.

**ACF field groups vanished after a fresh container**
They were saved to the database instead of Local JSON. Check that
`includes/acf-json/` exists and is writable, then re-sync from the ACF UI. Field groups are
code in this project — [appendix 03 §4](03-content-model-reference.md#4-acf-field-groups).

**`wp` command says "Error: This does not seem to be a WordPress installation"**
You are running `wp` on the host, or against the `wordpress` service (which has no WP-CLI at
all). Always go through the `wpcli` service:

```bash
docker compose run --rm wpcli wp <command>
```

---

## 3. GraphQL

**A field I know exists returns `null`**
Four candidates, in order of likelihood:

1. Missing `idType` — `incident(id: "my-slug")` without `idType: SLUG` returns `null`.
2. The post type or field group lacks `show_in_graphql`.
3. The post is a draft and you did not pass `asPreview: true`.
4. You are querying anonymously and the content is private. Check in GraphiQL, where you are
   logged in as an administrator — if it works there and not from Next, that is a permissions
   difference, and it is usually correct.

**`Cannot query field "x" on type "Y"`**
The plugin providing it is inactive, or the field is not registered. `wp plugin list` first.

**ACF repeater type is `any` in TypeScript**
Repeaters generate object list types (`TechReviewFieldsPros`), not `string[]`. Expected —
[appendix 03 §4.3](03-content-model-reference.md#43-tech-review-fields).

**Everything works in GraphiQL but fails from Next**
GraphiQL runs as your wp-admin session. Next runs anonymously unless it sends a token. Test
anonymously with `curl` — see
[appendix 07 §7](07-command-reference.md#7-graphql-from-the-terminal).

**A mutation succeeds when it should not**
There is no `current_user_can()` check in `mutateAndGetPayload`. **WPGraphQL does not
authorise your custom mutations for you.** Fix the resolver, then write the test that proves
the anonymous case fails.

**The query is slow**
Enable `SAVEQUERIES` and count. It is an N+1 or an unbounded connection. Lesson 06.4.

---

## 4. Next.js

**`Error: Cannot read properties of undefined`, in a Server Component, on a GraphQL field**
GraphQL returned `data: null` plus an `errors` array, and you read through it. GraphQL returns
**HTTP 200 with errors** — `fetch` will never throw. Check `body.errors`. This is what
`src/lib/graphql/client.ts` exists to centralise.

**`You're importing a component that needs useState` / `next/headers` errors**
A Server/Client boundary violation. Either add `'use client'` to the leaf that needs
interactivity, or stop importing a server-only module into a client component. Push
`'use client'` as deep into the tree as possible.

**`Error: Invalid src prop ... hostname is not configured`**
Add the WordPress host to `images.remotePatterns` in `next.config.ts`. Lesson 14.5.

**A page shows stale content after publishing in WordPress**
Work down this list:

1. Did the webhook fire? `WP_DEBUG_LOG` sends `error_log()` to a **file**, not to Apache's
   stdout, so `docker compose logs` will not show it:
   `docker compose exec wordpress tail -n 20 /var/www/html/wp-content/debug.log | grep revalidate`
2. **Is `BTT_FRONTEND_URL` set to `host.docker.internal:3000`?** Next runs on the host;
   WordPress inside the container cannot reach `localhost:3000`. On Linux you also need
   `extra_hosts: ["host.docker.internal:host-gateway"]`. **This is the single most common
   cause.**
3. Did the HMAC verify? A 401 from `/api/revalidate` is silent by design — check the Next
   terminal.
4. Do the tag names match? WordPress's payload and Next's `fetch` tags must agree. That is why
   they are centralised in `src/lib/graphql/tags.ts`.
5. In dev, is the route `force-dynamic`? Then there is nothing to revalidate and the problem is
   elsewhere.

**A secret appeared in the client bundle**

```bash
npm run build && grep -r "$REVALIDATE_SECRET" .next/static/
# Expected: no output
```

A hit means either the variable is prefixed `NEXT_PUBLIC_`, or a server-only module got
imported into a client component. Add `import 'server-only'` to the module so this fails at
build time instead of shipping.

**`proxy.ts` does not run**
It must be at `next-app/src/proxy.ts` (or the project root, next to `app/`) — not inside
`app/`. Check the `matcher` too.

**Preview shows the published version, not my draft**
Missing `asPreview: true`. For an already-published post the draft lives in `wp_posts` as a
`revision` row, not on the post itself. Lesson 17.2.

**Preview says 404 or 401**
Preview tokens are **single-use with a 120-second TTL**. Reloading the preview URL consumes an
already-consumed token. Click Preview in wp-admin again.

**Preview says 400**
The `?next=` parameter is not a same-origin path, so the open-redirect guard rejected it before
the token was spent. Something rewrote the preview link in transit. Click Preview again. Lesson 17.2.

---

## 5. Auth

**Logged in, but the Server Component thinks I am anonymous**
The cookie is not reaching the server, or you are reading it in a client component. Session is
read with `cookies()` on the server. There is deliberately no session React context.

**Session drops after five minutes**
That is the access-token TTL. The proxy refresh is not firing — check that `btt_rt` exists
and that its `Path=/api/auth` matches the refresh route exactly. A `Path` mismatch means the
browser never sends it.

**`Set-Cookie` is ignored in production**
Missing `Secure` over HTTPS, or a domain mismatch. Both cookies need `Secure` in production.

**A Server Action returns "Invalid Server Actions request"**
An Origin/Host mismatch. Add the origin to `experimental.serverActions.allowedOrigins`.

**`createIncident` publishes immediately instead of going to moderation**
The mutation is not forcing `post_status = 'pending'`, or the user has `publish_incidents`.
`incident_reporter` must not have it —
[appendix 03 §6](03-content-model-reference.md#6-roles-and-capabilities).

---

## 6. Blocks

**"This block contains unexpected or invalid content"**
The `save()` output changed and no longer matches what is stored in `post_content`. You need a
`deprecated` entry, not a re-save. Lesson 13.5.

**A block renders in wp-admin but is blank in Next**
It is not in the `blockRegistry`, or the fragment does not include an inline fragment for its
type. In development `<UnknownBlock>` renders a red box with the block name — look for it.

**`editorBlocks` returns `[]`**
WPGraphQL Content Blocks is inactive, or the post genuinely has classic content rather than
blocks.

**The generated block type is missing from the union**
Re-run codegen after adding the inline fragment. `npm run codegen`.

**`npm run start` in the blocks plugin does not pick up changes**
`@wordpress/scripts` compiles `src/<block>/` into `build/<block>/` and copies `block.json`
across as it goes. The plugin must therefore register from the **built** directory —
`register_block_type( PLUGIN_DIR . '/build/incident-callout' )`, never `/src/...`. The
`file:./index.js` paths inside `block.json` are relative to that built copy, so they need no
`build/` prefix. Registering `src/` is the usual cause: the block appears, and every change
you make is invisible.

---

## 7. Tests

**A test passes alone and fails in the suite**
The cache-coherency gotcha. After `wp db reset && wp db import`, **Next still serves the old
data from the ISR cache**. `globalSetup` must call the test-only revalidate hook after
restoring the database. Lesson 23.6.

**Playwright cannot find an element that is clearly there**
You used a CSS chain. Use `getByRole` / `getByLabel` / `getByText` — CSS chains are banned by
an ESLint rule in `e2e/` (Lesson 23.7) precisely because Tailwind class churn breaks them
weekly. `getByTestId` is not the escape hatch either: Lesson 12.3 rules it out, because a
`data-testid` passes while the control is invisible or unreachable.

**E2E results differ between runs**
Non-deterministic seed data. Fixed slugs, explicit `post_date`, no `wp_rand`/`time()`. Lesson
12.4.

**`vitest` cannot render an async Server Component**
Nothing can. The rule: if a component is `async` or reads `cookies()`/`headers()`, unit-test
the `lib/` function it awaits and cover the rendered output in Playwright.

**Visual snapshots fail on my machine but pass in CI**
You added snapshot tests of rendered markup, and **this course deliberately has none** — Lesson
12.1 writes the rule into `docs/testing-strategy.md` as a do-not-test line, and nothing here
calls `toHaveScreenshot()`. The reason is this failure: a baseline is font-, platform- and
GPU-dependent, so it fails for reasons unrelated to your change and the fastest fix is always
`--update-snapshots`, which is a test that asserts whatever it currently does. If you add them
anyway, generate every baseline inside the Playwright Docker image rather than on macOS, and
accept that you now own a second artifact per assertion.

---

## 8. CI/CD

**`codegen:check` fails but works locally**
You changed a query and did not commit `src/gql/`. Run `npm run codegen` and commit the output.

**The schema-drift job fails**
Someone changed the WordPress schema without running `wp graphql generate-static-schema` and
committing `schema.graphql`. That is the job working as intended — the diff is the review.

**E2E passes locally, fails in CI**
CI runs the **built** WordPress image; locally you run the dev container with bind mounts. A
file that only exists on your disk will not be in the image. Check `.dockerignore`.

**Fly deploy fails in the release command**
`release_command` runs before machines take traffic and aborts on non-zero exit. `fly logs`
shows which step failed — usually `wp core update-db` or a plugin activation.

**Images 404 after scaling to two Fly machines**
The volume pinned uploads to one machine. Media must go to R2/S3. This is not fixable by
scaling differently.

---

## 9. Still stuck

1. Re-read the error. Next.js and WPGraphQL both have unusually good messages.
2. Re-run the previous lesson's `## Verification`.
3. Bisect your own history — you have been committing per lesson, so `git bisect` works.
4. Reproduce it in isolation: does the GraphQL query work in GraphiQL? Does `curl` reproduce
   it? Is it Next or WordPress?
5. `docker compose down && docker compose up -d --wait && wp blame seed --fresh` resets local
   state without losing your code.
