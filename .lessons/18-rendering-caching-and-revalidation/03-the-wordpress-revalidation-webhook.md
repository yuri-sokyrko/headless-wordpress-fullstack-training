---
title: 'The WordPress Revalidation Webhook'
module: 18
lesson: 3
teaches: [hmac-signed-webhooks, replay-window, timing-safe-compare, wp-remote-post, host-docker-internal]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Revalidate.php', 'next-app/src/app/api/revalidate/route.ts', 'wordpress-headless/.env.example', 'next-app/.env.example']
requires: [18.2]
---

# Lesson 18.3 — The WordPress Revalidation Webhook

## Quick Overview

This is the lesson that closes the gap you have been living with since Module 16: an editor clicks
Publish and the public site changes within seconds. WordPress hooks `transition_post_status`,
`saved_term` and `acf/save_post`, builds a small JSON payload — type, post type, slug, locale —
and `wp_remote_post()`s it to `BTT_FRONTEND_URL . '/api/revalidate'` with two headers:
`X-BTT-Timestamp` and `X-BTT-Signature: sha256=<HMAC(ts + "." + body, BTT_REVALIDATE_SECRET)>`.
Two arguments to that call matter as much as the signature: `blocking => false` and
`timeout => 2`. An editor's Publish must never wait on a network call to Vercel, and a slow or
down front end must never become an editorial outage. The consequence is that WordPress does not
see the response, which you should notice now rather than during debugging.

The Next side is a route handler that does four things in a fixed order, and each one has a
specific failure code. First, the timestamp must be within ±300 seconds of now, or `400` — that is
the replay guard, and without it a captured request stays valid forever. Second, recompute the HMAC
over `ts + "." + body` and compare with `timingSafeEqual`, returning `401` with **no reason
echoed**, because a helpful error message on a signature check is an oracle. Third, `Zod.parse` the
body and return `400` on anything unexpected — a valid signature proves the sender knows the
secret, not that the payload is sane. Only then `revalidateTag`, using the functions from
`tags.ts` so the vocabulary cannot drift. Note what this endpoint does *not* have: cookies. It is
cookieless by design, so CSRF against it is structurally impossible rather than merely blocked —
a browser cannot forge the signature, and there is no ambient credential for it to ride on.

By the end of this lesson you will have:

- `includes/Revalidate.php` — the three hooks, the payload builder, `hash_hmac()`, and
  `wp_remote_post()` with `blocking => false, timeout => 2`
- `src/app/api/revalidate/route.ts` — the four ordered checks, tags derived from `tags.ts`, and a
  `200 {"revalidated":[…]}` response listing what it actually invalidated
- `BTT_REVALIDATE_SECRET` / `REVALIDATE_SECRET` in both `.env.example` files as `__CHANGE_ME__`,
  with real values only in gitignored files
- `BTT_FRONTEND_URL` set to `host.docker.internal:3000`, plus `extra_hosts` in the Compose file if
  you are on Linux
- Four negative proofs: unsigned request → `401`; wrong signature → `401`; correct signature with a
  ten-minute-old timestamp → `400`; valid signature with a malformed body → `400`
- The end-to-end result: change a title in wp-admin, reload the public page, see the new title
  without a deploy and without waiting for a timer

## Classic WP Analogy

The hook side is completely familiar. `transition_post_status` is the hook you reach for whenever
"do something when a post is published" comes up, and you already know why it beats `save_post`:
it gives you both the old and new status, so you can act on `draft → publish` without also firing
on every autosave. `wp_remote_post()` is `wp_remote_*`, the same function you use to call any
third-party API from WordPress, with the same `blocking` and `timeout` arguments and the same
`WP_Error` return. Webhooks out of WordPress are not new — WooCommerce, Jetpack and every CRM
integration you have installed do exactly this.

| Classic WordPress | This stack |
|---|---|
| `transition_post_status` → clear a page cache | `transition_post_status` → `POST /api/revalidate` |
| `wp_remote_post()` to a third-party API | unchanged — same function, same arguments |
| `blocking => false` on analytics pings | unchanged, and load-bearing here |
| `hash_hmac( 'sha256', … )` for a payment callback | unchanged — this is the standard webhook pattern |
| `hash_equals()` on an incoming signature | `crypto.timingSafeEqual()` on the Next side |
| a nonce for a same-origin form | **not applicable** — this request has no browser and no cookie |
| verifying a Stripe/PayPal IPN signature | verifying your own signature, in the other direction |

If you have ever implemented a payment-gateway callback properly, you have written the receiving
half of this before: verify the signature over the **raw** body, check a timestamp, then and only
then parse. The order is not stylistic. Parsing before verifying means running a parser on
attacker-controlled input, and reading the body twice in a way that lets the signed bytes and the
parsed bytes differ is its own vulnerability class.

**Where the analogy breaks down:** cache invalidation in Classic WordPress is an **internal**
operation. `delete_transient()` or a page-cache plugin's flush runs in the same process, needs no
credential, and cannot be triggered by a stranger. Here invalidation is a **public HTTP endpoint on
a different machine**, and an unauthenticated one would be a free denial-of-service lever: an
attacker who can invalidate your entire cache in a loop makes every request a cache miss and
points all of that traffic at your WordPress origin. That is why the signature is not optional and
why the `Zod` parse is not paranoia.

The second break, and it is the one that eats an afternoon: in Classic WordPress the cache is
inside the container, so networking never enters the picture. Here Next runs on the **host** and
WordPress runs in Compose, so `localhost:3000` inside the container is the container itself.
`BTT_FRONTEND_URL` must be `http://host.docker.internal:3000`, and on Linux that name only resolves
if you added `extra_hosts: ["host.docker.internal:host-gateway"]`. Combined with `blocking => false`
throwing away the response, this is the number-one cause of "my revalidation webhook silently does
nothing" — see [appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv).

---

## Key Concepts

### 1. `transition_post_status`, and why the old status is the whole point

`save_post` tells you a post was written. `transition_post_status` tells you what it was and what
it became, and cache invalidation is a question about the *change*, not about the write.

```php
// (illustration) the signature. Old status is the SECOND argument, and getting
// the order backwards means your handler fires never rather than always.
add_action( 'transition_post_status', $callback, 10, 3 );
function callback( string $new_status, string $old_status, \WP_Post $post ): void {}
```

| The change | `save_post` sees | `transition_post_status` sees | Does the public site change |
|---|---|---|---|
| `draft` → `publish` | a save | the transition | **yes** — a page appears |
| `publish` → `trash` | a save | the transition | **yes** — a page disappears |
| `publish` → `publish` (a title edit) | a save | `$new === $old` | **yes** — the same page, different content |
| `draft` → `pending` | a save | the transition | no — invisible either way |
| `auto-draft` → `draft` | a save | the transition | no |

Read that table twice, because it contains the trap. `save_post` cannot distinguish rows 4 and 5
from rows 1 and 2, so a `save_post`-driven webhook fires on every autosave of every draft and
invalidates a cache that was correct. And `transition_post_status` alone cannot see row 3, because
`$new === $old` — which is the guard everybody adds first and the reason a title edit on a
published post silently stops revalidating.

**The resolution this lesson uses: guard on `$new === $old` *and* accept the case where either
side is `publish`.** A `publish → publish` transition does fire `transition_post_status` — the hook
runs on every `wp_insert_post` call, including one that does not change the status — so the
`$new === $old` guard must be a guard on *irrelevant* transitions, not a blanket one. Lesson 16.4
Key Concept 4 has the full transition table for the moderation flow; do not re-derive it here.

### 2. The full guard set, and a second handler on the same hook

`includes/admin/moderation-queue.php` (Lesson 16.4) already registers
`notify_reporter_on_transition()` on this hook, with the `$new === $old`, `wp_is_post_revision()`
and `wp_is_post_autosave()` guards. This lesson adds a **second, independent** handler in a
different file, and that is deliberate.

| | One handler doing both | Two handlers, one hook |
|---|---|---|
| A `wp_mail()` failure | can abort the revalidation | cannot |
| A network timeout on the webhook | delays the mail | cannot |
| Reading the file later | two unrelated concerns interleaved | each file is about one thing |
| Duplicated guards | none | **four lines, duplicated** |

**The verdict: two handlers.** The duplicated guard set is a real cost and it is the cheaper one:
mailing a reporter and invalidating a cache have nothing to say to each other, and neither should
be able to prevent the other. Lesson 16.4's own comment anticipated this — "Module 18 attaches the
revalidation webhook to this same hook, and reuses these same guards."

The four guards, and what each one costs you when it is missing:

| Guard | Missing means |
|---|---|
| `in_array( $post->post_type, REVALIDATE_POST_TYPES, true )` | every `nav_menu_item`, `attachment`, `acf-field-group` and `revision` fires a webhook |
| `$new_status === $old_status` combined with a `publish` test | either every autosave fires, or a title edit never does |
| `wp_is_post_revision( $post )` | every save fires twice, once for the post and once for its revision |
| `wp_is_post_autosave( $post )` | the block editor's periodic autosave fires a webhook every sixty seconds |

None of these produces an error. They produce a webhook storm you only notice as WordPress load,
which is the same class of invisible as everything else in this lesson.

### 3. The other two triggers, and what each payload looks like

Three hooks, three payload shapes, one signing function.

| Hook | Fires on | Payload |
|---|---|---|
| `transition_post_status` | a post's status changing, or a save on a published post | `{"type":"post","postType":"incident","slug":"incident-01","locale":"en"}` |
| `saved_term` | a term created, renamed or re-slugged | `{"type":"term","taxonomy":"scapegoat","slug":"the-intern","termId":4,"locale":"en"}` |
| `acf/save_post` | an SCF field group saved — including the **options page** and a **term** field group | `{"type":"options","locale":"en"}`, or the post/term shape above |

`acf/save_post` is the one that is easy to leave out and expensive to leave out. An SCF-only edit
to a *published* post — changing `downtimeMinutes`, or the HOBT page's `seatsLeft` — **does not
change the post status**, so `transition_post_status` fires with `$new === $old` and most guard
sets drop it. The SCF hook is what catches it, and after Lesson 18.1 made `/hobt`
`revalidate: false` it is the only thing that catches it.

It also has two argument shapes that are not documented next to each other: `'options'` for an
options page, and `term_<id>` for a term field group. The `Scapegoat Profile` group from appendix
03 §4.2 arrives as the second one, which is how an editor filling in a tagline invalidates that
scapegoat's page. Register it at priority **20**, after SCF has written the fields — at priority 10
you can win the race and send a webhook describing the previous values.

> **`menu:primary` is not in this webhook, and that is a named gap.** A menu change arrives on
> `saved_term` for the `nav_menu` taxonomy, but the tag is keyed on the theme *location*
> (`primary`), not on the menu's own slug, so building it needs a reverse lookup through
> `get_nav_menu_locations()`. The frozen payload's `type` enum has three values and none of them
> fits. So `menu:primary` is still invalidated only by the 3600-second window Lesson 11.3 gave it.
> Written into `docs/api-contract.md` as a gap in Step 6, because an undocumented gap is a bug and
> a documented one is a decision.

### 4. `blocking => false`, `timeout => 2`, and the diagnostics you therefore do not get

Two arguments to `wp_remote_post()` that matter as much as the signature.

```
   WITH blocking => true                    WITH blocking => false
   ─────────────────────────────────        ─────────────────────────────────
   editor clicks Publish      t=0           editor clicks Publish      t=0
   wp_remote_post() opens TCP t=0           request is dispatched      t=0
   Vercel is cold             t=0.1         PHP does not wait          t=0
   ...                                      wp-admin responds          t=0.2
   response arrives           t=4.8         (the POST completes,
   wp-admin responds          t=4.9          or does not, unobserved)
```

**An editor's Publish must never wait on a network call**, and a slow or down front end must never
become an editorial outage. `timeout => 2` bounds the worst case even in the blocking case;
`blocking => false` removes the wait entirely.

The consequence, which you should notice now rather than at 2am:

- **WordPress does not see the response.** Not the status code, not the body, not a `WP_Error`.
- `wp_remote_post()` returns a `WP_Error` on a transport failure and **you will never see it**,
  because with `blocking => false` there is nothing to return it about. Checking `is_wp_error()`
  on that return value is a check that cannot fail.
- Therefore **every diagnostic is on the Next side.** A 401 from `/api/revalidate` appears in the
  Next terminal and nowhere else. WordPress's only trace is a log line recording the *intent*,
  which is why this lesson writes one.

That single fact is why appendix 06 §4's stale-content checklist starts on the WordPress side and
ends on the Next side: WordPress can tell you it *tried*, and only Next can tell you what happened.

### 5. `host.docker.internal`, and why the failure is completely silent

Appendix 06 calls this "the single most common cause", and combined with Key Concept 4 you can see
exactly why: the request fails, WordPress discards the failure, and nothing anywhere says so.

```
   ┌─ your host ─────────────────────────────────────────────────────────┐
   │                                                                     │
   │   next-app  npm run start  :3000                                    │
   │        ▲                                                            │
   │        │  POST /api/revalidate                                      │
   │        │  http://host.docker.internal:3000     ✅                   │
   │   ┌────┴────────────────────────────────────────────────┐            │
   │   │ compose network: btt-net                            │            │
   │   │                                                     │            │
   │   │   wordpress ──▶ http://localhost:3000  ❌ nothing    │            │
   │   │                 (localhost IS the wordpress          │            │
   │   │                  container — Lesson 02.2 §2)         │            │
   │   └─────────────────────────────────────────────────────┘            │
   └─────────────────────────────────────────────────────────────────────┘
```

Next runs on your **host**. It is not a Compose service, so it has no service-name DNS entry, and
`localhost:3000` inside the `wordpress` container reaches the container's own empty port 3000.
`BTT_FRONTEND_URL` must be `http://host.docker.internal:3000`, and on Linux that name only resolves
because Lesson 02.2 added `extra_hosts: ["host.docker.internal:host-gateway"]` to both the
`wordpress` and the `wpcli` service.

In production the same variable is the public origin, which is why it is a variable rather than a
constant — see [appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv).

### 6. Verify over the raw body, then parse — and read the body exactly once

This is the one implementation detail people get wrong in a Node route handler, and it has a
specific shape.

```ts
// ❌ WRONG: parse first. A parser is now running on attacker-controlled bytes,
//    before anything has established that the sender knows the secret.
const payload = await request.json();
if (!verify(request.headers.get('X-BTT-Signature'), JSON.stringify(payload))) …

// ❌ ALSO WRONG, and worse: sign one thing, use another. `JSON.stringify` of a
//    parsed object is NOT the bytes that arrived — key order, whitespace and
//    number formatting all differ — so this either never verifies, or verifies
//    something that is not what you are about to act on.

// ✅ RIGHT: one read, verify those bytes, parse THAT string.
const raw = await request.text();
if (!verify(request.headers.get('X-BTT-Signature'), raw)) return unauthorized();
const payload = PayloadSchema.parse(JSON.parse(raw));
```

Two independent reasons, and both are worth holding:

1. **A parser is code.** `JSON.parse` on unverified input is a small attack surface, and Zod on
   unverified input is a larger one. Verifying first means the only code that touches unauthenticated
   bytes is an HMAC over a byte string.
2. **The signed bytes and the acted-on bytes must be the same bytes.** Any design in which they can
   differ is its own vulnerability class — signature confusion. `await request.text()` returns a
   string; sign that string, parse that string, act on the result. A second `await request.text()`
   on a consumed stream throws, which is the runtime's way of enforcing the rule for you.

The same reasoning applies on the WordPress side and shows up as one line: `wp_json_encode()` once,
into a variable, then sign **that variable** and send **that variable**. Encoding twice — once to
sign and once to send — is how PHP produces two different byte strings from one array.

### 7. The signature, the window, and the silence

Three decisions that only make sense together.

**The window.** `X-BTT-Timestamp`, and `|now − ts| <= 300` or HTTP 400. Without it a captured
request is valid forever: anybody who once observed a signed POST — a proxy log, a `tcpdump`, a
shared CI log — can replay it indefinitely and force a cache miss on demand. With it, the capture
expires in five minutes. ±300 seconds rather than ±30 because a container's clock and its host's
clock drift, and a webhook that fails on a two-minute skew is a webhook you will disable.

Note what makes the timestamp trustworthy: **it is inside the signature.** `ts . '.' . body` is
what is signed, so an attacker cannot move the timestamp forward without invalidating the HMAC.
A timestamp header outside the signature is decoration.

**`timingSafeEqual`.** A naive `===` on two strings returns as soon as it finds a differing byte,
so the time it takes leaks how many leading bytes matched. That is a practical attack against a
remote HMAC comparison given enough samples, and the fix costs nothing:

```ts
// ✅ Compare lengths in the open — the length of a hex digest is public —
//    then compare contents in constant time. timingSafeEqual THROWS on a
//    length mismatch, so the length check is required rather than an
//    optimisation.
if (left.length !== right.length) return false;
return timingSafeEqual(left, right);
```

**The silent 401.** The response body on a signature failure is empty. No "bad signature", no "bad
timestamp format", no "expected sha256=". A helpful error on a signature check is an **oracle**: it
tells an attacker which of their guesses was structurally right, which converts an unguessable
64-character digest into a series of answerable questions. The 401 says nothing, and the reason
lives in the Next server log where only you can read it.

This is also why the *order* is window-then-signature. The window check is on a value nobody can
forge into validity, so answering it with a distinguishable 400 costs nothing; the signature check
is the one that must be mute.

### 8. `Zod.parse` after a valid signature, because they prove different things

A valid signature proves the sender knows `BTT_REVALIDATE_SECRET`. That is all it proves.

| It does prove | It does not prove |
|---|---|
| the sender holds the shared secret | the payload has the fields you expect |
| the bytes were not modified in transit | `postType` is a post type this app renders |
| the request is less than 300 s old | the sender is the WordPress *version* you deployed |
| — | the sender is not a WordPress with a half-applied plugin update |

The third row is the practical one. Both applications deploy independently: a WordPress running
last week's `Revalidate.php` still holds this week's secret. So the schema is the version boundary,
and an unrecognised `postType` must be a **loud 400** rather than a tag nothing carries.

That is a genuine improvement in the failure mode, and it is why this lesson's payload carries
**identifiers rather than tag strings**:

```
   payload carries TAG STRINGS          payload carries IDENTIFIERS
   ────────────────────────────         ────────────────────────────────
   PHP builds 'incident-dns'            PHP sends postType: 'incident'
   Next calls revalidateTag(it)         Zod rejects an unknown postType → 400
   → 200, nothing invalidated           Next builds the tag with tags.ts
   → silent, forever                    → one tag builder in the system
```

**So `tags.ts` stays the only thing in either codebase that constructs a tag string.** The
two-codebase contract does not disappear — PHP still has to send `tech_review` and not
`techReview`, and `$post->post_name` and not `$post->post_title` — but the contract is now over a
small enumerated vocabulary that Zod validates, instead of over free-form strings nobody checks.
Step 6 writes that vocabulary into `docs/api-contract.md`.

Two more properties of this endpoint worth stating plainly:

- **An unauthenticated revalidation endpoint is a free denial-of-service lever.** Not a data
  breach — a load amplifier. An attacker who can invalidate your cache in a loop makes every
  subsequent request a miss, and every miss is a GraphQL query against your WordPress origin. Your
  CDN stops absorbing traffic and starts forwarding it. The signature is not paranoia; it is the
  only thing between a cheap loop and your database.
- **The endpoint reads no cookie, so CSRF against it is structurally impossible** rather than
  merely blocked. There is no ambient credential for an attacker's page to borrow, and a browser
  cannot compute the HMAC. Compare Lesson 15.5 §8's three layers: this is layer three, the one that
  changes the endpoint's design instead of defending it.

### 9. The ID-keyed scapegoat tag, and a debt from Lesson 14.4

Lesson 14.4's `ScapegoatPicker` block tags its fetch with `termTag('scapegoat', String(termId))`,
not `termTag('scapegoat', slug)`. The reason is structural rather than sloppy: the block's saved
attributes contain a term **ID**, and the component cannot know the slug until the GraphQL response
it is about to make has already arrived.

```
   the block stores          the component can tag with       the webhook must send
   ────────────────          ──────────────────────────       ─────────────────────
   { termId: 4 }             scapegoat:4                      scapegoat:4
                             (available before the fetch)     AND
                                                              scapegoat:the-intern
                             scapegoat:the-intern             (because every OTHER
                             ✗ needs the response first        consumer uses the slug)
```

Lesson 14.4 wrote that into `docs/api-contract.md` as a debt this webhook owes: **the term branch
sends both forms.** One `saved_term` event produces `scapegoat:the-intern` *and* `scapegoat:4`, plus
`scapegoats` and `incidents`. Four `revalidateTag` calls for one editorial action, and every one of
them is a real dependency somebody attached.

The cost, stated plainly: a tag keyed on a database ID is a tag that means nothing to a human
reading a log line, and it is the one tag in the vocabulary that is not portable across a database
restore. It is the right trade anyway — the alternative is a block that re-renders stale term names
forever — and it is the reason the payload carries `termId` at all.

### 10. The test-only hook, and why it 404s rather than 401s

Lesson 23.6 runs Lesson 12.4's `global-setup`, which restores `fixtures/seeded.sql`, and then
has a problem: **Next has no
idea the database was replaced.** Every ISR entry still describes the pre-import content, the tags
were never expired, and the specs that follow assert against data that is correct in MySQL and
stale in Next. Appendix 06 §7 lists it as "passes alone, fails in the suite" — the worst possible
failure signature.

So `/api/revalidate` gets a second credential: `X-BTT-E2E-Secret`, checked **before** the HMAC
path, with `{"type":"all"}` mapping to `revalidatePath('/', 'layout')`.

| Condition | Response | Why that code |
|---|---|---|
| `E2E_MODE !== '1'` | **404** | in production this branch **does not exist**, and the response says so |
| `E2E_MODE === '1'`, `E2E_SECRET` unset | **404** | an unconfigured hook is an absent hook. Fail closed |
| `E2E_MODE === '1'`, wrong secret | **401** | the hook exists and you are not authorised |
| `E2E_MODE === '1'`, right secret, bad body | 400 | same rule as the signed path: a credential is not a schema |

**404 and not 401 is the decision worth understanding.** A 401 confirms there is something there
to authenticate against — it turns "does this deployment have a test hook" into a question with an
answer. A 404 makes the endpoint indistinguishable from one that was never written. AUTHORING's
security invariant states it as a rule: a test-only hook 404s unless explicitly enabled **and** a
secret header matches.

And `revalidatePath('/', 'layout')` is correct **here** and wrong everywhere else, which Lesson
18.2 Key Concept 10 argued: a database import replaced the entire content universe, and there is no
set of tags that expresses that. Everywhere else it discards every warm entry to fix one page.

One environment detail that is settled and should not be re-litigated: `E2E_MODE` and `E2E_SECRET`
reach **this** code from `next-app/.env.local`, because this code runs inside the Next runtime. The
**Playwright** process reads them only from the invoking shell, because Playwright does not load
`.env.local`. Lesson 12.4 §9 argues that split; cite it rather than repeating it.

---

## Task

### Step 1: Confirm the WordPress secret, add the Next one

`BTT_REVALIDATE_SECRET` and `BTT_FRONTEND_URL` have been in `wordpress-headless/.env` and
`.env.example` since Lesson 02.5 — this lesson **verifies** them rather than creating them, exactly
as Lesson 15.2 did for `GRAPHQL_JWT_AUTH_SECRET_KEY`. What is missing is the Next half.

```bash
cd wordpress-headless

# 1. Is the secret a real value rather than a placeholder?
docker compose exec wordpress php -r 'echo getenv("BTT_REVALIDATE_SECRET") === "__CHANGE_ME__" || getenv("BTT_REVALIDATE_SECRET") === "" ? "NOT SET\n" : "set (" . strlen(getenv("BTT_REVALIDATE_SECRET")) . " chars)\n";'

# 2. Is the front-end URL the one a container can actually reach?
docker compose exec wordpress php -r 'echo getenv("BTT_FRONTEND_URL"), PHP_EOL;'
# Expected: http://host.docker.internal:3000   — NOT localhost:3000

# 3. Does that name resolve from inside the container? Lesson 02.2 added the
#    extra_hosts entry for exactly this moment.
docker compose exec wordpress getent hosts host.docker.internal
```

If check 1 says `NOT SET`, generate one **into your session** and write it into both gitignored
files. Same value on both sides — it is a shared secret, not a pair of secrets:

```bash
export BTT_REVALIDATE_SECRET="$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)"
printf 'BTT_REVALIDATE_SECRET=%s\n' "$BTT_REVALIDATE_SECRET" >> wordpress-headless/.env
printf 'REVALIDATE_SECRET=%s\n'     "$BTT_REVALIDATE_SECRET" >> next-app/.env.local
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate wordpress
```

Then the two tracked example files. One is a comment change; one is a new section.

```dotenv
# wordpress-headless/.env.example — the existing section, with the lesson named
# ── Server-to-server credentials (Modules 16 and 18) ────────────────
# BTT_APP_TOKEN mirrors WP_APP_TOKEN in next-app/.env.local.
# BTT_REVALIDATE_SECRET mirrors REVALIDATE_SECRET there, and Lesson 18.3 is
# where it starts being used: it signs `<timestamp>.<body>` on every webhook.
# The two values MUST be identical, and a mismatch is a silent 401 nobody sees.
BTT_APP_TOKEN=__CHANGE_ME__
BTT_REVALIDATE_SECRET=__CHANGE_ME__
```

```dotenv
# next-app/.env.example — a new section, appended
# ── Revalidation (Lesson 18.3) ──────────────────────────────────────
# Mirrors BTT_REVALIDATE_SECRET in wordpress-headless/.env. Verifies the HMAC
# on POST /api/revalidate. Server-only: there is no NEXT_PUBLIC_ form of this
# and there never will be.
REVALIDATE_SECRET=__CHANGE_ME__
```

**Verify §1:**

- [ ] `docker compose exec wordpress getent hosts host.docker.internal` prints an IP. **If it is
      empty, stop here** — everything downstream will fail silently, which is exactly the symptom
      appendix 06 §4 calls the single most common cause.
- [ ] `grep -c '__CHANGE_ME__' next-app/.env.example` went up by exactly one.
- [ ] `grep -c 'REVALIDATE_SECRET' next-app/.env.local` is `1` and
      `git check-ignore -v next-app/.env.local` names a rule.
- [ ] The two values match:
      `test "$(grep -oP '(?<=^BTT_REVALIDATE_SECRET=).*' wordpress-headless/.env)" = "$(grep -oP '(?<=^REVALIDATE_SECRET=).*' next-app/.env.local)" && echo match`
      prints `match`. On macOS without GNU grep, use `cut -d= -f2-` instead of `-oP`.

### Step 2: Write `includes/Revalidate.php`

One file, three hooks, one payload builder, one signing function. It builds **no tag strings** —
Key Concept 8 is the argument, and `src/lib/graphql/tags.ts` stays the only thing in either
codebase that constructs a tag.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Revalidate.php
/**
 * The revalidation webhook: WordPress tells Next what changed.
 *
 * THREE TRIGGERS, ONE PAYLOAD BUILDER, ONE SIGNED POST — and no cache tag
 * strings anywhere in this file. The payload carries WordPress IDENTIFIERS
 * (`post_type`, `taxonomy`, `post_name`, `term_id`) and Next builds the tags
 * from them with src/lib/graphql/tags.ts. That way there is exactly one tag
 * builder in the system, and an identifier this app does not recognise is a
 * loud 400 rather than a tag nothing carries. Lesson 18.3 §8.
 *
 * `blocking => false` means WordPress never sees the response, so there is no
 * error handling here to write and none to read. Every diagnostic is on the
 * Next side; the error_log() line below records the INTENT and nothing more.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Post types the front end renders. A type that is absent is not an omission:
 * `nav_menu_item`, `attachment`, `revision` and `acf-field-group` all
 * transition statuses and none of them has a page.
 */
const REVALIDATE_POST_TYPES = array( 'incident', 'post', 'tech_review', 'page' );

/**
 * Taxonomies the front end renders. `nav_menu` is deliberately absent — the tag
 * is keyed on the theme LOCATION, not the menu's slug, and the payload's `type`
 * enum has no shape for it. Recorded as a gap in docs/api-contract.md.
 */
const REVALIDATE_TAXONOMIES = array( 'scapegoat', 'severity', 'tech_stack' );

add_action( 'transition_post_status', __NAMESPACE__ . '\\revalidate_on_transition', 10, 3 );
add_action( 'saved_term', __NAMESPACE__ . '\\revalidate_on_saved_term', 10, 3 );
// Priority 20, AFTER SCF has written the fields. At 10 you can win the race and
// send a webhook describing the previous values.
add_action( 'acf/save_post', __NAMESPACE__ . '\\revalidate_on_acf_save', 20 );

/**
 * A post's status changed, or a published post was saved.
 *
 * A SECOND, INDEPENDENT handler on this hook. includes/admin/moderation-queue.php
 * (Lesson 16.4) already registered notify_reporter_on_transition() with the same
 * guard set, and it stays there: mailing a reporter and invalidating a cache
 * have nothing to say to each other, and neither must be able to prevent the
 * other. Lesson 18.3 §2.
 */
function revalidate_on_transition( string $new_status, string $old_status, \WP_Post $post ): void {
	if ( ! in_array( $post->post_type, REVALIDATE_POST_TYPES, true ) ) {
		return;
	}

	// Autosaves and revisions transition statuses too. Without these two the
	// block editor fires a webhook every sixty seconds, forever, invisibly.
	if ( wp_is_post_revision( $post ) || wp_is_post_autosave( $post ) ) {
		return;
	}

	// The public site only changes when `publish` is on one side of the
	// transition. draft -> pending is an editorial event with no public
	// consequence; publish -> trash is very much one; publish -> publish is a
	// title or content edit and MUST fire. Lesson 16.4 Key Concept 4 has the
	// full table.
	if ( 'publish' !== $new_status && 'publish' !== $old_status ) {
		return;
	}

	revalidate_send(
		array(
			'type'     => 'post',
			'postType' => $post->post_type,
			// post_name, never post_title: the slug is what the front end
			// routes on and what tags.ts tagged with.
			'slug'     => $post->post_name,
			'locale'   => revalidate_locale_of_post( $post ),
		)
	);
}

/**
 * A term was created, renamed or re-slugged.
 *
 * `saved_term` fires for every taxonomy, including `nav_menu` — hence the
 * allowlist. It also fires on term creation, which is correct: a new scapegoat
 * appears in the leaderboard and in the submit form's allowlist.
 */
function revalidate_on_saved_term( int $term_id, int $tt_id, string $taxonomy ): void {
	if ( ! in_array( $taxonomy, REVALIDATE_TAXONOMIES, true ) ) {
		return;
	}

	revalidate_send_term( $term_id );
}

/**
 * An SCF field group was saved.
 *
 * This is the trigger that is easy to leave out and expensive to leave out. An
 * SCF-only edit to a PUBLISHED post changes no status, so the transition hook
 * above sees `publish -> publish` and this hook is what carries the detail
 * about which fields moved. After Lesson 18.1 made /hobt `revalidate: false`,
 * it is the only thing that keeps `seatsLeft` current.
 *
 * SCF's $post_id has three shapes and they are not documented next to each
 * other: an integer post ID, the string `options` for an options page, and
 * `term_<id>` for a term field group.
 *
 * @param int|string $post_id SCF's polymorphic identifier.
 */
function revalidate_on_acf_save( $post_id ): void {
	$id = (string) $post_id;

	// The SCF options page from appendix 03 §4.5 — site settings, one tag.
	if ( 'options' === $id || 'option' === $id ) {
		revalidate_send( array( 'type' => 'options', 'locale' => 'en' ) );
		return;
	}

	// A term field group. `Scapegoat Profile` (appendix 03 §4.2) arrives here,
	// which is how an editor filling in a tagline invalidates that term's page.
	if ( 1 === preg_match( '/^term_(\d+)$/', $id, $matches ) ) {
		revalidate_send_term( (int) $matches[1] );
		return;
	}

	$post = get_post( absint( $post_id ) );

	if ( ! $post instanceof \WP_Post || ! in_array( $post->post_type, REVALIDATE_POST_TYPES, true ) ) {
		return;
	}

	// A draft's fields changing has no public consequence. When it is published
	// the transition hook fires and picks up everything at once.
	if ( 'publish' !== $post->post_status ) {
		return;
	}

	revalidate_send(
		array(
			'type'     => 'post',
			'postType' => $post->post_type,
			'slug'     => $post->post_name,
			'locale'   => revalidate_locale_of_post( $post ),
		)
	);
}

/**
 * The term payload, including BOTH keys Next needs.
 *
 * `term_id` is here to discharge Lesson 14.4's debt: ScapegoatPicker tags its
 * fetch with termTag('scapegoat', String(termId)) because the block stores a
 * term ID and cannot know the slug before the response arrives. Next emits both
 * the slug-keyed and the ID-keyed tag. Lesson 18.3 §9.
 */
function revalidate_send_term( int $term_id ): void {
	$term = get_term( $term_id );

	if ( ! $term instanceof \WP_Term || ! in_array( $term->taxonomy, REVALIDATE_TAXONOMIES, true ) ) {
		return;
	}

	revalidate_send(
		array(
			'type'     => 'term',
			'taxonomy' => $term->taxonomy,
			'slug'     => $term->slug,
			'termId'   => $term_id,
			'locale'   => 'en',
		)
	);
}

/**
 * The post's locale.
 *
 * Hard-coded until Module 20 installs Polylang, and a function rather than a
 * literal so 20.4 changes one line. Next already parses this key and
 * deliberately puts nothing from it into a tag — Module 18 emits locale-free
 * tags and 20.4 is where the locale starts mattering.
 */
function revalidate_locale_of_post( \WP_Post $post ): string {
	if ( function_exists( 'pll_get_post_language' ) ) {
		$language = pll_get_post_language( $post->ID, 'slug' );

		if ( is_string( $language ) && '' !== $language ) {
			return $language;
		}
	}

	return 'en';
}

/**
 * Sign and fire. The ONLY place BTT_REVALIDATE_SECRET is read.
 *
 * @param array<string, mixed> $payload Identifiers, never tag strings.
 */
function revalidate_send( array $payload ): void {
	$base   = untrailingslashit( (string) getenv( 'BTT_FRONTEND_URL' ) );
	$secret = (string) getenv( 'BTT_REVALIDATE_SECRET' );

	// FAIL CLOSED AND QUIET. A missing secret must not fire an unsigned request
	// that Next answers with a 401 nobody is watching for.
	if ( '' === $base || '' === $secret || '__CHANGE_ME__' === $secret ) {
		return;
	}

	// Encode ONCE, into a variable. Sign THAT variable and send THAT variable.
	// Encoding twice — once to sign, once to send — is how PHP produces two
	// different byte strings from one array, and the signed bytes and the sent
	// bytes differing is its own vulnerability class. Lesson 18.3 §6.
	$body = wp_json_encode( $payload );

	if ( ! is_string( $body ) ) {
		return;
	}

	$timestamp = (string) time();
	$signature = hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );

	// The return value is DISCARDED deliberately. With blocking => false there
	// is no response and no WP_Error to inspect — is_wp_error() here would be a
	// check that cannot fail. Lesson 18.3 §4.
	wp_remote_post(
		$base . '/api/revalidate',
		array(
			'headers'  => array(
				'Content-Type'    => 'application/json',
				'X-BTT-Timestamp' => $timestamp,
				'X-BTT-Signature' => 'sha256=' . $signature,
			),
			'body'     => $body,
			// The editor's Publish must NEVER wait on a network call, and a
			// slow front end must never become an editorial outage.
			'blocking' => false,
			'timeout'  => 2,
		)
	);

	if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
		// The only trace on this side. It records the INTENT — never the
		// secret, never the signature — and it is what makes appendix 06 §4's
		// first diagnostic step possible at all.
		error_log( sprintf( '[btt] revalidate -> %s %s', $base . '/api/revalidate', $body ) );
	}
}
```

**Verify §2:**

- [ ] `docker compose logs --tail=40 wordpress` shows no fatal and no `Failed opening required`.
- [ ] `grep -c "'incident:" wp-content/plugins/blame-the-tech-core/includes/Revalidate.php` is `0`.
      This file builds no tags, on purpose.
- [ ] `grep -c 'blocking' wp-content/plugins/blame-the-tech-core/includes/Revalidate.php` is `1`
      and the value is `false`.
- [ ] `grep -c 'is_wp_error' wp-content/plugins/blame-the-tech-core/includes/Revalidate.php` is
      `0`. If you added one, delete it and reread Key Concept 4.

### Step 3: Load it

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		// …every entry Modules 03 to 17 added, unchanged…
		'includes/Revalidate.php',                          // Lesson 18.3
	);
```

**Verify §3:**

- [ ] `docker compose run --rm wpcli wp eval 'echo function_exists("Blame\\Core\\revalidate_send") ? "loaded" : "NOT LOADED", PHP_EOL;'`
      prints `loaded`.
- [ ] Publishing anything in wp-admin now writes one `[btt] revalidate ->` line to
      `wp-content/debug.log`. Nothing on the Next side answers it yet, and that is expected until
      Step 4.

### Step 4: Write the route handler, four checks in order

```ts
// next-app/src/app/api/revalidate/route.ts
// POST-only, cookieless, HMAC-signed. Four checks in a FIXED order, each with
// its own status code, and one of them deliberately says nothing.
//
// This route reads NO COOKIE. CSRF against it is not blocked — it is
// structurally impossible, because there is no ambient credential for a
// browser to borrow and a browser cannot compute the HMAC (Lesson 15.5 §8,
// layer three).
import { createHmac, timingSafeEqual } from 'node:crypto';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import type { ContentType, TaxonomyName } from '@/lib/graphql/tags';
import {
  incidentTag,
  listTag,
  pageTag,
  postTag,
  reviewTag,
  siteTag,
  taxonomyListTag,
  termTag,
} from '@/lib/graphql/tags';

export const dynamic = 'force-dynamic';

/**
 * ±300 seconds. Wide enough for real clock skew between a container and its
 * host; narrow enough that a captured request expires before it is useful.
 * The timestamp is INSIDE the signature, which is what makes it trustworthy.
 */
const WINDOW_SECONDS = 300;

/** WordPress `post_type` values this app renders. Also the version boundary — see below. */
const POST_TYPES = ['incident', 'post', 'tech_review', 'page'] as const;

/** WordPress taxonomy names this app renders. */
const TAXONOMIES = ['scapegoat', 'severity', 'tech_stack'] as const;

/**
 * `post_type` → the ContentType tags.ts understands. `tech_review` becomes
 * `review`: the GraphQL type name, the post_type string and the tag prefix are
 * three different words (appendix 03 §1), and this table is the only place that
 * fact is written down on the Next side.
 */
const CONTENT_OF: Record<(typeof POST_TYPES)[number], ContentType> = {
  incident: 'incident',
  post: 'post',
  tech_review: 'review',
  page: 'page',
};

/** taxonomy → TaxonomyName. `tech_stack` shortens to `stack`, same as tags.ts. */
const TAXONOMY_OF: Record<(typeof TAXONOMIES)[number], TaxonomyName> = {
  scapegoat: 'scapegoat',
  severity: 'severity',
  tech_stack: 'stack',
};

/** node-tag builder per ContentType, so the dispatch is exhaustive by type. */
const NODE_TAG: Record<ContentType, (slug: string) => string> = {
  incident: incidentTag,
  post: postTag,
  review: reviewTag,
  page: pageTag,
};

const PayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('post'),
    postType: z.enum(POST_TYPES),
    slug: z.string().min(1),
    locale: z.string().min(2).max(8).optional(),
  }),
  z.object({
    type: z.literal('term'),
    taxonomy: z.enum(TAXONOMIES),
    slug: z.string().min(1),
    termId: z.number().int().positive(),
    locale: z.string().min(2).max(8).optional(),
  }),
  z.object({
    type: z.literal('options'),
    locale: z.string().min(2).max(8).optional(),
  }),
]);

type Payload = z.infer<typeof PayloadSchema>;

/** The test-only body. One shape, one value, nothing to be clever with. */
const E2eSchema = z.object({ type: z.literal('all') });

/**
 * Constant-time string compare.
 *
 * timingSafeEqual THROWS on a length mismatch, so the length check is required
 * rather than an optimisation — and comparing lengths in the open costs
 * nothing, because the length of a hex digest is public information.
 */
function equals(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/**
 * Every tag this endpoint can emit, built by tags.ts. Nothing here
 * concatenates a string, and `payload.locale` is deliberately unused: Module 18
 * emits locale-free tags and Module 20.4 is where the locale enters them.
 */
function tagsFor(payload: Payload): readonly string[] {
  if (payload.type === 'options') {
    return [siteTag()];
  }

  if (payload.type === 'term') {
    const taxonomy = TAXONOMY_OF[payload.taxonomy];

    return [
      termTag(taxonomy, payload.slug),
      // BOTH FORMS. Lesson 14.4's ScapegoatPicker tags with the term ID
      // because the block stores an ID and cannot know the slug before the
      // response arrives. This line is that debt discharged (§9).
      termTag(taxonomy, String(payload.termId)),
      taxonomyListTag(taxonomy),
      // A term's name changed, so every card that prints it is stale. All
      // three of these taxonomies are attached to incidents.
      listTag('incident'),
    ];
  }

  const content = CONTENT_OF[payload.postType];

  return [NODE_TAG[content](payload.slug), listTag(content)];
}

/**
 * The test-only cache reset. Lesson 23.6's global-setup calls this after
 * restoring fixtures/seeded.sql, because Next has no idea the database was
 * replaced and keeps serving the pre-import ISR cache (appendix 06 §7).
 *
 * E2E_MODE and E2E_SECRET reach THIS code from next-app/.env.local, because
 * this code runs inside the Next runtime. The Playwright process reads them
 * only from the invoking shell. Lesson 12.4 §9 argues that split.
 */
function handleE2E(presented: string, raw: string): Response {
  // 404, not 401 and not 403: in production this branch DOES NOT EXIST and the
  // response says so. A 401 would confirm there is something here to
  // authenticate against, which turns "does this deployment have a test hook?"
  // into a question with an answer.
  if (process.env.E2E_MODE !== '1') {
    return new Response(null, { status: 404 });
  }

  const expected = process.env.E2E_SECRET ?? '';

  // Fail closed on an unset secret, and 404 rather than 401 — an unconfigured
  // hook is an absent hook.
  if (expected === '') {
    return new Response(null, { status: 404 });
  }

  if (!equals(presented, expected)) {
    return new Response(null, { status: 401 });
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'body is not JSON' }, { status: 400 });
  }

  if (!E2eSchema.safeParse(body).success) {
    return Response.json({ error: 'payload failed validation' }, { status: 400 });
  }

  // THE SLEDGEHAMMER, and the only place in this course where it is correct.
  // `wp db reset && wp db import` replaced the entire content universe; no set
  // of tags expresses that, so "everything" is an accurate description rather
  // than a shortcut. Lesson 18.2 Key Concept 10 is why it is wrong elsewhere.
  revalidatePath('/', 'layout');

  return Response.json({ revalidated: ['*'] });
}

export async function POST(request: Request): Promise<Response> {
  // Read the raw body ONCE. Everything below operates on THIS string: the
  // bytes that were signed and the bytes that are parsed must be the same
  // bytes (§6). A second request.text() on a consumed stream throws, which is
  // the runtime enforcing the rule for you.
  const raw = await request.text();

  // ── 0. The test-only branch, checked FIRST, absent by default ────────
  const e2eSecret = request.headers.get('X-BTT-E2E-Secret');

  if (e2eSecret !== null) {
    return handleE2E(e2eSecret, raw);
  }

  // ── 1. The replay window → 400 ───────────────────────────────────────
  const timestampHeader = request.headers.get('X-BTT-Timestamp');
  const timestamp = Number(timestampHeader);

  if (
    timestampHeader === null ||
    !Number.isInteger(timestamp) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WINDOW_SECONDS
  ) {
    // A distinguishable error is fine HERE: the timestamp is not a secret and
    // nobody can forge it into validity without the signature anyway.
    return Response.json({ error: 'timestamp outside the accepted window' }, { status: 400 });
  }

  // ── 2. The signature, over the RAW body → 401, silently ──────────────
  const secret = process.env.REVALIDATE_SECRET ?? '';

  if (secret === '') {
    // Fail closed. A server with no secret configured authenticates nobody.
    return new Response(null, { status: 401 });
  }

  // Sign over the HEADER'S EXACT BYTES, not over Number(...) re-stringified.
  const expected =
    'sha256=' +
    createHmac('sha256', secret).update(`${timestampHeader}.${raw}`, 'utf8').digest('hex');

  if (!equals(request.headers.get('X-BTT-Signature') ?? '', expected)) {
    // NO BODY AND NO REASON. A helpful error on a signature check is an
    // oracle: "bad length", "bad prefix" and "bad digest" are three separate
    // pieces of information an attacker would otherwise have to guess (§7).
    return new Response(null, { status: 401 });
  }

  // ── 3. Zod, AFTER the signature → 400 ────────────────────────────────
  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'body is not JSON' }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(body);

  if (!parsed.success) {
    // A valid signature proves the sender knows the secret. It does not prove
    // the payload is sane, and it does not prove the sender is the WordPress
    // VERSION you deployed — the two applications deploy independently. An
    // unrecognised postType is a loud 400 here rather than a tag nothing
    // carries and nobody notices (§8).
    return Response.json({ error: 'payload failed validation' }, { status: 400 });
  }

  // ── 4. Invalidate ────────────────────────────────────────────────────
  const tags = tagsFor(parsed.data);

  for (const tag of tags) {
    // The second argument is the cacheLife profile, required since Next 16.
    // 'max' = serve the stale entry while the fresh one is fetched, which is
    // what you want for public content behind a publish event.
    revalidateTag(tag, 'max');
  }

  // Echo what was invalidated. This body is the ONLY place either application
  // can see the tag strings that were actually used, and with
  // `blocking => false` WordPress will not read it — so it is for you, in a
  // terminal, with curl.
  return Response.json({ revalidated: tags });
}
```

**Verify §4:**

- [ ] `npm run type-check` is silent. If `NODE_TAG` complains, `ContentType` gained a member and
      the exhaustive `Record` is telling you about it — which is the point of writing it that way.
- [ ] `grep -c 'cookies()' 'src/app/api/revalidate/route.ts'` is `0`.
- [ ] `grep -c 'request.text()' 'src/app/api/revalidate/route.ts'` is `1`. **Exactly one.** Two
      reads is the bug Key Concept 6 is about, and the second one throws anyway.
- [ ] `grep -n 'export async function' 'src/app/api/revalidate/route.ts'` shows `POST` and nothing
      else. A `GET` on this route is a 405 from Next, for free.

### Step 5: Arm the test-only hook locally, and confirm it is absent by default

The branch is written; this step configures it and proves both polarities.

```bash
cd next-app

# The secret Lesson 12.4 told you to keep in the shell, now also needed by the
# Next RUNTIME — so this one value lives in two places for two readers.
export E2E_SECRET="$(openssl rand -base64 32 | tr -d '\n=+/')"
printf 'E2E_MODE=1\nE2E_SECRET=%s\n' "$E2E_SECRET" >> .env.local
grep -c 'E2E_' .env.local
```

**Verify §5:**

- [ ] `git check-ignore -v .env.local` names a rule. This file is never committed.
- [ ] `grep -c 'E2E_MODE' .env.example` is `1` — Module 12 already added it, so there is nothing
      to add here.
- [ ] With `E2E_MODE=1` removed from `.env.local` and the server restarted, the hook returns
      **404**. Verification checks 9 and 10 do both directions; do not take it on faith.

### Step 6: Write the webhook contract into `docs/api-contract.md`

```markdown
<!-- docs/api-contract.md — append -->
## POST /api/revalidate (Lesson 18.3)

Cookieless, HMAC-signed, POST-only. **CSRF against it is structurally impossible** rather than
blocked: there is no ambient credential to borrow and a browser cannot compute the HMAC.

**Headers**

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-BTT-Timestamp` | Unix seconds, as sent by `time()` in PHP |
| `X-BTT-Signature` | `sha256=` + `hash_hmac('sha256', "<timestamp>.<raw body>", BTT_REVALIDATE_SECRET)` |
| `X-BTT-E2E-Secret` | test-only alternative credential; see below |

**Body — a discriminated union on `type`.** WordPress sends **identifiers, never tag strings**;
Next builds every tag with `src/lib/graphql/tags.ts`, so there is one tag builder in the system.

| `type` | Fields | Tags Next emits |
|---|---|---|
| `post` | `postType` (`incident` \| `post` \| `tech_review` \| `page`), `slug`, `locale` | `<type>:<slug>`, the plural list tag |
| `term` | `taxonomy` (`scapegoat` \| `severity` \| `tech_stack`), `slug`, `termId`, `locale` | `<tax>:<slug>`, **`<tax>:<termId>`**, the taxonomy list tag, `incidents` |
| `options` | `locale` | `site-settings` |

`postType` is the WordPress `post_type` string and **not** the GraphQL type name or the tag
prefix: `tech_review` → `TechReview` → `review:`. The mapping lives in
`src/app/api/revalidate/route.ts` and nowhere else.

`termId` is present because Lesson 14.4's `ScapegoatPicker` tags with
`termTag('scapegoat', String(termId))` — the block stores a term ID and cannot know the slug before
its own response arrives. Both forms are emitted for every term event.

`locale` is parsed and **deliberately unused**. Module 18 emits locale-free tags; Module 20.4 is
where the locale enters them.

**Responses**

| Order | Check | Failure |
|---|---|---|
| 0 | `X-BTT-E2E-Secret` present → the test branch | `404` unless `E2E_MODE=1`; `401` on a wrong secret |
| 1 | `\|now − ts\| <= 300` | `400`, with a reason |
| 2 | `timingSafeEqual` over `ts + "." + raw body` | **`401`, with no reason echoed** |
| 3 | `Zod.parse` of that same raw string | `400`, with a reason |
| 4 | `revalidateTag` per tag | `200 {"revalidated":[…]}` |

**WordPress side.** `includes/Revalidate.php`, three hooks — `transition_post_status`,
`saved_term`, `acf/save_post` (priority 20) — with `wp_remote_post( …, blocking => false,
timeout => 2 )`. The editor's Publish never waits, **WordPress never sees the response**, and
`wp_remote_post()`'s `WP_Error` return is therefore unobservable. The only WordPress-side trace is
one `[btt] revalidate ->` line in `wp-content/debug.log` when `WP_DEBUG` is on.

**Known gap: `menu:primary` is not invalidated by this webhook.** A menu change arrives on
`saved_term` for the `nav_menu` taxonomy, but the tag is keyed on the theme *location* rather than
the menu's slug, which needs a reverse lookup through `get_nav_menu_locations()` and a fourth
`type` value. `menu:primary` remains covered only by the 3600-second window from Lesson 11.3.

**Test-only hook.** `X-BTT-E2E-Secret` compared with `timingSafeEqual` to `E2E_SECRET`, body
`{"type":"all"}`, effect `revalidatePath('/', 'layout')`. **404 unless `E2E_MODE === '1'`**, so the
branch does not exist in production. Called by `e2e/global-setup.ts` after a fixture restore,
because Next has no way to know the database was replaced. `E2E_MODE`/`E2E_SECRET` reach this code
from `next-app/.env.local`; the Playwright process reads them from the shell (Lesson 12.4 §9).
```

### Step 7: Fill in the entry-point matrix row

Lesson 15.5 Step 6 left `POST /api/revalidate` as a row of `STUB`s. Replace it.

```markdown
<!-- docs/quality-gates.md — replace the /api/revalidate row -->
| `POST /api/revalidate` (18.3) | HMAC-SHA256 over `ts + "." + rawBody`, `timingSafeEqual`, ±300 s window. Holding `BTT_REVALIDATE_SECRET` IS the identity | n/a: the only capability is "expire a cache tag", and the secret grants exactly that | `Zod.parse` of the raw body **after** the signature verifies — a valid signature proves the sender knows the secret, not that the payload is sane | **none, and it is defensible**: a valid signature is required per request, and the holder of the secret is our own WordPress. An attacker without it gets a 401 before any work happens | **structurally immune** — cookieless, so there is no ambient credential to ride, and a browser cannot compute the HMAC |
| `POST /api/revalidate` test branch (18.3) | `X-BTT-E2E-Secret` vs `E2E_SECRET`, `timingSafeEqual`, **404 unless `E2E_MODE=1`** | n/a: same capability | `Zod.parse` of `{"type":"all"}` | none — the branch does not exist in production | same: cookieless |
```

Add one line to that file's "Known gaps" list:

```markdown
7. **The revalidation endpoint has no rate limit.** An attacker who obtained
   `BTT_REVALIDATE_SECRET` could invalidate the cache in a loop and turn every request into a
   WordPress query — a load amplifier, not a disclosure. Mitigation today is that the secret is
   server-to-server only and rotatable; the runbook entry is in Lesson 18.4.
```

### Step 8: The end-to-end proof, then commit

No deploy. No timer. Change a title in wp-admin and reload.

```bash
cd next-app
npm run build && npm run start & SERVER_PID=$!
sleep 6
curl -s http://localhost:3000/en/incidents/incident-01 | grep -o '<h1[^>]*>[^<]*</h1>'
```

Now open `http://localhost:8080/wp-admin`, edit `incident-01`, change its title, click **Update**,
and reload the `curl` above. Then put the title back the same way.

**Verify §8:**

- [ ] The `curl` shows the new title within a second or two of clicking Update. If it shows the old
      one, work appendix 06 §4's five-step list in order — it starts with `BTT_FRONTEND_URL`
      because that is the most common cause.
- [ ] `docker compose exec wordpress tail -n 5 /var/www/html/wp-content/debug.log | grep revalidate`
      shows one `[btt] revalidate ->` line per Update, with the payload and **no secret in it**.
- [ ] The Next terminal shows no 401 and no 400. A 401 means the two secrets differ; a 400 means
      either a clock skew over five minutes or a payload the schema rejected.
- [ ] `/en/incidents` also shows the new title, because the payload's `listTag('incident')` expired
      the archive as well. **This is the assertion Lesson 16.4's `funnel.spec.ts` deliberately did
      not make** — it commented that the archive would stay stale until the revalidate window
      expired, "which is why this spec asserts the detail page and Lesson 18.3 fixes the rest".

```bash
kill "$SERVER_PID"
npm run type-check && npm run lint && npm run lint:tags && npm run test:run
git add -A
git commit -m "feat(cache): revalidate incident tags from a signed WordPress webhook"
```

---

## Verification

```bash
cd next-app

# 0. Build the signing helpers ONCE. Everything below reuses them, so there are
#    no <placeholders> to substitute by hand.
#
#    `awk '{print $NF}'` rather than `-r`: OpenSSL 3 prints
#    "HMAC-SHA256(stdin)= <hex>" and LibreSSL prints "(stdin)= <hex>", and the
#    last field is the digest in both. `shasum` has no portable -hmac.
SECRET="$(grep '^REVALIDATE_SECRET=' .env.local | cut -d= -f2-)"
test -n "$SECRET" && echo 'secret loaded'
# Expected: secret loaded

sign() {  # sign <timestamp> <body>  ->  sha256=<hex>
  printf '%s.%s' "$1" "$2" \
    | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}' | sed 's/^/sha256=/'
}
post() {  # post <timestamp> <signature> <body>  ->  "<status> <body>"
  curl -s -o /tmp/btt-rev-body -w '%{http_code}' -X POST \
    http://localhost:3000/api/revalidate \
    -H 'Content-Type: application/json' \
    -H "X-BTT-Timestamp: $1" -H "X-BTT-Signature: $2" \
    --data "$3"
  printf ' '; cat /tmp/btt-rev-body; echo
}

BODY='{"type":"post","postType":"incident","slug":"incident-01","locale":"en"}'

npm run build && npm run start & SERVER_PID=$!
sleep 6

# 1. The happy path: a correctly signed post event
TS="$(date +%s)"
post "$TS" "$(sign "$TS" "$BODY")" "$BODY"
# Expected: 200 {"revalidated":["incident:incident-01","incidents"]}
#           Both tags, built by tags.ts. This EXACT string is the contract.

# 2. A term event emits FOUR tags, including the ID-keyed form (Key Concept 9)
TS="$(date +%s)"
TERM='{"type":"term","taxonomy":"scapegoat","slug":"the-intern","termId":4,"locale":"en"}'
post "$TS" "$(sign "$TS" "$TERM")" "$TERM"
# Expected: 200 and a revalidated array containing
#           scapegoat:the-intern, scapegoat:4, scapegoats, incidents
#           (termId 4 is illustrative — any positive integer signs the same.)

# 3. An options event
TS="$(date +%s)"
OPTS='{"type":"options","locale":"en"}'
post "$TS" "$(sign "$TS" "$OPTS")" "$OPTS"
# Expected: 200 {"revalidated":["site-settings"]}

# 4. NEGATIVE — unsigned, in both of its shapes. The ORDER of the checks is
#    what decides which code you get, and it is worth seeing both.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/revalidate \
  -H 'Content-Type: application/json' --data "$BODY"
# Expected: 400 — no headers at all, so the WINDOW check fails first. The
#           frozen order is window, then signature, then schema.
TS="$(date +%s)"
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-Timestamp: $TS" --data "$BODY"
# Expected: 401 — a fresh timestamp and NO signature header. This is the
#           "unsigned request" case that matters: it got past the cheap check
#           and was refused by the one that counts.

# 5. NEGATIVE — a fresh timestamp and a wrong signature
TS="$(date +%s)"
post "$TS" 'sha256=0000000000000000000000000000000000000000000000000000000000000000' "$BODY"
# Expected: 401 followed by NOTHING. An empty body is the assertion: no "bad
#           signature", no "expected length", no reason of any kind (§7).

# 6. NEGATIVE — a valid signature over a ten-minute-old timestamp
TS="$(( $(date +%s) - 600 ))"
post "$TS" "$(sign "$TS" "$BODY")" "$BODY"
# Expected: 400 {"error":"timestamp outside the accepted window"}
#           The signature is perfect. The replay guard does not care.

# 7. NEGATIVE — a valid signature over a MALFORMED body
TS="$(date +%s)"
JUNK='{"type":"post","postType":"sprocket","slug":""}'
post "$TS" "$(sign "$TS" "$JUNK")" "$JUNK"
# Expected: 400 {"error":"payload failed validation"}
#           Knowing the secret is not the same as sending a sane payload. An
#           unrecognised postType is a LOUD 400 rather than a tag nothing
#           carries — which is the whole argument in §8.

# 8. NEGATIVE — THE RAW-BODY TRAP, as a test. Sign one body, send another.
TS="$(date +%s)"
SIG_FOR_A="$(sign "$TS" "$BODY")"
OTHER='{"type":"post","postType":"page","slug":"hobt","locale":"en"}'
post "$TS" "$SIG_FOR_A" "$OTHER"
# Expected: 401, empty body. The signature is valid FOR A DIFFERENT BODY, and
#           because the route verifies the exact bytes it later parses, there is
#           no gap for the two to differ in. A handler that re-stringified a
#           parsed object would have a real chance of accepting this.

# 9. NEGATIVE — the test-only hook, armed, with the WRONG secret
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/revalidate \
  -H 'Content-Type: application/json' -H 'X-BTT-E2E-Secret: not-the-secret' \
  --data '{"type":"all"}'
# Expected: 401 — the hook exists (E2E_MODE=1 in .env.local) and you are not it

# 10. The test-only hook with the RIGHT secret. $E2E_SECRET is in your shell
#     from Task Step 5; the Next runtime reads the same value from .env.local.
curl -s -X POST http://localhost:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-E2E-Secret: $E2E_SECRET" \
  --data '{"type":"all"}'
# Expected: {"revalidated":["*"]}
#           revalidatePath('/', 'layout'). The only correct use of the
#           sledgehammer in this course.

# 11. NEGATIVE — the same call with a body the schema rejects
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-E2E-Secret: $E2E_SECRET" \
  --data '{"type":"everything"}'
# Expected: 400 — a credential is not a schema, on both branches

# 12. NEGATIVE — the hook DOES NOT EXIST when E2E_MODE is not exactly '1'.
#     A shell variable wins: Next never overwrites an env var that is already
#     set in the process it was started from.
kill "$SERVER_PID"
E2E_MODE=0 npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-E2E-Secret: $E2E_SECRET" \
  --data '{"type":"all"}'
# Expected: 404 — not 401, not 403. In production this branch is indistinguishable
#           from an endpoint that was never written.
#
#     …and the SIGNED path still works on the same server, which proves the two
#     branches are independent rather than one gating the other.
TS="$(date +%s)"
post "$TS" "$(sign "$TS" "$BODY")" "$BODY"
# Expected: 200 {"revalidated":["incident:incident-01","incidents"]}
kill "$SERVER_PID"

# 13. NEGATIVE — the route reads no cookie and reads the body exactly once
grep -c 'cookies()' 'src/app/api/revalidate/route.ts'
# Expected: 0 — cookieless, so CSRF is structurally impossible (§8)
grep -c 'request.text()' 'src/app/api/revalidate/route.ts'
# Expected: 1 — exactly one read. Two is the signature-confusion bug in §6.
grep -c 'request.json()' 'src/app/api/revalidate/route.ts'
# Expected: 0

# 14. NEGATIVE — no secret reached the client bundle
npm run build >/dev/null
grep -rl "$SECRET" .next/static/ 2>/dev/null; echo "exit=$?"
# Expected: no output, exit=1. A hit means the variable got a NEXT_PUBLIC_
#           prefix or a server-only module was imported into a client component.

# 15. The WordPress side fires, and logs its intent without logging the secret
cd ../wordpress-headless
docker compose run --rm wpcli wp eval 'echo function_exists("Blame\\Core\\revalidate_send") ? "loaded" : "NOT LOADED", PHP_EOL;'
# Expected: loaded
ID1=$(docker compose run --rm -T wpcli wp post list --post_type=incident --name=incident-01 --field=ID)
OLD=$(docker compose run --rm -T wpcli wp post get "$ID1" --field=post_title)
cd ../next-app
npm run start & SERVER_PID=$!
sleep 6
cd ../wordpress-headless
docker compose run --rm -T wpcli wp post update "$ID1" --post_title="Webhook proof"
sleep 2
docker compose exec wordpress tail -n 5 /var/www/html/wp-content/debug.log | grep revalidate
# Expected: one line like
#   [btt] revalidate -> http://host.docker.internal:3000/api/revalidate {"type":"post",...}
docker compose exec wordpress tail -n 5 /var/www/html/wp-content/debug.log | grep -c 'X-BTT-Signature\|sha256='
# Expected: 0 — the log records the intent, never the signature and never the secret

# 16. THE PAYOFF: no deploy, no timer, and the public page has changed
cd ../next-app
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'Webhook proof'
# Expected: 1
curl -s http://localhost:3000/en/incidents | grep -c 'Webhook proof'
# Expected: 1 — the ARCHIVE too, because the payload's list tag expired it.
#           Lesson 16.4's funnel.spec.ts explicitly did not assert this and
#           said "Lesson 18.3 fixes the rest". It does.

# 17. Put it back, and confirm the smoke suite agrees
kill "$SERVER_PID"
cd ../wordpress-headless
docker compose run --rm -T wpcli wp post update "$ID1" --post_title="$OLD"
cd ../next-app
npm run type-check && npm run lint && npm run lint:tags && npm run test:run
# Expected: no output from the first three, 0 failures from the fourth
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" npx playwright test --project=smoke
# Expected: 9 passed — which also proves the title restore landed

# 18. The contract and the matrix row are written down
grep -c 'POST /api/revalidate (Lesson 18.3)' ../docs/api-contract.md
# Expected: 1
grep -c 'X-BTT-E2E-Secret' ../docs/quality-gates.md
# Expected: 1
grep -c 'STUB' ../docs/quality-gates.md
# Expected: fewer than before — the /api/revalidate row is filled in
```

If check 5 or check 8 returns anything other than a bare `401`, read the response body: whatever it
says is the oracle you just built. Delete the message and reread Key Concept 7 before continuing.

## Control Questions

1. `save_post` and `transition_post_status` both fire when an editor changes a published post's
   title. Say what each one can and cannot tell you about that change, then explain why a handler
   guarded only on `$new_status !== $old_status` stops revalidating title edits.
2. `wp_remote_post()` is called with `blocking => false`, so WordPress discards the response and
   never sees a `WP_Error`. Name what you give up, name what you gain, and describe where you would
   look first when an editor says "I published and nothing changed".
3. The route reads `await request.text()` once and parses that same string. Describe the bug that
   appears if you instead `await request.json()` and sign `JSON.stringify(payload)`, and say why the
   bug can present as "it never verifies" *and* as "it verified the wrong thing".
4. The 400 for a stale timestamp carries a reason and the 401 for a bad signature does not.
   Justify the asymmetry, then say what an attacker would learn from a 401 body reading
   `"expected sha256=<64 hex chars>"`.
5. The test-only branch returns 404 when `E2E_MODE` is unset and 401 when the secret is wrong.
   Explain what a 401-in-both-cases design would tell somebody probing your production deployment,
   and name the other endpoint in this application whose failure mode follows the same principle.

## Learn More

- [WordPress — `transition_post_status`](https://developer.wordpress.org/reference/hooks/transition_post_status/)
  — the argument order that trips everyone, and the list of statuses a post can be in
- [WordPress — `wp_remote_post()`](https://developer.wordpress.org/reference/functions/wp_remote_post/)
  — read the `blocking` and `timeout` arguments in the HTTP API docs beside it; the `WP_Error`
  return is the part Key Concept 4 is about
- [WordPress — `saved_term`](https://developer.wordpress.org/reference/hooks/saved_term/) — fires
  for every taxonomy including `nav_menu`, which is why the allowlist exists
- [SCF — `acf/save_post`](https://www.advancedcustomfields.com/resources/acf-save_post/) — the
  priority argument and the three shapes of `$post_id`, including `options` and `term_<id>`
- [PHP — `hash_hmac()`](https://www.php.net/manual/en/function.hash-hmac.php) and
  [`hash_equals()`](https://www.php.net/manual/en/function.hash-equals.php) — the pair you already
  use for payment callbacks, in the sending direction this time
- [Node — `crypto.timingSafeEqual()`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
  — note that it **throws** on a length mismatch, which is why Key Concept 7's length check is
  required rather than an optimisation
- [Stripe — webhook signature verification](https://docs.stripe.com/webhooks/signature) — the
  industry reference implementation of exactly this pattern, including the timestamp-in-the-signature
  detail and the replay-window rationale
- [OWASP — Server-Side Request Forgery prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
  — why `BTT_FRONTEND_URL` is a fixed configured value and never taken from a request
- [Zod — `discriminatedUnion`](https://zod.dev/api?id=discriminated-unions) — the schema shape this
  payload uses, and why it produces a better error than a plain union
- [Next.js — Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) —
  the `Request`/`Response` contract, and the fact that an unexported method is a 405 for free
