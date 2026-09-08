---
title: 'The Get Demo Lead Form'
module: 16
lesson: 3
teaches: [custom-table-writes, turnstile, honeypot-and-timing, pii-minimization, app-token]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Leads.php', 'next-app/src/actions/leads.ts', 'next-app/src/components/hobt/LeadForm.tsx', 'next-app/src/components/hobt/GetDemoDialog.tsx']
requires: [6.3, 16.2]
---

# Lesson 16.3 — The Get Demo Lead Form

## Quick Overview

The Get Demo button on `/hobt` has been inert since Module 11. Now it opens a dialog, captures a
lead, and writes it into `wp_btt_leads` — a **custom table**, not a custom post type. That choice
is made in [appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads)
and the reasoning is worth internalising, because it is the one place in this course where the
WordPress-shaped answer is the wrong one. A CPT is one misconfigured `show_in_rest` or
`show_in_graphql` away from publishing every lead you have ever collected; a custom table is
invisible to WordPress's content APIs by construction. It also gives you a database-enforced
`UNIQUE KEY (email, source)`, which has no CPT equivalent, and it avoids eight `wp_postmeta` rows
per lead.

This form is public, which means it is a spam target and a PII store at the same time. Four
controls stack, cheapest first: a **honeypot** field that real users never fill, a **render-timing**
check that rejects submissions arriving impossibly fast after the form was served, **Cloudflare
Turnstile** verified server-side against `siteverify` (the site key is public by design, the
secret key is not — [appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-five-of-them)),
and the per-IP rate limiter from Lesson 16.2. On the data side there are two absolute rules.
`ip_hash` is an **HMAC** keyed with `BTT_LEAD_IP_HMAC_KEY`, never a raw address — it exists to
deduplicate and to spot abuse, not to identify a person. And **never log PII or tokens**: no email
in a `console.log`, no request body in an error path, no Bearer token in a Sentry breadcrumb. A
log line is a database you did not mean to create, with no retention policy and much wider read
access.

By the end of this lesson you will have:

- `src/actions/leads.ts` — `submitLead`, the same five steps as Lesson 16.2, calling
  `submitHobtLead` with `X-BTT-App-Token` because there is no logged-in user
- `GetDemoDialog.tsx` and `LeadForm.tsx` — a Radix dialog with focus trapping and a form that
  still submits without JavaScript
- Honeypot plus render-timestamp fields, and a server-side Turnstile `siteverify` call whose
  failure path returns a generic message
- Rows in `wp_btt_leads` you can read in Adminer on `:8081`, with `ip_hash` as 64 hex characters
  and no raw IP anywhere
- A duplicate-submission test proving the database rejects the second `(email, source)` pair
  rather than your PHP remembering to
- A grep-based check over your own logs and error paths confirming no email address, IP or token
  is ever written

## Classic WP Analogy

You have built this form before, most likely with Contact Form 7, WPForms or Gravity Forms, and
those plugins do exactly what this lesson does: validate, check a spam signal, store the entry,
notify someone. Gravity Forms even stores entries in its **own tables** — `wp_gf_entry` and
friends — for precisely the reasons in §5 above. `submitHobtLead` is a hand-rolled version of
that, and the PHP is the PHP you already know: `dbDelta()` on activation, `$wpdb->insert()` with
format specifiers, `$wpdb->prepare()` for reads.

| Classic WordPress | This stack |
|---|---|
| a CF7 / Gravity Forms form | `LeadForm.tsx` + `submitLead` Server Action |
| Gravity Forms entries in `wp_gf_entry` | `wp_btt_leads`, created with `dbDelta()` |
| Akismet | Turnstile + honeypot + render-timing + rate limit |
| `wp_mail()` on submit, caught by Mailpit | unchanged — `wp_mail()`, optionally Resend in production |
| a `nonce` on the AJAX submit | `X-BTT-App-Token` on the mutation + the Origin check on the action |
| `$wpdb->insert( $table, $data, ['%s','%s'] )` | unchanged — this is the one place you write real SQL |

**Where the analogy breaks down:** a form plugin's submit handler runs *inside* WordPress, as
whichever user happens to be browsing — usually nobody, which is fine because there is no
authorization question. Here the write crosses a network boundary to an endpoint that must
authenticate *something*, and the something cannot be a user, because leads come from anonymous
visitors. That is the whole reason the application token exists: `submitHobtLead` is authorised by
`X-BTT-App-Token`, proving "the Next.js app is calling", which is a completely different claim
from "this human is calling". WordPress compares it with `hash_equals()`, not `==`, and it never
travels to a browser under any circumstances. Reach for the user JWT here and it will not work;
reach for the app token in `createIncident` and it will work in a way you very much do not want.

The second break is legal rather than technical. A CF7 entry sitting in `wp_postmeta` on a client
site is somebody else's compliance problem. A leads table you designed, with a `consent` column
and an `ip_hash` column, is yours. That is why the column is `ip_hash CHAR(64)` and not
`ip VARCHAR(45)` — the schema encodes the retention decision, so the wrong thing cannot be stored
by accident later.

---

## Key Concepts

### 1. A custom table, and the one place the WordPress-shaped answer is wrong

Your instinct is a `hobt_lead` custom post type, and it is the wrong instinct exactly once. The four
reasons live in [appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads);
here is what each looks like on the day it goes wrong.

| Reason | The concrete failure |
|---|---|
| PII isolation | A CPT needs `show_in_rest: true` for the block editor to work at all (appendix 03 §1). One `show_in_graphql: true` typed by someone adding a feature, and `leads { nodes { title } }` is a public endpoint returning every email address you have ever collected. There is no equivalent typo for a table WPGraphQL has never heard of. |
| `wp_postmeta` bloat | Nine fields per lead means **8N** postmeta rows — one per field bar the title — all EAV, all `LONGTEXT`, none indexed by value. Ten thousand leads is eighty thousand rows you query with `meta_query` string comparisons. |
| Correct uniqueness | `UNIQUE KEY (email, source)` is enforced by MySQL. There is **no** CPT equivalent: the nearest thing is a `pre_post_insert` filter running a `meta_query`, which is a race condition with extra steps. |
| Real `$wpdb` practice | `dbDelta()`, format specifiers, `prepare()`, index design, `VARCHAR(190)`. This is the one place in the course you write actual SQL, and it is a skill a headless developer still needs. |

Now the honest counter-argument, because the decision has a price and pretending otherwise is how
people copy it where it does not belong.

| What a CPT would have given you free | What you do instead |
|---|---|
| The admin list table, with search, sorting, pagination, bulk actions | Adminer on `:8081` until Module 24, which builds and reviews a leads screen (appendix 03 §10) |
| Revisions, trash, restore | nothing — a lead is an event, not a document, so this is a loss you can live with |
| The REST and GraphQL surface | **deliberately absent.** That is the point, not a gap |
| Every plugin that expects posts: exporters, CSV tools, CRM bridges | you write the integration, or you write a `wp blame leads export` command |
| `WP_Query` | `$wpdb->prepare()`, by hand, every time |

> **The rule to take away is not "use custom tables".** It is: **a CPT is a document; a table row is
> an event.** Documents get edited, revised, moderated and published; events get appended and read
> in aggregate. Gravity Forms reached this conclusion years ago, which is why its entries live in
> `wp_gf_entry` and not in `wp_posts`.

### 2. `dbDelta()` — and its parser, which is not MySQL's

`dbDelta()` takes a `CREATE TABLE` statement, compares it against what the database has, and issues
the `ALTER`s needed to converge. Run it a hundred times and the hundredth is a no-op, which is what
makes it safe in an activation hook that fires on every deploy. The catch: it **parses your SQL with
regular expressions rather than a SQL parser**, then compares what it extracted against what MySQL
reports. So the *form* of the string is load-bearing in a way unrelated to whether MySQL would
accept it.

[Appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads)
is the **contract** and now states the formatting rules in one place — read that paragraph before
you type the statement, and do not learn them twice. Two things are worth naming here anyway,
because they are the two that break a migration **silently** rather than loudly:

- **Two spaces after `PRIMARY KEY`.** One space and `dbDelta()` does not recognise the line as the
  primary key, so it tries to add one on every run.
- **`KEY`, not `INDEX`, and every key named.** An unnamed or `INDEX`-spelled key is not matched
  against the existing one, so it is dropped and re-added.

Neither produces an error. Both produce an `ALTER TABLE` on an activation that should have been a
no-op, and you find out from a slow-query log or not at all.

Lowercase type names are the third thing this lesson copies from the appendix, and the honest reason
is narrower than you might expect: **core's own `wp_get_db_schema()` is written that way**, older
WordPress required it, and matching the convention costs nothing. Modern `dbDelta()` normalises case
before comparing field types, so on the `wordpress:6.8` image this course pins, uppercase types are
unlikely to cause a spurious `ALTER` on their own. Write it lowercase because it is the house style
of the function you are calling — not because you have been told it will break. (The one rule that
fails *loudly*: without `require_once ABSPATH . 'wp-admin/includes/upgrade.php'`, `dbDelta()` is not
defined and activation fatals. That one you cannot miss.)

**Do not take any of this on trust.** The risk that matters is a schema that converges the first
time and diverges every time after, and it is directly checkable: activate twice and compare
`SHOW CREATE TABLE` byte for byte. That is Verification check 2, and it is the check worth keeping
in your own projects.

**It belongs in activation, not on a request.** It runs `SHOW CREATE TABLE`, parses it, diffs it and
possibly alters the schema — a query for nothing on every page view, and the day it *does* find a
difference it runs DDL inside somebody's request. Activation means every deploy here (Lesson 03.1),
which is the right cadence, and a version option lets you skip even that.

### 3. `$wpdb->insert()`, `$wpdb->prepare()`, and `%i`

Three ways to talk to MySQL, and only two of them are ever acceptable.

```
❌ NEVER
$wpdb->query( "SELECT * FROM {$table} WHERE email = '{$email}'" );
   string interpolation into SQL. There is no argument. PHPCS flags it as
   WordPress.DB.PreparedSQL and Lesson 07.5 turned that sniff on for this file.

✅ WRITES
$wpdb->insert( $table, $data, $formats );
   the format array MAKES it a prepared statement. %s, %d, %f — and the array
   length must match the data array, or the values shift silently.

✅ READS
$wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE source = %s', $table, $source ) );
   %i is an IDENTIFIER placeholder — table and column names — and it exists
   since WordPress 6.2. Before that, a table name had to be interpolated,
   which is why so much old plugin code looks unsafe and mostly is not.
```

| Placeholder | For | Note |
|---|---|---|
| `%s` | a string | quoted for you. Never add your own quotes around it |
| `%d` | an integer | |
| `%f` | a float | |
| `%i` | an **identifier** — table or column | WordPress 6.2+. This is the one people do not know exists |
| `%%` | a literal `%` | needed inside a `LIKE` you build yourself |

The trap in `insert()` is the format array: nine columns and eight specifiers does not error, it
shifts every value after the mismatch by one, and you find out when `consent` contains a locale.
Count them twice.

### 4. `VARCHAR(190)`, and the arithmetic behind it

The email column is `VARCHAR(190)` and not `VARCHAR(255)`, and it is not a style choice.

`utf8mb4` needs up to **4 bytes per character** and the legacy InnoDB index prefix limit is **767
bytes**, so the widest single-column index on a `utf8mb4` column is `767 / 4 = 191` characters.
Core uses `191` everywhere for exactly that reason; `wp_btt_leads` uses `190` because
`uniq_email_source` is a **composite** index over `email` plus `source varchar(64)` and the
arithmetic has to leave room for both. Declare `varchar(255)` and `CREATE TABLE` fails with
`Specified key was too long` — on some MySQL configurations, on the customer's server and not yours.

Modern InnoDB with `DYNAMIC` row format allows 3072 bytes, so the limit rarely bites. "Rarely" is
not a schema decision, and 190 costs nothing: MySQL stores `varchar` by actual length.

### 5. Spam control as a stack, cheapest first

Four controls. Each one is weak alone, and the order is by cost to *you*, not by strength.

```
   ┌─ 1. HONEYPOT ────────────── 0 requests, 0 dependencies, 0 UX cost ────┐
   │    a field real users never fill. Filled → refuse.                    │
   └───────────────────────────────────────────────────────────────────────┘
   ┌─ 2. RENDER TIMING ───────── 1 hidden field, 0 dependencies ───────────┐
   │    submitted 400ms after the page was served → refuse.                │
   └───────────────────────────────────────────────────────────────────────┘
   ┌─ 3. TURNSTILE ───────────── 1 script, 1 server round trip ────────────┐
   │    Cloudflare's verdict, verified against siteverify. Refuse on fail. │
   └───────────────────────────────────────────────────────────────────────┘
   ┌─ 4. RATE LIMIT ──────────── 1 Redis round trip (Lesson 16.2) ─────────┐
   │    per IP, fail closed. Bounds the damage everything else missed.     │
   └───────────────────────────────────────────────────────────────────────┘
```

**The honeypot, precisely.** A field a human never sees and a naive bot always fills, because it
fills every input it finds. Name it something a bot wants: `website` and `url` are the classics.

| Technique | Verdict |
|---|---|
| `type="hidden"` | ❌ any bot worth the name skips hidden inputs. It is also a lie: the field is *for* bots |
| `display: none` on a `required` field | ❌ Chrome refuses to submit the form at all — "An invalid form control with name='' is not focusable" — and you get a form that silently never works |
| `aria-hidden="true"` + `tabIndex={-1}` + off-screen CSS + `autoComplete="off"` | ✅ **this course.** A text input that is off-screen, out of the tab order, hidden from assistive technology, and never `required` |

**Render timing, and the forgery question.** A hidden field carrying the time the form was rendered
lets you refuse a submission that arrived 200 milliseconds later, because a human cannot type an
email address that fast. An **unsigned** timestamp is forgeable: a bot rewrites the value to
`now - 30s` and the check passes. So this app uses two signals and is explicit about which is which:

| Signal | Forgeable? | Kept because |
|---|---|---|
| `renderedAt`, an unsigned hidden field | **yes**, trivially | it costs one input and catches every bot that posts the form without reading it, which is most of them. A weak signal you are honest about is worth having |
| Turnstile's `challenge_ts` from the `siteverify` response | **no** | Cloudflare issues it and Cloudflare returns it to your server. The client never touches it |

That second row is the design decision worth noticing: the authoritative timestamp is a **free
side-effect of a call you were already making** — no new secret, no new variable, no HMAC to get
wrong. Without Turnstile, the honest code comment is "this timing check is a weak signal".

**Turnstile, precisely.** The widget renders with the **site key**, public by design and inlined
into your client bundle — one of the four legal `NEXT_PUBLIC_` variables
([appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-five-of-them)). The
token it produces means nothing until your **server** posts it to `siteverify` with the **secret
key**, which never leaves the server. A client-side "the widget said OK" is not a check.

**And every spam refusal returns one generic message.** Not "honeypot filled", not "too fast", not
"captcha failed": a precise message tells a spammer which control tripped and which one to tune.
One sentence, from a fixed set. Key Concept 8 draws the boundary between that rule and WordPress's
own field messages, which *are* surfaced verbatim.

### 6. PII minimisation, and a schema that encodes the decision

The column is `ip_hash CHAR(64)`. There is no `ip` column, and there never will be, because the
column does not exist to be filled in later.

```
   raw IP                    plain SHA-256                keyed HMAC-SHA256
   203.0.113.7        →      hash('sha256', $ip)     →    hash_hmac('sha256', $ip, $key)
   ─────────────────         ─────────────────────        ────────────────────────────
   identifies a person       BRUTE-FORCEABLE in            requires the key. Rotate the
   under GDPR                seconds: 4.3 billion          key and every stored hash
                             IPv4 addresses is a           becomes unlinkable, which is
                             rainbow table you can         a deletion mechanism you get
                             build on a laptop             for free
```

The unkeyed hash is the interesting failure: it *feels* like anonymisation and is not. The input
space is 2^32, so anybody holding your database can enumerate the whole of IPv4 in minutes and
recover every address exactly. A key living only in the environment makes the same table useless to
someone who has the rows and not the key.

What the column is **for** matters too, and the purpose is narrow: deduplicating a burst and
spotting abuse. Not identifying a person, not geolocation, not enriching a lead. Which is why a
one-way keyed digest suffices — you only ever compare, never read.

> **The schema encodes the retention decision.** `ip_hash CHAR(64)` cannot hold a dotted quad by
> accident. A `ip VARCHAR(45)` column with a comment saying "we hash this before storing" is a
> promise; a `CHAR(64)` column is a constraint. Six months and two developers later, only one of
> those still holds. The Verification block asserts it with SQL: no row where `ip_hash` starts with
> a digit followed by a dot.

### 7. Never log PII or tokens

**A log line is a database you did not mean to create.** No schema, no retention policy, no access
control worth the name, replicated to wherever your log drain points — a third-party SaaS, a shared
Slack channel, a colleague's terminal scrollback.

| Never write to a log | Why |
|---|---|
| an email address | it is the PII the whole lesson is about; a log drain has no deletion request workflow |
| a raw IP | you just spent Key Concept 6 not storing it |
| a Bearer token or the app token | a 300-second window is still a window, and log retention is 30 days |
| the request body of a failed submit | it contains all three of the above |
| a `console.error(error)` on a `fetch` you sent credentials with | Node's error objects can carry the request options, headers included |

The rule: `src/actions/` contains **no** `console.log`, and every `console.error` logs a message you
wrote and never an object you received. Verification greps for it.

Two adjacent traps. `graphql_debug()` in PHP only surfaces when `GRAPHQL_DEBUG` is on, which is
local only — that is why Lesson 06.2 uses it for detail, and it still must not carry an email. And
an error-reporting SDK captures breadcrumbs automatically: Module 24's Sentry `beforeSend` scrubber
exists for this, and is checked against the note you write in Step 8.

### 8. The app token, because there is no user

A lead is a stranger: `is_user_logged_in()` is `false` and there is no capability to check, so the
caller that must prove itself is the **application**.

| | `submitIncident` (Lesson 16.2) | `submitLead` (this lesson) |
|---|---|---|
| Credential | `{ kind: 'user', jwt }` | **`{ kind: 'app' }`** |
| Header | `Authorization: Bearer <jwt>` | `X-BTT-App-Token: <token>` |
| Proves | "this human is calling" | "the Next.js application is calling" |
| Guard in PHP | `is_user_logged_in()` then `current_user_can()` | `require_app_token()` with `hash_equals()` |
| In a browser, ever | as an opaque httpOnly cookie | **never, under any circumstances** |

Reaching for the user JWT here does not work: there is no session, `readAccessToken()` returns
`null`, and `require_app_token()` finds no header. Reaching for the app token in `createIncident`
fails too, because that mutation checks `is_user_logged_in()` first. The two mutations are guarded
by two different credentials on purpose, and Lesson 15.2 made substituting one a **compile error**.

`kind: 'app'` carries no token field. `fetchGraphQLAuthed` reads `WP_APP_TOKEN` from the
environment itself, so an app token cannot arrive from a call site — and therefore never from a
form field, a request or a client component.

`fetchGraphQLAuthed` is also the **strict** wrapper, and that matters here for a reason specific to
this action. Lesson 15.2 split the response policy: reads tolerate a partial response, writes do
not, so any `errors` entry from a write becomes a thrown `GraphQLRequestError` rather than a null
payload with the sentence in a log (Lesson 16.2 §7). For a lead form the payoff is a diagnostic
one. A wrong `WP_APP_TOKEN` makes `require_app_token()` answer `Not authorized.`, and with a generic
message that is a form which silently accepts nothing, on the page whose conversion rate somebody
is measuring, with no clue in the browser. Surfacing WordPress's own sentence turns it into a
one-glance answer, and it leaks nothing: Lesson 06.2 §8 fixed that message set to single sentences
with no path, plugin name, class name or SQL fragment in them.

Which is a boundary worth drawing precisely, because this lesson has two message policies:

| Refusal from | Message | Why |
|---|---|---|
| steps 1–3 — limiter, honeypot, timing, Turnstile | the **generic** `REFUSED` | a precise message tells a spammer which control tripped and which to tune |
| step 4 — WordPress's `UserError` | **WordPress's own wording** | it is a validation answer, not a spam signal, and it is safe by construction |
| step 4 — a timeout or DNS failure | the generic `REFUSED` | there is no WordPress sentence to surface, and an opaque failure is honest |
| a duplicate `(email, source)` | **nothing — it is a success** | §9. Not an error path, so there is no oracle |

### 9. The duplicate returns `accepted: true`, on purpose

Submit the same `(email, source)` pair twice. `UNIQUE KEY uniq_email_source` refuses the second row,
`$wpdb->insert()` returns `false`, and the mutation returns `accepted: true` anyway. That is not
dishonesty — it is **enumeration defence**, the same decision `registerDeveloper` makes for an
already-registered email (Lesson 06.2 §8).

```
"That address is already on our list."          "Thanks. We will be in touch."
────────────────────────────────────────        ─────────────────────────────────
an ORACLE. Feed it a list of 10,000             the same answer for every
addresses and you learn which of your           address. The attacker learns
competitor's customers asked for a demo         nothing they did not bring
```

The cost, stated plainly: a genuine user who submits twice gets no feedback that they already did,
and your support inbox eventually gets "did my request go through?". The mitigation is the
confirmation the form shows and the mail Resend sends — a channel the enumerator does not control —
not a different HTTP response.

And notice **which layer enforces it**. Not your PHP remembering to `SELECT` before it inserts, which
is a race between two simultaneous submissions. MySQL enforces it atomically, which is why the
Verification block asserts on the **row count** and not on the API response.

### 10. The dialog is an enhancement, not a requirement

`GetDemoDialog` wraps Radix `Dialog`, generated in Lesson 11.2. What the primitive is doing for you,
from Lesson 11.2 Key Concept 3:

| Behaviour | Radix handles it |
|---|---|
| Focus into the dialog on open; `Tab` cannot escape; `Escape` closes | ✅ |
| Focus **returns to the trigger** on close | ✅ the one hand-rolled dialogs always forget |
| `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, ids that match | ✅ |
| The rest of the page inert to assistive technology | ✅ |

None of that is a reason to reach for a dialog. The reason is that the CTA sits inside a marketing
band and a five-field form expanded inline pushes the pricing out of view. A dialog is a layout
decision that happens to need six accessibility behaviours.

> **The form inside still posts natively.** `<form action={submitLead}>` inside a dialog is still a
> form: with JavaScript off, the dialog never opens — and the honest consequence is that a no-JS
> visitor cannot reach the lead form at all through the dialog. So the CTA is an `<a href="#lead">`
> pointing at a **second, always-rendered copy** of the form further down the page. That is the
> version of "progressive enhancement" that actually holds; "the form still works if you can reach
> it" is not a claim worth making.

---

## Task

### Step 1: Create the table with `dbDelta()`

`Leads.php` is already in `wordpress-headless/README.md`'s expected tree, unclaimed. This is it.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Leads.php
/**
 * The wp_btt_leads custom table.
 *
 * NOT a custom post type, and appendix 03 §5 is the contract for the columns
 * and the two keys. A CPT is one misconfigured show_in_graphql away from
 * publishing every lead; a table WPGraphQL has never heard of cannot leak
 * through a content API by accident. Lesson 16.3 §1.
 *
 * Writes go through the submitHobtLead mutation ONLY. This file owns the
 * schema and the two read helpers, and nothing else.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Bump this whenever the CREATE TABLE statement changes, or ensure_leads_table()
 * will skip the dbDelta() that would apply your change. Same mechanism as
 * ROLES_VERSION in Lesson 03.5, for the same reason.
 */
const LEADS_DB_VERSION = '1';

/**
 * The CREATE TABLE statement, formatted for dbDelta()'s parser.
 *
 * Columns and keys are appendix 03 §5, reproduced here because this is the file
 * that creates them.
 *
 * dbDelta() parses this with regular expressions, not a SQL parser, so the FORM
 * matters. The two rules that break a migration SILENTLY: TWO spaces after
 * PRIMARY KEY, and KEY rather than INDEX with every key named. One field per
 * line and no backticks on field names are the other two. Lowercase types match
 * core's own wp_get_db_schema() convention — modern dbDelta() normalises case
 * itself, so this is house style rather than a trap. Lesson 16.3 §2, and
 * appendix 03 §5 for the full rule set.
 */
function leads_table_schema( string $table, string $charset_collate ): string {
	return "CREATE TABLE {$table} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		created_at datetime NOT NULL,
		email varchar(190) NOT NULL,
		full_name varchar(190) NOT NULL,
		company varchar(190) NULL,
		team_size varchar(32) NULL,
		source varchar(64) NOT NULL,
		locale varchar(10) NOT NULL,
		consent tinyint(1) NOT NULL DEFAULT 0,
		ip_hash char(64) NULL,
		user_agent varchar(255) NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY uniq_email_source (email, source),
		KEY idx_created_at (created_at)
	) {$charset_collate};";
}

/**
 * Create or converge the table. Idempotent, and called from Plugin::activate().
 *
 * dbDelta() runs SHOW CREATE TABLE, parses it, diffs it and possibly issues
 * DDL. That is a fine thing to do once per deploy and a terrible thing to do on
 * a page view, so it lives in activation and the version option lets even that
 * be skipped.
 */
function ensure_leads_table(): void {
	if ( get_option( 'btt_leads_db_version' ) === LEADS_DB_VERSION && leads_table_exists() ) {
		return;
	}

	global $wpdb;

	// dbDelta() is not loaded on a normal request.
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	dbDelta( leads_table_schema( leads_table(), $wpdb->get_charset_collate() ) );

	// autoload = false: read by activation, never on the request path.
	update_option( 'btt_leads_db_version', LEADS_DB_VERSION, false );
}

/**
 * How many leads came from one source.
 *
 * The one READ in the whole feature, and it is here to be the example: %i is an
 * IDENTIFIER placeholder for the table name, %s is the value, and there is no
 * interpolated SQL string anywhere in this function. %i needs WordPress 6.2+.
 */
function leads_count_by_source( string $source ): int {
	global $wpdb;

	return (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM %i WHERE source = %s',
			leads_table(),
			$source
		)
	);
}
```

`leads_table()` and `leads_table_exists()` stay where Lesson 06.2 declared them. Declarations are
visible across the whole request once `Plugin::boot()` has required every file, and
`ensure_leads_table()` is only *called* from `activate()`, which runs later — so there is no
load-order problem, and no reason to risk a redeclare fatal moving two working functions.

Two anchored edits to `Plugin.php`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',                          // Lesson 03.2
		'includes/taxonomies.php',                          // Lesson 03.3
		'includes/statuses.php',                            // Lesson 03.4
		'includes/admin/incident-columns.php',              // Lesson 03.4
		'includes/roles.php',                               // Lesson 03.5
		'includes/acf.php',                                 // Lesson 04.1
		'includes/Leads.php',                               // Lesson 16.3
		'includes/graphql/enums.php',                       // Lesson 06.1
		'includes/graphql/fields.php',                      // Lesson 06.1
		'includes/graphql/app-token.php',                   // Lesson 06.2
		'includes/graphql/mutation-create-incident.php',    // Lesson 06.2
		'includes/graphql/mutation-register-developer.php', // Lesson 06.2
		'includes/graphql/mutation-submit-hobt-lead.php',   // Lesson 06.2
		'includes/graphql/performance.php',                 // Lesson 06.4
		'includes/graphql/mutation-verify-developer.php',   // Lesson 15.3
	);
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	public static function activate(): void {
		register_post_types();
		register_taxonomies();
		seed_default_terms();

		grant_incident_caps_to_core_roles();
		ensure_reporter_role();
		close_wp_registration();

		// New in 16.3. Idempotent, gated on LEADS_DB_VERSION, and it must run
		// BEFORE flush_rewrite_rules() only because everything does — dbDelta
		// has no rewrite rules of its own.
		ensure_leads_table();

		ensure_permalink_structure();

		flush_rewrite_rules();

		update_option( 'btt_core_version', VERSION, false );
	}
```

**Verify §1:**

- [ ] `grep -c 'PRIMARY KEY  (id)' includes/Leads.php` returns `1` — with **two** spaces. One space
      makes `dbDelta()` try to add a primary key on every activation, with no error.
- [ ] `grep -c 'INDEX ' includes/Leads.php` returns `0`. `dbDelta()` matches `KEY`.
- [ ] `grep -c 'upgrade.php' includes/Leads.php` returns `1`. Without it, `dbDelta()` is undefined
      and activation fatals — the one formatting mistake that fails loudly.
- [ ] Do not trust any of the three above on their own. Verification check 2 activates twice and
      diffs `SHOW CREATE TABLE`, which is the assertion that actually proves convergence.

### Step 2: Remove the guard, and add the write

Lesson 06.2 shipped `submitHobtLead` complete on its input side with its write gated behind a
table-existence check. The table exists now, so the guard goes. **Delete these seven lines** from
`submit_hobt_lead_payload()`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-submit-hobt-lead.php
	// ── 5. WRITE ───────────────────────────────────────────────────────
	if ( ! leads_table_exists() ) {
		// Module 16 creates the table. The caller learns that the endpoint is
		// unavailable and nothing about schemas, tables or plugins.
		graphql_debug( 'wp_btt_leads does not exist yet — Module 16 creates it with dbDelta().' );

		throw new UserError( __( 'Temporarily unavailable.', 'blame-the-tech-core' ) );
	}
```

and replace them with this, keeping the `$wpdb->insert()` call that already follows it exactly as
it is:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/mutation-submit-hobt-lead.php
	// ── 5. WRITE ───────────────────────────────────────────────────────
	// Lesson 16.3 created wp_btt_leads with dbDelta() in includes/Leads.php, so
	// the table-existence guard Lesson 06.2 left here is GONE. Removing the
	// table without removing the guard, or the guard without the table, leaves
	// the funnel silently broken in one of two different ways.
```

Leaving the guard is not "harmless belt and braces": it is a `SHOW TABLES LIKE` on every submission
forever, answering a question settled at activation — and its `Temporarily unavailable.` message is
the hardest failure to diagnose in the whole funnel, because it says nothing and nothing is wrong.

> **`leads_table_exists()` now has no callers in the mutation, and keep it anyway.**
> `ensure_leads_table()` calls it, and it is the honest way to answer "did activation actually run
> on this environment?" from `wp eval`. A function with one caller is fine; a guard on a hot write
> path is not.

**Verify §2:**

- [ ] `grep -c 'Temporarily unavailable' includes/graphql/mutation-submit-hobt-lead.php` returns
      `0`. If it returns `1`, the guard is still there and every lead will be refused.
- [ ] `grep -c 'leads_table_exists' includes/graphql/mutation-submit-hobt-lead.php` returns `1` —
      the declaration only.
- [ ] The `$wpdb->insert()` call still has a **ten**-element format array for its ten-key data
      array. Count both.

### Step 3: Add the HMAC key, and re-activate

`lead_ip_hash()` already exists in `mutation-submit-hobt-lead.php` and already reads
`BTT_LEAD_IP_HMAC_KEY`. It returns `null` when the key is absent, which means an unconfigured
environment stores no hash rather than storing something weak — the right default, and the reason
this step is a variable and not a code change.

```bash
cd wordpress-headless
git check-ignore -v .env
# Expected: a .gitignore rule. NO OUTPUT MEANS STOP.

printf 'BTT_LEAD_IP_HMAC_KEY=%s\n' "$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)"
```

Paste that line into `.env`, add `BTT_LEAD_IP_HMAC_KEY=__CHANGE_ME__` to `.env.example` — the name
only, never the value — then restart and re-activate:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker compose exec wordpress php -r 'echo getenv("BTT_LEAD_IP_HMAC_KEY") ? "set\n" : "MISSING\n";'
# Expected: set

# Activation is what runs dbDelta(). Deactivate and activate to trigger it.
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core
docker compose run --rm wpcli wp option get btt_leads_db_version
# Expected: 1
```

> **Rotating `BTT_LEAD_IP_HMAC_KEY` makes every stored `ip_hash` unlinkable from every new one.**
> That is a deletion mechanism, not a bug — and it costs you abuse-detection history. Rotate
> deliberately and write the date in `docs/runbook.md`.

**Verify §3:**

- [ ] `docker compose exec -T db mysql -u btt -p"$WORDPRESS_DB_PASSWORD" btt -e 'SHOW TABLES LIKE "wp_btt_leads";'`
      prints one row.
- [ ] `git status --short` does not list `.env`.
- [ ] `docker compose logs --tail=40 wordpress` shows no fatal from activation.

### Step 4: Add the mutation document and the lead schema

```graphql
# next-app/src/graphql/hobt.graphql — append to the existing document file
# `accepted` is the ONLY output field. No row id, and no way to tell a duplicate
# from a new lead — Lesson 06.2 §9 and §8, on purpose.
mutation SubmitHobtLead($input: SubmitHobtLeadInput!) {
  submitHobtLead(input: $input) {
    accepted
  }
}
```

```ts
// next-app/src/lib/validation/schemas.ts — append
/**
 * Lead sources, stored KEBAB-case, matching wp_btt_leads.source and the ACF
 * select convention. The block attribute `leadSource` on btt/hobt-cta uses the
 * same values. The GraphQL enum is LeadSource (appendix 03 §3) in
 * SCREAMING_SNAKE, and src/actions/leads.ts maps between them.
 */
export const LEAD_SOURCES = ['hobt-hero', 'hobt-cta-block', 'hobt-footer', 'incident-sidebar'] as const;

export const leadSchema = z.object({
  email,
  // wp_btt_leads.full_name varchar(190), and mutation-submit-hobt-lead.php
  // checks '' === $full_name || mb_strlen( $full_name ) > 190.
  fullName: z.string().trim().min(1, 'Enter your name.').max(190, 'That name is too long.'),
  company: z.string().trim().max(190, 'That company name is too long.').default(''),
  // varchar(32). A free-text bucket rather than an enum, because marketing
  // changes the brackets and a schema change is the wrong cost for that.
  teamSize: z.string().trim().max(32).default(''),
  source: z.enum(LEAD_SOURCES),
  locale,
  // A checkbox posts 'on' when ticked and is ABSENT when not, so a boolean
  // schema would see `undefined` and a `z.boolean()` would reject it with a
  // type error rather than "consent is required". Model what FormData sends.
  consent: z.literal('on', { errorMap: () => ({ message: 'Please confirm you are happy to be contacted.' }) }),
  // The HONEYPOT. A human never fills this, so anything at all is a refusal.
  // Validated, not ignored: a schema that drops the field cannot refuse on it.
  website: z.literal('').default(''),
  // The UNSIGNED render timestamp. Weak by construction (§5) — a bot can
  // rewrite it. Kept because it costs one hidden input.
  renderedAt: z.string().trim().default(''),
  // The Turnstile token. Shape only; the verdict comes from siteverify.
  turnstileToken: z.string().trim().default(''),
});
export type LeadInput = z.infer<typeof leadSchema>;
```

```bash
cd next-app && npm run codegen && npm run type-check
```

**Verify §4:**

- [ ] `grep -c 'SubmitHobtLeadDocument' src/gql/graphql.ts` returns `1` or more.
- [ ] `git status --short ../wordpress-headless/schema.graphql` is empty. `submitHobtLead` was
      registered in Lesson 06.2; removing a runtime guard changes no types.

### Step 5: Write `submitLead`

```ts
// next-app/src/actions/leads.ts
'use server';

// ONE export, and it is the action. Every export in a 'use server' file is a
// public HTTP endpoint (Lesson 16.2 §1).
//
// NOTHING in this file logs an email address, an IP, a token or a request
// body. A log line is a database you did not mean to create (Lesson 16.3 §7).
import { SubmitHobtLeadDocument, type SubmitHobtLeadInput } from '@/gql/graphql';
import { fetchGraphQLAuthed } from '@/lib/graphql/client';
import { formatGraphQLErrors, isGraphQLRequestError } from '@/lib/graphql/errors';
import { limit } from '@/lib/rate-limit';
import { leadSchema, type LeadInput } from '@/lib/validation/schemas';
import { headers } from 'next/headers';

export type LeadFormState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    }
  | { readonly status: 'success' };

/**
 * ONE message for every SPAM refusal — steps 1 to 3.
 *
 * Not "honeypot filled", not "too fast", not "captcha failed". A precise
 * message tells a spammer which control tripped and therefore which one to
 * tune. Same rule as Lesson 06.2 §8.
 *
 * Note the boundary: this covers the spam stack. WordPress's own field
 * messages, which arrive from step 4, ARE surfaced verbatim — they are
 * validation answers, not spam-control signals, and Lesson 06.2 §8 fixed them
 * to single safe sentences.
 */
const REFUSED = 'We could not accept that submission. Please try again.';

/** Kebab (stored, and what leadSchema validates) → the GraphQL enum NAME. */
const SOURCE: Record<LeadInput['source'], NonNullable<SubmitHobtLeadInput['source']>> = {
  'hobt-hero': 'HOBT_HERO',
  'hobt-cta-block': 'HOBT_CTA_BLOCK',
  'hobt-footer': 'HOBT_FOOTER',
  'incident-sidebar': 'INCIDENT_SIDEBAR',
};

/** The rate-limit key only. Never stored here, never logged, never returned. */
async function clientIp(): Promise<string> {
  const store = await headers();

  return store.get('x-forwarded-for')?.split(',')[0]?.trim() || store.get('x-real-ip') || '0.0.0.0';
}

type TurnstileVerdict = { readonly ok: false } | { readonly ok: true; readonly challengeTs: number };

/**
 * Verify a Turnstile token SERVER-SIDE.
 *
 * The site key is public by design and lives in the client bundle; the secret
 * key is in TURNSTILE_SECRET_KEY and never leaves this process
 * (appendix 04 §3.2). A client-side "the widget said OK" is not a check.
 *
 * The response carries `challenge_ts` — the time CLOUDFLARE recorded the
 * challenge being solved. That is the authoritative render timestamp: the
 * client never touches it, so unlike the `renderedAt` hidden field it cannot
 * be forged. Free, from a call we were already making (Lesson 16.3 §5).
 */
async function verifyTurnstile(token: string, ip: string): Promise<TurnstileVerdict> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    // FAIL CLOSED on a missing secret, exactly like the limiter and exactly
    // like require_app_token()'s empty-token branch. A forgotten env var must
    // not switch a control off.
    return { ok: false };
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      cache: 'no-store',
    });

    const result = (await response.json()) as { success?: boolean; challenge_ts?: string };

    if (result.success !== true || !result.challenge_ts) {
      return { ok: false };
    }

    return { ok: true, challengeTs: Date.parse(result.challenge_ts) };
  } catch {
    // No `console.error(error)`. A fetch error object can carry the request
    // options, and the request options carry the secret key.
    return { ok: false };
  }
}

/** Record a HOBT demo lead. The same five steps as Lesson 16.2, in order. */
export async function submitLead(_previous: LeadFormState, formData: FormData): Promise<LeadFormState> {
  // ── 1. RATE LIMIT ──────────────────────────────────────────────────
  const ip = await clientIp();
  const verdict = await limit(`lead:${ip}`);

  if (!verdict.ok) {
    // Both reasons get the generic message. "Too many requests" tells a
    // spammer their budget; "unavailable" tells them Redis is down.
    return { status: 'error', message: REFUSED };
  }

  // ── 2. VALIDATE ────────────────────────────────────────────────────
  // The honeypot and the timestamp are FIELDS IN THE SCHEMA. `website` is
  // z.literal(''), so anything in it is a parse failure — and the error is
  // remapped to the generic message below rather than surfaced on a field
  // nobody can see.
  const parsed = leadSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;

    if (fieldErrors.website || fieldErrors.renderedAt || fieldErrors.turnstileToken) {
      return { status: 'error', message: REFUSED };
    }

    return { status: 'error', message: 'Check the fields below.', fieldErrors };
  }

  const input = parsed.data;

  // ── 3. AUTHENTICATE, then AUTHORISE ────────────────────────────────
  // There is no user. The APPLICATION authenticates, in step 4, with the app
  // token — §8. What this step does instead is the spam stack, because these
  // are the checks that decide whether the caller is entitled to write.
  const turnstile = await verifyTurnstile(input.turnstileToken, ip);

  if (!turnstile.ok) {
    return { status: 'error', message: REFUSED };
  }

  // The AUTHORITATIVE timing check: Cloudflare's timestamp, not the client's.
  const elapsedMs = Date.now() - turnstile.challengeTs;

  if (elapsedMs < 2_000 || elapsedMs > 300_000) {
    // Too fast to be a human filling in five fields, or a token so old the
    // page has been sitting open for five minutes and may have been harvested.
    return { status: 'error', message: REFUSED };
  }

  // The weak signal, checked second because it proves less. An unsigned hidden
  // field is forgeable and this app says so out loud (§5).
  const renderedAt = Number(input.renderedAt);

  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < 2_000) {
    return { status: 'error', message: REFUSED };
  }

  // ── 4. CALL WORDPRESS ──────────────────────────────────────────────
  // { kind: 'app' } — there is no logged-in user, so the application proves
  // itself with X-BTT-App-Token. The union carries no credential field at all —
  // fetchGraphQLAuthed reads WP_APP_TOKEN from the environment, so an app
  // credential can never arrive from a call site, and therefore never from a
  // form field, a request or a client component.
  try {
    const data = await fetchGraphQLAuthed(
      SubmitHobtLeadDocument,
      {
        input: {
          email: input.email,
          fullName: input.fullName,
          company: input.company === '' ? null : input.company,
          teamSize: input.teamSize === '' ? null : input.teamSize,
          source: SOURCE[input.source],
          locale: input.locale,
          consent: true,
        },
      },
      { kind: 'app' }
    );

    if (data.submitHobtLead?.accepted !== true) {
      // Defensive only. A refusal is THROWN, not returned: Lesson 15.2 made
      // fetchGraphQLAuthed strict, so any `errors` entry becomes a
      // GraphQLRequestError. A DUPLICATE never reaches here either —
      // submitHobtLead returns accepted: true for one on purpose (§9), so
      // there is no error to surface and no oracle to leak.
      return { status: 'error', message: REFUSED };
    }
  } catch (error) {
    if (isGraphQLRequestError(error)) {
      // WordPress spoke. Its message set is fixed and safe (Lesson 06.2 §8):
      // "A valid email address is required.", "Consent is required.",
      // "Not authorized." — single sentences, no path, no plugin, no SQL.
      // Surfacing "Not authorized." verbatim is what turns a misconfigured
      // WP_APP_TOKEN from an undiagnosable outage into a one-glance answer.
      return { status: 'error', message: formatGraphQLErrors(error.errors) };
    }

    // A timeout, a DNS failure, a proxy hanging up. There is no WordPress
    // sentence to surface. `error` is READ FOR NOTHING and never logged,
    // stringified or interpolated: a fetch error object can carry the request
    // options, and the request options carry the lead and the app token.
    return { status: 'error', message: REFUSED };
  }

  // ── 5. REVALIDATE, then return ─────────────────────────────────────
  // NOTHING is revalidated, and that is the whole comment. A lead is not
  // content: no page renders it, no cache tag covers it, and wp_btt_leads is
  // invisible to WordPress's content APIs by construction. The step is written
  // out anyway so a reviewer can see it was CONSIDERED rather than skipped —
  // which is the only thing that makes a fixed skeleton worth having.
  return { status: 'success' };
}
```

**Verify §5:**

- [ ] `grep -cE '^export (async )?function ' src/actions/leads.ts` returns `1`.
- [ ] `grep -c "kind: 'app'" src/actions/leads.ts` returns `1`;
      `grep -c "kind: 'user'" src/actions/leads.ts` returns `0`.
- [ ] `grep -c 'console' src/actions/leads.ts` returns `0`, and
      `grep -cE '(JSON\.stringify|`\$\{error)' src/actions/leads.ts` returns `0`. Exactly one
      `catch` binds the error, it is read only for `error.errors`, and it is never serialised.
- [ ] The five `// ── N.` comments appear in order. Step 5 is present and revalidates nothing on
      purpose.

### Step 6: Write the form and the dialog

```tsx
// next-app/src/components/hobt/LeadForm.tsx
'use client';

import Script from 'next/script';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { submitLead, type LeadFormState } from '@/actions/leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

const INITIAL: LeadFormState = { status: 'idle' };

export function LeadForm({
  source,
  locale,
  demoBookingUrl,
}: {
  readonly source: (typeof LEAD_SOURCES)[number];
  readonly locale: string;
  readonly demoBookingUrl: string | null;
}) {
  const [state, formAction, isPending] = useActionState(submitLead, INITIAL);
  // useId(), so two copies of this form on one page do not share label ids
  // (Lesson 16.1 §7). /hobt renders it twice: in the dialog and inline.
  const ids = useId();
  const [turnstileReady, setTurnstileReady] = useState(false);
  // Rendered on the CLIENT at mount, so it reflects when this visitor got the
  // form rather than when the page was cached. It is also UNSIGNED and
  // therefore forgeable — the authoritative timestamp is Cloudflare's
  // challenge_ts, checked server-side (Lesson 16.3 §5).
  const renderedAt = useRef(Date.now());

  useEffect(() => {
    if (state.status === 'success' && demoBookingUrl) {
      window.location.assign(demoBookingUrl);
    }
  }, [state.status, demoBookingUrl]);

  if (state.status === 'success') {
    return (
      <p role="status" className="text-sm font-medium">
        Thanks. We will be in touch about a demo.
      </p>
    );
  }

  return (
    <>
      {/* afterInteractive: the widget is not needed for first paint, and it must
          not block it. The SITE key is public by design — appendix 04 §3.2. */}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={() => setTurnstileReady(true)}
      />

      {/* No onSubmit. This posts natively with JavaScript off — although with
          JavaScript off there is no Turnstile token either, so the action
          refuses. Named in Key Concept 10: a spam control that requires
          JavaScript is a spam control that requires JavaScript. */}
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="renderedAt" value={String(renderedAt.current)} />

        {/*
          THE HONEYPOT. Off-screen, out of the tab order, hidden from assistive
          technology, autocomplete off, and NEVER `required` — a hidden required
          field makes Chrome refuse to submit the form at all. `type="hidden"`
          would be skipped by any bot worth the name. Lesson 16.3 §5.
        */}
        <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor={`${ids}-website`}>Website</label>
          <input id={`${ids}-website`} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-fullName`}>Your name</Label>
          <Input id={`${ids}-fullName`} name="fullName" autoComplete="name" maxLength={190} required />
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.status === 'error' ? (state.fieldErrors?.fullName?.[0] ?? '') : ''}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-email`}>Work email</Label>
          <Input id={`${ids}-email`} name="email" type="email" autoComplete="email" maxLength={190} required />
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.status === 'error' ? (state.fieldErrors?.email?.[0] ?? '') : ''}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-company`}>Company</Label>
          <Input id={`${ids}-company`} name="company" autoComplete="organization" maxLength={190} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-teamSize`}>Team size</Label>
          <Input id={`${ids}-teamSize`} name="teamSize" maxLength={32} placeholder="e.g. 5-20" />
        </div>

        <div className="flex items-start gap-2">
          <input id={`${ids}-consent`} name="consent" type="checkbox" className="mt-1" required />
          <Label htmlFor={`${ids}-consent`} className="text-sm font-normal">
            You may email me about Blame The Tech. The consent is recorded with the submission.
          </Label>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.status === 'error' ? (state.fieldErrors?.consent?.[0] ?? '') : ''}
        </p>

        {/* The widget writes its token into a hidden input named
            cf-turnstile-response, so the form field name is fixed by Cloudflare.
            We copy it to `turnstileToken`, which is the name leadSchema knows. */}
        <div
          className="cf-turnstile"
          data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          data-response-field-name="turnstileToken"
          data-theme="auto"
        />

        {state.status === 'error' && state.message && !state.fieldErrors ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" variant="blame" size="xl" disabled={isPending || !turnstileReady}>
          {isPending ? 'Sending…' : 'Request a demo'}
        </Button>
      </form>
    </>
  );
}
```

```tsx
// next-app/src/components/hobt/GetDemoDialog.tsx
'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { LeadForm } from '@/components/hobt/LeadForm';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

/**
 * Radix Dialog from Lesson 11.2 gives the six behaviours a hand-rolled modal
 * always gets wrong: focus in on open, a real focus trap, Escape to close,
 * focus RESTORED to the trigger, the aria wiring with matching ids, and the
 * rest of the page inert to assistive technology. Lesson 16.3 §10.
 *
 * With JavaScript off, this trigger renders as a button that does nothing —
 * which is why /hobt also renders an always-visible copy of LeadForm at
 * #lead and this trigger is not the only route to it.
 */
export function GetDemoDialog({
  source,
  locale,
  demoBookingUrl,
}: {
  readonly source: (typeof LEAD_SOURCES)[number];
  readonly locale: string;
  readonly demoBookingUrl: string | null;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* asChild, so this is ONE <button>, not a button inside a button
            (Lesson 11.2 Key Concept 7). */}
        <Button variant="outline" size="xl">
          Get Demo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book a demo</DialogTitle>
          <DialogDescription>
            Four fields. We do not store your IP address, only a keyed hash of it.
          </DialogDescription>
        </DialogHeader>
        <LeadForm source={source} locale={locale} demoBookingUrl={demoBookingUrl} />
      </DialogContent>
    </Dialog>
  );
}
```

### Step 7: Discharge Lesson 11.5's debt on the CTA band

Lesson 11.5 promised that Module 16 would delete the `aria-disabled` attribute **and** the visible
sentence explaining it, together. Both go, in one edit, because a control that works and still
carries an explanation of why it does not is worse than either alone.

```tsx
// next-app/src/components/hobt/HobtCtaBand.tsx
// Anchored edit: replace the inert GET DEMO block and the explanatory <p>
// beneath it. `noteId` and the `aria-describedby` it fed go with them.
import { GetDemoDialog } from '@/components/hobt/GetDemoDialog';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

export function HobtCtaBand({
  idPrefix,
  heading,
  blurb,
  startNowUrl,
  demoBookingUrl,
  locale,
  // Kebab-case, matching wp_btt_leads.source and the btt/hobt-cta block's
  // `leadSource` attribute. The block component from Lesson 14.4 passes its
  // attribute straight through.
  leadSource = 'hobt-hero',
}: {
  readonly idPrefix: string;
  readonly heading: string;
  readonly blurb: string | null;
  readonly startNowUrl: string | null;
  readonly demoBookingUrl: string | null;
  readonly locale: string;
  readonly leadSource?: (typeof LEAD_SOURCES)[number];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <p className="text-lg font-semibold tracking-tight">{heading}</p>
      {blurb !== null && blurb !== '' ? <p className="mt-2 text-sm text-muted-foreground">{blurb}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {startNowUrl !== null && startNowUrl !== '' ? (
          <Button asChild variant="blame" size="xl">
            <a href={startNowUrl} rel="noopener noreferrer">
              Start Now
            </a>
          </Button>
        ) : null}

        {/* GET DEMO — live as of Lesson 16.3. `aria-disabled="true"`, the
            explanatory sentence and the `noteId` that tied them together are
            all DELETED, together, exactly as Lesson 11.5 promised. */}
        <GetDemoDialog source={leadSource} locale={locale} demoBookingUrl={demoBookingUrl} />
      </div>
    </div>
  );
}
```

`/hobt` renders `HobtCtaBand` twice (Lesson 11.5 Step 6) and Lesson 14.4 also mounts it through the
`btt/hobt-cta` block's registry component, so this one edit lights up every Get Demo surface at
once. Pass `leadSource="hobt-footer"` to the closing instance so the two are distinguishable in the
`source` column — which is the entire reason that column exists.

Then the always-available copy, so the dialog is genuinely an enhancement, appended to
`src/app/[locale]/hobt/page.tsx` after `<HobtTestimonials />`:

```tsx
// next-app/src/app/[locale]/hobt/page.tsx — anchored edit, after <HobtTestimonials />
      {/* The route the dialog trigger cannot offer when JavaScript is absent.
          Two copies of one form on one page is exactly why LeadForm uses
          useId() for its label ids (Lesson 16.1 §7). */}
      <section id="lead" className="mx-auto w-full max-w-md py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Book a demo</h2>
        <LeadForm source="hobt-footer" locale={locale} demoBookingUrl={promo.demoBookingUrl} />
      </section>
```

Finally the two Turnstile variables:

```dotenv
# next-app/.env.local  — GITIGNORED.
# Cloudflare's DOCUMENTED test keys. The 1x pair ALWAYS PASSES and is the right
# thing for local development; the 2x secret ALWAYS FAILS and the Verification
# block uses it. A real key needs a free Cloudflare account, a site name and a
# hostname allowlist that must include localhost for local work.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

```dotenv
# next-app/.env.example  — TRACKED. Names only. Not even a test key: a
# plausible-looking value in a tracked file gets copied into production by
# somebody in a hurry (appendix 04 §1 rule 1).
NEXT_PUBLIC_TURNSTILE_SITE_KEY=__CHANGE_ME__
TURNSTILE_SECRET_KEY=__CHANGE_ME__
RESEND_API_KEY=__CHANGE_ME__
```

**Verify §7:**

- [ ] `grep -c 'aria-disabled' src/components/hobt/HobtCtaBand.tsx` returns `0`.
- [ ] `grep -c 'Demo booking opens in Module 16' src/components/hobt/HobtCtaBand.tsx` returns `0`.
      The attribute and the sentence go together; one without the other is a half-discharged debt.
- [ ] `grep -c '1x00000000000000000000AA' .env.example` returns `0`.

### Step 8: Write the PII rule down

```markdown
<!-- docs/quality-gates.md — append -->
## PII and logging (Lesson 16.3)

`wp_btt_leads` is the only place in this application that stores personal data. Five rules, no
exceptions, and each one is grep-checkable.

| Rule | Enforced by |
|---|---|
| The raw IP is never stored | there is no `ip` column. `ip_hash CHAR(64)` cannot hold a dotted quad |
| `ip_hash` is a **keyed** HMAC, never a plain hash | `hash_hmac( 'sha256', $ip, BTT_LEAD_IP_HMAC_KEY )`. An unkeyed IPv4 hash is brute-forceable in seconds — 2^32 inputs |
| No email, IP or token in a log line | `grep -rn 'console' next-app/src/actions/` returns nothing. The one `catch` that binds an error reads `error.errors` — WordPress's own fixed message set — and never serialises the object, which can carry the request options and therefore the app token |
| No request body in an error path | the generic `REFUSED` message, from a fixed set |
| Duplicates are accepted, not reported | `UNIQUE KEY (email, source)` in MySQL. Telling a caller the address is known is an enumeration oracle |

**Why logging is a data-protection question and not an ops one.** A log line has no schema, no
retention policy, no deletion-request workflow and much wider read access than the database — and
it is replicated to wherever the log drain points. Anything you log, you have published to a system
with none of the controls you built. Module 24's Sentry `beforeSend` scrubber is checked against
this table.

Rotating `BTT_LEAD_IP_HMAC_KEY` makes historic hashes unlinkable from new ones. That is a deletion
mechanism, and it costs you abuse-detection history. `docs/runbook.md` records the date.

Add this row to the entry-point matrix from Lesson 15.5:

| Entry point | AuthN | AuthZ | Validation | Rate limit | CSRF |
|---|---|---|---|---|---|
| `submitLead` (action) | none — the caller is anonymous by definition; the **application** authenticates to WordPress with `X-BTT-App-Token` | n/a, and here is why: there is no subject to authorise. Entitlement to write is decided by the spam stack — honeypot, Cloudflare-issued timestamp, Turnstile, rate limit | `leadSchema.safeParse`, then PHP re-validates every field | Upstash per IP, fail closed | Next Origin/Host on action POSTs |
```

**Verify §8:**

- [ ] `grep -c 'PII and logging' ../docs/quality-gates.md` returns `1`.
- [ ] `grep -c 'submitLead' ../docs/quality-gates.md` returns `1` or more, and it sits in the same
      matrix Lesson 15.5 created rather than a second table of your own.

---

## Verification

```bash
cd wordpress-headless

# 0. This shell session only.
export WORDPRESS_DB_PASSWORD="$(grep -E '^WORDPRESS_DB_PASSWORD=' .env | cut -d= -f2-)"
export BTT_APP_TOKEN="$(grep -E '^BTT_APP_TOKEN=' .env | cut -d= -f2-)"
test -n "$BTT_APP_TOKEN" && echo 'app token loaded' || echo 'MISSING — Lesson 06.2 Step 7'
# Expected: app token loaded

SQL() { docker compose exec -T db mysql -u btt -p"$WORDPRESS_DB_PASSWORD" btt -N -B -e "$1"; }

# 1. The table exists, with BOTH keys. This is the whole reason the lesson exists.
docker compose exec -T db mysql -u btt -p"$WORDPRESS_DB_PASSWORD" btt \
  -e 'SHOW CREATE TABLE wp_btt_leads;'
# Expected: the CREATE TABLE, containing
#             UNIQUE KEY `uniq_email_source` (`email`,`source`)
#             KEY `idx_created_at` (`created_at`)
#           and `email` varchar(190), NOT 255 — see Key Concept 4

# 2. dbDelta() IS IDEMPOTENT — the check that actually matters (Key Concept 2).
#    Activation runs on every deploy, so a statement that converges once and
#    diverges forever is a silent ALTER on every release. Capture, re-activate,
#    compare byte for byte.
docker compose exec -T db mysql -u btt -p"$WORDPRESS_DB_PASSWORD" btt \
  -e 'SHOW CREATE TABLE wp_btt_leads;' > /tmp/btt-leads-schema-1.txt

docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core

docker compose exec -T db mysql -u btt -p"$WORDPRESS_DB_PASSWORD" btt \
  -e 'SHOW CREATE TABLE wp_btt_leads;' > /tmp/btt-leads-schema-2.txt

diff /tmp/btt-leads-schema-1.txt /tmp/btt-leads-schema-2.txt && echo 'schema converged'
# Expected: schema converged — no diff output at all.
#           ANY difference means dbDelta() re-issued DDL it did not need to, and
#           the cause is a formatting rule from appendix 03 §5. Check the two
#           spaces after PRIMARY KEY first; it is the usual one.

#    And a third activation with the version option already at 1 must not even
#    reach dbDelta():
docker compose run --rm wpcli wp option get btt_leads_db_version
# Expected: 1 — ensure_leads_table() returns early on the second call, so the
#           steady-state cost of this on a deploy is one option read.
rm -f /tmp/btt-leads-schema-1.txt /tmp/btt-leads-schema-2.txt

# 3. The guard is gone, and the endpoint now WRITES. Lesson 06.2 check 14
#    returned "Temporarily unavailable." here; it must not any more.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{submitHobtLead(input:{email:\"lead163@example.test\",fullName:\"Lead One\",source:HOBT_HERO,consent:true}){accepted}}"}' \
  | jq -c '.'
# Expected: {"data":{"submitHobtLead":{"accepted":true}}}   ← no `errors` key

SQL 'SELECT email, source, locale, consent FROM wp_btt_leads WHERE email = "lead163@example.test";'
# Expected: lead163@example.test	hobt-hero	en	1

# 4. ip_hash is 64 hex characters, and the HMAC key is doing its job
SQL 'SELECT ip_hash FROM wp_btt_leads WHERE email = "lead163@example.test";' | grep -cE '^[0-9a-f]{64}$'
# Expected: 1

# 5. NEGATIVE — THE DUPLICATE. Submit the same (email, source) again. The API
#    says accepted; the ROW COUNT does not move. The assertion is on the count,
#    because that is what proves MySQL enforced it rather than PHP remembering to.
BEFORE=$(SQL 'SELECT COUNT(*) FROM wp_btt_leads;')
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{submitHobtLead(input:{email:\"lead163@example.test\",fullName:\"Lead One\",source:HOBT_HERO,consent:true}){accepted}}"}' \
  | jq -r '.data.submitHobtLead.accepted'
# Expected: true   ← deliberately indistinguishable from a new lead (§9)
SQL 'SELECT COUNT(*) FROM wp_btt_leads;'
# Expected: exactly BEFORE. The UNIQUE KEY refused the insert.
echo "before=$BEFORE"

#    And the SAME email from a DIFFERENT source is a different lead, which is
#    what the composite key means.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{submitHobtLead(input:{email:\"lead163@example.test\",fullName:\"Lead One\",source:HOBT_FOOTER,consent:true}){accepted}}"}' \
  >/dev/null
SQL 'SELECT COUNT(*) FROM wp_btt_leads WHERE email = "lead163@example.test";'
# Expected: 2

# 6. NEGATIVE — no raw IP anywhere. Not in ip_hash, not in any other column.
SQL 'SELECT COUNT(*) FROM wp_btt_leads WHERE ip_hash REGEXP "^[0-9]+\\\\.";'
# Expected: 0
SQL 'SHOW COLUMNS FROM wp_btt_leads;' | grep -ciE '^ip	|^remote'
# Expected: 0 — there is no `ip` column and there is not going to be one

# 7. Now the browser path. Open http://localhost:3000/en/hobt, click Get Demo,
#    fill the four fields, tick consent, wait for the Turnstile widget, submit.
SQL 'SELECT email, source FROM wp_btt_leads ORDER BY id DESC LIMIT 1;'
# Expected: the address you typed, with source hobt-hero
#           Also open http://localhost:8081 (Adminer) and read the row there —
#           it is the only reader this feature has until Module 24.

# 8. NEGATIVE — a filled honeypot is refused and NO row appears. In DevTools,
#    Elements, find input[name="website"], set its value to "https://x.test",
#    then submit the form.
SQL 'SELECT COUNT(*) FROM wp_btt_leads;'
# Expected: unchanged. In the browser: the generic message, which says nothing
#           about a honeypot.

# 9. NEGATIVE — an impossibly fast submit is refused. In DevTools set
#    input[name="renderedAt"] to the current epoch in milliseconds
#    (`Date.now()` in the console) and submit immediately.
SQL 'SELECT COUNT(*) FROM wp_btt_leads;'
# Expected: unchanged, with the same generic message. Note that Cloudflare's
#           challenge_ts check (§5) is the one that cannot be defeated this way,
#           because rewriting a hidden field does not move Cloudflare's clock.

# 10. NEGATIVE — a bad Turnstile token is refused. Cloudflare's documented
#     ALWAYS-FAILS secret, called directly, so this needs no restart:
#     Cloudflare's always-fails pair is "2x" + 31 zeroes + "AA". Assembled here
#     rather than pasted, so the lesson never contains a line that looks like a
#     real credential assignment.
FAILS="2x$(printf '0%.0s' $(seq 1 31))AA"
curl -s -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  --data-urlencode "secret=$FAILS" -d 'response=anything' \
  | jq -c '{success, "error-codes"}'
# Expected: {"success":false,...}
#     For the full path: put "$FAILS" in TURNSTILE_SECRET_KEY, restart
#     `npm run dev`, submit a valid form, then put the always-passes 1x value back.
SQL 'SELECT COUNT(*) FROM wp_btt_leads;'
# Expected: unchanged

# 10b. NEGATIVE — WordPress'S OWN WORDING reaches the form. Two halves.
#
#      (a) The SHAPE. `consent: false` is refused in PHP, not by your schema:
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"query":"mutation{submitHobtLead(input:{email:\"nc@example.test\",fullName:\"No Consent\",source:HOBT_HERO,consent:false}){accepted}}"}' \
  | jq -c '{message: .errors[0].message, payload: .data.submitHobtLead}'
# Expected: {"message":"Consent is required.","payload":null}
#           `errors` populated AND `data` present carrying a null. Lesson 15.2's
#           strict policy on fetchGraphQLAuthed is what makes that a thrown
#           GraphQLRequestError instead of a null the action has to guess about.
SQL 'SELECT COUNT(*) FROM wp_btt_leads WHERE email = "nc@example.test";'
# Expected: 0
#
#      (b) The FORM. `consent` cannot demonstrate this through the UI, because
#          leadSchema's z.literal('on') refuses first — which is the design. So
#          use a refusal only WordPress can produce. Copy the file first; never
#          revert one from git in a verification block.
cd ../next-app
cp .env.local /tmp/btt-env-local.bak
sed -i.orig 's#^WP_APP_TOKEN=.*#WP_APP_TOKEN=not-the-token#' .env.local
rm -f .env.local.orig
#          Restart `npm run dev`, then submit a VALID Get Demo form.
# Expected in the browser: "Not authorized." — require_app_token()'s own
#          sentence, compared with hash_equals(). With a generic message here, a
#          rotated-but-not-redeployed app token is a lead form that silently
#          captures nothing on your highest-value page.
cd ../wordpress-headless && SQL 'SELECT COUNT(*) FROM wp_btt_leads;'
# Expected: unchanged
cd ../next-app && cp /tmp/btt-env-local.bak .env.local && rm /tmp/btt-env-local.bak
#          Restart `npm run dev` again, and re-submit to confirm it works.
cd ../wordpress-headless

# 11. NEGATIVE — nothing logs PII, and nothing can
cd ../next-app
grep -rn 'console.log' src/actions/ | wc -l
# Expected: 0
grep -rniE '(email|ip_hash|token)' src/actions/leads.ts | grep -ciE 'console|log\('
# Expected: 0
grep -c 'catch {' src/actions/leads.ts
# Expected: 1 — verifyTurnstile(), where the error object could carry the SECRET
#           KEY in its request options. No bound variable, so there is nothing
#           in scope to print. That is a mechanism, not a discipline.
grep -c 'catch (error)' src/actions/leads.ts
# Expected: 1 — step 4, the one place an error IS bound, because
#           formatGraphQLErrors(error.errors) is how WordPress's own sentence
#           reaches the user (Key Concept 8).
grep -cE '(console|JSON\.stringify)\( *error' src/actions/leads.ts
# Expected: 0 — that bound error is read for `.errors` and never serialised

# 12. NEGATIVE — the secret key is server-side and the site key is not
grep -rl 'TURNSTILE_SECRET_KEY' src/components/ | wc -l
# Expected: 0
grep -rl 'NEXT_PUBLIC_TURNSTILE_SITE_KEY' src/components/ | wc -l
# Expected: 1 — LeadForm.tsx, and that is correct by design
npm run build
grep -rl "$(grep -E '^TURNSTILE_SECRET_KEY=' .env.local | cut -d= -f2-)" .next/static/ 2>/dev/null | wc -l
# Expected: 0

# 13. NEGATIVE — Lesson 11.5's debt is discharged, both halves of it
grep -c 'aria-disabled' src/components/hobt/HobtCtaBand.tsx
# Expected: 0
curl -s http://localhost:3000/en/hobt | grep -c 'Demo booking opens in Module 16'
# Expected: 0
curl -s http://localhost:3000/en/hobt | grep -o 'Get Demo' | wc -l
# Expected: 2 or more — the button is still there, and now it does something

# 14. NEGATIVE — no interpolated SQL in the plugin, anywhere near this table
cd ../wordpress-headless
grep -rn 'wp_btt_leads\|btt_leads' wp-content/plugins/blame-the-tech-core/
# Expected: every hit is inside leads_table(), a $wpdb->prepare() call, an
#           $wpdb->insert() call, an option name, or a comment. No hit is a
#           string being built with a variable in it.
grep -rcE '\$wpdb->query\( *"' wp-content/plugins/blame-the-tech-core/ | grep -v ':0' | wc -l
# Expected: 0
grep -rc 'prepare(' wp-content/plugins/blame-the-tech-core/includes/Leads.php
# Expected: 1

# 15. Both suites still green
cd ../next-app && npm test -- --run && npx playwright test
# Expected: 0 failures

# 16. Clean up the probes
cd ../wordpress-headless
SQL 'DELETE FROM wp_btt_leads WHERE email LIKE "%@example.test";'
SQL 'SELECT COUNT(*) FROM wp_btt_leads;'
# Expected: only the lead you submitted through the browser in check 7
git status --short
# Expected: no .env, no .env.local
```

Checks 2, 5, 6 and 13 define this lesson: the schema converges instead of being re-altered on every
deploy, the database enforces uniqueness rather than your PHP remembering to, no raw address is
stored anywhere, and the inert button from Module 11 is gone along with the sentence apologising for
it. Check 10b will save you an afternoon — it is the difference between a lead form that says
`Not authorized.` and one that says nothing.

## Control Questions

1. A colleague "simplifies" `wp_btt_leads` into a `hobt_lead` custom post type with
   `show_in_rest: true` and `show_in_graphql: false`. Name the three things they have lost, the one
   thing they have gained, and the single character change that turns their build into a public
   lead-disclosure endpoint.
2. `dbDelta()` runs on every activation and every activation is a deploy. Explain what happens over
   twenty deploys if you write `PRIMARY KEY (id)` with one space instead of two, and say how you
   would notice.
3. The `renderedAt` hidden field is forgeable and the lesson keeps it anyway. Justify keeping it,
   then describe how Cloudflare's `challenge_ts` gives you an unforgeable version of the same signal
   without a new environment variable.
4. `ip_hash` is `hash_hmac('sha256', $ip, $key)` rather than `hash('sha256', $ip)`. Estimate how
   long it takes to reverse the unkeyed version for the whole of IPv4, and say what rotating
   `BTT_LEAD_IP_HMAC_KEY` does to rows already in the table.
5. Every spam refusal returns the same sentence, and the duplicate case returns `accepted: true`.
   Name the class of attack each decision defends against, and state the concrete user-experience
   cost you are accepting in exchange for each.

## Learn More

- [`dbDelta()`](https://developer.wordpress.org/reference/functions/dbdelta/) — the reference, and
  the note about `require_once` on `upgrade.php`
- [Creating tables with plugins](https://codex.wordpress.org/Creating_Tables_with_Plugins) — the
  formatting rules in Key Concept 2, in the order they were written down originally
- [`wpdb::prepare()`](https://developer.wordpress.org/reference/classes/wpdb/prepare/) — read the
  `%i` section; most developers have never met it
- [`wpdb::insert()`](https://developer.wordpress.org/reference/classes/wpdb/insert/) — why the
  format array makes the call a prepared statement, and what happens when its length is wrong
- [InnoDB limits](https://dev.mysql.com/doc/refman/8.0/en/innodb-limits.html) — the 767-byte index
  prefix that produces the number 190
- [Turnstile: server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) —
  the `siteverify` contract, including the `challenge_ts` field Key Concept 5 depends on
- [Turnstile: testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) — the
  documented always-pass and always-fail key pairs, so this lesson needs no Cloudflare account
- [`hash_hmac()`](https://www.php.net/manual/en/function.hash-hmac.php) — one page, and the reason a
  keyed digest is not the same thing as a hash
- [OWASP: logging cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) —
  the "what not to log" list Key Concept 7 condenses
- [WAI-ARIA APG: modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) — the
  six behaviours Radix implements, so you can check them rather than assume them
