---
title: 'Custom Mutations & Input Validation'
module: 6
lesson: 2
teaches: [register-graphql-mutation, input-validation-server-side, forced-post-status, trust-boundaries, app-token-auth]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-create-incident.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-register-developer.php']
requires: [3.5, 5.5, 6.1]
---

# Lesson 06.2 — Custom Mutations & Input Validation

## Quick Overview

Two mutations, written from scratch with `register_graphql_mutation`, replacing WPGraphQL's
built-ins. `createIncident` accepts a title, a body, a scapegoat, a severity and the incident
detail fields from an authenticated `incident_reporter`, and it **forces**
`post_status = 'pending'` and `post_author = get_current_user_id()` in PHP — those two are not
read from the input at all, so there is no value a client can send that publishes a post or
attributes it to someone else. It also **ignores** `is_verified`, which is present in the schema
and writable by an editor in wp-admin: a field appearing in an input type is not permission to
set it. `registerDeveloper` creates a user with the `incident_reporter` role explicitly assigned,
authenticated by the app token rather than a user JWT, because there is no logged-in user at
registration time.

The discipline the lesson teaches is **independent re-authorisation**. The Next.js Server Action
in Module 16 will validate this input with Zod and check the `incident_submission_open` kill
switch, and none of that counts here. WordPress authenticates the caller, checks
`create_incidents` with `current_user_can()`, sanitises every field with the right
`sanitize_*`/`wp_kses_post` function, validates every value against its own rules — `occurred_at`
not in the future, `downtime_minutes` within range, `environment` a legal enum value — and only
then writes. Two independent checks at two layers is the design, not redundancy: the front end's
validation is a user-experience feature, and WordPress's is the security control, because a
compromised or buggy front end is a plausible attacker.

By the end of this lesson you will have:

- `mutation-create-incident.php` — a mutation with a typed input, full sanitising, and
  independent capability checks
- `post_status` and `post_author` set in PHP and provably unsettable from the input
- `is_verified` provably discarded when a client sends `true`
- `mutation-register-developer.php` — app-token authenticated, assigning `incident_reporter`
  explicitly, never `get_option('default_role')`
- App-token comparison with `hash_equals()`, never `==`, and a note on why
- Verification that proves the negatives: anonymous is rejected, a reporter cannot publish, a
  client-supplied `is_verified` is ignored, and a wrong app token returns an error that echoes
  no reason

## Classic WP Analogy

You have written this handler. `add_action('admin_post_submit_incident', ...)`, then
`check_admin_referer()`, then `current_user_can()`, then a block of
`sanitize_text_field($_POST['title'])` and `absint($_POST['downtime'])` and
`wp_kses_post($_POST['body'])`, then `wp_insert_post()` with `'post_status' => 'pending'`
hard-coded because you would never take a status from `$_POST`, then a redirect. Every instinct
in that paragraph is correct and transfers directly. The sanitise functions are the same
functions. `wp_insert_post()` is the same function. The capability check is the same check.

The structural difference is where the input arrives and what it looks like. Instead of `$_POST`
you get a typed `$input` array whose shape GraphQL has already validated against the input type
you declared — a `Float` field cannot contain a string, a required field cannot be absent, and an
enum field cannot hold a value outside its set. That is real, genuine protection you did not have
with `$_POST`, and it is tempting to treat it as sufficient. It is not: type validity is not
business validity, and `downtime_minutes: -5` is a perfectly well-typed `Float`.

**Where the analogy breaks down:** the nonce is gone, and with it the assumption underneath your
whole Classic WordPress write path. `check_admin_referer()` proved the request came from a form
*your site rendered for this user in this session*, which meant the request had already passed
through your code once and was shaped by it. Here the request arrives as JSON from another
application, and there is no equivalent proof of origin — identity comes from a bearer token, and
the shape of the payload is whatever the caller chose to send. So the question changes from "did
this come from my form?" to "is this caller allowed to do this, and is this data acceptable
regardless of who sent it?" — and the second half of that question has to be answered here, in
PHP, even though a Server Action already answered it in TypeScript twenty milliseconds earlier.

---

## Key Concepts

### 1. The anatomy of `register_graphql_mutation`

Three keys do the work. Everything else is description.

```php
// Illustrative — the shape. The real files are in the Task.
register_graphql_mutation(
	'createIncident',
	array(
		'description'         => 'Submit an incident for moderation.',
		'inputFields'         => array( /* the CreateIncidentInput fields  */ ),
		'outputFields'        => array( /* the CreateIncidentPayload fields */ ),
		'mutateAndGetPayload' => static function ( array $input, $context, $info ): array {
			// authenticate → authorise → sanitise → validate → write
			return array( 'postObjectId' => 42 );
		},
	)
);
```

| Key | WPGraphQL builds | Notes |
|---|---|---|
| `inputFields` | the input type `CreateIncidentInput` | `clientMutationId` is added **for you**. Do not declare it. |
| `outputFields` | the payload type `CreateIncidentPayload` | `clientMutationId` is echoed back automatically |
| `mutateAndGetPayload` | the resolver behind the mutation field | Receives `( array $input, AppContext $context, ResolveInfo $info )` and returns an array |

The returned array is the `$source` for every output field's resolver — the same
`$source`-is-the-parent's-value rule from Lesson 06.1 §2. So the convention that follows is
worth adopting deliberately: **`mutateAndGetPayload` returns identifiers, and the output fields
turn identifiers into nodes.**

```
mutateAndGetPayload returns          outputFields['incident']['resolve']
  [ 'postObjectId' => 4711 ]   ──▶     $context->get_loader('post')
                                          ->load_deferred( 4711 )   ──▶  Incident node
```

That split matters for two reasons. It keeps the write path free of read concerns, and it means
the node is fetched through the **loader**, so a client mutating and reading in one request pays
one query rather than two. Lesson 06.4 is the same idea applied to queries.

> **WPGraphQL's mutation config also accepts `isPrivate` and `auth` keys.** This course sets
> neither, on purpose. They are declarations *about* a field, enforced somewhere inside
> WPGraphQL, and the whole point of this lesson is that the authorisation decision must be a
> `current_user_can()` call you can read in the function that does the writing. Use them as
> documentation if you like. Never as the control.

### 2. WPGraphQL does not authorise your custom mutations for you

This is the most important paragraph in Phase 1, so it gets its own concept and no hedging.

A `mutateAndGetPayload` with no capability check **runs for anybody who can reach the
endpoint**. Not "anybody logged in" — anybody. There is no implicit gate, no inherited
permission from the post type, no framework asking whether this is sensible.

```
Lesson 05.5: the GENERATED mutation        Lesson 06.2: YOUR mutation
───────────────────────────────────        ───────────────────────────────────
createIncident (built-in)                  createIncident (custom)
   │                                          │
   ▼                                          ▼
WPGraphQL's PostObjectCreate               mutateAndGetPayload
   │                                          │
   ├─ current_user_can('create_incidents')    ├─ ??? whatever you wrote
   │     ← WPGraphQL wrote this               │
   ▼                                          ▼
denies anonymous callers  ✅               denies nobody  ❌  unless YOU wrote the check
```

The trap is precise and it catches experienced developers: the generated mutation you are
*replacing* was checking capabilities, so the endpoint behaved correctly before you touched it,
and it behaves correctly in your manual test too — because you tested it logged in. The
regression is invisible until someone `curl`s it with no `Authorization` header.

> **Why this is the single most common headless WordPress security bug.** Every other write path
> in WordPress arrives pre-guarded. `admin_post_` handlers are reached through wp-admin, REST
> routes will not register without a `permission_callback`, and the block editor is behind a
> login. A custom GraphQL mutation is the first write path in most developers' careers where
> "did anyone check?" has the answer "only if you did". Lesson 24.8's review checklist has one
> line for exactly this, and appendix 05 §7 states it too.

So every `mutateAndGetPayload` in this course opens with authorisation and nothing else:

| Mutation | First lines of the function |
|---|---|
| `createIncident` | `if ( ! is_user_logged_in() ) { … }` then `if ( ! current_user_can( 'create_incidents' ) ) { … }` |
| `registerDeveloper` | `require_app_token();` — there is no user, so the application proves itself |
| `submitHobtLead` | `require_app_token();` |

### 3. Five steps, in this order, every time

The order is not stylistic. Each step assumes the previous one succeeded, and running them out
of order produces a specific class of bug.

```
1. AUTHENTICATE   who is calling?           JWT (a user) or app token (the application)
        │                                   fail → error, no work done
        ▼
2. AUTHORISE      may they do this at all?  current_user_can( 'create_incidents' )
        │                                   fail → error, no work done
        ▼
3. SANITISE       make each value safe       sanitize_text_field, wp_kses_post, absint, …
        │                                   never fails — it transforms
        ▼
4. VALIDATE       is each value acceptable?  date not in future, slug in allowlist, range
        │                                   fail → error, still nothing written
        ▼
5. WRITE          wp_insert_post / $wpdb     forced fields applied here, not read from input
```

| Getting the order wrong | What it costs you |
|---|---|
| Sanitising before authorising | You do work for callers you were going to reject. On an unauthenticated endpoint that is a free CPU sink. |
| Validating before sanitising | You validate a value you then transform, so what you approved is not what you stored |
| Writing before validating fully | Half-written content. `wp_insert_post()` then a failed term lookup leaves an orphan post — so the term allowlist check happens **before** the insert |
| Trusting step 3 as step 4 | `sanitize_text_field()` makes a string safe to store. It has no opinion about whether `-5` is a legal downtime. |

**Sanitising is not validating, and conflating them is the most common review finding.**
`absint( '-5' )` is `5`: perfectly safe, completely wrong. `sanitize_text_field()` on a date
gives you a safe string that may be the year 3000.

### 4. Type validity is not business validity

The input type does real work, and it is worth being precise about how much.

| GraphQL guarantees | GraphQL does not guarantee |
|---|---|
| `downtimeMinutes` is a `Float`, not a string | that it is between 0 and 100000 |
| `occurredAt` is a `String` | that it parses as a date, or that the date is in the past |
| `environment` is one of four enum values | that the incident happened in that environment |
| a `String!` field is present and non-null | that it is non-empty — `""` satisfies `String!` |
| `scapegoatSlug` is a string | **that a `scapegoat` term with that slug exists** |

The last two rows are where mutations actually get broken. `String!` accepts the empty string,
so a required title still needs a length check. And a slug that *looks* like a slug is not a slug
that *exists* — which is Key Concept 6, and the one with teeth.

### 5. Forced fields, discarded fields, and why the fix is never "narrow the schema"

`createIncident` sets two fields in PHP and reads neither from the input:

```php
// Illustrative — the two lines that make the mutation safe.
'post_status' => 'pending',                  // never from $input
'post_author' => get_current_user_id(),      // never from $input
```

Lesson 05.5 §Step 3 had you watch the generated mutation accept `status: PUBLISH` from the
client and honour it. For an administrator in GraphiQL that is correct behaviour. For a mutation
a public submitter can call it is a vulnerability, and this is the fix.

Then there are the fields the input **accepts and does not obey**, which is where the principle
lives:

| Input field | Present in `CreateIncidentInput`? | What the resolver does | Why |
|---|---|---|---|
| `status` | yes | **always discarded**; `pending` is forced | No caller of *this* mutation has a legitimate reason to choose a status. Moderation is a wp-admin row action (Lesson 03.4). |
| `isVerified` | yes | discarded **unless** the caller holds `edit_others_incidents` | An editor submitting on someone's behalf may legitimately set it. A reporter may not. |
| `authorId` | **no** | — | There is no caller for whom "write this as someone else" is meaningful here |

> **A field appearing in an input type is not permission to set it.** The input type describes
> *what the API will parse*. The resolver decides *what the API will honour*, per caller. Those
> are different questions and they belong in different places.

This answers the Control Question Lesson 05.5 left open — *why not just remove the field from
the input type?* Three reasons, in increasing order of importance:

1. **A schema is one shared artifact.** The same `createIncident` is reachable by a reporter's
   JWT and by an editor's. Removing `isVerified` to protect the first caller removes a
   legitimate capability from the second. You would end up with `createIncident` and
   `createIncidentAsEditor`, two mutations to keep in sync, and the authorisation logic
   duplicated across both.
2. **The answer is per-caller, and a type cannot be.** GraphQL types are static — the schema is
   printed once, into `wordpress-headless/schema.graphql`, identical for everyone. "May you set
   this?" depends on who is asking. Only a resolver can see that.
3. **Narrowing the type moves the failure to the wrong layer.** With the field removed, a client
   sending it gets `Field "isVerified" is not defined by type CreateIncidentInput` — a *schema*
   error, which reads like a client bug and tells the caller nothing about permissions. With the
   field present and ignored, the response is a successfully created incident with
   `isVerified: false`, which is the truth.

And the backstop from Lesson 03.5 is still underneath all of it: even a resolver that forgot to
force `pending` would not publish, because `wp_insert_post()` downgrades the status itself when
the author lacks `publish_incidents`. Two independent mechanisms, one outcome. The forced line
stays anyway — Lesson 03.5's fifth Control Question is exactly this argument.

### 6. Sanitise per type, and check term slugs against a server-fetched allowlist

Every field gets the function that matches what it is. There is no general-purpose sanitiser and
reaching for `sanitize_text_field()` on everything is how HTML gets stripped out of a body and
survives in a title.

| Input | Function | Why that one |
|---|---|---|
| `title` | `sanitize_text_field()` | strips tags and control characters, collapses whitespace |
| `body` | `wp_kses_post()` | allows the HTML a post body may contain, strips `<script>` and event attributes |
| `stackTrace` | `sanitize_textarea_field()` | a stack trace is **not** HTML; it renders inside `<pre>`, escaped (appendix 03 §4.1) |
| `downtimeMinutes` | `absint()`, then a range check | negative minutes are not a thing |
| `estimatedCostUsd` | `(float)`, then a range check | may be fractional |
| `scapegoatSlug`, `severitySlug` | `sanitize_key()`, then **an existence check** | `sanitize_key()` proves shape only |
| `occurredAt` | `strtotime()`, then reject future and unparseable | see below |
| `reporterDisplayName` | `sanitize_text_field()` | displayed as-is by the front end |
| `email` (registerDeveloper) | `sanitize_email()`, then `is_email()` | the two do different jobs |

The slug row is the one that matters, and the reasoning generalises:

```
A REGEX CONFIRMS SHAPE                 A LOOKUP CONFIRMS EXISTENCE
────────────────────────────           ────────────────────────────
sanitize_key('the-intern')             get_term_by('slug','the-intern','scapegoat')
  → 'the-intern'      ✅ shape ok        → WP_Term(term_id: 17)       ✅ it exists

sanitize_key('the-hacker')             get_term_by('slug','the-hacker','scapegoat')
  → 'the-hacker'      ✅ shape ok        → false                      ❌ reject
```

**`wp_set_object_terms()` will happily create a term that does not exist.** Pass it a string and
it treats it as a name to find *or create*; pass it an integer and it can only assign an existing
term. So the mutation resolves the slug to a `WP_Term`, rejects the request if there is no match,
and passes the **term ID** to `wp_set_object_terms()`. Two lines, and public callers can no
longer author your taxonomy.

> **Where this breaks in the wild:** `severity` is a closed set of four terms (appendix 03 §2)
> with a locked term UI, and none of that helps if a mutation writes term *names*. An attacker
> submitting `severitySlug: "s0-apocalyptic"` would not be exploiting anything — they would
> simply be editing your content model from the outside. The blame leaderboard is a `count`
> column on `wp_term_taxonomy`; polluting the term table pollutes every aggregate built on it.

### 7. The app token, `hash_equals()`, and why `==` is a vulnerability

`registerDeveloper` and `submitHobtLead` have no logged-in user by definition — nobody is
registered yet, and a lead is a stranger. So the caller that must prove itself is the
**application**, with the `X-BTT-App-Token` header from
[appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials).

| | user JWT | app token |
|---|---|---|
| Represents | a human | the Next.js application |
| Header | `Authorization: Bearer …` | `X-BTT-App-Token: …` |
| Used by | `createIncident` | `registerDeveloper`, `submitHobtLead` |
| Comes from | the `login` mutation (Module 15) | `BTT_APP_TOKEN` in the environment |

The comparison is the interesting part:

```
$provided == $expected            ❌  short-circuits on the first differing byte
$provided === $expected           ❌  same: still a byte-by-byte early return
hash_equals($expected, $provided) ✅  constant time for equal-length strings
```

`==` and `===` on strings return as soon as two bytes differ. The time taken therefore leaks
**how many leading bytes were correct**, which turns guessing a 48-character token from
"impossible" into "a few thousand requests per character". That is a **timing oracle**, and it is
not theoretical — it is the reason `hash_equals()` exists in PHP's standard library and the
reason WordPress core uses it for nonces and cookie hashes.

Two more rules that come with it:

- **Compare the *stored* value first.** `hash_equals( $expected, $provided )` — argument order
  is documented as known-string first. It matters for the length-comparison shortcut.
- **`==` on strings has a second problem.** PHP's loose comparison has historically treated some
  strings as numbers. `===` fixes the type-juggling; only `hash_equals()` fixes the timing.

> **A missing token and a wrong token get the same answer.** `Not authorized.` Nothing about
> which header was expected, nothing about length, no hint that the header name was right and
> the value wrong. A caller who is entitled to call this mutation already has the token and needs
> no help; a caller who does not is the one asking.

### 8. Error hygiene: what the caller is allowed to learn

Errors are API surface. A `500` with a stack trace is a gift to whoever triggered it.

```
❌ NEVER let a caller see                    ✅ WHAT THE CALLER GETS
─────────────────────────────────────        ─────────────────────────────
"blame-the-tech-core/includes/graphql/       "Invalid input."
 mutation-create-incident.php:118"
"WordPress database error Duplicate          "Not authorized."
 entry for key 'uniq_email_source'"
"Call to a member function on null"          "That severity does not exist."
"user btt_admin already exists"              "Registration received."
```

| Rule | Reason |
|---|---|
| One safe sentence per failure, from a fixed set | Lesson 06.3 lists the set in `docs/api-contract.md` so the front end can map errors to fields |
| Never a file path, plugin name, class name or SQL fragment | Version and layout disclosure; the first step of most real attacks is fingerprinting |
| Never "that email is already registered" | An account-enumeration oracle. Return the same payload as a successful registration. |
| Never "that email already submitted a lead" | Same oracle, same fix — treat the duplicate as success |
| Detail goes to the log, not the wire | `graphql_debug()` surfaces only when `GRAPHQL_DEBUG` is on, which is local only |

`GraphQL\Error\UserError` is the exception class to throw: WPGraphQL marks it client-safe, so its
message reaches the caller in the `errors` array with an HTTP **200**, exactly like every other
GraphQL failure (Lesson 05.5 §3). Throwing a plain `\Exception` gets you `Internal server error`
and a log entry — safe, but useless to a legitimate caller.

### 9. The three mutations, and what each one guards

Specified in
[appendix 03 §7](../appendix/03-content-model-reference.md#7-custom-graphql-fields-and-mutations).

| Mutation | Credential | Forced in PHP | Payload deliberately withholds |
|---|---|---|---|
| `createIncident` | user JWT + `create_incidents` | `post_status`, `post_author`; `status` discarded; `isVerified` discarded unless editor | nothing — the author may read their own submission |
| `registerDeveloper` | app token | role `incident_reporter`, `btt_verified = 0`, generated password | the `User` node, and whether the email already existed |
| `submitHobtLead` | app token | `created_at`, `ip_hash` (HMAC, never the raw IP) | the row ID, and whether the lead was a duplicate |

The payload column is a design decision people skip. `registerDeveloper` is called by an
unauthenticated application, so returning a `User` node would put user fields in reach of a
caller with no session — and the moment the token leaks, that mutation becomes a user-data read
API. It returns a boolean and an echo of the submitted email, and nothing else.

> **`submitHobtLead` writes to `wp_btt_leads`, and that table does not exist yet.** Appendix 03
> §5 creates it with `dbDelta()`, and appendix 03 §10 assigns that work to Module 16 along with
> the honeypot, the timing check, Turnstile and rate limiting. So the mutation you register in
> this lesson is complete on its input side — token, sanitising, validation, HMAC, safe errors —
> and guards its own write with a table-existence check that fails with `Temporarily
> unavailable.` until Module 16 lands. That is deliberate: the guard is what makes an
> API-first-storage-later mutation safe to ship, and the error message is a working example of
> Key Concept 8.

---

## Task

### Step 1: Remove the generated mutations at the source

The generated `createIncident` accepts a client `status` and `authorId` (Lesson 05.5 §Step 3),
and its input and payload types are already named `CreateIncidentInput` and
`CreateIncidentPayload` — the exact names your own mutation needs. Remove them where they were
created, in `register_post_type()`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/post-types.php
		// Lesson 06.2: WPGraphQL generates create/update/delete mutations for every
		// post type in the schema. Ours are replaced by guarded custom mutations, so
		// switch the generated ones off HERE rather than deregistering them later —
		// this also frees the CreateIncidentInput / CreateIncidentPayload type names.
		'graphql_exclude_mutations' => array( 'create', 'update', 'delete' ),
```

Add that line to the `incident` argument array, alongside `graphql_single_name`.

**Verify §1:**

```bash
cd wordpress-headless
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"RootMutation\"){ fields { name } } }"}' \
  | jq -r '.data.__type.fields[].name' | grep -cE '^(createIncident|updateIncident|deleteIncident)$'
```

- [ ] The count is `0`. The generated mutations are gone.
- [ ] If it is `3`, your WPGraphQL predates `graphql_exclude_mutations` (WPGraphQL 1.14). Update
      the plugin — do **not** work around it by naming your mutation something else, because the
      mutation name is fixed by appendix 03 §7.

### Step 2: Write the app-token guard

One function, used by two mutations. Putting it in its own file means there is exactly one place
where the token comparison lives, and one place to audit.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/app-token.php
/**
 * Application-token authentication for server-to-server mutations.
 *
 * The app token identifies the Next.js APPLICATION, not a user — see
 * appendix 04 §4. It is used by mutations that have no logged-in caller by
 * definition: registration and lead capture.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Error\UserError;

defined( 'ABSPATH' ) || exit;

const APP_TOKEN_HEADER = 'X-BTT-App-Token';

/**
 * The expected token, from the environment. Never a literal, never an option,
 * never committed — appendix 04 §1.
 */
function expected_app_token(): string {
	$token = getenv( 'BTT_APP_TOKEN' );

	return is_string( $token ) ? trim( $token ) : '';
}

/**
 * The token the caller presented, from the request headers.
 *
 * PHP exposes `X-BTT-App-Token` as HTTP_X_BTT_APP_TOKEN. It is not sanitised
 * with sanitize_text_field(), because it is never stored or printed — it is
 * only ever compared, and trimming is all the normalisation it may safely get.
 */
function presented_app_token(): string {
	$raw = $_SERVER['HTTP_X_BTT_APP_TOKEN'] ?? '';

	return is_string( $raw ) ? trim( $raw ) : '';
}

/**
 * Require a valid application token, or fail the mutation.
 *
 * hash_equals(), NOT == or ===. String comparison returns as soon as two bytes
 * differ, which leaks how many leading bytes were correct and turns guessing a
 * 48-character token into a few thousand requests per character.
 * hash_equals() takes the same time for any two strings of equal length.
 *
 * The known value goes FIRST — that is the documented argument order.
 *
 * @throws \GraphQL\Error\UserError If the token is missing, empty or wrong.
 */
function require_app_token(): void {
	$expected = expected_app_token();

	// A misconfigured server must never authenticate everyone. If the
	// environment variable is absent, every call fails closed.
	if ( '' === $expected ) {
		graphql_debug( 'BTT_APP_TOKEN is not set in the WordPress environment.' );

		throw new UserError( __( 'Not authorized.', 'blame-the-tech-core' ) );
	}

	if ( ! hash_equals( $expected, presented_app_token() ) ) {
		// Same message for missing, empty, short, long and wrong. A caller
		// entitled to this mutation already holds the token.
		throw new UserError( __( 'Not authorized.', 'blame-the-tech-core' ) );
	}
}
```

**Verify §2:**

- [ ] `hash_equals` appears exactly once in the file, and there is no `==` or `===` comparing
      tokens anywhere.
- [ ] The empty-`$expected` branch throws. An unset environment variable must fail **closed** —
      `hash_equals( '', '' )` is `true`, and that would authenticate every caller on a server
      that forgot the variable.
- [ ] The error message is the same string in both branches.

### Step 3: Write `createIncident`

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-create-incident.php
/**
 * The `createIncident` mutation.
 *
 * Replaces WPGraphQL's generated createIncident, which accepts a client-chosen
 * post_status and authorId. Contract: appendix 03 §7.
 *
 * Order inside mutateAndGetPayload is authenticate → authorise → sanitise →
 * validate → write, and it is not negotiable (Lesson 06.2 §3).
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Error\UserError;
use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/**
 * Resolve a term slug to a term ID, or fail.
 *
 * sanitize_key() proves the SHAPE of a slug. Only a lookup proves it EXISTS.
 * The term ID is what gets passed to wp_set_object_terms(), because that
 * function will CREATE a term when handed a string it cannot find.
 *
 * @throws \GraphQL\Error\UserError If no term with that slug exists.
 */
function require_term_id( mixed $raw_slug, string $taxonomy, string $label ): int {
	$slug = sanitize_key( (string) $raw_slug );
	$term = '' === $slug ? false : get_term_by( 'slug', $slug, $taxonomy );

	if ( ! $term instanceof \WP_Term ) {
		/* translators: %s: human-readable taxonomy label, e.g. "severity". */
		throw new UserError( sprintf( __( 'That %s does not exist.', 'blame-the-tech-core' ), $label ) );
	}

	return (int) $term->term_id;
}

/**
 * Validate a client-supplied date-time and return it as MySQL GMT.
 *
 * Rejects rather than corrects. An incident in the future is a typo or a
 * probe; silently clamping it to `now` stores a fact nobody asserted.
 *
 * @throws \GraphQL\Error\UserError If unparseable or in the future.
 */
function require_past_datetime( mixed $raw ): string {
	$time = strtotime( sanitize_text_field( (string) $raw ) );

	if ( false === $time || $time > time() ) {
		throw new UserError( __( 'occurredAt must be a valid date and time that is not in the future.', 'blame-the-tech-core' ) );
	}

	return gmdate( 'Y-m-d H:i:s', $time );
}

/** Input fields for createIncident. `clientMutationId` is added by WPGraphQL. */
function create_incident_input_fields(): array {
	return array(
		'title'               => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'Incident headline. Plain text; markup is stripped.', 'blame-the-tech-core' ),
		),
		'body'                => array(
			'type'        => 'String',
			'description' => __( 'What happened, as post content. A safe subset of HTML is kept.', 'blame-the-tech-core' ),
		),
		'scapegoatSlug'       => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'Slug of an EXISTING scapegoat term. Unknown slugs are rejected; no term is ever created.', 'blame-the-tech-core' ),
		),
		'severitySlug'        => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'Slug of one of the four severity terms. The set is closed.', 'blame-the-tech-core' ),
		),
		'occurredAt'          => array(
			'type'        => array( 'non_null' => 'String' ),
			'description' => __( 'When it happened. Anything strtotime() understands, and not in the future.', 'blame-the-tech-core' ),
		),
		'downtimeMinutes'     => array(
			'type'        => array( 'non_null' => 'Int' ),
			'description' => __( 'Minutes of downtime, 0–100000.', 'blame-the-tech-core' ),
		),
		'estimatedCostUsd'    => array(
			'type'        => 'Float',
			'description' => __( 'Estimated cost in USD. Optional, must not be negative.', 'blame-the-tech-core' ),
		),
		'environment'         => array(
			'type'        => array( 'non_null' => 'IncidentEnvironment' ),
			'description' => __( 'Where it happened. A real enum, so an illegal value never reaches this resolver.', 'blame-the-tech-core' ),
		),
		'resolutionStatus'    => array(
			'type'        => 'IncidentResolutionStatus',
			'description' => __( 'Defaults to OPEN when omitted.', 'blame-the-tech-core' ),
		),
		'blameConfidence'     => array(
			'type'        => 'Float',
			'description' => __( 'How sure the reporter is, 0–100. Defaults to 73.', 'blame-the-tech-core' ),
		),
		'stackTrace'          => array(
			'type'        => 'String',
			'description' => __( 'Optional stack trace. Stored as plain text and rendered escaped inside <pre>.', 'blame-the-tech-core' ),
		),
		'reporterDisplayName' => array(
			'type'        => 'String',
			'description' => __( 'Display name to credit. Defaults to the authenticated user’s display name.', 'blame-the-tech-core' ),
		),
		// The two fields that teach the trust boundary. Both are PARSED.
		// Neither is trusted. See Lesson 06.2 §5 before deleting them.
		'status'              => array(
			'type'        => 'PostStatusEnum',
			'description' => __( 'ACCEPTED AND ALWAYS IGNORED. Every incident is created as `pending`; moderation happens in wp-admin. Present so that clients sending it get a created incident rather than a schema error.', 'blame-the-tech-core' ),
		),
		'isVerified'          => array(
			'type'        => 'Boolean',
			'description' => __( 'Honoured only for callers holding `edit_others_incidents`. Silently discarded for everyone else — a field in an input type is not permission to set it.', 'blame-the-tech-core' ),
		),
	);
}

/**
 * Create a pending incident on behalf of the authenticated user.
 *
 * @throws \GraphQL\Error\UserError On any authorisation or validation failure.
 * @return array{postObjectId: int}
 */
function create_incident_payload( array $input, AppContext $context, ResolveInfo $info ): array {
	// ── 1. AUTHENTICATE ────────────────────────────────────────────────
	if ( ! is_user_logged_in() ) {
		throw new UserError( __( 'You must be signed in to submit an incident.', 'blame-the-tech-core' ) );
	}

	// ── 2. AUTHORISE ───────────────────────────────────────────────────
	// WPGraphQL does NOT do this for you. Without these three lines the
	// mutation runs for anyone who can reach /graphql (Lesson 06.2 §2).
	if ( ! current_user_can( 'create_incidents' ) ) {
		throw new UserError( __( 'You are not allowed to submit incidents.', 'blame-the-tech-core' ) );
	}

	// The `incident_submission_open` kill switch from appendix 03 §4.5 is
	// honoured by the Server Action in Module 16. It is deliberately NOT
	// checked here: it is a content setting, not an authorisation decision,
	// and a mutation that fails closed when an ACF options page has never
	// been saved takes the submission form down for a reason nobody can see.

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$title     = sanitize_text_field( (string) ( $input['title'] ?? '' ) );
	$body      = wp_kses_post( (string) ( $input['body'] ?? '' ) );
	$trace     = sanitize_textarea_field( (string) ( $input['stackTrace'] ?? '' ) );
	$downtime  = absint( $input['downtimeMinutes'] ?? 0 );
	$cost      = (float) ( $input['estimatedCostUsd'] ?? 0 );
	$blame     = isset( $input['blameConfidence'] ) ? (float) $input['blameConfidence'] : 73.0;
	$reporter  = sanitize_text_field( (string) ( $input['reporterDisplayName'] ?? '' ) );

	// Enum inputs arrive as the STORED kebab-case value already — graphql-php
	// mapped SCREAMING_SNAKE to it (Lesson 06.1 §4). Re-assert anyway: this
	// value is about to be written to wp_postmeta.
	$environment = normalize_stored_value( 'IncidentEnvironment', $input['environment'] ?? '' );
	$resolution  = normalize_stored_value( 'IncidentResolutionStatus', $input['resolutionStatus'] ?? 'open' ) ?? 'open';

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	// Everything here runs BEFORE wp_insert_post(), so a rejected request
	// leaves nothing behind. `String!` accepts "" — non-null is not non-empty.
	if ( '' === $title ) {
		throw new UserError( __( 'A title is required.', 'blame-the-tech-core' ) );
	}

	if ( mb_strlen( $title ) > 200 ) {
		throw new UserError( __( 'The title is too long.', 'blame-the-tech-core' ) );
	}

	if ( $downtime > 100000 ) {
		throw new UserError( __( 'downtimeMinutes must be between 0 and 100000.', 'blame-the-tech-core' ) );
	}

	if ( $cost < 0 || $cost > 1000000000 ) {
		throw new UserError( __( 'estimatedCostUsd is out of range.', 'blame-the-tech-core' ) );
	}

	if ( $blame < 0 || $blame > 100 ) {
		throw new UserError( __( 'blameConfidence must be between 0 and 100.', 'blame-the-tech-core' ) );
	}

	if ( null === $environment ) {
		throw new UserError( __( 'environment is not a recognised value.', 'blame-the-tech-core' ) );
	}

	$occurred_at = require_past_datetime( $input['occurredAt'] ?? '' );

	// Term existence, before the insert — otherwise a bad slug leaves an
	// orphan post behind (Lesson 06.2 §3).
	$scapegoat_id = require_term_id( $input['scapegoatSlug'] ?? '', 'scapegoat', __( 'scapegoat', 'blame-the-tech-core' ) );
	$severity_id  = require_term_id( $input['severitySlug'] ?? '', 'severity', __( 'severity', 'blame-the-tech-core' ) );

	// ── 5. WRITE ───────────────────────────────────────────────────────
	$post_id = wp_insert_post(
		array(
			'post_type'    => 'incident',
			'post_title'   => $title,
			'post_content' => $body,
			// FORCED. Not read from $input. $input['status'] is discarded here
			// and this is the line Lesson 05.5 promised.
			'post_status'  => 'pending',
			// FORCED. There is no code path by which a caller attributes an
			// incident to somebody else.
			'post_author'  => get_current_user_id(),
		),
		true
	);

	if ( is_wp_error( $post_id ) ) {
		// The WP_Error message can name tables and columns. Log it, do not
		// return it (Lesson 06.2 §8).
		graphql_debug( 'wp_insert_post failed: ' . $post_id->get_error_message() );

		throw new UserError( __( 'The incident could not be saved.', 'blame-the-tech-core' ) );
	}

	$post_id = (int) $post_id;

	// Term IDs, never strings: wp_set_object_terms() creates terms from
	// strings it cannot find, and creates nothing from an integer.
	wp_set_object_terms( $post_id, array( $scapegoat_id ), 'scapegoat', false );
	wp_set_object_terms( $post_id, array( $severity_id ), 'severity', false );

	update_post_meta( $post_id, 'occurred_at', $occurred_at );
	update_post_meta( $post_id, 'downtime_minutes', $downtime );
	update_post_meta( $post_id, 'estimated_cost_usd', $cost );
	update_post_meta( $post_id, 'environment', $environment );
	update_post_meta( $post_id, 'resolution_status', $resolution );
	update_post_meta( $post_id, 'blame_confidence', $blame );
	update_post_meta( $post_id, 'stack_trace', $trace );
	update_post_meta(
		$post_id,
		'reporter_display_name',
		'' !== $reporter ? $reporter : wp_get_current_user()->display_name
	);

	// `is_verified` is a MODERATION fact. A client value is honoured only for
	// a caller who could set it in wp-admin anyway; otherwise it is discarded
	// without comment and the field is written false.
	$verified = current_user_can( 'edit_others_incidents' ) && ! empty( $input['isVerified'] );
	update_post_meta( $post_id, 'is_verified', $verified );

	return array( 'postObjectId' => $post_id );
}

/** Register the mutation. */
function register_create_incident_mutation(): void {
	register_graphql_mutation(
		'createIncident',
		array(
			'description'         => __( 'Submit an incident for moderation. Always creates a `pending` post authored by the authenticated user. Requires the `create_incidents` capability.', 'blame-the-tech-core' ),
			'inputFields'         => create_incident_input_fields(),
			'outputFields'        => array(
				'incident' => array(
					'type'        => 'Incident',
					'description' => __( 'The created incident, always with status `pending`.', 'blame-the-tech-core' ),
					// $source is the array returned by mutateAndGetPayload.
					// Resolve through the LOADER so a mutate-then-read round
					// trip costs one query, not two (Lesson 06.4).
					'resolve'     => static function ( $payload, array $args, AppContext $context, ResolveInfo $info ) {
						if ( empty( $payload['postObjectId'] ) ) {
							return null;
						}

						return $context->get_loader( 'post' )->load_deferred( (int) $payload['postObjectId'] );
					},
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\create_incident_payload',
		)
	);
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_create_incident_mutation' );
```

**Verify §3:**

- [ ] `'post_status' => 'pending'` and `'post_author' => get_current_user_id()` are **literals in
      the `wp_insert_post()` array**. If either reads from `$input`, the mutation is the bug this
      lesson exists to fix.
- [ ] `current_user_can( 'create_incidents' )` appears **before** the first `sanitize_*` call.
- [ ] Both `require_term_id()` calls happen **before** `wp_insert_post()`.
- [ ] `wp_set_object_terms()` receives `array( $term_id )` — integers, not slugs.

### Step 4: Write `registerDeveloper`

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-register-developer.php
/**
 * The `registerDeveloper` mutation — the ONLY registration door.
 *
 * WPGraphQL's built-in registerUser requires users_can_register (a second
 * door) and assigns get_option('default_role'). This assigns
 * `incident_reporter` explicitly. See appendix 03 §6 and Lesson 05.5 §5.
 *
 * Module 15 adds email verification enforcement, Turnstile and rate limiting.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Error\UserError;
use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/**
 * A unique, valid username derived from an email local part.
 *
 * Never the email itself: WordPress exposes usernames in several places, and
 * an email address is not a public identifier.
 */
function unique_reporter_login( string $email ): string {
	$base = sanitize_user( strtok( $email, '@' ), true );
	$base = '' !== $base ? $base : 'reporter';
	$base = substr( $base, 0, 40 );

	$login = $base;
	$n     = 1;

	while ( username_exists( $login ) ) {
		++$n;
		$login = $base . $n;
	}

	return $login;
}

/**
 * Create an unverified `incident_reporter`.
 *
 * @throws \GraphQL\Error\UserError On a bad token or invalid input.
 * @return array{accepted: bool, email: string}
 */
function register_developer_payload( array $input, AppContext $context, ResolveInfo $info ): array {
	// ── 1. AUTHENTICATE ────────────────────────────────────────────────
	// There is no logged-in user at registration time, so the APPLICATION
	// proves itself. hash_equals() is inside require_app_token().
	require_app_token();

	// ── 2. AUTHORISE ───────────────────────────────────────────────────
	// Holding the app token IS the authorisation for this mutation. It is
	// stated here rather than left implicit, because a reader must not have
	// to wonder whether the check was forgotten.

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$email  = sanitize_email( (string) ( $input['email'] ?? '' ) );
	$name   = sanitize_text_field( (string) ( $input['displayName'] ?? '' ) );
	$locale = sanitize_key( (string) ( $input['locale'] ?? 'en' ) );

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	// sanitize_email() strips illegal characters; is_email() judges the
	// result. Two functions, two jobs.
	if ( '' === $email || ! is_email( $email ) ) {
		throw new UserError( __( 'A valid email address is required.', 'blame-the-tech-core' ) );
	}

	if ( '' === $name || mb_strlen( $name ) > 80 ) {
		throw new UserError( __( 'A display name of 1–80 characters is required.', 'blame-the-tech-core' ) );
	}

	if ( ! in_array( $locale, array( 'en', 'uk', 'de' ), true ) ) {
		$locale = 'en';
	}

	// ── 5. WRITE ───────────────────────────────────────────────────────
	// An existing email returns the SAME payload as a new registration.
	// Anything else is an account-enumeration oracle (Lesson 06.2 §8).
	if ( email_exists( $email ) ) {
		graphql_debug( 'registerDeveloper: email already registered; returning generic payload.' );

		return array(
			'accepted' => true,
			'email'    => $email,
		);
	}

	$user_id = wp_insert_user(
		array(
			'user_login'   => unique_reporter_login( $email ),
			'user_email'   => $email,
			// Generated, never returned, never logged. The user sets their own
			// via the reset flow; Module 15 wires that up.
			'user_pass'    => wp_generate_password( 32, true, true ),
			'display_name' => $name,
			'locale'       => 'en' === $locale ? '' : $locale,
			// EXPLICIT. Not get_option('default_role') — appendix 03 §6.
			'role'         => REPORTER_ROLE,
		)
	);

	if ( is_wp_error( $user_id ) ) {
		graphql_debug( 'wp_insert_user failed: ' . $user_id->get_error_message() );

		throw new UserError( __( 'Registration could not be completed.', 'blame-the-tech-core' ) );
	}

	$user_id = (int) $user_id;

	// Unverified until proven otherwise. Module 15 refuses `createIncident`
	// for a reporter whose btt_verified is 0.
	update_user_meta( $user_id, 'btt_verified', 0 );

	// Store only a HASH of the verification code; mail the raw one. A database
	// read must not yield a usable credential.
	$verify_code = wp_generate_password( 32, false, false );
	update_user_meta( $user_id, 'btt_verify_hash', hash( 'sha256', $verify_code ) );
	update_user_meta( $user_id, 'btt_verify_expires', time() + DAY_IN_SECONDS );

	$verify_url = add_query_arg(
		array(
			'uid'   => $user_id,
			'token' => $verify_code,
		),
		trailingslashit( (string) getenv( 'BTT_FRONTEND_URL' ) ) . 'verify'
	);

	wp_mail(
		$email,
		__( 'Confirm your Blame The Tech account', 'blame-the-tech-core' ),
		sprintf(
			/* translators: %s: verification URL. */
			__( "Welcome. Confirm your account within 24 hours:\n\n%s\n", 'blame-the-tech-core' ),
			esc_url_raw( $verify_url )
		)
	);

	return array(
		'accepted' => true,
		'email'    => $email,
	);
}

/** Register the mutation. */
function register_register_developer_mutation(): void {
	register_graphql_mutation(
		'registerDeveloper',
		array(
			'description'         => __( 'Create an unverified incident_reporter. Server-to-server only: requires the X-BTT-App-Token header. Returns the same payload whether or not the email was already registered.', 'blame-the-tech-core' ),
			'inputFields'         => array(
				'email'       => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'Email address. Also the verification target.', 'blame-the-tech-core' ),
				),
				'displayName' => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'Public display name, 1–80 characters.', 'blame-the-tech-core' ),
				),
				'locale'      => array(
					'type'        => 'String',
					'description' => __( 'One of en, uk, de. Anything else falls back to en.', 'blame-the-tech-core' ),
				),
			),
			'outputFields'        => array(
				'accepted' => array(
					'type'        => array( 'non_null' => 'Boolean' ),
					'description' => __( 'True when the registration was accepted for processing. Deliberately true for an already-registered email.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $payload ): bool => ! empty( $payload['accepted'] ),
				),
				'email'    => array(
					'type'        => 'String',
					'description' => __( 'The sanitised email, echoed for form display. No User node is returned — this mutation is called without a session.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $payload ): ?string => $payload['email'] ?? null,
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\register_developer_payload',
		)
	);
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_register_developer_mutation' );
```

**Verify §4:**

- [ ] `'role' => REPORTER_ROLE` — the constant from `includes/roles.php`, not a literal string
      and not `get_option( 'default_role' )`.
- [ ] `update_user_meta( $user_id, 'btt_verified', 0 )` is unconditional.
- [ ] Only `hash( 'sha256', $verify_code )` is stored; the raw code appears only in the email.
- [ ] The `email_exists()` branch returns the **same** payload shape as the success path.
- [ ] No `wp_generate_password()` result is ever returned or passed to `graphql_debug()`.

### Step 5: Write `submitHobtLead`

The input side is complete now; the write waits for the table Module 16 creates.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-submit-hobt-lead.php
/**
 * The `submitHobtLead` mutation.
 *
 * Writes to the custom wp_btt_leads table (appendix 03 §5) — never a post
 * type, because a CPT is one misconfigured show_in_graphql away from leaking
 * every lead. The table itself is created with dbDelta() in Module 16, which
 * also adds the honeypot, timing, Turnstile and rate-limit checks. Until then
 * this mutation guards its own write and fails safely.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Error\UserError;
use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/** Fully-qualified leads table name. */
function leads_table(): string {
	global $wpdb;

	return $wpdb->prefix . 'btt_leads';
}

/**
 * Does the leads table exist yet?
 *
 * $wpdb->prepare() with a %s placeholder — the table name is interpolated by
 * WordPress, not by us, and never by string concatenation.
 */
function leads_table_exists(): bool {
	global $wpdb;

	$table = leads_table();
	$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );

	return $found === $table;
}

/**
 * Pseudonymise the caller's IP.
 *
 * The raw address is never stored and never logged. An HMAC with a key that
 * lives only in the environment is reversible only by brute force over the
 * whole IPv4 space, and only by someone who also holds the key.
 */
function lead_ip_hash( string $ip ): ?string {
	$key = (string) getenv( 'BTT_LEAD_IP_HMAC_KEY' );

	if ( '' === $key || '' === $ip ) {
		return null;
	}

	return hash_hmac( 'sha256', $ip, $key );
}

/**
 * Record a HOBT lead.
 *
 * @throws \GraphQL\Error\UserError On a bad token, invalid input, or before Module 16.
 * @return array{accepted: bool}
 */
function submit_hobt_lead_payload( array $input, AppContext $context, ResolveInfo $info ): array {
	// ── 1 + 2. AUTHENTICATE / AUTHORISE ────────────────────────────────
	require_app_token();

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$email     = sanitize_email( (string) ( $input['email'] ?? '' ) );
	$full_name = sanitize_text_field( (string) ( $input['fullName'] ?? '' ) );
	$company   = sanitize_text_field( (string) ( $input['company'] ?? '' ) );
	$team_size = sanitize_text_field( (string) ( $input['teamSize'] ?? '' ) );
	$locale    = sanitize_key( (string) ( $input['locale'] ?? 'en' ) );
	$consent   = ! empty( $input['consent'] );

	// An enum input arrives as the stored kebab value; re-assert it anyway.
	$source = normalize_stored_value( 'LeadSource', $input['source'] ?? '' );

	$agent = substr( sanitize_text_field( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ) ), 0, 255 );
	$ip    = filter_var( (string) ( $_SERVER['REMOTE_ADDR'] ?? '' ), FILTER_VALIDATE_IP );

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	if ( '' === $email || ! is_email( $email ) ) {
		throw new UserError( __( 'A valid email address is required.', 'blame-the-tech-core' ) );
	}

	if ( '' === $full_name || mb_strlen( $full_name ) > 190 ) {
		throw new UserError( __( 'A name of 1–190 characters is required.', 'blame-the-tech-core' ) );
	}

	if ( null === $source ) {
		throw new UserError( __( 'source is not a recognised value.', 'blame-the-tech-core' ) );
	}

	if ( ! $consent ) {
		throw new UserError( __( 'Consent is required.', 'blame-the-tech-core' ) );
	}

	// ── 5. WRITE ───────────────────────────────────────────────────────
	if ( ! leads_table_exists() ) {
		// Module 16 creates the table. The caller learns that the endpoint is
		// unavailable and nothing about schemas, tables or plugins.
		graphql_debug( 'wp_btt_leads does not exist yet — Module 16 creates it with dbDelta().' );

		throw new UserError( __( 'Temporarily unavailable.', 'blame-the-tech-core' ) );
	}

	global $wpdb;

	// $wpdb->insert() builds a prepared statement from the format array.
	// There is no SQL string in this function to concatenate anything into.
	$wpdb->insert(
		leads_table(),
		array(
			'created_at' => current_time( 'mysql', true ),
			'email'      => $email,
			'full_name'  => $full_name,
			'company'    => '' !== $company ? $company : null,
			'team_size'  => '' !== $team_size ? $team_size : null,
			'source'     => $source,
			'locale'     => in_array( $locale, array( 'en', 'uk', 'de' ), true ) ? $locale : 'en',
			'consent'    => 1,
			'ip_hash'    => lead_ip_hash( false !== $ip ? (string) $ip : '' ),
			'user_agent' => '' !== $agent ? $agent : null,
		),
		array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s' )
	);

	// A duplicate violates UNIQUE KEY (email, source) and returns false. That
	// is SUCCESS from the caller's point of view: telling them the address is
	// already on the list is the same enumeration oracle as in §8.
	return array( 'accepted' => true );
}

/** Register the mutation. */
function register_submit_hobt_lead_mutation(): void {
	register_graphql_mutation(
		'submitHobtLead',
		array(
			'description'         => __( 'Record a HOBT demo lead. Server-to-server only: requires the X-BTT-App-Token header. Returns `accepted: true` for a duplicate, on purpose.', 'blame-the-tech-core' ),
			'inputFields'         => array(
				'email'    => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'Lead email address.', 'blame-the-tech-core' ),
				),
				'fullName' => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'Lead name, 1–190 characters.', 'blame-the-tech-core' ),
				),
				'company'  => array(
					'type'        => 'String',
					'description' => __( 'Optional company name.', 'blame-the-tech-core' ),
				),
				'teamSize' => array(
					'type'        => 'String',
					'description' => __( 'Optional team-size bucket.', 'blame-the-tech-core' ),
				),
				'source'   => array(
					'type'        => array( 'non_null' => 'LeadSource' ),
					'description' => __( 'Which HOBT surface produced the lead.', 'blame-the-tech-core' ),
				),
				'locale'   => array(
					'type'        => 'String',
					'description' => __( 'One of en, uk, de.', 'blame-the-tech-core' ),
				),
				'consent'  => array(
					'type'        => array( 'non_null' => 'Boolean' ),
					'description' => __( 'Must be true. Recorded, and required.', 'blame-the-tech-core' ),
				),
			),
			'outputFields'        => array(
				'accepted' => array(
					'type'        => array( 'non_null' => 'Boolean' ),
					'description' => __( 'True when the lead was accepted. No row ID is returned and duplicates are indistinguishable from new leads.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $payload ): bool => ! empty( $payload['accepted'] ),
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\submit_hobt_lead_payload',
		)
	);
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_submit_hobt_lead_mutation' );
```

**Verify §5:**

- [ ] There is no SQL string in the file other than the `SHOW TABLES LIKE %s` inside
      `$wpdb->prepare()`.
- [ ] `$wpdb->insert()` is called with a **format array** whose length matches the data array.
- [ ] `ip_hash` is an HMAC and `REMOTE_ADDR` is never stored, echoed or logged.
- [ ] The payload has no row ID and no duplicate flag.

### Step 6: Load the four files

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
		'includes/graphql/enums.php',                      // Lesson 06.1
		'includes/graphql/fields.php',                      // Lesson 06.1
		'includes/graphql/app-token.php',                   // Lesson 06.2
		'includes/graphql/mutation-create-incident.php',     // Lesson 06.2
		'includes/graphql/mutation-register-developer.php',  // Lesson 06.2
		'includes/graphql/mutation-submit-hobt-lead.php',    // Lesson 06.2
```

**Verify §6:**

- [ ] `app-token.php` is listed **before** the two mutations that call `require_app_token()`.
      Function declarations hoist within a file, not across a `require` that has not run yet.
- [ ] `docker compose logs --tail=60 wordpress` shows no `Failed opening required` and no fatal.

### Step 7: Put the app token in the environment

Add the variable to `wordpress-headless/.env`, which you confirmed gitignored in Lesson 02.2:

```bash
cd wordpress-headless
git check-ignore -v .env
# Expected: a .gitignore rule. NO OUTPUT MEANS STOP.

printf 'BTT_APP_TOKEN=%s\n' "$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)"
```

Paste the printed line into `.env`, add the name (never the value) to `.env.example` as
`BTT_APP_TOKEN=__CHANGE_ME__`, then restart so the container picks it up:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker compose exec wordpress php -r 'echo getenv("BTT_APP_TOKEN") ? "set\n" : "MISSING\n";'
# Expected: set
```

> **The token is a value in a gitignored env file that Compose injects, and nowhere else.** Not
> in `docker-compose.yml`, not in an option row, not in the image (`docker history` prints build
> args), and not in your shell profile. For the Verification block below, read it into the
> **current session only** — close the terminal and it is gone.

---

## Verification

```bash
cd wordpress-headless

# 0. Read the token into this shell session only. Never into a dotfile.
export BTT_APP_TOKEN="$(grep -E '^BTT_APP_TOKEN=' .env | cut -d= -f2-)"
test -n "$BTT_APP_TOKEN" && echo 'token loaded into this session' || echo 'MISSING — see Step 7'
# Expected: token loaded into this session

# 1. The generated mutations are gone and the custom ones are present
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"RootMutation\"){ fields { name } } }"}' \
  | jq -r '.data.__type.fields[].name' | sort > /tmp/mutations.txt
grep -cE '^(updateIncident|deleteIncident)$' /tmp/mutations.txt
# Expected: 0 — removed by graphql_exclude_mutations in Step 1
grep -cE '^(createIncident|registerDeveloper|submitHobtLead)$' /tmp/mutations.txt
# Expected: 3

# 2. The input type has our fields, and does NOT have authorId
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"CreateIncidentInput\"){ inputFields { name } } }"}' \
  | jq -r '.data.__type.inputFields[].name' | sort | tr '\n' ' '
# Expected: blameConfidence body clientMutationId downtimeMinutes environment
#           estimatedCostUsd isVerified occurredAt reporterDisplayName
#           resolutionStatus scapegoatSlug severitySlug stackTrace status title
#           ... and NO authorId

# 3. NEGATIVE: anonymous createIncident is refused, and writes nothing
curl -s -o /tmp/anon.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId}}}",
       "variables":{"i":{"title":"Anon probe 062","scapegoatSlug":"the-intern","severitySlug":"s2-major",
                         "occurredAt":"2024-01-01 10:00:00","downtimeMinutes":10,"environment":"PRODUCTION"}}}'
# Expected: HTTP 200 — refusal arrives with a 200 (Lesson 05.5 §3)
jq -r '.errors[0].message' /tmp/anon.json
# Expected: You must be signed in to submit an incident.
docker compose run --rm wpcli wp post list --post_type=incident --title='Anon probe 062' --format=count
# Expected: 0   ← the negative that matters

# 4. Build the payload once. Single-quoted, so the shell expands nothing.
Q_OK='mutation { createIncident(input:{
  title:"Forced status probe", body:"<p>ok</p><script>alert(1)</script>",
  scapegoatSlug:"the-intern", severitySlug:"s1-catastrophic",
  occurredAt:"2024-06-01 09:00:00", downtimeMinutes:42,
  environment:WORKS_ON_MY_MACHINE, status:PUBLISH, isVerified:true
}) { incident { databaseId status } } }'

# 5. THE PAYOFF: run it AS the reporter. `wp_set_current_user` exercises exactly
#    the authorisation path the JWT will exercise in Module 15, without needing
#    the JWT plugin yet. The client asks for PUBLISH and isVerified true.
docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "reporter" )->ID );
  echo wp_json_encode( graphql( array( "query" => $argv[0] ) ) ), PHP_EOL;' "$Q_OK"
# Expected: data.createIncident.incident with a databaseId, and status "pending"
#           (some WPGraphQL versions report "PENDING"). In NO case "publish".

ID=$(docker compose run --rm wpcli wp post list --post_type=incident \
  --title='Forced status probe' --field=ID --format=ids | tr -d '\r')

docker compose run --rm wpcli wp post get "$ID" --field=post_status
# Expected: pending   ← the client sent PUBLISH and PHP did not listen
docker compose run --rm wpcli wp post get "$ID" --field=post_author
# Expected: the reporter's user ID — not 0, and not the administrator's
docker compose run --rm wpcli wp post meta get "$ID" is_verified
# Expected: empty or 0 — the client sent true and it was discarded
docker compose run --rm wpcli wp post get "$ID" --field=post_content
# Expected: <p>ok</p> — the <script> tag was stripped by wp_kses_post()
docker compose run --rm wpcli wp post meta get "$ID" environment
# Expected: works-on-my-machine — the enum name arrived, the kebab value was stored

# 6. NEGATIVE: the term allowlist. A well-shaped slug that does not exist is refused,
#    no term is created, and no orphan post is left behind.
Q_BADTERM='mutation { createIncident(input:{
  title:"Invented scapegoat probe", scapegoatSlug:"the-security-researcher",
  severitySlug:"s2-major", occurredAt:"2024-06-01 09:00:00",
  downtimeMinutes:5, environment:STAGING
}) { incident { databaseId } } }'

docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "reporter" )->ID );
  $r = graphql( array( "query" => $argv[0] ) );
  echo $r["errors"][0]["message"] ?? "NO ERROR — unexpected", PHP_EOL;' "$Q_BADTERM"
# Expected: That scapegoat does not exist.

docker compose run --rm wpcli wp term list scapegoat --field=slug | grep -c 'the-security-researcher'
# Expected: 0 — wp_set_object_terms() never saw a string, so it created nothing
docker compose run --rm wpcli wp post list --post_type=incident --title='Invented scapegoat probe' --format=count
# Expected: 0 — validation ran before the insert, so there is no half-written post

# 7. NEGATIVE: a future date is rejected, not silently clamped to `now`
Q_FUTURE='mutation { createIncident(input:{
  title:"Future probe", scapegoatSlug:"dns", severitySlug:"s3-minor",
  occurredAt:"2099-01-01 00:00:00", downtimeMinutes:1, environment:STAGING
}) { incident { databaseId } } }'

docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "reporter" )->ID );
  $r = graphql( array( "query" => $argv[0] ) );
  echo $r["errors"][0]["message"] ?? "NO ERROR — unexpected", PHP_EOL;' "$Q_FUTURE"
# Expected: occurredAt must be a valid date and time that is not in the future.

# 8. NEGATIVE: the WRONG-CAPABILITY case. A core `contributor` is fully authenticated
#    and still refused, because appendix 03 §6 gives contributor no create_incidents.
export BTT_CONTRIB_PASSWORD="$(openssl rand -base64 24)"
docker compose run --rm wpcli wp user create contrib contrib@example.test \
  --role=contributor --user_pass="$BTT_CONTRIB_PASSWORD" >/dev/null

Q_CONTRIB='mutation { createIncident(input:{
  title:"Contributor probe", scapegoatSlug:"dns", severitySlug:"s3-minor",
  occurredAt:"2024-06-01 09:00:00", downtimeMinutes:1, environment:STAGING
}) { incident { databaseId } } }'

docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "contrib" )->ID );
  $r = graphql( array( "query" => $argv[0] ) );
  echo $r["errors"][0]["message"] ?? "NO ERROR — unexpected", PHP_EOL;' "$Q_CONTRIB"
# Expected: You are not allowed to submit incidents.
#           Authenticated is NOT authorised. This is the second negative that matters.
docker compose run --rm wpcli wp post list --post_type=incident --title='Contributor probe' --format=count
# Expected: 0

# 8b. Once Module 15 installs WPGraphQL JWT, the same three checks run over HTTP with
#     `-H "Authorization: Bearer <jwt>"` and must give byte-identical answers. Nothing in
#     the mutation distinguishes a CLI caller from an HTTP one — that is the design.

# 9. NEGATIVE: registerDeveloper with NO app token
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{registerDeveloper(input:{email:\"a@example.test\",displayName:\"A\"}){accepted}}"}' \
  | jq -r '.errors[0].message'
# Expected: Not authorized.

# 10. NEGATIVE: registerDeveloper with a WRONG app token — identical message, no extra detail
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H 'X-BTT-App-Token: not-the-token' \
  -d '{"query":"mutation{registerDeveloper(input:{email:\"a@example.test\",displayName:\"A\"}){accepted}}"}' \
  | jq -r '.errors[0].message'
# Expected: Not authorized.   ← byte-identical to check 9. No hint about length or prefix.
docker compose run --rm wpcli wp user list --field=user_email | grep -c 'a@example.test'
# Expected: 0

# 11. The CORRECT app token registers a reporter with the right role and btt_verified 0
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{registerDeveloper(input:{email:\"newdev@example.test\",displayName:\"New Dev\"}){accepted email}}"}' \
  | jq '.data.registerDeveloper'
# Expected: {"accepted": true, "email": "newdev@example.test"}
docker compose run --rm wpcli wp user get newdev@example.test --field=roles
# Expected: incident_reporter
docker compose run --rm wpcli wp user meta get newdev@example.test btt_verified
# Expected: 0

# 12. The verification mail was captured by Mailpit and never left the machine
curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].Subject'
# Expected: Confirm your Blame The Tech account

# 13. NEGATIVE: no account-enumeration oracle. The SAME email again returns the SAME payload.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{registerDeveloper(input:{email:\"newdev@example.test\",displayName:\"New Dev\"}){accepted email}}"}' \
  | jq '.data.registerDeveloper'
# Expected: {"accepted": true, "email": "newdev@example.test"} — identical to check 11
docker compose run --rm wpcli wp user list --field=user_email | grep -c 'newdev@example.test'
# Expected: 1 — one user, two identical answers

# 14. submitHobtLead: the token is checked BEFORE anything else, and the error leaks nothing
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{submitHobtLead(input:{email:\"l@example.test\",fullName:\"L\",source:HOBT_HERO,consent:true}){accepted}}"}' \
  | jq -r '.errors[0].message'
# Expected: Not authorized.

curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{submitHobtLead(input:{email:\"l@example.test\",fullName:\"L\",source:HOBT_HERO,consent:true}){accepted}}"}' \
  | jq -r '.errors[0].message // "accepted"'
# Expected: Temporarily unavailable.
#           wp_btt_leads arrives in Module 16. Note what the message does NOT say:
#           no table name, no plugin name, no SQL.

# 15. No error message anywhere in this lesson leaked a path, a plugin or SQL
grep -RiEl 'blame-the-tech-core/includes|wpdb|SELECT |INSERT INTO' /tmp/anon.json
# Expected: no output

# 16. Clean up every probe
docker compose run --rm wpcli wp post delete "$ID" --force
docker compose run --rm wpcli wp user delete newdev@example.test --yes
docker compose run --rm wpcli wp user delete contrib --yes
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: the count you had before this lesson

# 17. Nothing secret is staged
git status --short
git check-ignore -v .env
# Expected: .env absent from git status; check-ignore names a rule
```

Checks 3, 8, 5 and 10 are the four that define this lesson: anonymous is refused, authenticated
but unauthorised is refused, a client-chosen `status` and `isVerified` are discarded, and a wrong
token is answered with exactly as much information as no token.

## Control Questions

1. A colleague adds a `deleteIncident` mutation with `register_graphql_mutation` and no
   `current_user_can()` call. They test it while logged in as an administrator and it works
   correctly. Write the single `curl` command that demonstrates the bug, and say why their test
   could never have found it.
2. `createIncident` accepts a `status` input field and always ignores it, while `isVerified` is
   ignored *only* for callers without `edit_others_incidents`. Explain why the same principle
   produces two different rules, and what would break if you deleted `isVerified` from the input
   type instead.
3. `sanitize_key( 'the-security-researcher' )` returns `the-security-researcher` unchanged, and
   the mutation still rejects it. Say what the extra check is, why a regular expression could
   never replace it, and what `wp_set_object_terms()` would have done with the raw string.
4. Replace `hash_equals( $expected, $provided )` with `$expected === $provided`. Describe the
   attack that becomes possible, roughly how many requests it needs against a 48-character
   token, and why `===` does not help even though it is strict.
5. `registerDeveloper` returns `accepted: true` for an email that is already registered, and
   `submitHobtLead` returns `accepted: true` for a duplicate lead. Name the class of
   vulnerability both are avoiding, and describe the user-experience cost the design accepts in
   exchange.

## Learn More

- [`register_graphql_mutation()`](https://www.wpgraphql.com/functions/register_graphql_mutation/) —
  the config keys used in all three files, including the `isPrivate` and `auth` keys this lesson
  deliberately does not rely on
- [WPGraphQL — Mutations](https://www.wpgraphql.com/docs/wpgraphql-mutations) — `register_graphql_mutation`
  and how to extend an existing mutation. The Relay input/payload convention this lesson leans on is
  no longer spelled out in these docs; read the generated schema for it instead
- [OWASP — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) — the
  category a missing `current_user_can()` in a resolver falls into; read the "Missing function
  level access control" examples
- [OWASP — GraphQL Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html) —
  authorisation, input validation and error hygiene for GraphQL specifically
- [`hash_equals()`](https://www.php.net/manual/en/function.hash-equals.php) — one paragraph, and
  the argument order note that Key Concept 7 depends on
- [Data Validation — WordPress Plugin Handbook](https://developer.wordpress.org/apis/security/data-validation/) —
  core's own sanitise-versus-validate table; the vocabulary the whole course uses
- [`wp_set_object_terms()`](https://developer.wordpress.org/reference/functions/wp_set_object_terms/) —
  read the `$terms` parameter description and notice exactly when it creates a term
- [`wpdb::insert()`](https://developer.wordpress.org/reference/classes/wpdb/insert/) — the format
  array, and why it makes the call a prepared statement
- [OWASP — Account enumeration](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/04-Testing_for_Account_Enumeration_and_Guessable_User_Account) —
  why `registerDeveloper` answers identically for a known and an unknown email
