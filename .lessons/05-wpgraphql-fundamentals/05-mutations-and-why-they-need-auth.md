---
title: 'Mutations & Why They Need Auth'
module: 5
lesson: 5
teaches: [graphql-mutations, mutation-auth, input-types, client-mutation-id, no-cors-plugin]
produces: []
requires: [5.3]
---

# Lesson 05.5 — Mutations & Why They Need Auth

## Quick Overview

Reads are done; this lesson is about writes, and it is deliberately the shortest and most
cautious lesson in the module. A GraphQL **mutation** is a field on the mutation root that takes
a single `input` object and returns a payload — WPGraphQL follows the Relay convention, so every
input carries an optional `clientMutationId` and every payload can return the affected node. You
will explore the mutation root in GraphiQL, look at the built-in `createIncident`,
`updatePost` and `registerUser` mutations WPGraphQL exposes, and read their input types.

Then you try one anonymously and watch it fail. That failure is the lesson. WPGraphQL maps every
mutation onto the same capability checks wp-admin uses, so an anonymous caller attempting to
create an incident gets an `errors` array mentioning permission and no created post — because
`create_incidents` is a capability that the anonymous user does not have, exactly as Lesson 03.5
arranged. You will also see the trap: the built-in `registerUser` mutation would assign
`get_option('default_role')` and require opening `/wp-login.php?action=register`, which is two
doors into the same room. This course does not use it. Module 06 replaces these built-ins with
custom mutations that sanitise, re-authorise independently, force `post_status` and `post_author`,
and ignore `is_verified` — and this lesson is where you see why that work is necessary rather
than paranoid.

By the end of this lesson you will have:

- The mutation root explored in GraphiQL, with the input and payload types of three built-in
  mutations read from the docs pane
- A recorded anonymous `createIncident` attempt that fails with a permission error and creates
  nothing
- The same attempt succeeding for an authenticated editor session, and the created post
  confirmed with WP-CLI
- A written explanation of why `users_can_register` stays off and the built-in `registerUser` is
  not used
- The list of the four custom operations Module 06 will build, and what each one guards
- A written statement of why this course installs no CORS plugin

## Classic WP Analogy

Every write path you have built in Classic WordPress had two halves: a nonce, and a capability
check. `wp_verify_nonce($_POST['_wpnonce'], 'save_incident')` proved the request came from a form
your site rendered for this user; `current_user_can('publish_post', $id)` proved the user was
allowed to do the thing. You wrote both, in that order, in every `admin_post_` handler and every
AJAX action, and you knew that skipping the second one was the actual security bug while
skipping the first was a CSRF hole.

In GraphQL the second half is unchanged. Mutations resolve through `current_user_can()`, the
capabilities are the ones Lesson 03.5 assigned, and `map_meta_cap` still decides whether this
user may edit *this* post. Your capability instincts transfer completely. The first half —
nonces — does not exist, and that is the piece to think carefully about. There is no form,
therefore no nonce; the caller proves identity with a `Authorization: Bearer <jwt>` header
issued by the `login` mutation, and CSRF is handled differently because the credential is not
automatically attached by a browser to a cross-site request in the way a session cookie is.
Module 15 covers that in full.

**Where the analogy breaks down:** in Classic WordPress the *only* realistic caller of your write
handler is a form your own site rendered, so "did this come from my form?" and "is this user
allowed?" together felt like enough. Here the caller is a separate application on a separate
host that you also wrote — and you must nonetheless not trust it. A compromised or buggy front
end is a plausible attacker, so validation on the Next side is a user-experience feature and
validation in WordPress is the security control. That is why Lesson 06.2 re-validates and
re-authorises independently rather than trusting a Server Action that already checked, and why
`createIncident` forces `post_status = 'pending'` in PHP rather than accepting whatever status
the client sent.

---

## Key Concepts

### 1. The shape of a mutation

Every WPGraphQL mutation follows the Relay convention, which means once you have read one you
have read all of them.

```
mutation OperationName($input: CreateIncidentInput!) {
         └──────┬─────┘ └──┬──┘  └────────┬────────┘
                │          │              └── ONE input object. Always. Never
                │          │                  loose top-level arguments.
                │          └── your variable
                └── the operation name — codegen turns this into a TS type

  createIncident(input: $input) {
  └──────┬──────┘                     the mutation field
         │
    clientMutationId                  echoed straight back to you
    incident {                        the PAYLOAD — the affected node
      id
      status
    }
  }
}
```

| Part | Rule |
|---|---|
| Input type | Always exactly one argument named `input`, of type `<Mutation>Input!` |
| `clientMutationId` | Optional string, echoed back unchanged. Relay used it to correlate optimistic updates; you will rarely need it, but it is in every input type so it is worth recognising. |
| Payload | An object type, not the node directly. `createIncident` returns `CreateIncidentPayload`, which *contains* an `incident`. |
| Nullability | Payload fields are usually nullable, because a mutation can fail after being authorised |

The payload-wraps-the-node shape has a practical benefit: you choose what comes back. After
creating an incident you can ask for just `{ incident { id status } }` and skip the twenty
fields you already have on the client.

### 2. Mutations resolve through `current_user_can()` — the same one

There is no separate GraphQL permission system. WPGraphQL's built-in mutations call the same
capability functions wp-admin calls, against the same roles you configured in Lesson 03.5.

```
POST /graphql   { "query": "mutation { createIncident(...) }" }
        │
        ▼
  WPGraphQL resolves the mutation field
        │
        ▼
  current_user_can( 'create_incidents' )        ← Lesson 03.5's capability
        │
        ├── anonymous  → false → errors[] "not allowed", data.createIncident = null
        ├── reporter   → true  → wp_insert_post(), status downgraded to `pending`
        └── editor     → true  → wp_insert_post(), publishes if asked
```

This is the payoff of Module 03. You did not configure anything GraphQL-specific to make
anonymous writes fail — the capability was simply never granted, and every code path that
funnels through `current_user_can()` denies. Lesson 03.5 §3 called this **structural**
authorization; this lesson is where you watch it work over HTTP.

### 3. HTTP 200 with an `errors` array

The single most surprising thing about GraphQL for anyone coming from REST:

```
REST                                 GraphQL
─────────────────────────────        ─────────────────────────────
POST /wp-json/wp/v2/posts            POST /graphql
  → 401 Unauthorized                   → 200 OK
  → body: { "code": "..." }            → body: { "data": {...}, "errors": [...] }

if (!res.ok) throw                   res.ok is ALWAYS true.
                                     `fetch` will NEVER throw.
```

A denied mutation is a **successful HTTP request that carries an error in its body**. Three
consequences you must internalise now, because Lesson 10.1 builds a client around them:

1. `res.ok` and `res.status` tell you nothing about whether the operation succeeded.
2. `data` and `errors` can **both** be populated — partial success is normal. A query selecting
   five fields where one resolver throws returns the other four plus one error.
3. Every check in this course's Verification blocks inspects `.errors`, never the status code.

```bash
# The pattern used throughout the course
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"..."}' | jq '.errors[0].message'
```

### 4. The built-in mutations, and which ones this course refuses

WPGraphQL exposes a mutation for every registered post type and taxonomy. Useful for
exploration; mostly wrong for production.

| Built-in | What it does | This course |
|---|---|---|
| `createIncident` / `updateIncident` / `deleteIncident` | Generated from the CPT. Full capability checks. | **Replaced** in Lesson 06.2 — the built-in accepts whatever `status` you send |
| `createPost`, `updatePage`, … | Same, for core types | Unused. Editors author in wp-admin. |
| `registerUser` | Creates a user | **Refused.** See §5. |
| `login` (JWT plugin) | Credentials → tokens | **Used**, in Module 15 |
| `sendPasswordResetEmail` | Triggers the core reset mail | Used later, with rate limiting |

> **The built-in `createIncident` is not "insecure" — it is under-specified.** It correctly
> refuses anonymous callers. But it accepts a `status` from the client, and it accepts an
> `authorId`. For a mutation exposed to public submitters that is the wrong contract: the status
> must be forced to `pending` and the author must be forced to the current user, in PHP, with no
> client input consulted. Lesson 06.2 writes that mutation. This lesson exists so you know what
> it is replacing and why.

### 5. Why `registerUser` is refused

The built-in registration mutation looks like exactly what a headless site needs. It is not:

| Problem | Consequence |
|---|---|
| Requires `users_can_register = 1` | Which also serves `/wp-login.php?action=register` — a second door you did not build and must now secure |
| Assigns `get_option('default_role')` | A site-wide setting, not your decision. Change it for any reason and new reporters get the wrong role. |
| No verification, no rate limit, no challenge | Registration spam is automated within hours of a site being discoverable |
| No hook to force `incident_reporter` | You would filter your way to correctness rather than stating it |

Lesson 03.5 already set `users_can_register` to `0`. Module 06 builds `registerDeveloper`, which
assigns the role explicitly and is callable only server-to-server with the application token;
Module 15 adds email verification, Turnstile and rate limiting to it. **One door, one set of
rules, one place to audit.**

### 6. There is no CORS plugin, and that is architectural

WPGraphQL CORS is one of the most commonly installed companions to WPGraphQL. This course does
not install it, and the reason is worth stating plainly because it shapes everything after it.

```
THE COMMON SETUP                      THIS COURSE
────────────────────────────────      ────────────────────────────────
browser ──▶ /graphql                  browser ──▶ Next.js server ──▶ /graphql
   needs CORS headers                    no CORS policy needed
   endpoint is public                    endpoint never appears in the bundle
   introspection reachable               introspection not reachable from the app
   tokens must live in JS                tokens live in httpOnly cookies
```

**The browser never talks to `/graphql`. Only the Next.js server runtime does.** That single
property removes a CORS policy you could misconfigure, keeps the endpoint out of your client
bundle, and — most importantly — is what makes httpOnly cookie sessions possible at all in
Module 15. A token the browser must attach to a cross-origin request is a token JavaScript must
be able to read.

> **Be honest about the limit.** This is not obscurity-as-security: media `sourceUrl` values are
> public, so the WordPress host is discoverable regardless. The real controls are introspection
> off in production, depth and complexity limits, and persisted queries — Lesson 06.4 and Module
> 24. Keeping the endpoint server-side removes an attack *surface*, not the need for those
> controls. See [appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin).

### 7. What Module 06 builds, and what each guards

| Operation | Credential | Guards against |
|---|---|---|
| `createIncident` (custom) | user JWT + `create_incidents` | Client-chosen `status` or `authorId`; a client-supplied `is_verified`; unvalidated term slugs |
| `registerDeveloper` | application token | Wrong role, no verification, registration spam, a second registration door |
| `submitHobtLead` | application token | PII in `wp_postmeta`, unbounded writes, missing honeypot/timing/challenge |
| `blameScore` (field, not a mutation) | none — public | N+1 across a list of incidents |

---

## Task

You write no PHP in this lesson. You explore, you break something on purpose, and you write down
what you learn. Module 06 turns it into code.

### Step 1: Read the mutation root in GraphiQL

Open <http://localhost:8080/wp-admin/admin.php?page=graphiql-ide> and press the **Docs** button.
Click through to the `RootMutation` type.

**Verify §1:**

- [ ] You can see `createIncident`, `updateIncident`, `deleteIncident` — generated from the CPT
      you registered in Lesson 03.2.
- [ ] `createIncident` takes exactly one argument, named `input`, of type `CreateIncidentInput!`.
- [ ] `CreateIncidentInput` has a `clientMutationId`, a `title`, a `status` and an `authorId`.
      Note those last two. They are why Lesson 06.2 exists.

### Step 2: Record the anonymous attempt — the important one

GraphiQL sends your wp-admin session cookie, so it is the **wrong** tool for testing anonymous
access. Use `curl`, which sends nothing.

```bash
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation Anon($input: CreateIncidentInput!) { createIncident(input: $input) { incident { databaseId status } } }",
    "variables": { "input": { "title": "Anonymous write attempt", "status": "PUBLISH" } }
  }' | jq
```

**Verify §2:**

- [ ] The HTTP status was **200**. It is not an error at the transport layer.
- [ ] `.errors[0].message` mentions permission or capability.
- [ ] `.data.createIncident` is `null`.
- [ ] **Nothing was created.** Confirm it in the Verification block below, not by trusting the
      response.

> **This is Lesson 03.5 working over HTTP.** You wrote no GraphQL-specific permission code. The
> anonymous user simply does not hold `create_incidents`, and every path that asks
> `current_user_can()` — wp-admin, REST, WP-CLI, and now GraphQL — denies.

### Step 3: Watch the same mutation succeed, and note what it accepted

Repeat it in **GraphiQL**, where you are an authenticated administrator:

```graphql
# GraphiQL only — this is a probe, do not save it to queries.graphql
mutation AuthedProbe($input: CreateIncidentInput!) {
  createIncident(input: $input) {
    incident {
      databaseId
      title
      status
      author {
        node {
          name
        }
      }
    }
  }
}
```

with variables:

```json
{ "input": { "title": "Authed write probe", "status": "PUBLISH" } }
```

**Verify §3:**

- [ ] It succeeded, and `status` came back `publish` — lower case. The **input** `status` is a
      `PostStatusEnum` so you send `PUBLISH`, but the **output** `status` is a `String` carrying
      the raw `post_status`. Mixing the two up is a common source of failing assertions.
- [ ] **The client chose that status and the server accepted it.** For an administrator that is
      correct. For a public submitter it would be a vulnerability — write that sentence down,
      because it is the entire justification for Lesson 06.2.
- [ ] Note the `databaseId`; you delete it in the Verification block.

### Step 4: Confirm the registration door is shut

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8080/wp-login.php?action=register'
```

Then look at `registerUser` in the GraphiQL docs pane and read its input type.

**Verify §4:**

- [ ] The `wp-login.php` probe returns `302` — registration is disabled, as Lesson 03.5 set it.
- [ ] You can state, in one sentence, why this course will not use the built-in `registerUser`
      even though it exists and appears to work.

### Step 5: Write down the contract

Create `docs/api-contract.md` — Lesson 06.3 expands it into the full API policy, so start it now
while the reasoning is fresh.

```markdown
<!-- docs/api-contract.md -->
# Blame The Tech — API contract

## Mutations we expose

| Operation | Credential | Forced server-side | Built in |
|---|---|---|---|
| `createIncident` (custom) | user JWT | `post_status = pending`, `post_author = current user`, `is_verified` ignored | Lesson 06.2 |
| `registerDeveloper` | application token | role = `incident_reporter`, `btt_verified = 0` | Lesson 06.2 |
| `submitHobtLead` | application token | stored in `wp_btt_leads`, IP stored as an HMAC | Lesson 06.2 |
| `login` (JWT plugin) | credentials | — | Module 15 |

## Mutations we deliberately do NOT use

- `registerUser` — requires `users_can_register`, which opens a second registration door;
  assigns `get_option('default_role')` rather than our role.
- The generated `createIncident` — accepts a client-supplied `status` and `authorId`.

## Rules

- The browser never calls `/graphql`. Only the Next.js server runtime does. No CORS plugin.
- Validation on the Next side is a UX feature. Validation in WordPress is the security control.
- A field appearing in an input type is not permission to set it.
```

---

## Verification

```bash
cd wordpress-headless

# 1. The anonymous mutation is refused — and note the HTTP status
curl -s -o /tmp/anon.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId}}}",
       "variables":{"i":{"title":"Verification anon probe","status":"PUBLISH"}}}'
# Expected: HTTP 200   ← a REFUSAL delivered with a 200. This is the lesson.

jq -r '.errors[0].message' /tmp/anon.json
# Expected: a message about not being allowed / lacking permission

jq -r '.data.createIncident' /tmp/anon.json
# Expected: null

# 2. THE NEGATIVE THAT MATTERS: nothing was actually written
docker compose run --rm wpcli wp post list --post_type=incident \
  --title="Verification anon probe" --format=count
# Expected: 0

# 3. An authenticated request through the same endpoint DOES work.
#    Password comes from the session environment, never a file.
TOKEN=$(curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation(\$u:String!,\$p:String!){login(input:{username:\$u,password:\$p}){authToken}}\",
       \"variables\":{\"u\":\"btt_admin\",\"p\":\"$BTT_ADMIN_PASSWORD\"}}" | jq -r '.data.login.authToken // empty')
test -n "$TOKEN" && echo "token acquired" || echo "no token — is WPGraphQL JWT installed yet? (Module 15)"
# Expected: either "token acquired", or the Module 15 note. Both are fine here.

# 4. The mutation root exposes what we expect, and the input type has the fields
#    that make Lesson 06.2 necessary
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"CreateIncidentInput\"){ inputFields { name } } }"}' \
  | jq -r '.data.__type.inputFields[].name' | grep -E '^(status|authorId|clientMutationId)$'
# Expected: clientMutationId, status, authorId — all three present.
#           These are exactly what the custom mutation will refuse to trust.

# 5. Registration has one door
docker compose run --rm wpcli wp option get users_can_register
# Expected: 0

curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8080/wp-login.php?action=register'
# Expected: 302

# 6. No CORS plugin is installed — this is a deliberate absence
docker compose run --rm wpcli wp plugin list --field=name | grep -ci cors
# Expected: 0

# 7. Clean up the probe you created in Task Step 3
docker compose run --rm wpcli wp post list --post_type=incident \
  --title="Authed write probe" --field=ID --format=ids | xargs -r \
  docker compose run --rm wpcli wp post delete --force

docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: the same count you had before this lesson

# 8. The contract document exists
test -f ../docs/api-contract.md && echo "contract written" || echo "MISSING"
# Expected: contract written
```

Check 1 and check 2 together are the point of this lesson. A 200 that created nothing is not a
contradiction — it is how GraphQL reports refusal, and every client you write from Lesson 10.1
onward has to be built around it.

## Control Questions

1. `curl` shows an anonymous `createIncident` failing, but the same mutation succeeds in
   GraphiQL. Nothing about the mutation changed. Explain the difference, and say which of the two
   is the correct tool for testing what a public visitor can do.
2. A colleague reports "the API returned 200, so the incident was created." Describe precisely
   what they misread, and give the one line of `jq` that would have told them the truth.
3. `CreateIncidentInput` has a `status` field, and an administrator can set it to `PUBLISH`.
   Lesson 06.2 writes a custom mutation that ignores that field entirely. Explain why removing
   the field from the input type is *not* the fix.
4. This course installs no CORS plugin. State the architectural property that makes CORS
   unnecessary, and then name the one thing this property does **not** protect you from.
5. `users_can_register` is `0` and the built-in `registerUser` mutation is refused. Give two
   distinct problems that turning it on would create, one about roles and one about attack
   surface.

## Learn More

- [WPGraphQL — Mutations](https://www.wpgraphql.com/docs/wpgraphql-mutations) — the mutation
  reference. For how consistent the Relay convention is, skim the input types in your own generated
  `schema.graphql` rather than these docs, which no longer describe it
- [GraphQL spec — Errors](https://spec.graphql.org/October2021/#sec-Errors) — the normative
  answer to "why is this a 200?", including why `data` and `errors` may both be present
- [Relay input object mutations](https://relay.dev/docs/guides/graphql-server-specification/#mutations) —
  where `input` and `clientMutationId` come from, and why every WPGraphQL mutation has them
- [`register_graphql_mutation()`](https://www.wpgraphql.com/functions/register_graphql_mutation/) —
  read this before Lesson 06.2 so the custom mutations are not a surprise
- [WPGraphQL JWT Authentication](https://github.com/wp-graphql/wp-graphql-jwt-authentication) —
  the `login` mutation you used in Verification check 3, covered properly in Module 15
- [OWASP — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) — the
  category that "a mutation with no capability check" falls into; worth reading once
