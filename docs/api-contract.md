<!-- docs/api-contract.md -->

# Blame The Tech — API contract

The GraphQL schema is the contract between `wordpress-headless` and `next-app`. It is
snapshotted at `wordpress-headless/schema.graphql` and committed, so every change is a
reviewable diff and CI never needs a running WordPress.

## 1. Ownership

| Thing                | Owner     | Where                                                                     |
| -------------------- | --------- | ------------------------------------------------------------------------- |
| The schema           | WordPress | `blame-the-tech-core/includes/graphql/`                                   |
| The snapshot         | WordPress | `wordpress-headless/schema.graphql`, committed                            |
| Generated TypeScript | Next.js   | `next-app/src/gql/`, generated, committed (Module 10)                     |
| The refresh          | a human   | `npm run schema:pull` against a running local WordPress. **Never in CI.** |

## 2. Mutations we expose

| Operation                      | Credential                    | Forced server-side                                                                                                                      | Payload withholds                            |
| ------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `createIncident`               | user JWT + `create_incidents` | `post_status = pending`, `post_author = current user`; `status` always discarded; `isVerified` discarded unless `edit_others_incidents` | —                                            |
| `registerDeveloper`            | `X-BTT-App-Token`             | role `incident_reporter`, `btt_verified = 0`, generated password                                                                        | the `User` node; whether the email existed   |
| `submitHobtLead`               | `X-BTT-App-Token`             | `created_at`, `ip_hash` (HMAC, never a raw IP)                                                                                          | the row ID; whether the lead was a duplicate |
| `login`, `refreshJwtAuthToken` | credentials                   | —                                                                                                                                       | —                                            |

## 3. Mutations we deliberately do NOT use

- `registerUser` — requires `users_can_register`, which opens a second registration door, and
  assigns `get_option('default_role')` rather than ours.
- The generated `createIncident` / `updateIncident` / `deleteIncident` — switched off with
  `graphql_exclude_mutations` on the post type. They accept a client `status` and `authorId`.

## 4. Evolution policy

**Additive-first, always.** Add, deprecate, migrate, remove — in that order, across three
deploys.

| Change                                                              | Allowed                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| Add a field, an optional argument, an optional input field          | ✅ any time                                            |
| Add a value to an **output** enum                                   | ⚠️ ship with the front-end change that handles it      |
| Add a **required** input field                                      | ⚠️ WordPress deploys last, after every caller sends it |
| Remove `!` from an output field                                     | ✅                                                     |
| Add `!` to an output field, narrow a type, rename or remove a field | ❌ deprecation cycle first                             |

### Deprecation

- Reason format: `Use <replacement> instead. Removed after <ISO date>.`
- Window: one minor release or 30 days, whichever is longer.
- `@graphql-eslint`'s `no-deprecated` rule fails the front-end build, so the deprecation is
  enforced rather than suggested.
- Removal is its own pull request, whose `schema.graphql` diff shows only the removal.

### Currently deprecated

| Field                              | Replacement                     | Removed after |
| ---------------------------------- | ------------------------------- | ------------- |
| `BlameScoreBreakdown.severitySlug` | `severities { nodes { slug } }` | 2026-06-01    |

## 5. Nullability

Non-null **outputs** are a permanent promise, and a non-null field resolving to null nulls out
its parent. So: nullable outputs by default; non-null only where the resolver cannot fail and
the data cannot be missing. Non-null **inputs** only where the mutation would reject a missing
value anyway.

Non-null output fields in this schema, exhaustively: `RegisterDeveloperPayload.accepted`,
`SubmitHobtLeadPayload.accepted`.

## 6. Error vocabulary

GraphQL answers **HTTP 200 with an `errors` array**. `res.ok` is meaningless. Every client
inspects `errors`.

Messages are a fixed, safe set. They never contain a file path, a plugin name, a class name or
SQL; detail goes to `graphql_debug()`, which surfaces only in local development.

| Message                                                               | Meaning                         | Front-end handling                                  |
| --------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| `You must be signed in to submit an incident.`                        | no session                      | redirect to sign-in                                 |
| `You are not allowed to submit incidents.`                            | authenticated, wrong capability | show as a form-level error                          |
| `A title is required.`                                                | validation                      | attach to the `title` field                         |
| `occurredAt must be a valid date and time that is not in the future.` | validation                      | attach to `occurredAt`                              |
| `That scapegoat does not exist.` / `That severity does not exist.`    | unknown term slug               | refresh the term list                               |
| `Not authorized.`                                                     | missing or wrong app token      | server-side misconfiguration; never shown to a user |
| `Temporarily unavailable.`                                            | dependency not ready            | generic retry                                       |

## 7. Rules

- The browser never calls `/graphql`. Only the Next.js server runtime does. No CORS plugin.
- Validation on the Next side is a UX feature. Validation in WordPress is the security control.
- **A field appearing in an input type is not permission to set it.**
- Every custom field and mutation carries a `description`. It becomes the doc-string in
  `schema.graphql` and the JSDoc on the generated TypeScript type.
- A pull request that changes `schema.graphql` destructively needs a deploy plan in its
  description.

  ## 8. Query budget and limits

Measured on the 40-incident seed, second run, local Docker stack, <today's date>.

| Query                                                   | `first: 5` | `first: 40` | Shape                                |
| ------------------------------------------------------- | ---------- | ----------- | ------------------------------------ |
| `incidents { nodes { title } }`                         | 18         | 19          | flat                                 |
| `incidents { nodes { title blameScore } }`              | 18         | 19          | flat — computed from primed caches   |
| `incidents { nodes { scapegoats { nodes { name } } } }` | 23         | 58          | **linear** — one term query per node |
| `scapegoats { nodes { name count } }`                   | 6          | 6           | flat — `count` is an indexed column  |

Fixed cost before any resolver runs: `wp_options` autoload — <your bytes> bytes.

### Limits in force

| Limit                | Value                                    | Where                                                    |
| -------------------- | ---------------------------------------- | -------------------------------------------------------- |
| Nodes per connection | 50                                       | `graphql_connection_max_query_amount`                    |
| Query depth          | 10, for callers without `manage_options` | `QueryDepth` validation rule                             |
| Query complexity     | 500                                      | `QueryComplexity` validation rule                        |
| Public introspection | on in `local`, off elsewhere             | code, keyed on `WP_ENVIRONMENT_TYPE`                     |
| `graphql_debug`      | on in `local`, off elsewhere             | same filter — `extensions.debug` is a disclosure channel |
| Persisted queries    | Module 24, WPGraphQL Smart Cache         | production only; the strongest control                   |

### Rules

- A resolver on a type is called once per node, and the client chooses the node count. A resolver
  may compute; it must not fetch.
- Term meta is primed by nothing. Any resolver reaching for `get_term_meta()` or an SCF term
  field needs `update_termmeta_cache()` for the batch first.
- A linear query shape is a review finding, not a performance opinion. Re-ask the question from
  the other side of the relationship before reaching for a cache.
- Every list in a saved operation passes an explicit `first`. `@graphql-eslint` fails the build
  otherwise.

## Hand-written GraphQL response types (Module 09 debt)

Every type below is an assertion about WPGraphQL's output that nothing verifies. Lesson 10.2
deletes the file and regenerates the equivalents from wordpress-headless/schema.graphql.

| Type                          | Operation        | Known to disagree with the schema                                         |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `IncidentNodeResponse`        | `IncidentsList`  | all nine `incidentDetails` fields declared non-null; schema says nullable |
| `IncidentBySlugQueryResponse` | `IncidentBySlug` | inherits the above, plus `content` guessed                                |
| …                             | …                | Lesson 09.4 adds five more rows                                           |

### Why we are keeping them for one module

(Your own two sentences. If you cannot write them, re-read Key Concept 5.)

## Cache policy (Lesson 10.3)

Tags are built by `src/lib/graphql/tags.ts`. Never write a tag string by hand — Module 18's
WordPress webhook constructs the same strings in PHP, and a mismatch fails silently.

| Route                                                | `revalidate` | Tags                           |
| ---------------------------------------------------- | ------------ | ------------------------------ |
| `/[locale]`                                          | 300          | `incidents`, `site-settings`   |
| `/[locale]/incidents`                                | 300          | `incidents`                    |
| `/[locale]/incidents/[slug]`                         | 3600         | `incident:<slug>`, `incidents` |
| `/[locale]/blog`                                     | 3600         | `posts`                        |
| `/[locale]/blog/[slug]`                              | 3600         | `post:<slug>`, `posts`         |
| `/[locale]/reviews`                                  | 3600         | `reviews`                      |
| `/[locale]/reviews/[slug]`                           | 3600         | `review:<slug>`, `reviews`     |
| `/[locale]/scapegoats`                               | 600          | `scapegoats`, `incidents`      |
| `/[locale]/hobt`                                     | **60**       | `page:hobt`                    |
| root layout — `SiteChrome`                           | 3600         | `site-settings`                |
| root layout — `PrimaryMenu` (arrives in Lesson 11.3) | 3600         | `menu:primary`                 |
| `/api/health`                                        | `no-store`   | none                           |

Why the outliers:

- `/scapegoats` is 600, not 3600, because the leaderboard reads `count`, which WordPress
  updates whenever an incident is published. It carries `incidents` for the same reason.
- `/hobt` is 60 because `seats_left` drives a live urgency badge — see the content model
  contract, HOBT Promo. The route itself arrives in Lesson 11.5; the policy row exists now
  so the route is built against it rather than retrofitted.
- `/api/health` is `no-store` because a cached health check is not a health check.
- The root layout has **two** rows because Lesson 10.5 splits Lesson 05.4's `SiteChrome`
  into a settings document and a menu document. Two documents means two tags, so an editor
  reordering the menu does not expire the footer.
- Authenticated reads have no row. `fetchGraphQLAuthed` cannot be cached at all.

## GraphQL error policy (Lesson 10.4)

| Response                                | Client behaviour                                               |
| --------------------------------------- | -------------------------------------------------------------- |
| `data` present, no `errors`             | return `data`                                                  |
| `data` present, `errors` present        | **log `GraphQLRequestError.toString()`, return `data`**        |
| `data` null or absent, `errors` present | throw `GraphQLRequestError`                                    |
| Neither                                 | throw `GraphQLRequestError`                                    |
| Non-2xx, or no response at all          | throw `GraphQLRequestError` with `status` 0 or the real status |

Accepted cost: a partial response degrades the page silently until somebody reads the log.
Module 24 sends that log line to Sentry, which is what makes the policy honest.

Never shown to a browser: `error.message` in production, `locations` anywhere, the query
text, a file path, or a stack. The error page shows our own copy plus `error.digest`.
