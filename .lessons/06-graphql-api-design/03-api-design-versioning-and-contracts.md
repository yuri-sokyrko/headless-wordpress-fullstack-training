---
title: 'API Design, Versioning & Contracts'
module: 6
lesson: 3
teaches: [schema-as-contract, additive-versioning, deprecation, schema-snapshot, nullability]
produces: ['wordpress-headless/schema.graphql']
requires: [6.1, 6.2]
---

# Lesson 06.3 — API Design, Versioning & Contracts

## Quick Overview

GraphQL has no `/v2`. There is one schema, it evolves in place, and the only safe evolution is
**additive**: add fields, add optional arguments, add enum values with care, and mark things
`@deprecated(reason: "...")` instead of deleting them. This lesson turns that constraint into a
written policy for this project — what may change freely, what requires a deprecation cycle, and
what is simply a breaking change you have to coordinate. It also covers the design decisions that
are easy to get wrong and expensive to reverse: nullability as a promise rather than a default,
naming that will read well in generated TypeScript, and enums versus strings for anything with a
closed set of values.

Then you snapshot it. `wp graphql generate-static-schema` writes the SDL, and it lands at
`wordpress-headless/schema.graphql` — **committed**. Generated artifacts in git feel wrong until you see
what it buys: CI regenerates the TypeScript types from the file rather than introspecting a live
WordPress, which means **no CI job in this course ever holds a database password or a JWT
secret**, and an entire category of flaky pipeline disappears. Refreshing the schema becomes a
deliberate human action whose diff is reviewed like any other change, so a field rename shows up
in a pull request instead of surfacing as a runtime error after deploy. The cost, stated plainly:
the file can go stale, and you need a `codegen:check` job to catch it — which Module 24 adds.

By the end of this lesson you will have:

- `wordpress-headless/schema.graphql` generated and committed — the contract, frozen
- A written API policy: additive-only, deprecate rather than remove, and the deprecation window
  this project uses
- Every custom field and mutation from Lessons 06.1 and 06.2 carrying a `description`
- A deliberate nullability review of your custom fields, with a reason recorded for each
  non-null
- A demonstrated breaking change: rename a field, regenerate, and read the resulting diff
- An `npm`-free refresh command written down for later use as `npm run schema:pull`

## Classic WP Analogy

Classic WordPress versions its APIs by *not breaking them, ever*. `wp_insert_post()` has the same
signature it had a decade ago; deprecated functions live on in `wp-includes/deprecated.php`
calling `_deprecated_function()` and still working; and the entire ecosystem's stability rests on
backward compatibility being close to sacred. You have relied on that — a plugin written for 4.9
usually still runs. WordPress's REST API took the same approach in a more formal way, with
`/wp/v2` frozen and additions arriving as new fields and new namespaces rather than a `/wp/v3`.

GraphQL's evolution model is that same philosophy made structural. Adding a field cannot break an
existing client, because clients ask for fields explicitly and a query that did not request the
new field is unaffected — which is the property REST lacks, where adding a field changes every
response body. Removing a field, by contrast, breaks every query that names it, immediately and
loudly. So the safe operations and the dangerous ones are inverted relative to REST, and the
`@deprecated` directive plays the role `_deprecated_function()` plays in core: the thing still
works, and the tooling tells you to stop using it.

**Where the analogy breaks down:** in Classic WordPress, backward compatibility is somebody
else's discipline. Core maintains it for you, and when you break your own theme you fix the theme
in the same commit, in the same language, in the same repository. Here you are the API owner and
the API consumer, but they are separated by a language, a deploy boundary and — in production —
two independent release cycles on two platforms. A schema change deployed to Fly.io before the
Vercel deploy that consumes it means a window where the front end queries a field that does not
exist yet, and every user in that window sees an error. Nobody in Classic WordPress has to think
about deploy ordering as an API design concern. Module 24's deployment lesson returns to this;
the habit that saves you is additive-first, so both orderings are safe.

---

## Key Concepts

### 1. Field names are read by three audiences, and one of them is a compiler

A GraphQL field name is not just a label. It becomes a property on a generated TypeScript type,
a key in a JSON response, and a line in a diff someone reviews. Naming rules that look fussy in
PHP pay for themselves in Module 10.

| Rule | Good | Bad | Why |
|---|---|---|---|
| `camelCase`, always | `blameScore` | `blame_score` | WPGraphQL's convention; a snake_case field is a visibly foreign object in the schema and in generated types |
| Name the concept, not the storage | `blameConfidence` | `metaBlameConfidence` | `meta` is where it lives, not what it is |
| No type in the name | `occurredAt` | `occurredAtString` | The schema already states the type. If the type changes, the name lies. |
| Booleans read as assertions | `isVerified` | `verified`, `verifiedFlag` | `if (incident.isVerified)` reads as English |
| Plural means a list | `scapegoats` | `scapegoatList` | The type says it is a list |
| No abbreviations you would not say out loud | `estimatedCostUsd` | `estCost` | `Usd` survives because it is a unit, and a number without a unit is a bug waiting |
| Prefixes only for genuine namespacing | `hobtPromo` | `bttBlameScore` | Prefixing everything with your project makes every consumer read the prefix forever |

**The verdict: name the field the way you would name the React prop that receives it.** That is
literally where it ends up.

> **The name is the hardest thing to change.** A resolver can be rewritten, a type can be
> widened, a description can be fixed. A field name is in every saved query, every fragment,
> every generated type and every component. Spend the extra minute now.

### 2. Nullability is a promise, and `!` is the expensive one

`String` and `String!` are not "roughly the same, one is stricter". They are two different
promises to every consumer for as long as the field exists.

```
  environment: IncidentEnvironment        environment: IncidentEnvironment!
  ─────────────────────────────────       ─────────────────────────────────
  TS:  IncidentEnvironment | null         TS:  IncidentEnvironment
  the consumer MUST handle null           the consumer never checks
  you may return null forever             you may NEVER return null,
                                          for any incident, ever again
```

And the consequence people do not see coming: **a non-null field that resolves to null does not
just fail — it nulls out its parent.** GraphQL propagates the error upward until it finds a
nullable field, so one broken `Incident.blameScore!` inside `incidents { nodes { … } }` can turn
the entire `incidents` field null and take a whole page down. A nullable field that returns null
costs you one empty badge.

| Direction | Adding `!` | Removing `!` |
|---|---|---|
| On an **output** field | **breaking** — consumers stop handling null and you can never go back | safe — consumers already handle null |
| On an **input** field | **breaking** — existing clients omitting it now fail validation | safe — the field becomes optional |

Note the inversion. Output fields get stricter safely by *removing* `!`; input fields get
stricter safely by *adding* nullability. The rule that falls out:

> **Be generous in what you accept and cautious in what you promise.** Non-null inputs where a
> value is genuinely required — `title`, `scapegoatSlug`. Nullable outputs almost everywhere,
> because the only field you can honestly mark `!` is one whose resolver cannot fail and whose
> data cannot be missing. `registerDeveloper.accepted` earns it: the resolver returns a boolean
> derived from a payload the mutation only produces on success.

This project's custom surface, reviewed in Lesson 06.3's Task, comes out as: every output field
nullable except two booleans, and inputs non-null exactly where the mutation would have to reject
a missing value anyway.

### 3. Do not let WordPress leak into the shape of the schema

The schema is the contract with an application that does not know what WordPress is. Every
WordPress-shaped thing you expose is a WordPress detail your front end now depends on.

| Leaks | Better | Why it matters |
|---|---|---|
| `metaValue`, `postMeta`, raw meta keys | named fields (`downtimeMinutes`) | `wp_postmeta` is storage. Nobody outside should know it exists. |
| A `String` holding `"s2-major"` | a `Severity` term, or an enum | the slug is a WordPress identifier; the consumer wants a value |
| `severitySlug` on a breakdown object | `severities { nodes { slug } }` | one way to ask a question, not two |
| `postId`, `ID` and `databaseId` all exposed and interchangeable | the relay `id` for identity, `databaseId` where you truly need the integer | three identities for one thing is three ways to get it wrong |
| `acfFields { … }` as a passthrough | field groups with a named `graphql_field_name` | the plugin's name in your contract |
| Anything with `wp` in the name | — | you may move off WordPress. The contract should survive it. |

The third row is a real finding from this module: Lesson 06.1 put `severitySlug` on
`BlameScoreBreakdown` because the resolver had it handy. It duplicates
`incident.severities.nodes.slug`, which is the canonical route, and it hard-codes a WordPress
term slug into a field whose job is arithmetic. The Task deprecates it — the first deprecation in
the course, on a field this course itself got slightly wrong, which is the normal case.

> **The test to apply:** could you serve this schema from a Rails app with a completely different
> database, without renaming anything? Where the answer is no, you have leaked an implementation
> detail into the contract.

### 4. Additive versus breaking, and why GraphQL has no `/v2`

REST versions by URL because adding a field changes every response body. GraphQL cannot use that
escape hatch — there is one schema and one endpoint — but it does not need to, because clients
name the fields they want.

```
REST                                      GraphQL
──────────────────────────────────        ──────────────────────────────────
add a field  → every response grows      add a field  → nobody who did not
             → payload creep, some                     ask for it is affected
               clients break on
               unknown keys              remove a field → EVERY query naming
                                                          it fails instantly
remove a field → old clients break
               → so you ship /v2         so: additive is free,
                                            destructive is loud
```

| Change | Safe? | Notes |
|---|---|---|
| Add a field | ✅ | The single safest change in GraphQL |
| Add an **optional** argument | ✅ | |
| Add a value to an **output** enum | ⚠️ | Safe for the server; breaks any consumer with an exhaustive `switch` — which is the whole point of Lesson 06.1 §3. Ship it with the front-end change. |
| Add a value to an **input** enum | ✅ | Existing clients simply do not use it |
| Add an **optional** input field | ✅ | |
| Add a **required** input field | ❌ | Every existing mutation call fails validation |
| Widen a type (`Int` → `Float`) | ⚠️ | Fine for JSON; generated types change, so it is a front-end edit |
| Narrow a type (`Float` → `Int`) | ❌ | |
| Remove `!` from an output field | ✅ | Consumers were already required to handle null |
| Add `!` to an output field | ❌ | An irreversible promise |
| Rename a field | ❌ | Two changes: a removal and an addition. Do them in that order and you have an outage. |
| Remove a field | ❌ | Deprecate first — §5 |

**The rule this project follows: additive-first, always.** Add the new field, deprecate the old
one, migrate the front end, and only then remove. Three deploys instead of one, and no window in
which the two applications disagree.

### 5. `@deprecated` needs a reason and a migration, not a tombstone

WPGraphQL exposes deprecation through one config key:

```php
// Illustrative — applied for real in the Task.
'deprecationReason' => __( 'Use `severities { nodes { slug } }` instead. Removed after 2026-06-01.', 'blame-the-tech-core' ),
```

Which prints into the SDL as `@deprecated(reason: "…")`, greys the field out in GraphiQL,
and — the part that actually drives migration — makes `@graphql-eslint`'s
`no-deprecated` rule fail the Next.js build in Module 07's linting setup.

A reason has three jobs. Most deprecations only do the first:

| Job | Bad | Good |
|---|---|---|
| Say it is going | `Deprecated.` | ✅ |
| Say what to use instead | `Do not use.` | `Use severities { nodes { slug } } instead.` |
| Say when it disappears | *(nothing)* | `Removed after 2026-06-01.` |

Without the third, a deprecation is permanent: nothing forces a decision, the field stays for
years, and the schema grows a museum wing. This project's policy, written into
`docs/api-contract.md` in the Task:

| Element | Policy |
|---|---|
| Window | One minor release **or** 30 days, whichever is longer |
| Reason format | `Use <replacement> instead. Removed after <ISO date>.` |
| Enforcement | `@graphql-eslint` `no-deprecated` fails the front-end build |
| Removal | A separate pull request whose `schema.graphql` diff shows only the removal |

WordPress core's `_deprecated_function()` is the exact same idea: the function still works, and
the tooling nags. The difference is that core's deprecations are effectively permanent, while
yours have one consumer and a date.

### 6. The schema snapshot, and the credential CI therefore never needs

One command turns the live schema into a file:

```bash
docker compose run --rm wpcli wp graphql generate-static-schema --output=<path>
```

It lands at **`wordpress-headless/schema.graphql`** — not in `next-app/` — and it is
**committed**. WordPress owns the schema, so the file lives with WordPress;
`next-app/codegen.ts` reaches across with a relative path in Module 10.

```
   wordpress-headless/                      next-app/
   ┌──────────────────────────┐             ┌──────────────────────────┐
   │ the plugin registers     │             │ codegen.ts               │
   │ types, fields, mutations │             │   schema: '../wordpress- │
   │            │             │             │     headless/schema.     │
   │            ▼             │             │     graphql'             │
   │  wp graphql generate-    │             │            │             │
   │    static-schema         │             │            ▼             │
   │            │             │             │  src/gql/ (generated TS) │
   │            ▼             │             └──────────────────────────┘
   │  schema.graphql  ────────┼──── git ───────────────▶ read as a FILE
   └──────────────────────────┘                          not introspected
```

Committing a generated artifact feels wrong until you list what it buys:

| Property | Consequence |
|---|---|
| **CI needs no running WordPress** | No `docker compose up` in the type-check job, no waiting for MySQL, no flake |
| **CI needs no credential** | No database password, no JWT secret, no app token in any GitHub Actions secret for codegen |
| **A schema change is a reviewable diff** | A renamed field shows up in the pull request, next to the PHP that renamed it |
| **The front end can be built at any commit** | Check out a six-month-old commit and codegen still works |

The cost, stated plainly: **the file can go stale.** Someone edits `fields.php`, does not
regenerate, and the committed contract now describes a schema that no longer exists. The
mitigations are a `codegen:check` job (Module 24) and the habit of regenerating in the same
commit as the PHP — which the Task's breaking-change exercise is designed to build.

> **The refresh is a deliberate human action.** Module 10 wraps it as `npm run schema:pull`,
> which runs the command above against a *running* local WordPress. It is never run in CI. A
> schema that CI can silently update is a contract nobody reviews.

There is one trap in the command and it is worth naming before you type it: **without
`--output`, WPGraphQL writes to `get_temp_dir() . 'schema.graphql'` — which is `/tmp` inside the
`wpcli` container, and that container is deleted by `--rm` the moment the command finishes.** The
command reports success and you have nothing. Always pass `--output`, and pass a path inside a
bind mount so the file lands on your disk.

### 7. Two applications, two deploys, one contract

This is the concept with no Classic WordPress equivalent, and the one that makes additive-first
a rule rather than a preference.

```
   SAFE ORDER                              THE OTHER ORDER
   ─────────────────────────────           ─────────────────────────────
   1. Fly.io: WP adds `blameScore`         1. Vercel: front end asks for
      (additive — nobody asks yet)            `blameScore`
   2. Vercel: front end asks for it        2. every request → "Cannot query
                                              field blameScore on Incident"
   both orderings are fine                 an outage until step 2 lands
```

With an **additive** change, either deploy can go first. With a **destructive** one, only one
order works, and you have to coordinate two platforms to get it. Every rule in this lesson exists
to keep you in the left-hand column.

| Change kind | Deploy order | What can go wrong |
|---|---|---|
| Additive | either | nothing |
| Deprecation | either | nothing — the field still resolves |
| Removal | **WordPress last** | any front end still naming the field |
| Adding a required input field | **WordPress last**, and only after every caller sends it | mutations fail validation |

Module 24's deployment lesson returns to this with the actual pipeline. The habit to build now:
**a pull request that changes `schema.graphql` destructively is a pull request that needs a
deploy plan written in its description.**

---

## Task

### Step 1: Review nullability, and record a reason for every `!`

Read your own schema surface and decide, field by field. Do not skip to the code — the point of
this step is that the decision is written down.

| Field | Type as registered | Verdict |
|---|---|---|
| `Incident.blameScore` | `Float` | ✅ nullable — an incident with no severity term cannot be scored (Lesson 06.1 §6) |
| `Incident.blameScoreBreakdown` | `BlameScoreBreakdown` | ✅ nullable — null under exactly the same conditions |
| `BlameScoreBreakdown.score` | `Float` | ✅ nullable — the parent is only non-null when the score exists, but a nullable child costs nothing and cannot null out its parent |
| `IncidentDetails.environment` | `IncidentEnvironment` | ✅ nullable — a legacy row may hold an unrecognised value |
| `CreateIncidentPayload.incident` | `Incident` | ✅ nullable — the post is `pending`, and a viewer without `edit_incidents` legitimately sees null |
| `RegisterDeveloperPayload.accepted` | `Boolean!` | ✅ **non-null earned** — the resolver reads a payload the mutation only returns on success |
| `SubmitHobtLeadPayload.accepted` | `Boolean!` | ✅ non-null, same reason |
| `CreateIncidentInput.title` | `String!` | ✅ non-null — the mutation rejects an empty title anyway |
| `CreateIncidentInput.isVerified` | `Boolean` | ✅ nullable — optional, and ignored for most callers |

**Verify §1:**

- [ ] Nothing in the list above is a non-null **output** field except the two `accepted` booleans.
- [ ] You can state, for each of those two, what would have to break for it to return null. If
      you cannot, remove the `!` — you are promising something you have not checked.

### Step 2: Deprecate the field this module got wrong

`BlameScoreBreakdown.severitySlug` duplicates `incident.severities.nodes.slug` and puts a
WordPress term slug in a field whose job is arithmetic (Key Concept 3). Deprecate it rather than
deleting it — a saved query somewhere may already name it.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/fields.php
				'severitySlug'    => array(
					'type'              => 'String',
					'description'       => __( 'The severity term slug the weight came from.', 'blame-the-tech-core' ),
					// Lesson 06.3 §5: a reason names the replacement AND the date.
					// A deprecation with no date is a field that lives forever.
					'deprecationReason' => __( 'Duplicates `severities { nodes { slug } }`, which is the canonical route, and leaks a WordPress term slug into a computed field. Use that connection instead. Removed after 2026-06-01.', 'blame-the-tech-core' ),
					'resolve'           => static fn( $source ): ?string => isset( $source['severitySlug'] ) ? (string) $source['severitySlug'] : null,
				),
```

**Verify §2:**

- [ ] The reason contains a replacement **and** an ISO date.
- [ ] The field still resolves. A deprecation is a label, not a removal — confirm in GraphiQL
      that the value still comes back.

### Step 3: Generate the schema, to the right path

The default output path is inside a container that `--rm` is about to delete, so `--output` is
not optional (Key Concept 6). Write into the bind-mounted plugin directory, then move the file to
where the contract lives:

```bash
cd wordpress-headless

docker compose run --rm wpcli wp graphql generate-static-schema \
  --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql

mv wp-content/plugins/blame-the-tech-core/schema.graphql schema.graphql

wc -l schema.graphql
```

**Verify §3:**

- [ ] The command printed `Success: All done. Schema output to …`.
- [ ] `schema.graphql` is at `wordpress-headless/schema.graphql` — **not** in `next-app/`, and
      not left inside the plugin directory.
- [ ] It is several thousand lines. A short file means the schema failed to build; check
      `docker compose logs --tail=40 wordpress`.

### Step 4: Read the parts of it that are yours

The file is large and machine-generated, and you should still read the ninety lines you wrote.

```bash
# Your enums, in the contract
grep -A6 '^enum IncidentEnvironment' schema.graphql

# Your computed field, with its description as a doc-string
grep -B4 '  blameScore: Float' schema.graphql

# The deprecation from Step 2
grep -n '@deprecated' schema.graphql | head

# The mutation input, and the absence of authorId
sed -n "/^input CreateIncidentInput/,/^}/p" schema.graphql
```

**Verify §4:**

- [ ] Every `description` you wrote in Lessons 06.1 and 06.2 appears as a `"""doc string"""`
      above its field. A field with no doc-string in this file is a field you forgot to describe.
- [ ] `input CreateIncidentInput` contains `status` and `isVerified` and **no** `authorId`.
- [ ] `@deprecated(reason: "…")` appears on `severitySlug`.

### Step 5: Commit the contract

```bash
cd ..
git add wordpress-headless/schema.graphql
git commit -m "feat(api): commit the GraphQL schema snapshot

The schema is now a reviewable artifact. CI regenerates TypeScript types
from this file rather than introspecting a live WordPress, so no CI job
needs a database credential or a JWT secret."

git ls-files wordpress-headless/schema.graphql
```

**Verify §5:**

- [ ] `git ls-files` prints the path. If it prints nothing, a `.gitignore` rule is swallowing
      `*.graphql` — fix the rule, not the file.
- [ ] `git show --stat HEAD` shows one file, several thousand insertions.

### Step 6: Break it on purpose and read the diff

This is the exercise that builds the habit. Rename `blameScore` and watch what a breaking change
looks like in review.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/fields.php
	// TEMPORARY — Lesson 06.3 Step 6. You revert this in Step 7.
	register_graphql_field(
		'Incident',
		'blameScoreValue',
```

Regenerate and diff:

```bash
cd wordpress-headless
docker compose run --rm wpcli wp graphql generate-static-schema \
  --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql
mv wp-content/plugins/blame-the-tech-core/schema.graphql schema.graphql

git diff --stat wordpress-headless/schema.graphql
git diff wordpress-headless/schema.graphql | grep -E '^[-+] +blameScore'
```

**Verify §6:**

- [ ] The diff is a **removal and an addition**, not a modification:
      `- blameScore: Float` and `+ blameScoreValue: Float`.
- [ ] Say out loud what happens to a deployed front end asking for `blameScore` between the two
      deploys. That sentence is why Key Concept 7 exists.
- [ ] `git diff` on this file is the review a reviewer gets. Nothing else in the pull request
      would have told them.

### Step 7: Revert, regenerate, confirm clean

```bash
# Put the field name back to blameScore in fields.php, then:
docker compose run --rm wpcli wp graphql generate-static-schema \
  --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql
mv wp-content/plugins/blame-the-tech-core/schema.graphql schema.graphql

git diff --exit-code wordpress-headless/schema.graphql && echo 'schema matches the commit'
```

**Verify §7:**

- [ ] `schema matches the commit`. If there is a diff, something else changed too — read it
      before you commit it.

### Step 8: Write the refresh command down

Module 10 wires this into `next-app/package.json` as `npm run schema:pull`. Until then it lives
in your own runbook so you do not have to remember the `--output` trap:

```bash
# wordpress-headless — the schema refresh, two lines. Module 10 wraps it as `npm run schema:pull`.
docker compose run --rm wpcli wp graphql generate-static-schema \
  --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql \
  && mv wp-content/plugins/blame-the-tech-core/schema.graphql schema.graphql
```

### Step 9: Expand `docs/api-contract.md` into the policy

Lesson 05.5 started this file. Replace it with the full version — the API policy, the
deprecation rules, the nullability decisions and the error vocabulary the front end will match
on in Module 16.

```markdown
<!-- docs/api-contract.md -->
# Blame The Tech — API contract

The GraphQL schema is the contract between `wordpress-headless` and `next-app`. It is
snapshotted at `wordpress-headless/schema.graphql` and committed, so every change is a
reviewable diff and CI never needs a running WordPress.

## 1. Ownership

| Thing | Owner | Where |
|---|---|---|
| The schema | WordPress | `blame-the-tech-core/includes/graphql/` |
| The snapshot | WordPress | `wordpress-headless/schema.graphql`, committed |
| Generated TypeScript | Next.js | `next-app/src/gql/`, generated, committed (Module 10) |
| The refresh | a human | `npm run schema:pull` against a running local WordPress. **Never in CI.** |

## 2. Mutations we expose

| Operation | Credential | Forced server-side | Payload withholds |
|---|---|---|---|
| `createIncident` | user JWT + `create_incidents` | `post_status = pending`, `post_author = current user`; `status` always discarded; `isVerified` discarded unless `edit_others_incidents` | — |
| `registerDeveloper` | `X-BTT-App-Token` | role `incident_reporter`, `btt_verified = 0`, generated password | the `User` node; whether the email existed |
| `submitHobtLead` | `X-BTT-App-Token` | `created_at`, `ip_hash` (HMAC, never a raw IP) | the row ID; whether the lead was a duplicate |
| `login`, `refreshJwtAuthToken` | credentials | — | — |

## 3. Mutations we deliberately do NOT use

- `registerUser` — requires `users_can_register`, which opens a second registration door, and
  assigns `get_option('default_role')` rather than ours.
- The generated `createIncident` / `updateIncident` / `deleteIncident` — switched off with
  `graphql_exclude_mutations` on the post type. They accept a client `status` and `authorId`.

## 4. Evolution policy

**Additive-first, always.** Add, deprecate, migrate, remove — in that order, across three
deploys.

| Change | Allowed |
|---|---|
| Add a field, an optional argument, an optional input field | ✅ any time |
| Add a value to an **output** enum | ⚠️ ship with the front-end change that handles it |
| Add a **required** input field | ⚠️ WordPress deploys last, after every caller sends it |
| Remove `!` from an output field | ✅ |
| Add `!` to an output field, narrow a type, rename or remove a field | ❌ deprecation cycle first |

### Deprecation

- Reason format: `Use <replacement> instead. Removed after <ISO date>.`
- Window: one minor release or 30 days, whichever is longer.
- `@graphql-eslint`'s `no-deprecated` rule fails the front-end build, so the deprecation is
  enforced rather than suggested.
- Removal is its own pull request, whose `schema.graphql` diff shows only the removal.

### Currently deprecated

| Field | Replacement | Removed after |
|---|---|---|
| `BlameScoreBreakdown.severitySlug` | `severities { nodes { slug } }` | 2026-06-01 |

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

| Message | Meaning | Front-end handling |
|---|---|---|
| `You must be signed in to submit an incident.` | no session | redirect to sign-in |
| `You are not allowed to submit incidents.` | authenticated, wrong capability | show as a form-level error |
| `A title is required.` | validation | attach to the `title` field |
| `occurredAt must be a valid date and time that is not in the future.` | validation | attach to `occurredAt` |
| `That scapegoat does not exist.` / `That severity does not exist.` | unknown term slug | refresh the term list |
| `Not authorized.` | missing or wrong app token | server-side misconfiguration; never shown to a user |
| `Temporarily unavailable.` | dependency not ready | generic retry |

## 7. Rules

- The browser never calls `/graphql`. Only the Next.js server runtime does. No CORS plugin.
- Validation on the Next side is a UX feature. Validation in WordPress is the security control.
- **A field appearing in an input type is not permission to set it.**
- Every custom field and mutation carries a `description`. It becomes the doc-string in
  `schema.graphql` and the JSDoc on the generated TypeScript type.
- A pull request that changes `schema.graphql` destructively needs a deploy plan in its
  description.
```

---

## Verification

```bash
cd wordpress-headless

# 1. The contract exists, at the one correct path
test -f schema.graphql && echo 'schema.graphql present' || echo MISSING
# Expected: schema.graphql present
test -f ../next-app/schema.graphql && echo 'WRONG PATH — remove it' || echo 'not in next-app, correct'
# Expected: not in next-app, correct

# 2. It is committed, not just present
git ls-files --error-unmatch schema.graphql >/dev/null 2>&1 && echo tracked || echo 'NOT TRACKED'
# Expected: tracked

# 3. It is in sync with the running schema — the check Module 24 turns into CI
docker compose run --rm wpcli wp graphql generate-static-schema \
  --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql
mv wp-content/plugins/blame-the-tech-core/schema.graphql /tmp/schema-fresh.graphql
diff -q schema.graphql /tmp/schema-fresh.graphql && echo 'in sync' || echo 'STALE — regenerate and commit'
# Expected: in sync

# 4. Every custom type made it into the contract
for t in IncidentEnvironment IncidentResolutionStatus TechReviewVerdict LeadSource \
         BlameScoreBreakdown CreateIncidentInput CreateIncidentPayload \
         RegisterDeveloperPayload SubmitHobtLeadPayload; do
  printf '%-28s %s\n' "$t" "$(grep -cE "^(type|input|enum) $t " schema.graphql)"
done
# Expected: every line ends in 1

# 5. NEGATIVE: the generated mutations are NOT in the contract
grep -cE '^  (updateIncident|deleteIncident)\(' schema.graphql
# Expected: 0 — removed by graphql_exclude_mutations in Lesson 06.2

# 6. NEGATIVE: no WordPress internals leaked into the custom surface
grep -nE '^  (metaValue|postMeta|wpFields|acfFields):' schema.graphql
# Expected: no output

# 7. NEGATIVE: authorId is absent from the input we own
sed -n '/^input CreateIncidentInput/,/^}/p' schema.graphql | grep -c 'authorId'
# Expected: 0

# 8. Descriptions survived into the SDL as doc-strings
grep -B6 '^  blameScore: Float' schema.graphql | grep -c '"""'
# Expected: 2 or more — the opening and closing doc-string delimiters

# 9. The deprecation is in the contract, with a replacement and a date
grep -o '@deprecated(reason: "[^"]*severities[^"]*")' schema.graphql | head -1
# Expected: a reason naming `severities { nodes { slug } }` and a 2026-06-01 date

# 10. Non-null OUTPUT fields are exactly the two we justified.
#     `[^ ]` excludes list types like [String]! from this crude count.
grep -nE '^  [a-zA-Z]+: [A-Za-z]+!$' schema.graphql | grep -E 'accepted: Boolean!' | wc -l
# Expected: 2 — RegisterDeveloperPayload.accepted and SubmitHobtLeadPayload.accepted

# 11. THE NEGATIVE THAT MATTERS: the contract is readable with WordPress DOWN.
#     This is what "CI needs no running WordPress and no credential" means.
docker compose stop wordpress
grep -c '^enum IncidentEnvironment' schema.graphql
# Expected: 1 — the contract is a file in git, not a live introspection
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/graphql
# Expected: 000 or 502 — WordPress is genuinely down, and step above still worked
docker compose start wordpress

# 12. And the schema file holds no credential of any kind
grep -icE 'BTT_APP_TOKEN|MYSQL_|_SALT|_KEY=' schema.graphql
# Expected: 0

# 13. The policy document exists and covers the four sections that matter
grep -cE '^## (1\. Ownership|4\. Evolution policy|5\. Nullability|6\. Error vocabulary)' ../docs/api-contract.md
# Expected: 4

# 14. Nothing secret is staged alongside the contract
cd .. && git status --short
# Expected: no .env, no vendor/, no schema.graphql left uncommitted
```

Check 11 is the one to run even though it looks like theatre. Stopping WordPress and still being
able to read the schema is the whole argument for committing a generated file, and it is the
reason no job in this course's CI ever holds a database password.

## Control Questions

1. `Incident.blameScore` is `Float`, not `Float!`. Describe what a client sees when a
   `Float!` field resolves to null inside `incidents(first: 40) { nodes { … } }`, and say why
   that makes `!` on a computed field a bad trade.
2. Adding a value to an output enum is marked ⚠️ rather than ✅ in Key Concept 4, while adding a
   value to an **input** enum is ✅. Explain the asymmetry, and name the front-end mechanism that
   turns the output case into a build failure rather than a silent hole.
3. `BlameScoreBreakdown.severitySlug` is deprecated rather than deleted, even though this course
   wrote it two lessons ago and no front end exists yet. Give the argument for the deprecation
   cycle anyway, and the argument against — then say which you would apply on a real project on
   day two.
4. `wp graphql generate-static-schema` without `--output` reports success and leaves you with no
   file. Explain exactly where the file went, why `--rm` is involved, and what the same command
   would do if you ran it with `docker compose exec wordpress` instead.
5. `schema.graphql` is a generated artifact and it is committed. State the two concrete things
   this buys CI, the one way the file can lie, and the job Module 24 adds to catch it.

## Learn More

- [GraphQL — Best Practices: Versioning](https://graphql.org/learn/best-practices/#versioning) —
  the official argument for one evolving schema; two paragraphs, and it is the whole model
- [GraphQL spec — Field deprecation](https://spec.graphql.org/October2021/#sec-Field-Deprecation) —
  the normative behaviour of `@deprecated`, including that a deprecated field must still resolve
- [Nullability in GraphQL](https://graphql.org/learn/non-null-and-nullable/) — read the
  error-propagation section, which is Key Concept 2's most expensive detail
- [Apollo — Schema design: nullability](https://www.apollographql.com/docs/graphos/schema-design/guides/nullability) —
  the "be generous in what you accept" rule argued at length, with production examples
- [WPGraphQL — the `generate-static-schema` command](https://www.wpgraphql.com/docs/wp-cli/) —
  the flags, and where the file goes when you omit `--output`
- [graphql-inspector](https://the-guild.dev/graphql/inspector) — diffs two schema files and
  classifies every change as breaking, dangerous or safe; the tool version of Key Concept 4
- [`@graphql-eslint/no-deprecated`](https://the-guild.dev/graphql/eslint/rules/no-deprecated) —
  the rule that turns a deprecation into a build failure in Module 07's linting setup
