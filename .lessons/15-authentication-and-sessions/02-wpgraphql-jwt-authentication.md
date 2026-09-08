---
title: 'WPGraphQL JWT Authentication'
module: 15
lesson: 2
teaches: [wpgraphql-jwt, bearer-authorization, app-token, secret-separation, hash-equals]
produces: ['wordpress-headless/.env.example', 'next-app/.env.example', 'next-app/src/graphql/auth.graphql']
requires: [10.1, 15.1]
---

# Lesson 15.2 — WPGraphQL JWT Authentication

## Quick Overview

Install and configure **WPGraphQL JWT Authentication**, and WordPress gains three things: a
`login` mutation that trades a username and password for a signed token pair, a
`refreshJwtAuthToken` mutation that trades a long-lived refresh token for a fresh short-lived
one, and the ability to authenticate any GraphQL request that arrives with an
`Authorization: Bearer <jwt>` header. That is the whole surface. Everything else in this module
is you deciding where that token is allowed to live and who is allowed to trust it.

The configuration has one non-obvious requirement and one genuine trap. The requirement is that
`GRAPHQL_JWT_AUTH_SECRET_KEY` must be a value that appears nowhere else — in particular it must
differ from `AUTH_KEY`, for the blast-radius reason spelled out in
[appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key).
The trap is the second credential you add in this lesson: `BTT_APP_TOKEN`, which identifies
**the Next.js application** rather than any human, travels in `X-BTT-App-Token`, and exists
because `registerDeveloper` and `submitHobtLead` have to be callable when there is no logged-in
user at all. A user JWT and an app token are not interchangeable, and code that substitutes one
for the other frequently still returns `200`. You will build both, and you will build the check
that compares the app token with `hash_equals()` rather than `==`, so that a wrong guess cannot
be narrowed down by timing the response.

By the end of this lesson you will have:

- WPGraphQL JWT Authentication installed, with nine independent secrets generated and
  `GRAPHQL_JWT_AUTH_SECRET_KEY` verifiably different from `AUTH_KEY`
- `wordpress-headless/.env.example` and `next-app/.env.example` extended with `BTT_APP_TOKEN` /
  `WP_APP_TOKEN` as `__CHANGE_ME__` placeholders, and the real values only in gitignored files
- A working `login` mutation returning `authToken`, `refreshToken` and a `user` payload, proven
  from `curl` and from GraphiQL
- `next-app/src/graphql/auth.graphql` holding the `Login`, `RefreshToken` and `Viewer` documents,
  typed by codegen
- An app-token guard in PHP that rejects a missing or wrong `X-BTT-App-Token` with a constant-time
  comparison, plus a `curl` proof that a one-character-off token fails
- A `curl` transcript showing the same `viewer` query returning `null` anonymously and a real
  user with a Bearer token

## Classic WP Analogy

`wp-login.php` is the closest thing you have already used. A form POSTs credentials, WordPress
calls `wp_authenticate()`, and on success `wp_set_auth_cookie()` issues a cookie that is
validated on every subsequent request. The `login` mutation is that endpoint with the HTML
stripped off: same `wp_authenticate()` underneath, same filters, same failed-login hooks — but
instead of a `Set-Cookie` header it hands back a string, and it hands it to a *server*, not a
browser.

The application token has an analogy too, and it is one most WordPress developers have used
without naming: **Application Passwords**. Core's Application Passwords exist for exactly this
situation — a script that needs to call the REST API when nobody is sitting at a keyboard. They
are a machine credential, sent in a header, revocable independently of the user's password.
`BTT_APP_TOKEN` occupies the same slot in this architecture, with one deliberate difference:
core's Application Passwords are still *scoped to a user*, whereas the app token is scoped to
the *application* and grants only the two specific mutations that the app is allowed to perform
with no user present.

**Where the analogy breaks down:** the WordPress cookie is issued *to the browser* and the
browser is expected to keep presenting it, so a compromise of the browser is a compromise of the
session and nothing more. The JWT here is issued to your **server**, and the app token is a
credential your server holds permanently. That inverts the threat model. In Classic WordPress the
scariest place a credential can end up is a user's machine; in this stack the scariest place is
the client bundle — because a secret that reaches JavaScript has not leaked to one attacker, it
has been published to everyone who loads the page. That asymmetry is why `WP_APP_TOKEN` may
never take a `NEXT_PUBLIC_` prefix and why Lesson 09.5's `grep` over `.next/static/` becomes a
CI gate in Module 24.

The second break: WordPress validates its own cookie, so there is exactly one authority and no
question about who checks what. Here there are two runtimes, and the token is verified by
**WordPress only**. Next.js never holds `GRAPHQL_JWT_AUTH_SECRET_KEY` and therefore *cannot*
verify a token even if you wanted it to — which is the point, and which Lesson 15.5 makes into a
rule.

---

## Key Concepts

### 1. What the plugin adds, and how to confirm it rather than trust it

**WPGraphQL JWT Authentication** adds exactly three things and nothing else. It is a small plugin
and that is a feature.

| Addition | Kind | What it does |
|---|---|---|
| `login( input: LoginInput! )` | mutation | `username` + `password` in, a signed token pair plus a `User` node out. Calls `wp_authenticate()` underneath. |
| `refreshJwtAuthToken( input: … )` | mutation | a long-lived refresh token in, a fresh short-lived `authToken` out. No password. |
| `Authorization: Bearer <jwt>` recognition | request filter | on **every** GraphQL request, so `viewer`, `createIncident` and everything else resolve as that user |

It also decorates `User` with `jwtAuthToken`, `jwtRefreshToken`, `jwtUserSecret` and
`jwtAuthExpiration`. This course selects none of them: a query result containing a credential is a
credential in whatever holds query results.

Payload field names are what your documents depend on, so **verify them against the release you
installed**, not against any table or blog post:

```bash
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"LoginPayload\"){ fields { name } } }"}' | jq -r '.data.__type.fields[].name'
```

From `LoginPayload` this course selects `authToken`, `refreshToken` and
`user { id databaseId name roles { nodes { name } } }`. From `RefreshJwtAuthTokenPayload` it
selects `authToken` and **only** `authToken` — a refresh does not re-issue a refresh token.

> **`User.roles` is capability-gated inside WPGraphQL, and it will surprise you.** It resolves
> only for a caller who can `list_users`, so an `incident_reporter` asking for its *own* roles can
> get an empty connection. Not a bug to work around: it is why Lesson 15.4 treats `roles` as
> **display data with no authority** and why no guard here decides anything from it.

### 2. Two clocks, and the shorter one wins

Two independent expiry mechanisms owned by different parties, and almost every "my session drops
after five minutes" question is a failure to separate them.

| Clock | Set by | Enforced by | Value in this app |
|---|---|---|---|
| The token's `exp` claim | WordPress, when it signs | **WordPress**, on every verification | 300 s for `btt_at` |
| The cookie's `Max-Age` | `src/lib/auth/cookies.ts` (Lesson 15.4) | **the browser**, which stops sending it | 300 s for `btt_at`, 30 d for `btt_rt` |

```
   MAX-AGE shorter than EXP              EXP shorter than MAX-AGE
   ────────────────────────────          ────────────────────────────
   browser forgets the cookie            browser keeps sending a cookie
   while the token is still valid        WordPress now refuses
   ⇒ user looks logged out, and          ⇒ every request fails auth until
     the token quietly outlives            something refreshes
     the session it belonged to          ⇒ THIS is the case to design for
```

Both are 300 seconds for `btt_at`, so there is one number to reason about. For `btt_rt` they
deliberately differ: the plugin's default refresh-token lifetime is very long — on the order of a
year in the releases this course was written against — and the cookie's 30-day `Max-Age` is what
actually bounds it for a browser. Say that plainly rather than believing the app enforces 30 days:
**WordPress would still accept that refresh token on day 200 if something presented it.** That is
a browser-side policy, not a server-side one, and it is a real limitation of this design.

The lifetimes come from filters whose names have moved between releases. Read them out of the copy
you pinned rather than from memory:

```bash
docker compose exec wordpress \
  grep -rn "apply_filters( 'graphql_jwt_auth" wp-content/plugins/wp-graphql-jwt-authentication/src/
```

The access-token default is **300 seconds**, exactly what
[appendix 04 §4](../appendix/04-env-reference.md#session-cookies) specifies, so this course adds
**no filter at all** — the correct configuration here is the absence of configuration. Verification
check 6 measures it; Task Step 3's callout gives the one-line filter if your release disagrees.


### 3. `GRAPHQL_JWT_AUTH_SECRET_KEY` is not `AUTH_KEY`, and the diagram is the argument

Lesson 02.5 generated nine independent 64-character secrets, the ninth being the JWT signing key.
If you were tempted to reuse `AUTH_KEY` and save a line, here is what that line costs:

```
   SEPARATE KEYS                              ONE SHARED KEY
   ─────────────────────────────────────      ─────────────────────────────────────
   AUTH_KEY ──▶ wordpress_logged_in_*         AUTH_KEY ──▶ wordpress_logged_in_*
                (wp-admin sessions)                    └──▶ GraphQL API tokens

   GRAPHQL_JWT_… ──▶ API tokens               a leak of the API-layer key now
                                              also forges wp-admin cookies
   an API-layer leak forges API tokens        ⇒ an API bug is an ADMIN compromise
   ⇒ blast radius: the API                    ⇒ blast radius: everything
```

The argument is written up once, in
[appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key);
this lesson's job is to **prove** the two values differ. Task Step 2 does that with a one-line
comparison inside WordPress, because eyeballing two 64-character random strings is exactly the
kind of check that passes when it should fail.

The same section carries a quieter property Lesson 15.4 turns into a design decision: **Next.js
does not hold this key at all** — not in either env file, as Lesson 15.1 Verification check 9
showed. So this application *cannot* verify a JWT locally, in any runtime.

### 4. `GRAPHQL_JWT_AUTH_CORS_ENABLE`, and why explicit-off beats default-off

One configuration switch beyond the signing key. It is off by default and you are going to set it
to `false` anyway. When **on** it does two things:

| Behaviour | Who it helps |
|---|---|
| Emits CORS headers on `/graphql` responses | a **browser** issuing a cross-origin GraphQL request |
| Returns the refresh token in an `X-JWT-Refresh` **response header** rather than only in the mutation payload | a **browser** that wants to read it from JavaScript |

Both serve a browser client talking directly to `/graphql`, and here **the browser never talks to
`/graphql`** — appendix 03 §8 records that WPGraphQL CORS is deliberately not installed for the
same reason. Neither can help you, and one hands a long-lived credential to JavaScript.

So why write a line that changes nothing? A default is somebody else's decision and can change in
a release; a `grep` finding a deliberate `false` tells the next reader "off" rather than "never
considered"; and `wp eval` can assert an explicit constant, while "not on by default" is not
testable at all.

> **A habit worth naming, because it costs one line and saves an argument.** Security-relevant
> defaults get written down **at the value you want**, even when that value is the default.
> `reactStrictMode: true` in `next.config.ts` (Lesson 09.1) is the same move, and so is
> `export const dynamic = 'force-dynamic'` on `/api/health` (Lesson 09.5) in a Next version where
> `GET` handlers are already uncached.

### 5. The two credentials, and why substituting them usually still returns 200

Exactly two credentials authenticate a caller to WordPress here, and they are not interchangeable.
**[Appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials) is the contract — read
its *represents / issued by / lifetime / transport / stored in / ever in a browser* table there,
not a second copy here.** Two additions: `verifyDeveloper` joins the app-token column, and the app
token itself was built in **Lesson 06.2** — you are verifying it, not writing it.

The sharper version is why this deserves a Key Concept rather than a table. Consider four ways of
getting the credential wrong:

| Mistake | What WordPress answers |
|---|---|
| App token sent where a user JWT is required | HTTP **200**, `errors: ["You must be signed in to submit an incident."]` |
| User JWT sent where the app token is required | HTTP **200**, `errors: ["Not authorized."]` |
| App token sent **in addition to** a valid user JWT | HTTP **200**, and the mutation **works** — the extra header is ignored |
| App token used to call a *read* query | HTTP **200**, and the query **works**, anonymously, because reads are public |

Three of those four are a `200` and two carry real data. There is no status code to alert on, no
exception to catch, and no failing test unless someone wrote one. **The danger is not that
substitution breaks loudly; it is that it frequently does not break at all.** A call site that
reaches for the app token because "it always works" has turned a per-user operation into an
application-wide one, and an auditor finds out first.

### 6. The `Credential` union: making the substitution a compile error

Not vigilance, and not a code-review checklist item: a type. Lesson 10.1 typed
`fetchGraphQLAuthed`'s third parameter `token: string`, and since both credentials are strings the
type system had no opinion about which one arrived. This lesson replaces it with a discriminated
union:

```ts
// next-app/src/lib/graphql/client.ts — (illustration; the Task writes the real edit)
export type Credential =
  | { readonly kind: 'user'; readonly jwt: string }
  | { readonly kind: 'app' };
```

Read the second member twice. **`kind: 'app'` carries no token** — the function reads
`WP_APP_TOKEN` itself, which buys three properties a `string` parameter cannot have:

| Property | Consequence |
|---|---|
| An app token can never arrive from a call site | so it can never arrive from a request, a form field, a query parameter, or a client component that was handed one by mistake |
| There is exactly one line in the codebase that reads `WP_APP_TOKEN` | so "where does the app token come from?" is a one-line answer, and rotation touches one place |
| Passing a JWT where the app token belongs does not type-check | `{ kind: 'app', jwt: userJwt }` is an excess-property error; `{ kind: 'user' }` is missing `jwt` |

At the call site, `fetchGraphQLAuthed(doc, vars, token)` becomes
`fetchGraphQLAuthed(doc, vars, { kind: 'user', jwt: token })`, and the app-token variant becomes
`{ kind: 'app' }` with no token to pass. Before this edit, substitution was a runtime `200`. After
it, substitution is a compile error.

Two things do **not** change, and both are load-bearing: `cache: 'no-store'` stays hard-coded and
there is still **no options parameter**, so no caller can put an authenticated response into the
shared Data Cache. Lesson 15.5 comes back to it and Module 18 depends on it.

> **This lesson edits `src/lib/graphql/client.ts` and does not claim it in `produces:`.** Lesson
> 10.1 owns that file. `Credential` is a cross-module contract: Lesson 15.4's session reads and
> every Server Action in Module 16 pass it.

### 7. An authenticated call has no meaningful partial response

Lesson 10.4 §3 chose Option B for responses carrying **both** `data` and `errors`: throw only
when `data` is null or absent, otherwise log the `errors` array and render what arrived. That was
argued from proportionality and the argument was good — for reads. It is wrong for a write, and
the reason is one sentence: **a page has a 95% it can still render; a mutation does not.**

A WPGraphQL mutation field is nullable, so a `UserError` thrown in `mutateAndGetPayload` looks
like this on the wire:

```json
{
  "data": { "createIncident": null },
  "errors": [{ "message": "You are not allowed to submit incidents." }]
}
```

`data` is a **non-null object**, so under Option B `execute()` logs and returns, and the caller
gets `{ createIncident: null }` with no reason attached. Module 16's five-step skeleton says
*step 4: surface WordPress's error, because WordPress is the authority* — and it cannot, because
the reason went to a log the browser will never see.

So `execute()` gains one parameter and each public function chooses for itself:

`fetchGraphQL` passes `'partial'` and keeps Option B: its typical partial is one ACF sub-field a
plugin could not resolve, a gap in a page that is still 95% useful. `fetchGraphQLAuthed` passes
`'strict'` and takes Option A — **any** `errors` entry throws, because it has no typical partial
and a null field means the operation was refused. Neither exposes the policy at its call site.

The caller then does what Lesson 10.4 built `errors.ts` for: `catch`, `isGraphQLRequestError()`,
`formatGraphQLErrors()`, render WordPress's own sentence. That is why `GraphQLRequestError`
carries the `errors` array rather than a flattened string.

> **The policy is chosen by the function, not passed in by the caller.** Same argument as the
> hard-coded `cache: 'no-store'`: `fetchGraphQLAuthed` still takes **no options parameter**, so no
> call site can quietly opt an authenticated write back into Option B. The word `'strict'` appears
> exactly once in the codebase, and Verification check 17 asserts it.

### 8. `hash_equals()` versus `==`, and how many requests a timing oracle costs

Lesson 06.2 Key Concept 7 already wrote `require_app_token()` with `hash_equals()`. This lesson
re-proves it over HTTP rather than rebuilding it, because the reasoning generalises to every
secret comparison you will ever write.

```
$provided == $expected             ❌  returns on the first differing byte
$provided === $expected            ❌  strict about type, still returns early
hash_equals($expected, $provided)  ✅  constant time for equal-length strings
```

`==` and `===` on strings are memcmp underneath and stop as soon as two bytes differ, so the
**time taken encodes how many leading bytes were correct.** Turn that into an attack:

Send 64 tokens, each guessing a different value for byte 1; one comes back measurably slower and
byte 1 is known. Fix it, guess byte 2 the same way. One byte per round, 64 candidates per byte, 48
bytes — a few thousand requests **per character** to average out jitter, so tens of thousands
overall. That is minutes of traffic against an endpoint with no rate limit, and it converts
"guessing a 48-character token is impossible" into "guessing it is an afternoon".

Two rules travel with it, both already honoured in `includes/graphql/app-token.php`. **The known
value goes first** — `hash_equals( $expected, $provided )` is the documented order and it matters
for the length shortcut. And **an unset `BTT_APP_TOKEN` must fail closed**: `hash_equals( '', '' )`
is `true`, so a server that forgot the variable would authenticate everyone, which is why Lesson
06.2's guard throws on an empty expected value before it ever compares.

### 9. The password hash never leaves WordPress, and your security plugins still work

The `login` mutation is `wp-login.php` with the HTML removed, and that throwaway comparison has
two consequences people are surprised by.

**First: no password material crosses the boundary.** The Server Action forwards the plaintext
password once, server to server, in the mutation variables; WordPress hashes and compares. What
crosses back is `authToken`, `refreshToken` and a few public `User` fields. What never crosses is
the hash, the password, the salt, the algorithm and the cost factor — `wp_users.user_pass` is not
selected by any field in the schema.

**Second, the useful part: every `wp_authenticate` filter still fires.** The plugin does not
reimplement authentication — it calls `wp_authenticate()` and signs a token if the result is a
`WP_User`. So a lockout plugin's failed-attempt counter still works (it hooks `wp_login_failed`),
`authenticate` filters that block by IP still run, two-factor plugins that reject at the
`authenticate` stage still reject, and `wp_login` still fires for your audit log.

That is the strongest argument against the alternative — a custom `loginDeveloper` mutation
reading `wp_users` and calling `wp_check_password()` yourself. Forty lines, plausible-looking, and
it silently bypasses all four.

> **What it does not give you is rate limiting.** `wp_login_failed` fires on the attempt, but
> nothing throttles the *endpoint*, and a lockout plugin keyed on wp-login form submissions may
> not see a GraphQL mutation at all. So brute force is throttled on the **Next side**, in the
> `login` Server Action — an in-memory stopgap in Lesson 15.4, an Upstash limiter in 16.2. Do not
> assume it is handled because WordPress "has plugins for that".

### 10. What this plugin does not give you

Four absences, so you stop looking for them and start planning for them.
**No revocation list** — a signed token is valid until `exp`, so there is no "log out this
device"; Task Step 8's salt rotation is the only brake. **No per-device sessions** — that needs
server-side state, which is the thing statelessness bought us, and this course never builds it.
**No refresh-token rotation** — `refreshJwtAuthToken` returns a new `authToken` and not a new
`refreshToken`, so a stolen refresh token stays valid; Lesson 15.4 states that cost plainly. **No
rate limiting** — Lesson 15.4's stopgap, then Lesson 16.2.

The honest summary: this plugin is a **credential issuer and a request authenticator**, good at
both, and not a session manager. Every session-management feature you want either lives in
`next-app/src/lib/auth/` (Lesson 15.4) or does not exist, and knowing which before you write the
cookie code is the difference between a design and a pile of workarounds.

---

## Task

Read [appendix 04 §9](../appendix/04-env-reference.md#9-which-module-introduces-what) first.
`GRAPHQL_JWT_AUTH_SECRET_KEY`, `BTT_APP_TOKEN` and `includes/graphql/app-token.php` with its
`hash_equals()` comparison **already exist** (Lessons 02.5 and 06.2). This lesson installs the
plugin, adds two variables, writes three GraphQL documents, edits one TypeScript file, and
**verifies** everything else.

### Step 1: Install the plugin from a pinned release zip

WPGraphQL JWT Authentication is **not** in the WordPress.org directory, so
`wp plugin install wp-graphql-jwt-authentication` fails. It ships as a GitHub release asset,
exactly like WPGraphQL Content Blocks in Lesson 14.1. Open
<https://github.com/wp-graphql/wp-graphql-jwt-authentication/releases>, note the current tag, and
install that tag rather than a branch. **Check that the tag you pick actually has a `.zip`
attached** — `v0.7.0` and everything before `v0.7.1` were tagged with no release asset at all, so
their download URLs are a 404 rather than a plugin:

```bash
cd wordpress-headless

# Pin the TAG. A URL ending in /heads/main.zip is not a version, it is a moving target,
# and Module 24 cannot reproduce a build from it.
docker compose run --rm wpcli wp plugin install \
  https://github.com/wp-graphql/wp-graphql-jwt-authentication/releases/download/v0.7.2/wp-graphql-jwt-authentication.zip \
  --activate

docker compose run --rm wpcli wp plugin get wp-graphql-jwt-authentication --field=version
```

**Verify §1:**

- [ ] `wp plugin list --status=active --field=name` includes `wp-graphql-jwt-authentication` and
      the printed version matches your tag. A different tag is fine — record it in the commit.
- [ ] `docker compose logs --tail=40 wordpress` shows no fatal. The plugin needs WPGraphQL and
      deactivates itself with a notice if WPGraphQL is missing.

### Step 2: Prove the signing secret is set, long enough, and not `AUTH_KEY`

Three assertions, none of which prints a secret. Comparing two 64-character random strings by eye
is a check that passes when it should fail.

```bash
docker compose run --rm wpcli wp eval '
  $ok  = defined( "GRAPHQL_JWT_AUTH_SECRET_KEY" ) && "" !== GRAPHQL_JWT_AUTH_SECRET_KEY;
  $len = $ok ? strlen( GRAPHQL_JWT_AUTH_SECRET_KEY ) : 0;
  printf( "defined:   %s\n", $ok ? "yes" : "NO — see Lesson 02.5" );
  printf( "length:    %d %s\n", $len, $len >= 64 ? "(ok)" : "(TOO SHORT — regenerate)" );
  printf( "vs AUTH_KEY: %s\n",
    ( $ok && GRAPHQL_JWT_AUTH_SECRET_KEY !== AUTH_KEY ) ? "different (correct)" : "IDENTICAL — regenerate one" );
'
```

**Verify §2:**

- [ ] `defined: yes`, `length: 64 (ok)`, `vs AUTH_KEY: different (correct)`. `IDENTICAL` means
      stop and fix it now, before there are sessions to invalidate.
- [ ] You did **not** run `wp config get GRAPHQL_JWT_AUTH_SECRET_KEY` — it prints the value into
      your shell history. If you did,
      [regenerate](../appendix/04-env-reference.md#generating-the-eight-salts-plus-the-jwt-secret) it.

### Step 3: Turn CORS explicitly off, in all three places it has to agree

The variable, the tracked example, and the `define()` that turns the variable into the constant
the plugin reads. All three, or you have documented an intention rather than made a decision.

```bash
git check-ignore -v .env
# Expected: a .gitignore rule. NO OUTPUT MEANS STOP.

printf 'GRAPHQL_JWT_AUTH_CORS_ENABLE=false\n' >> .env
```

Add the same name to the tracked example. Not a secret, so it gets its real value:

```dotenv
# wordpress-headless/.env.example — append to the GraphQL section

# Lesson 15.2. Explicitly OFF. When on, WPGraphQL JWT Authentication emits CORS
# headers and returns the refresh token in an X-JWT-Refresh RESPONSE header —
# both of which only help a browser client, and the browser never reaches
# /graphql in this app (appendix 03 §8). Written down at the value we want so a
# future reader can tell "off" from "never considered".
GRAPHQL_JWT_AUTH_CORS_ENABLE=false
```

Then the `define()`, in the file Lesson 02.4 wrote, immediately after the
`GRAPHQL_JWT_AUTH_SECRET_KEY` line so the two JWT constants sit together:

```php
// wordpress-headless/wp-config.php — section 2, after GRAPHQL_JWT_AUTH_SECRET_KEY
// Lesson 15.2. btt_env_bool() from the top of this file: FILTER_VALIDATE_BOOLEAN,
// defaulting to false when the variable is absent. Explicitly off — Key Concept 4.
define( 'GRAPHQL_JWT_AUTH_CORS_ENABLE', btt_env_bool( 'GRAPHQL_JWT_AUTH_CORS_ENABLE', false ) );
```

The container reads `.env` at start, so a new variable needs a recreate, not a restart:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate wordpress
docker compose run --rm wpcli wp eval \
  'echo defined("GRAPHQL_JWT_AUTH_CORS_ENABLE") ? var_export(GRAPHQL_JWT_AUTH_CORS_ENABLE, true) . PHP_EOL : "UNDEFINED" . PHP_EOL;'
```

**Verify §3:**

- [ ] The output is `false` — the boolean, not the truthy string `'false'`, which would turn the
      feature **on**. `UNDEFINED` means you edited `.env` but not `wp-config.php`, or did not
      recreate the container.
- [ ] `diff <(grep -oE '^[A-Z_]+=' .env | sort) <(grep -oE '^[A-Z_]+=' .env.example | sort)` prints
      nothing — the invariant Lesson 02.5 Verification check 7 established.

> **If your pinned release's access-token lifetime is not 300 seconds.** Verification check 6
> measures it. If `exp - iat` is not `300`, add `includes/graphql/jwt.php` containing
> `add_filter( 'graphql_jwt_auth_expire', static fn( $exp, $issued ) => $issued + 300, 10, 2 );`
> in the `Blame\Core` namespace and register it in `Plugin::INCLUDES` the way Lesson 06.2 Step 6
> registered the mutations. In the releases this course was written against the default is already
> 300, which is why the filter is a remedy in a callout rather than a step in the Task.

### Step 4: Mirror the app token into the Next.js environment

`BTT_APP_TOKEN` exists on the WordPress side with a real value (Lesson 06.2 Step 7). Next needs
the **same** value under the name
[appendix 04 §3.1](../appendix/04-env-reference.md#31-server-only-no-prefix) assigns it,
`WP_APP_TOKEN`. Copy it rather than typing it, so the two cannot drift.

```bash
cd ../next-app

git check-ignore -v .env.local
# Expected: a .gitignore rule. NO OUTPUT MEANS STOP.

# Read the value out of the WordPress env file and append it under the Next name.
# No echo, no clipboard, no scrollback.
printf 'WP_APP_TOKEN=%s\n' \
  "$(grep -E '^BTT_APP_TOKEN=' ../wordpress-headless/.env | cut -d= -f2-)" >> .env.local

# Assert it arrived, WITHOUT printing it.
grep -q '^WP_APP_TOKEN=.\{40,\}$' .env.local && echo 'WP_APP_TOKEN present' || echo 'MISSING OR SHORT'
```

The tracked example gets the name and a placeholder, never the value:

```dotenv
# next-app/.env.example — append to the shared-secrets section

# Lesson 15.2. Mirrors BTT_APP_TOKEN in wordpress-headless/.env — the SAME value
# under a different name, because the name says who holds it. Identifies the
# APPLICATION, not a user (appendix 04 §4). Read only by
# src/lib/graphql/client.ts, only for Credential { kind: 'app' }.
# NEVER NEXT_PUBLIC_. There is no such thing as a public app token.
WP_APP_TOKEN=__CHANGE_ME__
```

**Verify §4:**

- [ ] `WP_APP_TOKEN present`, and the two values are byte-identical:
      `[ "$(grep -E '^WP_APP_TOKEN=' .env.local | cut -d= -f2-)" = "$(grep -E '^BTT_APP_TOKEN=' ../wordpress-headless/.env | cut -d= -f2-)" ] && echo match`.
- [ ] `git status --short` lists `.env.example` and **not** `.env.local`, and
      `grep -c '__CHANGE_ME__' .env.example` went up by exactly one.

### Step 5: Log in, from `curl` and from GraphiQL

The seeded `reporter` account exists (Lesson 04.5) and its password came from a shell session that
closed weeks ago. Set a new one **in this session only**:

```bash
cd ../wordpress-headless

export BTT_REPORTER_PASSWORD="$(openssl rand -base64 24)"
docker compose run --rm wpcli wp user update reporter --user_pass="$BTT_REPORTER_PASSWORD" >/dev/null
echo 'password set for this shell session only'
```

Now trade it for a token pair. Note that the `username` field is carrying an **email address**:

```bash
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg p "$BTT_REPORTER_PASSWORD" '{
        query: "mutation Login($u:String!,$p:String!){ login(input:{username:$u,password:$p}){ authToken refreshToken user { databaseId name } } }",
        variables: { u: "reporter@blamethe.tech", p: $p }
      }')" | jq '.data.login | {user, authToken: (.authToken|.[0:24] + "…"), refreshToken: (.refreshToken|.[0:24] + "…")}'
```

> **`username` accepts an email because `wp_authenticate` does.** Core's
> `wp_authenticate_email_password` filter resolves it. That matters more than it looks:
> `registerDeveloper` (Lesson 06.2) derives a login like `alex3` from the email's local part and
> **never tells the user what it is**, so a form demanding a username would lock out every
> registered developer. Lesson 15.4's field is labelled "Email" and still called `username`.

Then run the same mutation in GraphiQL — `wp-admin` → **GraphQL** → **GraphiQL IDE**. Not for its
own sake: the Docs panel is where you read the real `LoginPayload` field list for the release you
pinned, and it is where you will look next time a payload field is named differently from what a
tutorial claimed.

**Verify §5:**

- [ ] The `curl` returned `authToken`, `refreshToken` and a `user.name` of `Sam Reporter`. A null
      `data.login` with an `errors` array means the password is wrong.
- [ ] GraphiQL's Docs panel for `LoginPayload` lists at least `authToken`, `refreshToken` and
      `user`. Write down anything it lists that this lesson did not mention.
- [ ] The password is in `BTT_REPORTER_PASSWORD` and nowhere else
      ([appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target)).

### Step 6: Write the three GraphQL documents

One new file, following Lesson 10.5's layout: documents in `src/graphql/`, one file per feature
area, operation names globally unique because codegen concatenates everything into one namespace.

```graphql
# next-app/src/graphql/auth.graphql
# Authentication operations. Consumed by src/lib/auth/ and src/actions/auth.ts
# (Lesson 15.4). Lesson 15.3 appends RegisterDeveloper and VerifyDeveloper here.
#
# The plugin also decorates User with jwtAuthToken / jwtRefreshToken /
# jwtUserSecret. NONE of them are selected anywhere in this app: a query result
# that contains a credential is a credential in whatever holds query results.

mutation Login($username: String!, $password: String!) {
  login(input: { username: $username, password: $password }) {
    authToken
    refreshToken
    user {
      id
      databaseId
      name
      # Capability-gated inside WPGraphQL: resolves only for a caller who can
      # list_users, so a reporter asking for its OWN roles may get an empty
      # connection. Selected for DISPLAY. Nothing in this app branches on it.
      roles {
        nodes {
          name
        }
      }
    }
  }
}

mutation RefreshToken($refreshToken: String!) {
  # Returns a new authToken and NOT a new refreshToken. The refresh token is not
  # rotated — Lesson 15.4 states that cost rather than hiding it.
  refreshJwtAuthToken(input: { jwtRefreshToken: $refreshToken }) {
    authToken
  }
}

query Viewer {
  # null for an anonymous caller. That null IS the authentication check: it is
  # WordPress verifying the signature, the expiry and the user row, which is the
  # only party that can. getSession() in Lesson 15.4 is a wrapper around it.
  viewer {
    id
    databaseId
    name
    roles {
      nodes {
        name
      }
    }
  }
}
```

**Verify §6:** three operations named `Login`, `RefreshToken` and `Viewer` — the names codegen
turns into `LoginDocument`, `RefreshTokenDocument` and `ViewerDocument`, imported by exactly those
names in Lessons 15.3 to 15.5 — and **no** `jwtAuthToken`, `jwtRefreshToken` or `jwtUserSecret`
selection anywhere in the file.

### Step 7: Edit `client.ts` for the `Credential` union, then regenerate

Three anchored edits: `execute()` gains the policy parameter from Key Concept 7, `fetchGraphQL`
passes `'partial'`, and `fetchGraphQLAuthed` becomes the `Credential` version that passes
`'strict'`. Nothing else changes — same `operationNameOf()`, same `import 'server-only'`.

```ts
// next-app/src/lib/graphql/client.ts — 1 of 3: the response policy in execute()
// Replace the partial-response block Lesson 10.4 added with a policy the CALLER
// of execute() chooses. Nothing about Option B changes for public reads.
type ErrorPolicy = 'partial' | 'strict';

async function execute<TResult>(
  operationName: string,
  body: string,
  init: RequestInit,
  policy: ErrorPolicy
): Promise<TResult> {
  // …transport handling unchanged from Lesson 10.1/10.4…

  const hasErrors = parsed.errors !== undefined && parsed.errors.length > 0;
  const hasData = parsed.data !== undefined && parsed.data !== null;

  // OPTION A, for authenticated calls: ANY errors entry throws, even alongside
  // data. A refused mutation is `data: { createIncident: null }` WITH an errors
  // array, and the caller must be able to show WordPress's own sentence.
  // Lesson 15.2 §7.
  if (hasErrors && policy === 'strict') {
    throw new GraphQLRequestError(operationName, response.status, parsed.errors ?? []);
  }

  // OPTION B, for public reads: unchanged from Lesson 10.4 Key Concept 3.
  if (hasErrors && !hasData) {
    throw new GraphQLRequestError(operationName, response.status, parsed.errors ?? []);
  }
  if (hasErrors) {
    console.error(
      new GraphQLRequestError(operationName, response.status, parsed.errors ?? []).toString()
    );
  }
  if (!hasData) {
    throw new GraphQLRequestError(operationName, response.status, [
      { message: 'the response contained neither data nor errors' },
    ]);
  }
  return parsed.data;
}
```

```ts
// next-app/src/lib/graphql/client.ts — 2 of 3: fetchGraphQL keeps Option B
// The ONLY change to this function is the fourth argument to execute().
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      next: nextOptions(options),
    },
    'partial'
  );
```

```ts
// next-app/src/lib/graphql/client.ts — 3 of 3: the Credential union and Option A
/**
 * WHICH credential is calling. A discriminated union rather than a `string`,
 * because both credentials ARE strings and substituting one for the other
 * usually still returns HTTP 200 (Lesson 15.2 §5).
 *
 * `kind: 'app'` deliberately carries NO token: this function reads WP_APP_TOKEN
 * from the environment itself. So an app token can never arrive from a call
 * site — and therefore never from a request, a form field, a query parameter,
 * or a client component that was handed one by accident. Appendix 04 §4.
 */
export type Credential =
  | { readonly kind: 'user'; readonly jwt: string }
  | { readonly kind: 'app' };

/**
 * The only place in this application that reads WP_APP_TOKEN **for a GraphQL
 * call**. Lesson 17.2 adds a second reader for the REST preview exchange, and
 * replaces this invariant with a checkable one: `grep -rn 'WP_APP_TOKEN' src/`
 * must name exactly two files.
 */
function credentialHeaders(credential: Credential): Record<string, string> {
  if (credential.kind === 'user') {
    return { Authorization: `Bearer ${credential.jwt}` };
  }

  const appToken = process.env.WP_APP_TOKEN;

  // Fail CLOSED. A misconfigured deployment must refuse the call, not send an
  // empty header and let WordPress decide — hash_equals('', '') is true, and
  // Lesson 06.2's guard is the only reason that is not exploitable there.
  if (appToken === undefined || appToken === '') {
    throw new Error(
      'WP_APP_TOKEN is not set. Copy it from wordpress-headless/.env — Lesson 15.2 Step 4.'
    );
  }

  return { 'X-BTT-App-Token': appToken };
}

/**
 * Authenticated calls. `cache: 'no-store'` is written HERE, not passed in, and
 * there is still no options parameter — so no caller can put an authenticated
 * response into the shared Data Cache. Lesson 15.5 §10 and Module 18 both rely
 * on that being unrepresentable rather than merely discouraged.
 */
export function fetchGraphQLAuthed<TResult, TVariables extends Record<string, unknown>>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  credential: Credential
): Promise<TResult> {
  return execute<TResult>(
    operationNameOf(document),
    JSON.stringify({ query: print(document), variables }),
    {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...credentialHeaders(credential),
      },
    },
    // OPTION A. The word 'strict' appears exactly once in the codebase, and it
    // appears HERE rather than in a parameter, so no call site can opt an
    // authenticated write back into Option B. Lesson 15.2 §7.
    'strict'
  );
}
```

The schema changed, so refresh the committed contract and then the types, in that order:

```bash
cd ../next-app

npm run schema:pull
git diff --stat ../wordpress-headless/schema.graphql
# Review the diff. You should see LoginInput, LoginPayload, RefreshJwtAuthToken*
# and the jwt* fields on User appear — and nothing else. A schema diff is a
# contract change and gets read like one.

npm run codegen
npm run type-check
```

**Verify §7:**

- [ ] The `schema.graphql` diff adds JWT types and nothing else, committed from
      `wordpress-headless/`, never from `next-app/`.
- [ ] `npm run type-check` is silent. `fetchGraphQLAuthed` had **no call sites** before this
      lesson, which is why the signature change is free today and would not be in Module 16.
- [ ] `grep -c "'strict'" src/lib/graphql/client.ts` is `1` and no call site passes a policy.
- [ ] `git add ../wordpress-headless/schema.graphql src/gql/ src/graphql/ src/lib/graphql/client.ts`
      then commit — `codegen:check` only means anything after `src/gql/` is committed.

### Step 8: Write the two credentials down, and the rotation procedure

Two short notes. First, the credential boundary, into the API contract you have been growing
since Lesson 06.3:

```markdown
<!-- docs/api-contract.md — append -->

## The two credentials (Lesson 15.2)

| | User JWT | Application token |
|---|---|---|
| Represents | one human | the Next.js application |
| Header | Authorization: Bearer <jwt> | X-BTT-App-Token: <token> |
| Lifetime | 300 s (refreshed via btt_rt) | until rotated |
| Used by | viewer, createIncident | registerDeveloper, verifyDeveloper, submitHobtLead, /preview/verify |
| Held by | the browser, as opaque cookie bytes | the servers only, never a browser |

**Substitution is not loud.** An app token sent where a user JWT belongs returns HTTP 200 with
an `errors` array; sent alongside a valid JWT it is ignored and the call succeeds. There is no
status code to alert on. That is why `fetchGraphQLAuthed`'s third parameter is the
discriminated union `Credential` and not a `string`: substitution is a compile error.

`Credential { kind: 'app' }` carries no token. `src/lib/graphql/client.ts` reads WP_APP_TOKEN
from the environment itself, so an app token cannot arrive from a call site.
```

Second, the rotation procedure. `docs/runbook.md` is new here; Module 24 extends it:

```markdown
<!-- docs/runbook.md -->

# Runbook

## Rotating GRAPHQL_JWT_AUTH_SECRET_KEY (Lesson 15.2)

**When:** suspected token theft, a leaked backup of wordpress-headless/.env, an
offboarded engineer who had production access, or on a schedule.

**Effect, stated before you do it:** every issued authToken and refreshToken stops verifying
immediately. Every logged-in public developer is signed out mid-action. Editors in wp-admin are
**not** affected, because their cookies are signed with AUTH_KEY, which is a different value —
that separation is the whole reason appendix 04 §5 insists on it.

**Steps**

1. Generate one new 64-character value:
   `openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64`
2. Replace GRAPHQL_JWT_AUTH_SECRET_KEY in wordpress-headless/.env. Change nothing else — the
   eight WordPress salts are a separate rotation with a much larger blast radius.
3. Recreate the container so it re-reads the file:
   `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate wordpress`
4. Assert, without printing: `wp eval 'echo GRAPHQL_JWT_AUTH_SECRET_KEY !== AUTH_KEY ? "ok" : "FAIL";'`
5. Log in again and confirm a fresh `login` returns a token and `viewer` resolves.
6. In production: `fly secrets set GRAPHQL_JWT_AUTH_SECRET_KEY=…`, which triggers a rolling
   restart. Nothing to change on the Vercel side — Next never held this value.

**What this does NOT fix:** a leaked BTT_APP_TOKEN. That is a separate value with a separate
rotation, and it must be changed in BOTH wordpress-headless/.env and next-app's WP_APP_TOKEN
in the same maintenance window, or every server-to-server mutation fails closed.

(Add your own note: what tells you rotation worked, from the outside, in under a minute?)
```

**Verify §8:**

- [ ] Both files exist and neither restates
      [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials)'s cookie table.
- [ ] You filled in the runbook's parenthesis. A procedure with no success signal is a procedure
      nobody trusts at 2 a.m.
- [ ] `git add docs/ && git commit -m "feat(auth): WPGraphQL JWT, the Credential union, rotation"`.

---

## Verification

```bash
cd wordpress-headless

# 0. Read the two credentials into THIS shell session only. Never into a dotfile.
export BTT_APP_TOKEN="$(grep -E '^BTT_APP_TOKEN=' .env | cut -d= -f2-)"
test -n "$BTT_APP_TOKEN" && echo 'app token loaded into this session' || echo 'MISSING — Lesson 06.2 Step 7'
# Expected: app token loaded into this session
#           A token in a shell variable is fine for five minutes of learning and is
#           NOT a storage strategy. It dies with this terminal, which is the point.

# 1. The plugin is active, and at the version you pinned
docker compose run --rm wpcli wp plugin get wp-graphql-jwt-authentication --field=status
# Expected: active
docker compose run --rm wpcli wp plugin get wp-graphql-jwt-authentication --field=version
# Expected: the tag from the URL in Step 1 — 0.7.2 unless you pinned a newer one. If this
#           errors instead, the download 404'd: the tag you chose has no asset attached.

# 2. It added exactly the two mutations and nothing surprising
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"RootMutation\"){ fields { name } } }"}' \
  | jq -r '.data.__type.fields[].name' | grep -cE '^(login|refreshJwtAuthToken)$'
# Expected: 2

# 3. The signing secret: set, 64 chars, and NOT AUTH_KEY. Asserted, never printed.
docker compose run --rm wpcli wp eval '
  printf("%s %d %s\n",
    defined("GRAPHQL_JWT_AUTH_SECRET_KEY") ? "defined" : "MISSING",
    defined("GRAPHQL_JWT_AUTH_SECRET_KEY") ? strlen(GRAPHQL_JWT_AUTH_SECRET_KEY) : 0,
    GRAPHQL_JWT_AUTH_SECRET_KEY !== AUTH_KEY ? "different" : "IDENTICAL");'
# Expected: defined 64 different

# 4. CORS is explicitly OFF — the boolean false, not the truthy string 'false'
docker compose run --rm wpcli wp eval \
  'echo defined("GRAPHQL_JWT_AUTH_CORS_ENABLE") ? var_export(GRAPHQL_JWT_AUTH_CORS_ENABLE, true) . PHP_EOL : "UNDEFINED\n";'
# Expected: false

# 5. login returns a token pair. Set a session password first — the seeded one is long gone.
export BTT_REPORTER_PASSWORD="$(openssl rand -base64 24)"
docker compose run --rm wpcli wp user update reporter --user_pass="$BTT_REPORTER_PASSWORD" >/dev/null

LOGIN_JSON=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg p "$BTT_REPORTER_PASSWORD" '{
       query: "mutation Login($u:String!,$p:String!){ login(input:{username:$u,password:$p}){ authToken refreshToken user { databaseId name } } }",
       variables: { u: "reporter@blamethe.tech", p: $p } }')")

export JWT=$(echo "$LOGIN_JSON" | jq -r '.data.login.authToken')
export RT=$(echo "$LOGIN_JSON"  | jq -r '.data.login.refreshToken')
echo "$LOGIN_JSON" | jq -r '.data.login.user.name'
# Expected: Sam Reporter
test -n "$JWT" -a "$JWT" != null && echo 'authToken captured' || echo 'NO TOKEN — check the password'
# Expected: authToken captured

# 6. MEASURE the access-token lifetime rather than believing a table
b64url_d() {
  local s="${1//-/+}"; s="${s//_//}"
  case $(( ${#s} % 4 )) in 2) s="$s==" ;; 3) s="$s=" ;; esac
  printf '%s' "$s" | openssl base64 -A -d
}
b64url_d "$(echo "$JWT" | cut -d. -f2)" | jq -r '"exp - iat = \(.exp - .iat) s   user = \(.data.user.id)"'
# Expected: exp - iat = 300 s   user = <the reporter's ID>
#           Not 300? See the callout in Task Step 3 before continuing.

# 7. viewer with the Bearer header resolves the real user
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -d '{"query":"query Viewer { viewer { databaseId name } }"}' | jq -c '.data.viewer'
# Expected: {"databaseId":<id>,"name":"Sam Reporter"}

# 8. NEGATIVE — the SAME query anonymously resolves to null, with no error
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query Viewer { viewer { databaseId name } }"}' | jq -c '.data.viewer, (.errors // "no errors")'
# Expected: null  then  "no errors"
#           That null IS the authentication check. WordPress verified the absence of a
#           signature. Next.js could not have reached this conclusion by itself.

# 9. refreshJwtAuthToken trades the refresh token for a FRESH access token
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg rt "$RT" '{
       query: "mutation RefreshToken($rt:String!){ refreshJwtAuthToken(input:{jwtRefreshToken:$rt}){ authToken } }",
       variables: { rt: $rt } }')" | jq -r '.data.refreshJwtAuthToken.authToken | .[0:24] + "…"'
# Expected: a truncated token, different from the first 24 characters of $JWT

# 10. NEGATIVE — a garbage refresh token is refused, and the refusal arrives with HTTP 200
curl -s -o /tmp/btt-rt-bad.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation RefreshToken($rt:String!){ refreshJwtAuthToken(input:{jwtRefreshToken:$rt}){ authToken } }","variables":{"rt":"not-a-token"}}'
# Expected: HTTP 200
jq -e '.errors' /tmp/btt-rt-bad.json >/dev/null && echo 'errors present — refused' || echo 'NO ERRORS — investigate'
# Expected: errors present — refused
#           Read .errors, never the status code. Every GraphQL failure is a 200.

# 11. NEGATIVE — an app token one character off is refused, with no extra information
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: ${BTT_APP_TOKEN}X" \
  -d '{"query":"mutation{registerDeveloper(input:{email:\"probe152@example.test\",displayName:\"Probe\"}){accepted}}"}' \
  | jq -r '.errors[0].message'
# Expected: Not authorized.
#           hash_equals() (Lesson 06.2) — the timing is identical to a token that is
#           wrong in every byte, so the response leaks no prefix information.
docker compose run --rm wpcli wp user list --field=user_email | grep -c 'probe152@example.test'
# Expected: 0   — nothing was written

# 12. ...and the CORRECT app token is accepted, so check 11 proves something
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{registerDeveloper(input:{email:\"probe152@example.test\",displayName:\"Probe\"}){accepted email}}"}' \
  | jq -c '.data.registerDeveloper'
# Expected: {"accepted":true,"email":"probe152@example.test"}

# 13. NEGATIVE — THE CREDENTIALS ARE NOT INTERCHANGEABLE. An app token where a user
#     JWT is required is refused, and the refusal is a 200 with an errors array.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId}}}",
       "variables":{"i":{"title":"App token probe 152","scapegoatSlug":"dns","severitySlug":"s3-minor",
                         "occurredAt":"2024-06-01 09:00:00","downtimeMinutes":1,"environment":"STAGING"}}}' \
  | jq -r '.errors[0].message'
# Expected: You must be signed in to submit an incident.
#           The app token proves an APPLICATION. createIncident needs a HUMAN.
docker compose run --rm wpcli wp post list --post_type=incident --title='App token probe 152' --format=count
# Expected: 0

# 14. ...and the user JWT on the same mutation is accepted
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId status}}}",
       "variables":{"i":{"title":"JWT probe 152","scapegoatSlug":"dns","severitySlug":"s3-minor",
                         "occurredAt":"2024-06-01 09:00:00","downtimeMinutes":1,"environment":"STAGING"}}}' \
  | jq -c '.data.createIncident.incident'
# Expected: an object with a databaseId and status "pending" (some WPGraphQL versions
#           report "PENDING"). In NO case "publish" — Lesson 03.5 and Lesson 06.2.

# 15. NEGATIVE — Next holds no signing key, in either env file
cd ../next-app
grep -c 'GRAPHQL_JWT_AUTH_SECRET_KEY' .env.example
# Expected: 0
grep -c 'GRAPHQL_JWT_AUTH_SECRET_KEY' .env.local
# Expected: 0

# 16. NEGATIVE — every secret in the tracked example is a placeholder
grep -oE '^[A-Z_]+=' .env.example | tr -d '=' | tr '\n' ' '
# Expected: WP_GRAPHQL_ENDPOINT WP_REST_BASE WP_APP_TOKEN NEXT_PUBLIC_SITE_URL
#           NEXT_PUBLIC_DEFAULT_LOCALE  (order may differ)
grep -c '__CHANGE_ME__' .env.example
# Expected: 1   — WP_APP_TOKEN, the only secret in the file so far
grep -nE '=[A-Za-z0-9]{30,}' .env.example
# Expected: no output. A hit means a real value reached the tracked file.

# 17. NEGATIVE — the write policy is chosen by the function, not by a call site
grep -c "'strict'" src/lib/graphql/client.ts
# Expected: 1
grep -c "'partial'" src/lib/graphql/client.ts
# Expected: 1
grep -rn "fetchGraphQLAuthed(" src/ | grep -c "'strict'\|'partial'"
# Expected: 0   — no call site passes a policy, because there is no parameter for it

# 17b. The client edit compiles, generates and lints clean
npm run codegen:check
# Expected: no output — generated types match the committed src/gql/
npm run verify
# Expected: no output from type-check, lint or format:check

# 18. NEGATIVE — exactly ONE line in the codebase reads WP_APP_TOKEN
grep -rn 'WP_APP_TOKEN' src/
# Expected: exactly one hit, in src/lib/graphql/client.ts. Rotation touches one place.

# 19. NEGATIVE — no credential reached the client bundle
npm run build
grep -r "$(grep -E '^WP_APP_TOKEN=' .env.local | cut -d= -f2-)" .next/static/ 2>/dev/null
# Expected: no output
grep -rl 'http://localhost:3000' .next/static/ | head -1
# Expected: one .js file — the control. A grep that finds nothing proves nothing until
#           you have shown it can find something (Lesson 09.5 checks 7 and 8).

# 20. Clean up the probes
cd ../wordpress-headless
docker compose run --rm wpcli wp user delete probe152@example.test --yes
docker compose run --rm wpcli wp post list --post_type=incident --title='JWT probe 152' \
  --field=ID --format=ids | xargs -r -n1 docker compose run --rm wpcli wp post delete --force
git status --short
git check-ignore -v .env ../next-app/.env.local
# Expected: neither env file in git status; check-ignore names a rule for both
```

Checks 8, 13 and 15 define this lesson: authentication is something WordPress does and Next only
asks about; the two credentials are not substitutable in fact, not just in policy; and the runtime
that will hold your users' cookies cannot judge the tokens inside them.

## Control Questions

1. `fetchGraphQLAuthed`'s third parameter was `token: string` and is now `credential: Credential`.
   Both credentials are strings, so name the concrete bug the old signature permitted, the HTTP
   status it would have returned, and why `kind: 'app'` carrying no token closes a second hole.
2. You set `GRAPHQL_JWT_AUTH_CORS_ENABLE` to `false` even though it is already off by default.
   Give the two independent arguments for writing it down, and name the two behaviours it would
   switch on, saying which kind of client each exists to serve.
3. Verification check 6 measures `exp - iat` rather than trusting documentation. Describe the two
   clocks, say which party enforces each, and explain what a user experiences when the cookie's
   `Max-Age` is *longer* than the token's `exp`.
4. `fetchGraphQL` keeps Lesson 10.4's Option B and `fetchGraphQLAuthed` takes Option A. State the
   response shape that makes the difference matter, and say what Module 16's five-step skeleton
   could not do if both functions shared Option B.
5. `refreshJwtAuthToken` returns a new `authToken` and not a new `refreshToken`. State what a
   stolen refresh token gets an attacker and for how long, then say what rotation would require on
   the WordPress side — and why that reintroduces what Lesson 15.1 §3 said you were trading away.

## Learn More

- [WPGraphQL JWT Authentication — README](https://github.com/wp-graphql/wp-graphql-jwt-authentication) —
  install steps, the secret-key requirement and the CORS switch, from the people who wrote it
- [WPGraphQL JWT Authentication — `src/Auth.php`](https://github.com/wp-graphql/wp-graphql-jwt-authentication/blob/develop/src/Auth.php) —
  find the `apply_filters` calls Key Concept 2 tells you to grep for, and read `login` to see
  `wp_authenticate()` called rather than replaced
- [WPGraphQL — Authentication and authorization](https://www.wpgraphql.com/docs/authentication-and-authorization/) —
  WPGraphQL's own framing of who may see what, including why `User.roles` is gated
- [`wp_authenticate()`](https://developer.wordpress.org/reference/functions/wp_authenticate/) — the
  filter chain Key Concept 9 depends on; note `authenticate` and `wp_login_failed`
- [`hash_equals()`](https://www.php.net/manual/en/function.hash-equals.php) — one paragraph, and
  the argument-order note Key Concept 8's second rule depends on
- [A lesson in timing attacks](https://www.sjoerdlangkemper.nl/2024/05/29/string-comparison-timing-attacks/) — why byte-by-byte
  comparison leaks a prefix, with the maths behind "a few thousand requests per character"
- [TypeScript handbook — discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) —
  the narrowing that makes `credential.kind === 'user'` give you `jwt` and nothing else
- [MDN — `Authorization` header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Authorization) —
  the `Bearer` scheme, and why a custom header is legitimate for a non-bearer credential
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) —
  read the rotation section next to Task Step 8; the source of the "rotate both sides" rule
