---
title: 'Public Registration & Roles'
module: 15
lesson: 3
teaches: [register-developer-mutation, map-meta-cap, structural-authorization, role-hardening, email-verification]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-verify-developer.php', 'next-app/src/actions/auth.ts', 'next-app/src/components/auth/AuthForm.tsx', 'next-app/src/app/[locale]/(auth)/register/page.tsx', 'next-app/src/app/[locale]/(auth)/verify/page.tsx']
requires: [3.4, 6.3, 15.2]
---

# Lesson 15.3 — Public Registration & Roles

## Quick Overview

Public developers need accounts, and WordPress has a perfectly good registration system you are
about to deliberately not use. `users_can_register` stays **off** and `/wp-login.php?action=register`
stays closed, because opening it would create a second door into the same user table — one that
assigns `get_option('default_role')` instead of the role this app actually needs, and one you
would then have to remember to harden separately. Registration goes through the custom
`registerDeveloper` mutation from Module 06 instead, which assigns `incident_reporter`
explicitly, sets `btt_verified = 0`, and sends a verification mail. One door, not two.

The role itself is where the real lesson is. Look at the capability matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) and notice
what `incident_reporter` does **not** have: `publish_incidents`. That single omission is what
makes moderation structural rather than procedural. There is no code path by which a public user
publishes an incident — not because a check in the mutation catches them, but because
WordPress's own authorization layer has no capability to grant. Compare that with the version of
this feature you have probably written before: an `if ( $status === 'publish' ) { wp_die(); }`
somewhere in a handler, which is correct exactly as long as every future contributor remembers
it exists and no second handler is ever added. In this lesson you will also strip
`edit_posts` from the role so it cannot reach the block editor or upload media, turn off its
admin bar, and redirect it away from wp-admin on `admin_init` — public users get a front end,
not a dashboard.

By the end of this lesson you will have:

- `users_can_register` confirmed off, with a `curl` showing `/wp-login.php?action=register` does
  not offer a registration form
- A hardened `incident_reporter` role in `includes/roles.php`: no `edit_posts`, no
  `upload_files`, no `publish_incidents`, no admin bar, redirected out of wp-admin
- A working `registerDeveloper` call that creates the user with the right role and queues a
  verification mail, visible in Mailpit on `:8025`
- `/en/register` and `/en/verify` pages wired to the mutation through a Server Action, with the
  app token sent server-side only
- A capability probe — a `curl` proving a freshly registered reporter's token cannot publish,
  and cannot even read `/wp-admin/`
- A note in your own words on why `registerUser` (WPGraphQL's built-in) is the wrong mutation here

## Classic WP Analogy

You have configured this exact feature before, from Settings → General → "Anyone can register",
with `default_role` set to Subscriber. Under the hood that path runs `register_new_user()` →
`wp_create_user()` → `wp_new_user_notification()`, and every membership plugin you have installed
has hooked `user_register` to bolt extra behaviour onto it. `registerDeveloper` is the same
sequence, called from a mutation resolver instead of from a form handler, with the role passed
explicitly instead of read from an option.

The capability model is not an analogy at all — it is *literally the same system*. `add_role()`,
`WP_Role::add_cap()`, `current_user_can()`, `map_meta_cap` and the generated
`edit_incident` / `publish_incidents` / `edit_others_incidents` family behave in the headless
build exactly as they behave in a classic theme. If you have ever debugged why a Contributor
could not publish, you already understand the moderation queue in this application. The
difference is only that the check now runs inside a GraphQL resolver rather than inside
`wp-admin/post.php`.

**Where the analogy breaks down:** in a classic site, "logged in" and "in wp-admin" are nearly
the same state. A Subscriber who logs in lands on the dashboard, sees the admin bar on the front
end, and has a profile screen. Here, `incident_reporter` is a **front-end-only identity**. It has
a WordPress user row, a password hash and a set of capabilities, but it must never see wp-admin —
so `show_admin_bar_front` is off and `admin_init` redirects it away. That inverts a reflex: in
classic WordPress you *grant* capabilities to let a role do its job in the dashboard; here you
withhold nearly everything and let the role act only through mutations your own code exposes.
Anything you forget to remove is reachable surface.

The second break: `wp_new_user_notification()` mails a password-reset link into wp-login. That is
the wrong destination for a user who is not allowed into wp-admin, so this lesson replaces the
notification with one that links to `/en/verify` on the Next app. Mail is captured by Mailpit
locally, which is why Module 02 put it in the Compose file.

---

## Key Concepts

### 1. One registration door, and why an honest error message is a vulnerability

Lesson 03.5 §7 set `users_can_register` to `0` and pointed at Module 06, which built the door.
This lesson checks the lock and adds the second bolt. The door is `registerDeveloper` (Lesson
06.2), and the property worth revisiting looks like a bug the first time you meet it:

```
  POST registerDeveloper { email: "new@example.test" }        POST registerDeveloper { email: "already@example.test" }
        │                                                            │
        ▼                                                            ▼
  create the user, mail a code                              email_exists() → return early, mail nothing
        │                                                            │
        ▼                                                            ▼
  { accepted: true, email: "new@example.test" }              { accepted: true, email: "already@example.test" }
                    └──────────── BYTE-IDENTICAL PAYLOADS ───────────┘
```

Point ten thousand email addresses at your registration endpoint and read the responses. If a
registered address answers differently from an unregistered one — a different message, field,
status code, or a *measurably* different response time — the endpoint is an
**account-enumeration oracle**, and the attacker now knows which of those ten thousand people has
an account with you. A privacy breach with no exploit code in it.

"That email is already registered" says it outright. "Welcome back — check your inbox" says it
politely. A `409 Conflict` says it in a status code. A 4 ms response against a 180 ms one says it
to anyone who measures.

The cost, stated plainly: a genuine user who forgot they registered gets a "check your inbox"
message and no email arrives. A real, annoying failure, and this design accepts it. The mitigation
is copy, not logic — the confirmation screen says "if you already have an account, use Sign in
instead", which helps the honest user without answering the attacker's question.

> **The front end can undo this in one line.** WordPress returns the same payload; render "we
> sent you an email" for one case and "that address is taken" for another and you have rebuilt the
> oracle in TypeScript. Task Step 6's `register` has one success message for one reason.

### 2. `registerUser` versus `registerDeveloper`

WPGraphQL ships a `registerUser` mutation. It is the wrong tool here, and it is worth being
specific about why.

| | `registerUser` (WPGraphQL built-in) | `registerDeveloper` (Lesson 06.2) |
|---|---|---|
| Precondition | requires `users_can_register = 1`, which **opens `/wp-login.php?action=register`** | none; the option stays `0` |
| Role assigned | `get_option( 'default_role' )` — whatever the site happens to have | `REPORTER_ROLE`, explicitly, from a constant |
| Authentication | none, by design | **app token**, `hash_equals()` compared |
| Email verification | none | hashed, expiring, single-use code |
| Payload | a `User` node | `{ accepted, email }` and nothing else |

**Verdict: `registerDeveloper`, and it is not close.** The first row settles it: turning on
`users_can_register` opens a second registration door — an HTML form on wp-login that applies
none of your rules, assigns whatever `default_role` is, and that you must remember exists every
time you harden anything.

The fifth row is the one people skip. `registerUser` returns a `User` node to an
**unauthenticated caller**, so the moment it is reachable it is a user-data read API with a create
side effect. `registerDeveloper` returns a boolean and an echo of the submitted email, so a leaked
app token cannot become a directory of your users
([appendix 03 §7](../appendix/03-content-model-reference.md#7-custom-graphql-fields-and-mutations)).

### 3. Structural authorization: the capability that does not exist

`REPORTER_CAPS` is three strings, and what is **absent** does more work than what is present.
Lesson 03.5 wrote it; read it again with fresh eyes:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php — (already written, Lesson 03.5)
const REPORTER_CAPS = array(
	'read'             => true,
	'create_incidents' => true,
	'edit_incidents'   => true,
);
```

No `publish_incidents` means `wp_insert_post()` **downgrades** a `publish` request to `pending`
— in wp-admin, REST, WP-CLI, GraphQL, and code nobody has written yet. No
`edit_published_incidents` means editing rights expire the moment a moderator publishes, with no
code of yours involved. No `edit_others_incidents` means a reporter cannot touch another
reporter's submission. No `edit_posts` means no block editor, no Posts menu, nothing to see in
wp-admin. And no `upload_files` means no arbitrary-file surface at all.

Compare the two ways of achieving "public users cannot publish":

```
  PROCEDURAL                                  STRUCTURAL
  ────────────────────────────────────        ────────────────────────────────────
  if ( 'publish' === $status ) deny();        the role has no publish_incidents

  ✅ the mutation you remembered              ✅ the mutation
  ❌ the REST route added next quarter        ✅ the REST route
  ❌ the WP-CLI command in a cron             ✅ the WP-CLI command
  ❌ the second mutation someone copies       ✅ the second mutation
  ❌ wp-admin, if the role reaches it         ✅ wp-admin

  correct where you wrote it                 correct because WordPress funnels
                                              every path through one check
```

**The rule this course applies everywhere: if a permission can be expressed as the absence of a
capability, express it that way.** A check you have to remember to write is a check someone will
eventually forget. This lesson's new work is the same idea applied to *verification*, which is
why it lands in a `map_meta_cap` filter and not in an `if` inside the mutation.

### 4. `map_meta_cap` in depth, and the `do_not_allow` idiom

`map_meta_cap` is a function **and** a filter with the same name, and the filter is the extension
point almost nobody uses even though it is the right one.

```php
// (illustration of core's flow, not a file you write)
current_user_can( 'create_incidents' )
        │
        ▼
WP_User::has_cap( 'create_incidents' )
        │
        ▼
map_meta_cap( 'create_incidents', $user_id )        ← the FUNCTION
        │   a switch over the known meta caps; `default` returns array( $cap )
        ▼
apply_filters( 'map_meta_cap', $caps, $cap, $user_id, $args )   ← the FILTER, your hook
        │
        ▼
does the user hold every primitive capability in the returned array?
```

Four properties of the filter matter, and three of them are commonly got wrong:

It runs for **every** `current_user_can()` call, not only meta capabilities, so your callback must
return `$caps` untouched for every `$cap` it does not care about — check the name **first**, before
any database read. It receives the **user ID** rather than the current user, so it works for
`user_can( $other, … )` and you must never reach for `wp_get_current_user()` inside it. It returns
a list of **primitive** capabilities that must all be held, which is why `array( 'do_not_allow' )`
denies: no role holds a capability by that name. And `user_can()` inside the callback re-enters
the filter, which is safe **only** because the re-entry carries a different `$cap` and returns on
the first line.

`do_not_allow` is not a special-cased sentinel in WordPress; it is simply a capability string
that no role has and none ever will. That is why it works, and it is why the idiom is stable
across versions.

Now the comparison that justifies the design:

| Where to enforce "unverified users cannot create" | Covers |
|---|---|
| An `if` at the top of `createIncident` | that one mutation, until someone adds a second write path |
| A `rest_pre_dispatch` check | REST only |
| **A `map_meta_cap` filter on `create_incidents`** | **every caller of `current_user_can( 'create_incidents' )` — the mutation, wp-admin, REST, WP-CLI, and any future code, including code that forgot this feature exists** |

The mutation's own `current_user_can( 'create_incidents' )` line from Lesson 06.2 does not change
by a character. It simply starts returning `false` for unverified users, because the filter
rewrote what that capability resolves to. **That is the shape you want: a new rule that existing
correct code obeys without being edited.**

### 5. "Own, while pending" is free, and writing it yourself would be a bug

[Appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) says
`incident_reporter` may edit its own incident `✓ while pending`. No code in this course implements
that, and none must.

```
current_user_can( 'edit_incident', 4711 )
        │
        ▼
   map_meta_cap()  ── is $user_id the author of 4711?
        │                 │
        │                 ├── yes, and it is `pending`    → requires edit_incidents            ✅ held
        │                 ├── yes, and it is `publish`     → requires edit_published_incidents  ❌ absent
        │                 └── no                           → requires edit_others_incidents     ❌ absent
        ▼
   three different answers, from two absent strings and zero lines of your code
```

So appendix 03 §6's third column is produced by **omitting** two capabilities from an array.
Writing the author-and-status logic yourself means reimplementing forty lines of core that are
already correct, already applied by wp-admin, REST and WP-CLI, and already tested by WordPress's
own suite. Lesson 03.5 Verification check 6 demonstrated it: same user, same post, `can-edit`
before publication and `cannot-edit` after.

> **Saying "core already does this" is more valuable than writing code that duplicates core.**
> The temptation is strongest exactly here, because the requirement reads like a feature. Read
> `map_meta_cap()`'s `edit_post` case once — it is about forty lines — and you will stop reaching
> for the `if`.

### 6. `ROLES_VERSION` is a migration, and `btt_verified` has three states

Lesson 03.5 §1 established that `add_role()` is a one-time database write, so editing
`REPORTER_CAPS` changes nothing on a site where the role already exists. The fix was a version
number you bump by hand, and this lesson bumps it from `'1'` to `'2'`.

```
activate()  ──▶  get_option('btt_roles_version')
                       │
                       ├── === ROLES_VERSION and the role exists  → return, do nothing
                       │
                       └── differs or absent
                                ├── remove_role( 'incident_reporter' )   ← discard the old caps
                                ├── add_role( … REPORTER_CAPS … )        ← re-create clean
                                └── update_option( 'btt_roles_version', ROLES_VERSION )
```

Remove-then-add rather than patching, because **patching only ever adds**: delete a capability
from the array and a patch-based sync leaves the old one in the database forever. It is safe
because **a role definition is not a user** — `remove_role()` deletes the definition, users keep
the role *name* in `wp_capabilities`, and they pick up the new definition the instant it is
re-added.

And now the part this lesson adds, which is where the sharp edge lives. `btt_verified` looks like
a boolean and has **three** states, because `get_user_meta( $id, 'btt_verified', true )` returns
the empty string when the row does not exist at all:

| Value returned | Meaning | Who is in this state |
|---|---|---|
| `'0'` | created through `registerDeveloper` and **not yet verified** | every public signup, until they click the emailed link |
| `'1'` | verified | every signup that clicked it, and the seeded fixtures |
| `''` | **the row does not exist** | anyone created by an administrator, WP-CLI or a seeder that predates this lesson |

The filter must deny on `'0'` and **only** on `'0'`. Test for falsiness instead and you have
written a different rule, because in PHP `'' == 0` is `true`:

```php
// ❌ Denies every account that has no btt_verified row — which is the seeded
//    `reporter`, the seeded `e2e_agent`, the seeded `editor`, and anybody an
//    administrator adds by hand. `'' == 0` is true. (illustration of the trap)
if ( ! get_user_meta( $user_id, 'btt_verified', true ) ) { … }

// ✅ Denies only a real, explicit zero. (illustration of the fix)
if ( '0' === get_user_meta( $user_id, 'btt_verified', true ) ) { … }
```

> **This is the difference between a working fixture set and an unexplainable permission error.**
> Every E2E spec from Module 23 logs in as `reporter` or `e2e_agent`, and the seeded `editor`
> holds `create_incidents` for moderation. A falsy test locks out all three, and the symptom is
> `createIncident` refusing a user who is plainly signed in — which you will spend an hour blaming
> on the front end. An absent row means "this account did not come through the public door", which
> is exactly the right thing to treat as trusted, because `registerDeveloper` **always** writes an
> explicit `0`. Lesson 04.5's seeder states the same intent from the other side by writing
> `btt_verified = 1` for its fixture users.

### 7. A verification code must be hashed, expiring and single use

`registerDeveloper` already does two thirds of this (Lesson 06.2). Name each property separately,
because they defend against different things.

**Hashed at rest** — `hash( 'sha256', $code )` in `btt_verify_hash`, with the raw code existing
only in the email — defends against a database read, a leaked backup, a SQL injection elsewhere
and an over-broad `wp user meta list`. **Expiring** (`btt_verify_expires`, 24 hours) defends
against an old inbox, a forwarded email and a link sitting in a shared mailbox six months later.
**Single use** (both meta rows deleted on success) defends against replay from browser history,
from a proxy log, from a copied link. And a **constant-time compare** with `hash_equals()` defends
against the same timing oracle as the app token (Lesson 06.2 §7).

The first of those is the one to internalise as a general rule: **a database read must not yield a
usable credential.** Password reset tokens, API keys, invitation codes, magic-link tokens — all
of them get stored as a hash and mailed in the clear, for exactly this reason. WordPress core
does the same thing with `user_activation_key`.

And now the property this lesson has to add, because without it the whole flow dead-ends.
`registerDeveloper` sets the new user's password with `wp_generate_password( 32, true, true )` and
**never returns or mails it** — its own comment says "the user sets their own via the reset flow;
Module 15 wires that up". This is Module 15 discharging that debt. Nothing in this module's
`produces:` is a reset flow, so a registered developer would otherwise have a working account, a
verified email and no way to sign in. `verifyDeveloper` therefore takes a `password` alongside the
code:

```
   register  ──▶  user exists, random password nobody has, btt_verified = 0
                  code hashed into user meta, raw code mailed
        │
        │  GET /verify?uid=7&token=<code>     ← renders a form. A GET must not mutate.
        ▼
   verify    ──▶  code checked with hash_equals, then CONSUMED
                  wp_set_password( <the user's choice> )
                  btt_verified = 1
        │
        ▼
   login     ──▶  works, because there is now a password the human chose
```

The verification link is a **proof of email possession**, and the moment you have that proof is
exactly the right moment to let the human choose a password. Making verification and
credential-setting one atomic step is both better UX and a smaller attack surface than a second
email carrying a second token to a second page.

The cost, stated plainly: **this course never builds a standalone forgotten-password flow**, and a
real production app wants one. A user who forgets their password after verifying has nowhere to go
in this application, because `/wp-login.php?action=lostpassword` mails a link into wp-admin — the
one place an `incident_reporter` may not be. Naming that gap is more useful than pretending the
verify page covers it.

> **`wp_set_password()` also destroys that user's existing sessions and clears any pending
> password-reset key.** Both are what you want here, and neither is obvious from the function
> name. Read the source before you use it anywhere else.

### 8. `wp_new_user_notification()` and the headless problem

There is a path into your user table that has nothing to do with your mutation: an editor going to
**Users → Add New** and creating a reporter by hand. Core then calls
`wp_new_user_notification()`, which mails a `/wp-login.php?action=rp&key=…` link — to the one place
this user may not go, since `incident_reporter` is bounced off wp-admin on `admin_init` and has no
`edit_posts`. The notification is right for an editor and wrong for a reporter.

Two ways to change it, and the choice is instructive:

You could redeclare the **pluggable function** `wp_new_user_notification()` — `pluggable.php`
loads after plugins, so a plugin can define it first. Do not: it is global-namespace,
all-or-nothing, silently conflicts with any other plugin doing the same, and makes you responsible
for the *administrator's* notification you never wanted to change. Filter
**`wp_new_user_notification_email`** instead, which returns the `to` / `subject` / `message` /
`headers` array for the user's copy. Scoped, composable, and it leaves the admin copy alone.

The callback is role-conditional, and that condition is the whole design: an `incident_reporter`
gets a fresh single-use code and a link to `{BTT_FRONTEND_URL}/verify?uid=&token=`, while an
editor or administrator gets **core's message, unchanged** — they *do* use wp-admin, and a reset
link into wp-login is right for them.

Note precisely what this replaces. **Not** `registerDeveloper`'s email — Lesson 06.2 already builds
a `{BTT_FRONTEND_URL}/verify` URL and sends it. What 15.3 replaces is **core's default
notification** on the wp-admin path, so both doors end up at the same front-end page.

### 9. The `host.docker.internal` mail trap

`BTT_FRONTEND_URL` is `http://host.docker.internal:3000` (Lesson 02.2 §7), because that is how
WordPress **inside the container** reaches Next.js on your **host**. Both emails therefore contain
a link like:

```
http://host.docker.internal:3000/verify?uid=7&token=aB3dEf…
                └──────────────┘
                a hostname that exists INSIDE the container and,
                on most host machines, resolves to nothing at all
```

You will open Mailpit at `http://localhost:8025`, click the link, and get a browser error. The
feature is working perfectly.

For WordPress talking to Next — Module 18's revalidation webhook — `host.docker.internal:3000` is
correct. For a human clicking a captured email on the host machine, `localhost:3000` is, and you
swap it by hand. In production it is the real front-end origin, from `BTT_FRONTEND_URL`.

> **Swap `host.docker.internal` for `localhost` when you click a captured link, every time.** The
> symptom is a dead link that looks exactly like a broken feature, and it will cost you twenty
> minutes at least once. Do **not** "fix" it by changing `BTT_FRONTEND_URL` to `localhost:3000`:
> that breaks Module 18's webhook, which is issued from inside the container, and the failure
> there is silent — publishing works, the webhook fires, and the front end serves stale content
> forever.

---

## Task

Be clear about what already exists, because a lesson claiming to build something Module 06 built
is the most expensive kind of confusion. Already done: `users_can_register = 0`, the
`incident_reporter` role, the `admin_init` redirect and the `show_admin_bar` filter (**Lesson
03.5**); `registerDeveloper` with its app-token guard, hashed verification code and
`{BTT_FRONTEND_URL}/verify` mail (**Lesson 06.2**). New here: `verifyDeveloper`, the
`map_meta_cap` filter, `ROLES_VERSION` `'2'`, the defensive capability strip, the notification
filter, and the two Next pages.

### Step 1: Confirm the door is still closed

Check before you build. Thirty seconds, and the precondition for everything else.

```bash
cd wordpress-headless

docker compose run --rm wpcli wp option get users_can_register
# Expected: 0

curl -s 'http://localhost:8080/wp-login.php?action=register' | grep -ci 'user_login'
# Expected: 0 — no registration form is served
```

**Verify §1:**

- [ ] `users_can_register` is `0`. A `1` means something re-enabled it; `close_wp_registration()`
      runs on activation, so re-activate and find out what changed it.
- [ ] The `grep` count is `0`. One or more means wp-login is serving a form, and you have two doors.

### Step 2: Bump the role version and add the three new pieces to `roles.php`

Three anchored edits to the file Lesson 03.5 created. Start with the version, which is what makes
the rest of them reach an existing site at all:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php — replace the constant
/**
 * Bump this whenever REPORTER_CAPS changes OR a new capability condition is
 * added. '1' → '2' in Lesson 15.3: create_incidents is now conditional on
 * btt_verified, and every existing reporter predates that condition.
 */
const ROLES_VERSION = '2';
```

Then append the two new functions and the two filters. The text domain is `blame-the-tech-core`,
the one the plugin header declares (Lesson 03.1):

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/roles.php — append

/**
 * Remove capabilities from `incident_reporter` that nothing should have added.
 *
 * ensure_reporter_role() rebuilds the role from REPORTER_CAPS, so in a clean
 * install this function finds nothing. It exists because a role lives in the
 * `wp_user_roles` OPTION — shared, writable state that any plugin or any
 * "user role editor" screen can add to. `upload_files` on this role would be an
 * arbitrary-file-write surface reachable by a public signup.
 *
 * Idempotent. Called from Plugin::activate() and NOT gated on ROLES_VERSION.
 */
function strip_reporter_extras(): void {
	$role = get_role( REPORTER_ROLE );

	if ( ! $role instanceof \WP_Role ) {
		return;
	}

	$never = array(
		'upload_files',
		'edit_posts',
		'publish_incidents',
		'edit_published_incidents',
		'edit_others_incidents',
		'delete_incidents',
	);

	foreach ( $never as $cap ) {
		if ( $role->has_cap( $cap ) ) {
			$role->remove_cap( $cap );
		}
	}
}

/**
 * Deny `create_incidents` until the account's email has been verified.
 *
 * The right hook, for the reason in Lesson 15.3 §4: the map_meta_cap FILTER
 * runs for every current_user_can() call, so the rule applies to the Module 06
 * mutation, to wp-admin, to REST, to WP-CLI, and to code nobody has written
 * yet. The alternative — an `if` inside createIncident — is correct exactly
 * once and one forgotten code path away from being bypassed.
 *
 * `array( 'do_not_allow' )` denies because no role holds a capability by that
 * name. It is not a special-cased sentinel; that is why it is stable.
 *
 * $user_id is left untyped and cast: this filter is called by third-party code
 * as well as core, and a strict_types fatal inside an authorisation filter
 * would fail OPEN on any path that swallows the error.
 *
 * @param array<int, string> $caps
 * @return array<int, string>
 */
function deny_create_incidents_until_verified( array $caps, string $cap, $user_id, array $args ): array {
	// Name check FIRST, before any database read. This callback runs on every
	// capability check in every request; everything below it must not.
	if ( 'create_incidents' !== $cap ) {
		return $caps;
	}

	$user_id = (int) $user_id;

	// Anonymous. Let the normal machinery deny it — narrowing this filter's
	// scope keeps its behaviour easy to reason about.
	if ( 0 === $user_id ) {
		return $caps;
	}

	// THE THREE-STATE READ, and the whole reason Lesson 15.3 §6 exists.
	// get_user_meta( …, true ) returns '' when the row does not EXIST, and '0'
	// only when registerDeveloper wrote an explicit zero. Deny on '0' and only
	// on '0'. A falsy test — `! get_user_meta(...)` — would also match '',
	// because `'' == 0` is true in PHP, and would therefore lock out the seeded
	// reporter, e2e_agent and editor, plus every account an administrator adds
	// by hand. An absent row means "not created through the public door".
	if ( '0' !== get_user_meta( $user_id, 'btt_verified', true ) ) {
		return $caps;
	}

	// It really does say 0. One last exemption: an editor or administrator whose
	// meta was set to 0 by hand is not a public signup. user_can() re-enters
	// this filter with a DIFFERENT $cap, which returns on the first line of the
	// function, so there is no recursion. Get that ordering wrong and there is.
	if ( user_can( $user_id, 'edit_others_incidents' ) ) {
		return $caps;
	}

	return array( 'do_not_allow' );
}
add_filter( 'map_meta_cap', __NAMESPACE__ . '\\deny_create_incidents_until_verified', 10, 4 );

/**
 * Point core's new-user notification at the Next.js /verify page, for reporters.
 *
 * The wp-admin "Users → Add New" path calls wp_new_user_notification(), which
 * mails a /wp-login.php?action=rp link — into the one place an incident_reporter
 * may not go. Filtering `wp_new_user_notification_email` is scoped and
 * composable; redeclaring the pluggable function would be global and would
 * conflict with any other plugin doing the same (Lesson 15.3 §8).
 *
 * This does NOT replace registerDeveloper's own mail. Lesson 06.2 already sends
 * that one.
 *
 * @param array<string, string> $email `to`, `subject`, `message`, `headers`.
 * @return array<string, string>
 */
function reporter_new_user_notification_email( array $email, \WP_User $user, string $blogname ): array {
	if ( ! in_array( REPORTER_ROLE, (array) $user->roles, true ) ) {
		// Editors and administrators DO use wp-admin. Core's message is correct
		// for them and this filter leaves it entirely alone.
		return $email;
	}

	// A fresh single-use code, hashed at rest. Declared in
	// includes/graphql/mutation-verify-developer.php — all INCLUDES are required
	// before any hook fires, so load order does not matter for a call site.
	$code = issue_verify_code( (int) $user->ID );

	$verify_url = add_query_arg(
		array(
			'uid'   => (int) $user->ID,
			'token' => $code,
		),
		trailingslashit( (string) getenv( 'BTT_FRONTEND_URL' ) ) . 'verify'
	);

	/* translators: %s: site name. */
	$email['subject'] = sprintf( __( '[%s] Confirm your account', 'blame-the-tech-core' ), $blogname );
	$email['message'] = sprintf(
		/* translators: 1: site name, 2: verification URL. */
		__( "An account was created for you on %1\$s.\n\nConfirm it and choose a password within 24 hours:\n\n%2\$s\n\nIf you did not expect this, ignore this email.\n", 'blame-the-tech-core' ),
		$blogname,
		esc_url_raw( $verify_url )
	);

	return $email;
}
add_filter( 'wp_new_user_notification_email', __NAMESPACE__ . '\\reporter_new_user_notification_email', 10, 3 );
```

Finally, **confirm rather than re-add** the two pieces Lesson 03.5 already wrote:

```bash
grep -c "add_action( 'admin_init'" wp-content/plugins/blame-the-tech-core/includes/roles.php
# Expected: 1
grep -c "'show_admin_bar'" wp-content/plugins/blame-the-tech-core/includes/roles.php
# Expected: 1
```

**Verify §2:**

- [ ] `ROLES_VERSION` is `'2'`. Without the bump, `ensure_reporter_role()` returns early.
- [ ] `deny_create_incidents_until_verified()` checks `$cap` on its **first line**, before any
      `get_user_meta()`, and tests `'0' !==` rather than falsiness.
- [ ] `REPORTER_CAPS` still contains exactly three keys — this lesson adds a *condition*, not a
      capability — and both `grep` counts are `1`, not `2`.

### Step 3: Write `verifyDeveloper`

One new file, in Lesson 06.2's five-step order: authenticate, authorise, sanitise, validate, write.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-verify-developer.php
/**
 * The `verifyDeveloper` mutation, and the verification-code helpers.
 *
 * Consumes the single-use code registerDeveloper mailed (Lesson 06.2), sets a
 * password the human chose, and flips btt_verified to 1 — which is what makes
 * the map_meta_cap filter in includes/roles.php start allowing
 * create_incidents. Contract: appendix 03 §7.
 *
 * Returns the SAME payload for an unknown user, a wrong code, an expired code
 * and an already-used code. Four failures, one answer, no oracle.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use GraphQL\Error\UserError;
use GraphQL\Type\Definition\ResolveInfo;
use WPGraphQL\AppContext;

defined( 'ABSPATH' ) || exit;

/** Matches the window registerDeveloper's email promises. */
const VERIFY_CODE_TTL = DAY_IN_SECONDS;

/** The shortest password this application will accept. Length beats character classes. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Issue a fresh verification code and store only its hash.
 *
 * Returns the RAW code, which the caller mails and then forgets. A database
 * read must not yield a usable credential — the same rule core applies to
 * user_activation_key.
 *
 * Called by registerDeveloper's sibling in Lesson 06.2 and by
 * reporter_new_user_notification_email() in includes/roles.php.
 */
function issue_verify_code( int $user_id ): string {
	// No special characters: this value travels in a URL query string and gets
	// pasted by humans out of an email client that may or may not linkify it.
	$code = wp_generate_password( 32, false, false );

	update_user_meta( $user_id, 'btt_verify_hash', hash( 'sha256', $code ) );
	update_user_meta( $user_id, 'btt_verify_expires', time() + VERIFY_CODE_TTL );

	return $code;
}

/**
 * Check a presented code and, on success, CONSUME it.
 *
 * Single use: both meta rows are deleted, so a replay from browser history, a
 * proxy log or a forwarded email fails. hash_equals(), not ===, for the same
 * timing reason as the app token (Lesson 06.2 §7).
 */
function consume_verify_code( int $user_id, string $code ): bool {
	$stored  = (string) get_user_meta( $user_id, 'btt_verify_hash', true );
	$expires = (int) get_user_meta( $user_id, 'btt_verify_expires', true );

	if ( '' === $stored || '' === $code ) {
		return false;
	}

	if ( $expires < time() ) {
		return false;
	}

	if ( ! hash_equals( $stored, hash( 'sha256', $code ) ) ) {
		return false;
	}

	delete_user_meta( $user_id, 'btt_verify_hash' );
	delete_user_meta( $user_id, 'btt_verify_expires' );

	return true;
}

/**
 * Verify an account and set its password.
 *
 * @throws \GraphQL\Error\UserError On a bad app token or an unusable password.
 * @return array{verified: bool}
 */
function verify_developer_payload( array $input, AppContext $context, ResolveInfo $info ): array {
	// ── 1 + 2. AUTHENTICATE / AUTHORISE ────────────────────────────────
	// There is no logged-in user: the whole point is that this account cannot
	// sign in yet. So the APPLICATION proves itself. hash_equals() is inside.
	require_app_token();

	// ── 3. SANITISE ────────────────────────────────────────────────────
	$user_id = absint( $input['userId'] ?? 0 );
	$code    = sanitize_text_field( (string) ( $input['code'] ?? '' ) );

	// A password is NOT sanitised. It is compared and hashed, never stored as
	// text, never printed, never logged. sanitize_text_field() would silently
	// change it — collapsing whitespace turns a passphrase into a different
	// passphrase, and the user could then never log in with what they typed.
	$password = (string) ( $input['password'] ?? '' );

	// ── 4. VALIDATE ────────────────────────────────────────────────────
	// This one throws rather than returning `verified: false`, and that is
	// deliberate: it is a fact about the CALLER'S OWN input and leaks nothing
	// about the account. It also runs BEFORE the code is consumed, so a too
	// short password does not burn a single-use code.
	$length = mb_strlen( $password );

	if ( $length < MIN_PASSWORD_LENGTH || $length > 200 ) {
		throw new UserError(
			sprintf(
				/* translators: %d: minimum password length. */
				__( 'Choose a password of at least %d characters.', 'blame-the-tech-core' ),
				MIN_PASSWORD_LENGTH
			)
		);
	}

	$user = 0 === $user_id ? null : get_user_by( 'id', $user_id );

	// FOUR failures, ONE answer: no such user, not a reporter, wrong code,
	// expired code, already-consumed code. Nothing here distinguishes them,
	// because a distinguishable answer tells a stranger which user IDs exist
	// and whether a guessed code was close.
	if ( ! $user instanceof \WP_User
		|| ! in_array( REPORTER_ROLE, (array) $user->roles, true )
		|| ! consume_verify_code( $user_id, $code ) ) {
		graphql_debug( 'verifyDeveloper: generic refusal for uid ' . $user_id );

		return array( 'verified' => false );
	}

	// ── 5. WRITE ───────────────────────────────────────────────────────
	// registerDeveloper set a random 32-character password nobody has ever
	// seen, so this is the first password the human owns. wp_set_password()
	// also destroys that user's sessions and clears any pending reset key.
	wp_set_password( $password, $user_id );

	update_user_meta( $user_id, 'btt_verified', 1 );

	return array( 'verified' => true );
}

/** Register the mutation. */
function register_verify_developer_mutation(): void {
	register_graphql_mutation(
		'verifyDeveloper',
		array(
			'description'         => __( 'Consume the single-use code emailed by registerDeveloper, set the account password, and mark the email verified. Server-to-server only: requires the X-BTT-App-Token header. Returns `verified: false` — with no error — for an unknown user, a wrong code, an expired code or an already-used code.', 'blame-the-tech-core' ),
			'inputFields'         => array(
				'userId'   => array(
					'type'        => array( 'non_null' => 'Int' ),
					'description' => __( 'The `uid` query parameter from the verification link.', 'blame-the-tech-core' ),
				),
				'code'     => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'The `token` query parameter from the verification link. Compared against a stored sha256 hash with hash_equals().', 'blame-the-tech-core' ),
				),
				'password' => array(
					'type'        => array( 'non_null' => 'String' ),
					'description' => __( 'The password the user chooses. registerDeveloper generated a random one and never disclosed it, so this is the first password the account owner holds.', 'blame-the-tech-core' ),
				),
			),
			'outputFields'        => array(
				'verified' => array(
					'type'        => array( 'non_null' => 'Boolean' ),
					'description' => __( 'True only when the code was valid, unexpired and unused. False for every other case, with no detail about which.', 'blame-the-tech-core' ),
					'resolve'     => static fn( $payload ): bool => ! empty( $payload['verified'] ),
				),
			),
			'mutateAndGetPayload' => __NAMESPACE__ . '\\verify_developer_payload',
		)
	);
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_verify_developer_mutation' );
```

**Verify §3:**

- [ ] `require_app_token()` is the **first** statement in `verify_developer_payload()`, and
      `hash_equals()` appears exactly once with no `===` comparing hashes.
- [ ] Both `delete_user_meta()` calls are inside `consume_verify_code()`'s success path, so a
      failed check consumes nothing and a successful one cannot be replayed.
- [ ] The password is **not** passed through any `sanitize_*` function and never reaches
      `graphql_debug()`.
- [ ] The four failure branches are one `if` with one `return`. Split them into separate messages
      and you have built the oracle Key Concept 1 exists to prevent.

### Step 4: Wire it in, and re-activate

Two edits to `Plugin.php`, matching the pattern from Lesson 06.2 Step 6.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',                           // Lesson 03.2
		'includes/taxonomies.php',                           // Lesson 03.3
		'includes/statuses.php',                             // Lesson 03.4
		'includes/admin/incident-columns.php',               // Lesson 03.4
		'includes/roles.php',                                // Lesson 03.5, edited 15.3
		'includes/acf.php',                                  // Lesson 04.1
		'includes/graphql/enums.php',                        // Lesson 06.1
		'includes/graphql/fields.php',                        // Lesson 06.1
		'includes/graphql/app-token.php',                     // Lesson 06.2
		'includes/graphql/mutation-create-incident.php',      // Lesson 06.2
		'includes/graphql/mutation-register-developer.php',   // Lesson 06.2
		'includes/graphql/mutation-submit-hobt-lead.php',     // Lesson 06.2
		'includes/graphql/performance.php',                   // Lesson 06.4
		'includes/graphql/mutation-verify-developer.php',     // Lesson 15.3
	);
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
// Fragment — add the two calls to the existing activate(), next to
// ensure_reporter_role(). Everything else in the method is unchanged.
		ensure_reporter_role();

		// New in Lesson 15.3. Idempotent, and deliberately NOT gated on
		// ROLES_VERSION: a role lives in a shared option that any plugin can
		// add to, so this runs on every activation.
		strip_reporter_extras();

		close_wp_registration();
```

Then run the migration:

```bash
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core

docker compose run --rm wpcli wp option get btt_roles_version
docker compose run --rm wpcli wp cap list incident_reporter
```

**Verify §4:**

- [ ] `btt_roles_version` is `2`. A `1` means the plugin did not re-activate, or you did not save
      the constant.
- [ ] `wp cap list incident_reporter` prints exactly `read`, `create_incidents`, `edit_incidents`.
      `wp cap list incident_reporter | wc -l` is `3`.
- [ ] `docker compose logs --tail=40 wordpress` shows no `Failed opening required` and no fatal.
      A fatal here usually means the new file was added to `INCLUDES` with a typo in the path.
- [ ] `wp eval 'wp_set_current_user( get_user_by("login","reporter")->ID ); var_dump( current_user_can("create_incidents") );'`
      is still `true`. If it is `false`, your filter is testing falsiness rather than `'0'` —
      Key Concept 6.

### Step 5: Add the two documents, then regenerate

Append to the file Lesson 15.2 created — two operations, same naming rules.

```graphql
# next-app/src/graphql/auth.graphql — append

mutation RegisterDeveloper($email: String!, $displayName: String!, $locale: String) {
  # App-token guarded (Lesson 06.2). Returns the SAME payload whether or not the
  # address was already registered — see Lesson 15.3 §1. The front end must not
  # undo that by rendering two different sentences.
  registerDeveloper(input: { email: $email, displayName: $displayName, locale: $locale }) {
    accepted
    email
  }
}

mutation VerifyDeveloper($userId: Int!, $code: String!, $password: String!) {
  # `userId` and `code` are the `uid` and `token` query parameters from the
  # emailed link. `verified: false` covers unknown user, wrong code, expired
  # code and already-used code, with no detail about which.
  verifyDeveloper(input: { userId: $userId, code: $code, password: $password }) {
    verified
  }
}
```

```bash
cd ../next-app
npm run schema:pull
git diff --stat ../wordpress-headless/schema.graphql
# Review it: VerifyDeveloperInput and VerifyDeveloperPayload appear, and nothing
# else does. A schema diff is a contract change and gets read like one.
npm run codegen
npm run type-check
```

**Verify §5:**

- [ ] The schema diff adds `VerifyDeveloperInput`, `VerifyDeveloperPayload` and the
      `verifyDeveloper` field on `RootMutation`, and nothing else.
- [ ] `src/gql/graphql.ts` now exports `RegisterDeveloperDocument` and `VerifyDeveloperDocument`,
      and `npm run type-check` is silent. Commit `schema.graphql` and `src/gql/` together.

### Step 6: Write `src/actions/auth.ts`

The first Server Action file in the project. Two actions now; Lesson 15.4 adds `login` and
`logout` here.

```ts
// next-app/src/actions/auth.ts
'use server';

import { RegisterDeveloperDocument, VerifyDeveloperDocument } from '@/gql/graphql';
import { fetchGraphQLAuthed } from '@/lib/graphql/client';

/**
 * EVERY EXPORT OF A 'use server' MODULE MUST BE AN ASYNC FUNCTION.
 *
 * Next turns each export into a callable endpoint, so a `const` export is a
 * build error. A `type` export is fine — types are erased before the bundler
 * sees the file. That is why the idle state lives in AuthForm.tsx and not here.
 *
 * The shape is what useActionState needs: previous state in, next state out.
 * Module 23.3 unit-tests these two functions by that signature.
 */
export type AuthFormState = {
  readonly status: 'idle' | 'error' | 'sent' | 'verified';
  readonly message: string;
  /** Keyed by the form field's `name`. Rendered as a summary; Lesson 16.1 puts them beside the inputs. */
  readonly fieldErrors: Readonly<Record<string, string>>;
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DATED DEBT — replaced in Lesson 16.1 by src/lib/validation/schemas.ts (Zod).
 *
 * `zod` is not a dependency yet, on purpose: it arrives with react-hook-form and
 * @hookform/resolvers so the whole form story lands in one lesson. Until then
 * this is fifty lines of hand-written checking, and it has the two weaknesses
 * you would expect. It does not narrow types (every value stays `string`), and
 * the rules live here instead of in a schema the client could share. Both are
 * exactly what 16.1 fixes. Do not extend this helper; replace it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type FieldRule = {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly email?: boolean;
  /** Passwords only. Trimming a passphrase changes it, and the user could then never sign in. */
  readonly keepWhitespace?: boolean;
};

type FieldResult = { readonly value: string; readonly error: string | null };

// Deliberately loose. An email regex that tries to implement RFC 5322 rejects
// valid addresses; WordPress's is_email() is the real check and it runs in PHP
// on every one of these values (Lesson 06.2 §6). This one catches typos.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function field(formData: FormData, name: string, rule: FieldRule): FieldResult {
  const raw = formData.get(name);

  // FormData values are `string | File | null`. A File would stringify to
  // "[object File]" and pass a length check, so `typeof` is the only honest test.
  if (typeof raw !== 'string') {
    return { value: '', error: `${rule.label} is required.` };
  }

  const value = rule.keepWhitespace === true ? raw : raw.trim();

  if (value.length < rule.min) {
    return { value, error: `${rule.label} must be at least ${rule.min} character(s).` };
  }
  if (value.length > rule.max) {
    return { value, error: `${rule.label} must be ${rule.max} characters or fewer.` };
  }
  if (rule.email === true && !EMAIL_RE.test(value)) {
    return { value, error: `${rule.label} does not look like an email address.` };
  }

  return { value, error: null };
}

function errorsOf(fields: Readonly<Record<string, FieldResult>>): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};

  for (const [name, result] of Object.entries(fields)) {
    if (result.error !== null) {
      errors[name] = result.error;
    }
  }

  return errors;
}

/** One sentence, one reason. See the comment inside `register`. */
const REGISTER_SENT =
  'Check your inbox for a confirmation link. If you already have an account, sign in instead.';

/**
 * Create an unverified `incident_reporter`.
 *
 * `{ kind: 'app' }` — there is no user yet, so the APPLICATION proves itself.
 * The token is read from WP_APP_TOKEN inside the client and cannot be passed
 * in from here (Lesson 15.2 §6).
 */
export async function register(
  _previous: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const fields = {
    displayName: field(formData, 'displayName', { label: 'Display name', min: 1, max: 80 }),
    email: field(formData, 'email', { label: 'Email', min: 5, max: 190, email: true }),
  };

  const fieldErrors = errorsOf(fields);

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  try {
    const data = await fetchGraphQLAuthed(
      RegisterDeveloperDocument,
      {
        email: fields.email.value,
        displayName: fields.displayName.value,
        // Module 20 reads the real locale from the route segment. Hard-coded
        // here, and WordPress falls back to `en` for anything it does not know.
        locale: 'en',
      },
      { kind: 'app' }
    );

    if (data.registerDeveloper?.accepted !== true) {
      return { status: 'error', message: 'Registration could not be completed.', fieldErrors: {} };
    }
  } catch (error) {
    // Detail to the log, one sentence to the wire — the policy Lesson 10.4 wrote
    // into docs/api-contract.md.
    console.error('[btt] registerDeveloper failed', error);

    return { status: 'error', message: 'Registration could not be completed.', fieldErrors: {} };
  }

  // ONE success message, for a new address and for an already-registered one.
  // WordPress returns the same payload on purpose (Lesson 06.2 §8); rendering
  // two different sentences here would rebuild the enumeration oracle in
  // TypeScript. The user-experience cost is real and accepted: someone who
  // forgot they registered gets this message and no email.
  return { status: 'sent', message: REGISTER_SENT, fieldErrors: {} };
}

/**
 * Consume the emailed code, set the chosen password, mark the email verified.
 *
 * Called from a POST, never from rendering the /verify page. A GET must not
 * mutate: an email client that prefetches links would otherwise burn the code
 * before the human ever clicked it.
 */
export async function verify(
  _previous: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const fields = {
    uid: field(formData, 'uid', { label: 'Account reference', min: 1, max: 20 }),
    token: field(formData, 'token', { label: 'Confirmation code', min: 8, max: 200 }),
    password: field(formData, 'password', {
      label: 'Password',
      min: 12,
      max: 200,
      keepWhitespace: true,
    }),
  };

  const fieldErrors = errorsOf(fields);

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  const userId = Number.parseInt(fields.uid.value, 10);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { status: 'error', message: 'That confirmation link is not valid.', fieldErrors: {} };
  }

  try {
    const data = await fetchGraphQLAuthed(
      VerifyDeveloperDocument,
      { userId, code: fields.token.value, password: fields.password.value },
      { kind: 'app' }
    );

    if (data.verifyDeveloper?.verified !== true) {
      // ONE message for invalid, expired and already-used, mirroring the single
      // generic payload WordPress returns.
      return {
        status: 'error',
        message: 'That confirmation link is invalid, expired or already used. Register again to get a new one.',
        fieldErrors: {},
      };
    }
  } catch (error) {
    // A thrown error here is a UserError from PHP — in practice, the password
    // rule. WordPress is the authority on its own rules, so surface its message.
    console.error('[btt] verifyDeveloper failed', error);

    return {
      status: 'error',
      message: 'That password was rejected. Use at least 12 characters and try again.',
      fieldErrors: {},
    };
  }

  return {
    status: 'verified',
    message: 'Your account is confirmed and your password is set. You can sign in now.',
    fieldErrors: {},
  };
}
```

**Verify §6:**

- [ ] `'use server'` is the **first** line. Anywhere else and the file is an ordinary module whose
      exports are not callable from a form.
- [ ] Every `export` is either an `async function` or a `type`. Add a `const` export and
      `npm run build` fails with "Only async functions are allowed to be exported".
- [ ] `grep -c 'WP_APP_TOKEN' src/actions/auth.ts` is `0`. The app token is not this file's to
      hold; `{ kind: 'app' }` is the whole of its involvement.
- [ ] The password field passes `keepWhitespace: true`. Trim a passphrase and the user can never
      sign in with what they typed, and the bug is invisible.
- [ ] `register` has exactly one success message.

### Step 7: Write the shared form component and the two pages

`useActionState` is a client hook, so the form element is a Client Component. Everything else —
headings, labels, copy — stays on the server. One component, three forms (the third is 15.4's).

```tsx
// next-app/src/components/auth/AuthForm.tsx
'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';

import type { AuthFormState } from '@/actions/auth';
import { Button } from '@/components/ui/button';

// Lives here, not in actions/auth.ts: every export of a 'use server' module must
// be an async function, so a shared `const` is not allowed there.
const IDLE: AuthFormState = { status: 'idle', message: '', fieldErrors: {} };

/**
 * The form shell for /register, /verify and /login.
 *
 * The inputs are passed in as `children` and are rendered on the SERVER — a
 * Server Component may pass children to a Client Component, and only this
 * wrapper ships JavaScript.
 *
 * Errors are shown as one summary region with role="alert", which is announced
 * on change and needs no aria-live of its own. Lesson 16.1 replaces this with
 * per-field aria-describedby plus focus moved to the first invalid input; the
 * summary is honest about being the smaller version of that.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  readonly action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  const fieldErrors = Object.entries(state.fieldErrors);
  const settled = state.status === 'sent' || state.status === 'verified';

  // A settled form has nothing left to submit. Replacing it rather than leaving
  // a re-submittable form is what stops a second registration from the same page.
  if (settled) {
    return (
      <p role="status" className="mt-6 rounded-md border border-border bg-muted/40 p-4 text-sm">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state.status === 'error' ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p>{state.message}</p>
          {fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {fieldErrors.map(([name, message]) => (
                <li key={name}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {children}

      {/* `disabled` rather than aria-busy: the button's own label carries the
          state, so there is no extra ARIA to justify in docs/accessibility.md. */}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
```

```tsx
// next-app/src/app/[locale]/(auth)/register/page.tsx
import Link from 'next/link';

import { register } from '@/actions/auth';
import { AuthForm } from '@/components/auth/AuthForm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// The (auth) route group has NO layout.tsx and needs none: parentheses group
// files without adding a URL segment, and src/app/[locale]/layout.tsx is still
// the only layout above these pages. Do not go looking for one.

export default async function RegisterPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  // Next 15: params is a Promise.
  const { locale } = await params;

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Register as a developer</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        An account lets you file incidents for an editor to moderate. You will get a confirmation
        email; the link in it is single use and expires in 24 hours.
      </p>

      <AuthForm action={register} submitLabel="Create account" pendingLabel="Creating account…">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" name="displayName" maxLength={80} autoComplete="name" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          {/* type="email" gives a keyboard hint and a free browser check. It is
              not validation: the Server Action re-checks, and WordPress checks
              again with is_email(). Three layers, one of them load-bearing. */}
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
      </AuthForm>

      <p className="mt-6 text-sm text-muted-foreground">
        {/* This link 404s until Lesson 15.4 creates the page. It is the last
            deliberately broken thing in this module. */}
        Already registered? <Link href={`/${locale}/login`} className="underline">Sign in</Link>.
      </p>
    </section>
  );
}
```

```tsx
// next-app/src/app/[locale]/(auth)/verify/page.tsx
import Link from 'next/link';

import { verify } from '@/actions/auth';
import { AuthForm } from '@/components/auth/AuthForm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default async function VerifyPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ readonly uid?: string; readonly token?: string }>;
}) {
  // Next 15: BOTH are Promises.
  const { locale } = await params;
  const { uid = '', token = '' } = await searchParams;

  if (uid === '' || token === '') {
    return (
      <section className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Confirmation link incomplete</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the link from your email exactly as it was sent, or{' '}
          <Link href={`/${locale}/register`} className="underline">register again</Link> for a new one.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Confirm your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a password to finish. Your registration created an account with a random password
        nobody has ever seen, so this is the first one you own.
      </p>

      {/* Rendering this page does NOT verify anything. The code is consumed by a
          POST, because a GET must not mutate — an email client or a link
          previewer that prefetches would otherwise burn the code before the
          human clicked it. */}
      <AuthForm action={verify} submitLabel="Confirm and sign in" pendingLabel="Confirming…">
        <input type="hidden" name="uid" value={uid} />
        <input type="hidden" name="token" value={token} />

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
          <p className="text-xs text-muted-foreground">At least 12 characters.</p>
        </div>
      </AuthForm>
    </section>
  );
}
```

> **The confirmation code is in a URL, and that is the second exception to Lesson 15.1's rule.**
> It is not a session credential: it grants one action, once, within 24 hours, and it is stored
> only as a sha256 hash. Four mitigations do the work — hashed at rest, expiring, single use, and
> a page with no external links and no third-party scripts to leak a `Referer` to. The strongest
> of the four is single use: **the moment the code is consumed, the copy in your browser history
> is worthless.** State that when someone asks why this is allowed and `localStorage` is not.

**Verify §7:**

- [ ] `grep -c "'use client'" 'src/app/[locale]/(auth)/register/page.tsx'` is `0` — only
      `AuthForm.tsx` ships JavaScript.
- [ ] `/en/register` renders and an empty submit shows the error summary, not a blank page;
      `/en/verify` with no query string renders the "link incomplete" branch.
- [ ] There is no `(auth)/layout.tsx`, and header and footer still appear on both pages — because
      `src/app/[locale]/layout.tsx` is above them.

### Step 8: Register a real user, click through Mailpit, and write the accessibility row

End to end, through your own pages. Open `http://localhost:3000/en/register`, use
`newdev152@example.test`, submit, then find the mail:

```bash
# The captured message, and the link inside it.
MSG_ID=$(curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].ID')
curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].Subject'
curl -s "http://localhost:8025/api/v1/message/$MSG_ID" | jq -r '.Text' | grep -oE 'https?://[^[:space:]]+verify[^[:space:]]*'
```

The printed URL starts with `http://host.docker.internal:3000`. **Swap that host for `localhost`
before pasting it into your browser** — Key Concept 9, and you will do it again in Modules 17 and
18. If Mailpit's API path ever changes, the UI on `:8025` shows the same link.

Choose a password of at least twelve characters, submit, then append the accessibility row.
`docs/accessibility.md` was created in Lesson 11.4 with a standing rule: every lesson adding an
ARIA attribute or role adds a row.

```markdown
<!-- docs/accessibility.md — append to the roles table -->

| Attribute / role | Where | Justification | Could a native element do it? |
|---|---|---|---|
| role="alert" | components/auth/AuthForm.tsx | announces the validation summary the moment it appears; implies aria-live="assertive", so no separate attribute is needed | no — there is no native element that announces its own arrival |
| role="status" | components/auth/AuthForm.tsx | the settled confirmation ("check your inbox"), announced politely rather than interrupting | no |

**Known gap, closed in Lesson 16.1.** Errors are a single summary region, not per-field
messages. There is no aria-describedby linking an input to its error and no focus move to the
first invalid field. That is the smaller version of the right pattern and it is written down
here so it is a debt rather than an oversight.
```

**Verify §8:**

- [ ] The subject is the one `registerDeveloper` sends (Lesson 06.2): `Confirm your Blame The Tech
      account`, and `wp user get newdev152@example.test --field=roles` is `incident_reporter`.
- [ ] `wp user meta get newdev152@example.test btt_verified` is `0` before you confirm, `1` after.
- [ ] You can sign in with the password you chose — check it with the `login` mutation from Lesson
      15.2 Step 5, because `/en/login` does not exist until the next lesson.
- [ ] `git add -A && git commit -m "feat(auth): verifyDeveloper, verification-gated create, /register and /verify"`.

---

## Verification

```bash
cd wordpress-headless

export BTT_APP_TOKEN="$(grep -E '^BTT_APP_TOKEN=' .env | cut -d= -f2-)"
test -n "$BTT_APP_TOKEN" && echo 'app token loaded into this session' || echo 'MISSING — Lesson 06.2 Step 7'
# Expected: app token loaded into this session

# 1. NEGATIVE — wp-login serves no registration form, and the option is off
curl -s 'http://localhost:8080/wp-login.php?action=register' | grep -ci 'user_login'
# Expected: 0
docker compose run --rm wpcli wp option get users_can_register
# Expected: 0

# 2. The role migration ran, and the role is exactly three capabilities
docker compose run --rm wpcli wp option get btt_roles_version
# Expected: 2
docker compose run --rm wpcli wp cap list incident_reporter | sort | tr '\n' ' '
# Expected: create_incidents edit_incidents read
docker compose run --rm wpcli wp cap list incident_reporter | wc -l | tr -d ' '
# Expected: 3

# 3. NEGATIVE — the four capabilities that must be ABSENT are absent
docker compose run --rm wpcli wp cap list incident_reporter \
  | grep -cE '^(publish_incidents|edit_posts|upload_files|edit_others_incidents|edit_published_incidents)$'
# Expected: 0
#           Nothing in this course grants them. strip_reporter_extras() removes
#           them if another plugin ever does.

# 4. Editors still hold publish_incidents, so moderation is possible at all
docker compose run --rm wpcli wp cap list editor | grep -c '^publish_incidents$'
# Expected: 1

# 5. NEGATIVE against the '' -versus- '0' trap: the fixture accounts still work.
#    This is the regression Key Concept 6 exists to prevent, and it is the one that
#    would silently break every E2E spec in Module 23.
docker compose run --rm wpcli wp eval '
  foreach ( array( "reporter", "e2e_agent", "editor" ) as $login ) {
    $u = get_user_by( "login", $login );
    if ( ! $u ) { printf("%-10s MISSING USER\n", $login); continue; }
    wp_set_current_user( $u->ID );
    printf( "%-10s meta=%-3s create_incidents=%s\n", $login,
      var_export( get_user_meta( $u->ID, "btt_verified", true ), true ),
      current_user_can( "create_incidents" ) ? "true" : "FALSE — the filter is testing falsiness" );
  }'
# Expected: three lines, every one ending create_incidents=true.
#           `meta=''` or `meta='1'` are both fine; only an explicit '0' denies.
#           A FALSE here means you wrote `! get_user_meta(...)` instead of
#           `'0' === get_user_meta(...)`, and `'' == 0` is true in PHP.

# 6. registerDeveloper creates an UNVERIFIED reporter through the app token
BEFORE=$(docker compose run --rm wpcli wp user list --role=incident_reporter --format=count | tr -d '\r')
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{registerDeveloper(input:{email:\"probe153@example.test\",displayName:\"Probe 153\"}){accepted email}}"}' \
  | jq -c '.data.registerDeveloper'
# Expected: {"accepted":true,"email":"probe153@example.test"}
AFTER=$(docker compose run --rm wpcli wp user list --role=incident_reporter --format=count | tr -d '\r')
echo "reporters: $BEFORE -> $AFTER"
# Expected: the second number is one higher than the first
docker compose run --rm wpcli wp user get probe153@example.test --field=roles
# Expected: incident_reporter
docker compose run --rm wpcli wp user meta get probe153@example.test btt_verified
# Expected: 0

# 7. The mail was captured by Mailpit and never left this machine
curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].Subject'
# Expected: Confirm your Blame The Tech account
MSG_ID=$(curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].ID')
VERIFY_URL=$(curl -s "http://localhost:8025/api/v1/message/$MSG_ID" | jq -r '.Text' \
  | grep -oE 'https?://[^[:space:]]+verify[^[:space:]]*' | head -1)
echo "$VERIFY_URL"
# Expected: http://host.docker.internal:3000/verify?uid=<id>&token=<32 chars>
#           Swap host.docker.internal for localhost to click it. Key Concept 9.
UID153=$(printf '%s' "$VERIFY_URL" | sed -n 's/.*uid=\([0-9]*\).*/\1/p')
CODE153=$(printf '%s' "$VERIFY_URL" | sed -n 's/.*token=\([A-Za-z0-9]*\).*/\1/p')
test -n "$UID153" -a -n "$CODE153" && echo 'uid and code captured' || echo 'PARSE FAILED — read the UI on :8025'
# Expected: uid and code captured

# 8. NEGATIVE — an UNVERIFIED reporter cannot create an incident. Asserted with
#    wp_set_current_user(), which exercises exactly the authorisation path a
#    Bearer token exercises, without needing a password this account does not have.
docker compose run --rm wpcli wp eval '
  wp_set_current_user( (int) $argv[0] );
  echo current_user_can( "create_incidents" ) ? "CAN CREATE — filter not firing\n" : "denied (correct)\n";' "$UID153"
# Expected: denied (correct)
#           The map_meta_cap filter returned array('do_not_allow'). Lesson 06.2's
#           current_user_can() line did not change by a character.

# 9. NEGATIVE — a wrong code is refused with the SAME generic payload as everything else
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d "$(jq -nc --argjson u "$UID153" '{query:"mutation V($u:Int!,$c:String!,$p:String!){verifyDeveloper(input:{userId:$u,code:$c,password:$p}){verified}}",variables:{u:$u,c:"wrongcodewrongcodewrongcode1234",p:"correct-horse-battery"}}')" \
  | jq -c '.data.verifyDeveloper'
# Expected: {"verified":false}
docker compose run --rm wpcli wp user meta get probe153@example.test btt_verified
# Expected: 0   — and the real code was NOT consumed by the failed attempt

# 10. The CORRECT code verifies, sets the password, and consumes itself
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d "$(jq -nc --argjson u "$UID153" --arg c "$CODE153" '{query:"mutation V($u:Int!,$c:String!,$p:String!){verifyDeveloper(input:{userId:$u,code:$c,password:$p}){verified}}",variables:{u:$u,c:$c,p:"correct-horse-battery-153"}}')" \
  | jq -c '.data.verifyDeveloper'
# Expected: {"verified":true}
docker compose run --rm wpcli wp user meta get probe153@example.test btt_verified
# Expected: 1

# 11. NEGATIVE — SINGLE USE. The same code again is refused, identically.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d "$(jq -nc --argjson u "$UID153" --arg c "$CODE153" '{query:"mutation V($u:Int!,$c:String!,$p:String!){verifyDeveloper(input:{userId:$u,code:$c,password:$p}){verified}}",variables:{u:$u,c:$c,p:"another-password-entirely"}}')" \
  | jq -c '.data.verifyDeveloper'
# Expected: {"verified":false}
#           BYTE-IDENTICAL to check 9. Wrong, expired and already-used are one answer.
docker compose run --rm wpcli wp user meta get probe153@example.test btt_verify_hash
# Expected: empty — consume_verify_code() deleted both meta rows

# 12. NEGATIVE — verifyDeveloper with NO app token, before anything else happens
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{verifyDeveloper(input:{userId:1,code:\"x\",password:\"aaaaaaaaaaaa\"}){verified}}"}' \
  | jq -r '.errors[0].message'
# Expected: Not authorized.

# 13. Now VERIFIED, the same account can create — and only a pending incident
JWT153=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation Login($u:String!,$p:String!){login(input:{username:$u,password:$p}){authToken}}","variables":{"u":"probe153@example.test","p":"correct-horse-battery-153"}}' \
  | jq -r '.data.login.authToken')
test -n "$JWT153" -a "$JWT153" != null && echo 'logged in with the chosen password' || echo 'LOGIN FAILED'
# Expected: logged in with the chosen password
#           This is the proof that verifyDeveloper HAD to set a password:
#           registerDeveloper generated a random one and never disclosed it.

curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT153" \
  -d '{"query":"mutation($i:CreateIncidentInput!){createIncident(input:$i){incident{databaseId status}}}",
       "variables":{"i":{"title":"Verified reporter probe 153","scapegoatSlug":"the-intern","severitySlug":"s3-minor",
                         "occurredAt":"2024-06-01 09:00:00","downtimeMinutes":3,"environment":"STAGING","status":"PUBLISH"}}}' \
  | jq -c '.data.createIncident.incident'
# Expected: an object with a databaseId and status "pending" (some WPGraphQL
#           versions report "PENDING"). In NO case "publish".

# 14. NEGATIVE — the client asked for PUBLISH and got pending. Structurally.
ID153=$(docker compose run --rm wpcli wp post list --post_type=incident \
  --title='Verified reporter probe 153' --field=ID --format=ids | tr -d '\r')
docker compose run --rm wpcli wp post get "$ID153" --field=post_status
# Expected: pending
#           TWO independent mechanisms produced this: Lesson 06.2 forces 'pending',
#           and the role has no publish_incidents so wp_insert_post() would have
#           downgraded it anyway. Either one alone is sufficient.
docker compose run --rm wpcli wp post get "$ID153" --field=post_author
# Expected: the probe user's ID — not 0, and not the administrator's

# 15. NEGATIVE — a reporter cannot reach wp-admin. Asserted through capabilities,
#     which is more reliable than juggling a cookie jar.
docker compose run --rm wpcli wp eval '
  wp_set_current_user( (int) $argv[0] );
  printf("edit_posts:      %s\n", current_user_can("edit_posts") ? "TRUE — investigate" : "false (correct)");
  printf("upload_files:    %s\n", current_user_can("upload_files") ? "TRUE — investigate" : "false (correct)");
  printf("publish_incidents: %s\n", current_user_can("publish_incidents") ? "TRUE — investigate" : "false (correct)");
  printf("admin_init hook: %s\n", has_action("admin_init", "Blame\\Core\\redirect_reporters_away_from_admin") ? "hooked" : "MISSING");' "$UID153"
# Expected: false (correct) three times, then: hooked

# 16. The filter leaves editors alone — the negative case for the negative case
docker compose run --rm wpcli wp eval '
  wp_set_current_user( get_user_by("login","editor")->ID );
  echo current_user_can("create_incidents") ? "editor can create (correct)\n" : "EDITOR DENIED — the filter is too broad\n";'
# Expected: editor can create (correct)
#           The filter exempts anyone holding edit_others_incidents, and an editor
#           has no btt_verified meta at all.

# 17. The Next pages render, and only the form component ships JavaScript
cd ../next-app
curl -s http://localhost:3000/en/register | grep -c 'Register as a developer'
# Expected: 1
curl -s http://localhost:3000/en/verify | grep -c 'Confirmation link incomplete'
# Expected: 1
grep -rc "'use client'" 'src/app/[locale]/(auth)' | grep -v ':0$'
# Expected: no output — no page in the route group is a Client Component
grep -c "'use client'" src/components/auth/AuthForm.tsx
# Expected: 1

# 18. NEGATIVE — the app token is not in this feature's source, and not in the bundle
grep -rn 'WP_APP_TOKEN' src/ | grep -v 'src/lib/graphql/client.ts'
# Expected: no output — one reader, one line
npm run build
grep -r "$(grep -E '^WP_APP_TOKEN=' .env.local | cut -d= -f2-)" .next/static/ 2>/dev/null
# Expected: no output
grep -rl 'http://localhost:3000' .next/static/ | head -1
# Expected: one .js file — the control that proves the grep can find something

# 19. Gates stay green
npm run codegen:check
# Expected: no output
npm run verify
# Expected: no output from type-check, lint or format:check
npm test -- --run
# Expected: 0 failures

# 20. Clean up the probes
cd ../wordpress-headless
docker compose run --rm wpcli wp post delete "$ID153" --force
docker compose run --rm wpcli wp user delete probe153@example.test --yes
docker compose run --rm wpcli wp user delete newdev152@example.test --yes
docker compose run --rm wpcli wp user list --role=incident_reporter --format=count
# Expected: the count you started with — reporter and e2e_agent
git status --short
# Expected: no .env file listed
```

Checks 5, 8, 11 and 14 define this lesson: the fixture accounts still hold `create_incidents`;
verification is a capability condition rather than a form-level nicety; the code is genuinely
single use with an answer indistinguishable from a wrong guess; and a verified reporter asking
politely for `PUBLISH` gets `pending` from two independent mechanisms, neither of which is a check
you have to remember to write.

## Control Questions

1. `registerDeveloper` answers identically for a new address and an already-registered one, and
   the `register` Server Action has exactly one success message. Name the vulnerability class both
   are avoiding, describe the user-experience cost the design accepts, and say what a
   well-meaning front-end change would have to do to reintroduce the problem.
2. The rule "unverified users cannot create incidents" is enforced by a `map_meta_cap` filter
   rather than by an `if` at the top of `createIncident`. List three code paths the filter covers
   that the `if` would not, and explain why Lesson 06.2's `current_user_can( 'create_incidents' )`
   line did not have to change.
3. `deny_create_incidents_until_verified()` calls `user_can()` inside a `map_meta_cap` callback.
   Explain precisely why that is not infinite recursion, and describe what would happen if the
   `'create_incidents' !== $cap` check were moved below the `user_can()` call.
4. Appendix 03 §6 says a reporter may edit their own incident "while pending", and this course
   writes no code for that. Walk through how `map_meta_cap` produces the three different answers
   in Key Concept 5, naming the primitive capability required in each case, and say which two
   absent strings do the work.
5. `verifyDeveloper` takes a `password` even though appendix 03 §7 describes it only as consuming
   the code and setting `btt_verified`. Say what breaks without it, name the function in Lesson
   06.2 that causes the problem, and describe one alternative design that would avoid extending
   this mutation — with its cost.

## Learn More

- [`map_meta_cap()` source](https://developer.wordpress.org/reference/functions/map_meta_cap/) —
  read the function, not the summary. The `edit_post` case is about forty lines and it is the whole
  of Key Concept 5.
- [The `map_meta_cap` filter](https://developer.wordpress.org/reference/hooks/map_meta_cap/) — the
  four parameters, and the note that it runs for primitive capabilities too, which is the property
  Key Concept 4 depends on
- [`user_can()`](https://developer.wordpress.org/reference/functions/user_can/) — why the filter
  receives a user ID rather than the current user, and how to check somebody else's capability safely
- [`wp_new_user_notification()`](https://developer.wordpress.org/reference/functions/wp_new_user_notification/) —
  the pluggable function, and the `wp_new_user_notification_email` filter that is the better hook
- [`wp_set_password()`](https://developer.wordpress.org/reference/functions/wp_set_password/) — read
  it before using it anywhere else; the session destruction and reset-key clearing are not in the name
- [OWASP — account enumeration via login error messages](https://owasp.org/www-community/attacks/Account_Enumeration_via_Login_Error_Messages) —
  the attack Key Concept 1 defends against, with the response-timing variant most people forget
- [OWASP — Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) —
  the canonical rules for emailed single-use codes: hashed at rest, short TTL, single use, generic responses
- [React — `useActionState`](https://react.dev/reference/react/useActionState) — the hook the form
  shell is built on, including why the action takes the previous state as its first argument
- [Next.js — Server Actions and Mutations](https://nextjs.org/docs/app/getting-started/updating-data) —
  the `'use server'` rules, including the one that says every export must be an async function
