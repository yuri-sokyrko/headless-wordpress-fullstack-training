---
title: 'Auth Concepts for WordPress Developers'
module: 15
lesson: 1
teaches: [jwt-anatomy, session-vs-token, threat-modelling, credential-inventory, trust-boundaries]
produces: []
requires: [10.1]
---

# Lesson 15.1 — Auth Concepts for WordPress Developers

## Quick Overview

Blame The Tech has two audiences that both need to be authenticated, and they have almost
nothing in common. The first is **editors**, who log into wp-admin with a username and a
password, get a WordPress session cookie, compose blocks, and — from Module 17 — hit Preview
and expect Next.js to render their draft. The second is **public developers**, who register on
the Next.js app, never see wp-admin at all, and exist only so they can file an incident that an
editor will later moderate. One audience authenticates *to WordPress*; the other authenticates
*to Next.js, which then acts on their behalf against WordPress*. Every design decision in this
module follows from keeping those two paths separate.

This lesson writes no code. It builds the vocabulary and the threat model you need before you
touch a cookie attribute, because auth is the one area of the stack where a plausible-looking
implementation and a correct one are indistinguishable until someone attacks it. You will take
apart a JWT by hand, name what is and is not protected by a signature, and produce a written
inventory of every credential in the system — which of them represents a human, which
represents the application, where each one is allowed to be stored, and what an attacker gets
if they steal it. The two credentials in [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials)
are the ones you must never confuse; confusing them is the most consequential mistake this
architecture permits.

By the end of this lesson you will have:

- A decoded JWT, split into header / payload / signature, with the payload read as plain
  base64url — proving that a JWT is **signed, not encrypted**
- A written credential inventory: user JWT, refresh token, application token, revalidation
  HMAC secret, preview token — each with its lifetime, transport, storage location and blast radius
- A two-column threat model for the editor path and the public-developer path, with the
  attacker capability each control actually removes
- A one-paragraph note in your own words on why the browser never talks to `/graphql`, and why
  that removes CORS, introspection and rate-limiting problems rather than hiding them
- A list of the four storage locations this course forbids for any session credential, and the
  documented exceptions

## Classic WP Analogy

You already know WordPress's authentication stack better than you think. `wp_signon()` checks a
password against the `wp_users.user_pass` hash, `wp_set_auth_cookie()` writes
`wordpress_logged_in_<hash>` — an httpOnly cookie signed with `AUTH_KEY` and `AUTH_SALT` —
`wp_validate_auth_cookie()` re-checks it on every request, and `current_user_can()` answers the
authorization question separately from the authentication one. `wp_create_nonce()` handles CSRF
for form posts and admin-ajax calls.

The headless equivalents line up almost suspiciously well:

| Classic WordPress | This stack |
|---|---|
| `wp_signon( $creds )` | the WPGraphQL `login` mutation (Lesson 15.2) |
| `wp_set_auth_cookie()` | `cookies().set('btt_at', …)` in a Server Action (Lesson 15.4) |
| `wordpress_logged_in_*` cookie | the `btt_at` httpOnly cookie — **also** unreadable by JavaScript |
| `wp_validate_auth_cookie()` | WordPress re-verifying the `Authorization: Bearer` JWT on every call |
| `current_user_can( 'publish_posts' )` | `current_user_can( 'publish_incidents' )` — unchanged, still in PHP |
| `wp_create_nonce()` / `check_admin_referer()` | Next's Origin/Host check on Server Action POSTs plus `SameSite` (Lesson 15.5) |
| `is_user_logged_in()` in a template | `getSession()` reading `cookies()` in a Server Component |

**Where the analogy breaks down, and it breaks in the direction that matters:** a WordPress auth
cookie is *stateful by convention* — it is validated against a user row and a session token
stored in `wp_usermeta`, so `wp_destroy_current_session()` genuinely revokes it. A JWT is
**stateless**: it is a signed claim with an expiry, and nothing you do in Next.js can un-issue
one. That single property drives three decisions you will otherwise find arbitrary. It is why
`btt_at` lives for 300 seconds instead of a fortnight — the expiry *is* the revocation
mechanism. It is why logout deletes cookies and is honest with you that a stolen token stays
valid until it expires. And it is why the eight WordPress salts are the real emergency brake:
rotating them logs everyone out at once, which is an incident-response procedure rather than a
bug.

The second break is subtler. In Classic WordPress, one credential does everything — the same
cookie proves who you are for reading, writing and administering. Here, "who the user is" and
"which application is calling" are two separate credentials with different transports, different
lifetimes and different storage rules, and code that reaches for the wrong one usually still
works. That is exactly what makes it dangerous.

---

## Key Concepts

### 1. A JWT is three base64url strings, and the middle one is not a secret

A JSON Web Token is not a format you have to take on trust. It is three chunks of base64url,
joined with dots, and you can read two of the three with nothing but a shell.

```
eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9 . eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODAiLCJl… . x9Kf3n…
└──────────── HEADER ────────────────┘  └──────────── PAYLOAD ──────────────────────┘  └ SIGNATURE ┘
        {"typ":"JWT","alg":"HS256"}          {"iss":…,"iat":…,"exp":…,"data":{…}}       32 raw bytes,
        which algorithm signed this          the CLAIMS — who, when, until when         base64url'd
```

| Segment | Encoding | Readable without a key? | What it is for |
|---|---|---|---|
| Header | base64url JSON | **yes** | names the signing algorithm, so the verifier knows what to check |
| Payload | base64url JSON | **yes** | the claims: `iss`, `iat`, `nbf`, `exp` and, for WPGraphQL JWT, `data.user.id` |
| Signature | base64url of raw HMAC bytes | it is bytes, not text | proves the first two segments have not been altered by anyone without the key |

**base64url is not base64, and the difference bites you exactly once.** Standard base64 uses
`+`, `/` and `=`. base64url replaces `+` with `-`, replaces `/` with `_`, and drops the `=`
padding entirely, because all three of those characters need escaping in a URL. Every decoder
you reach for expects standard base64, so a hand decode needs two `tr` calls and the padding put
back. Step 1 of the Task writes that as a shell function, once, and the rest of the module uses
it.

> **Encoding is not encryption, and this is the sentence that matters most in this lesson.**
> `base64 -d` needs no key, no password and no permission. Anything you put in a JWT payload is
> readable by anyone who holds the token, including the browser it passes through, the proxy that
> logs it, and the error tracker that captures a request header. A JWT keeps data **honest**, not
> **private**.

### 2. Signed is not encrypted — what a token holder can and cannot do

Because the payload is public and the signature is not forgeable, the security properties of a
JWT are unusually easy to state precisely. Here is the whole list, for an attacker who has
somehow obtained a valid `btt_at`:

| The attacker wants to… | Can they? | Why |
|---|---|---|
| Read the user's WordPress ID out of the token | ✅ yes | `base64 -d` on segment two. No key involved. |
| See the expiry and issuing time | ✅ yes | Same. `exp` and `iat` are plain claims. |
| Act as that user until `exp` | ✅ **yes** | The token *is* the credential. This is the whole risk, and it is why `exp` is 300 seconds away. |
| Change `data.user.id` to `1` and become the administrator | ❌ no | Re-encoding the payload invalidates the signature, and forging a new one needs `GRAPHQL_JWT_AUTH_SECRET_KEY`. |
| Extend `exp` to next year | ❌ no | Same reason. `exp` is inside the signed region. |
| Recover the user's password | ❌ no | The password hash never leaves `wp_users`. It is not in the token, in any form. |
| Keep using the token after you rotate the salts | ❌ no | Rotation changes the signing key, so every previously issued token fails verification. |

Two rows deserve to be read twice. The third row is the reason short lifetimes matter more here
than anywhere else in WordPress: **a stolen JWT is not something you can revoke**. And the last
row is the emergency brake, which is why it appears in the runbook rather than in a lesson about
convenience.

> **`alg: none` and the algorithm-confusion family.** The header names the algorithm, and a naive
> verifier that trusts that field can be told "this token is unsigned, please accept it". Real
> libraries pin the expected algorithm and ignore the header's claim. You are not writing a
> verifier in this course, so you will not make this mistake — but it is the reason "just decode
> and trust the payload" is a vulnerability rather than a shortcut, and Lesson 15.4's
> `decodeExpiry()` is written so that it cannot become one.

### 3. Session versus token: revocation is the whole difference

You already know one of these two models intimately. Putting them side by side is the fastest way
to see what this module is actually trading away.

| | WordPress session cookie | WPGraphQL JWT |
|---|---|---|
| Where the truth lives | `wp_usermeta.session_tokens` **plus** the cookie | **the token alone** |
| Validated by | `wp_validate_auth_cookie()`, against the user row | signature check against `GRAPHQL_JWT_AUTH_SECRET_KEY` |
| Server-side state | yes, one row per active session | **none** |
| Revoke one session | `wp_destroy_current_session()` | **impossible** |
| Revoke all sessions | `wp_destroy_all_sessions()` | rotate the signing key |
| Cost of a check | a database read | a HMAC, no I/O |
| Scales across hosts | needs shared state | free |

The absent row is the interesting one. There is no `wp_destroy_current_session()` for a JWT,
because there is nothing to destroy: the token is a **signed statement**, and once signed it is
true until it expires. Three decisions in this module follow directly from that single property,
and they will all look arbitrary until you connect them to it:

```
  A JWT CANNOT BE REVOKED
            │
            ├──▶  btt_at lives 300 seconds       the expiry IS the revocation window.
            │                                    Two weeks would mean a stolen token is
            │                                    valid for two weeks.
            │
            ├──▶  logout is HONEST               it clears cookies, which ends the session
            │                                    for that browser. A copy already taken
            │                                    keeps working. Lesson 15.4 says so in a
            │                                    comment, out loud.
            │
            └──▶  salt rotation is the brake     rotating the eight salts plus the JWT key
                                                 invalidates every token at once. That is
                                                 an incident-response procedure, and it
                                                 lands in docs/runbook.md in Lesson 15.2.
```

The honest summary: **you are trading revocability for statelessness.** That is usually the right
trade for an API, and it is only right if you shorten the lifetime to compensate. A five-minute
access token with a thirty-day refresh token is not two arbitrary numbers; it is the shape the
trade forces on you.

### 4. The credential inventory

Five credentials exist in the finished application, and the mistake that matters is not losing
one — it is using one where another belongs. This inventory is the lesson's main artifact, and
you write it into `docs/architecture.md` in the Task. The exact cookie attributes are the
contract in [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials); read them
there rather than copying the table around.

| Credential | Represents | Lifetime | Transport | Lives in | Held by | Blast radius if stolen |
|---|---|---|---|---|---|---|
| **User JWT** (`btt_at`) | one human | 300 s | `Authorization: Bearer` | httpOnly cookie | the browser, opaquely | act as that user for ≤ 300 s. No password, no other user, no admin. |
| **Refresh token** (`btt_rt`) | one human's right to a new JWT | 30 d | mutation variable | httpOnly cookie, `Path=/api/auth` | the browser, opaquely | mint access tokens for that user for up to 30 days. Worse than the JWT, which is why its path is narrow. |
| **App token** (`BTT_APP_TOKEN` / `WP_APP_TOKEN`) | **the Next.js application** | until rotated | `X-BTT-App-Token` | Fly secret + Vercel env | the servers only, never a browser | register users and submit leads at will, forever, as nobody. Rotation is the only fix. |
| **Revalidation HMAC key** (`BTT_REVALIDATE_SECRET`) | WordPress's right to invalidate cache | until rotated | HMAC over the body | both `.env` files | the servers only | force cache purges. Denial of service by cache stampede, not data disclosure. Module 18. |
| **Preview token** | one editor, one post, one click | **120 s, single use** | **a URL query parameter** | nowhere; it is consumed | the editor's browser, then destroyed | read one unpublished post once. The narrowest credential in the app, deliberately. Module 17. |

Read the last column top to bottom. It is not a ranking of how secret each value is — it is a
ranking of how much damage each one does, and those two orders are different. The app token has
the largest radius and the fewest moving parts, which is exactly the combination that gets it
pasted into a client component "just to test something".

> **The credential that is not on this list is the one you have been using all along.** Your own
> `wordpress_logged_in_*` cookie, from `btt_admin` in wp-admin, is a sixth credential with a
> larger blast radius than any of these. It is absent from the table because no part of the
> Next.js application ever holds it, sees it, or forwards it. That absence is a design property
> worth naming, because a great many headless setups proxy the admin cookie to the front end and
> then wonder why the front end is in scope for their next audit.

### 5. Two audiences, two paths, one user table

Blame The Tech authenticates two populations that have almost nothing in common except a shared
`wp_users` table. Drawing them is more useful than describing them, because the drawing shows
where they touch and where they do not.

```
 EDITORS — authenticate TO WordPress            PUBLIC DEVELOPERS — authenticate TO Next
 ───────────────────────────────────            ────────────────────────────────────────
  browser                                        browser
    │ POST /wp-login.php                           │ POST /en/login   (Server Action)
    │ username + password                          │ email + password
    ▼                                              ▼
  WordPress :8080                                Next.js :3000
    wp_signon()                                    │ mutation login  ─────────┐
    wp_set_auth_cookie()                           │                          ▼
    │                                              │                   WordPress :8080
    ◀── Set-Cookie: wordpress_logged_in_…          │◀── authToken, refreshToken ┘
    │   Path=/  httpOnly  signed with AUTH_KEY     │
    │                                              ├─ Set-Cookie: btt_at  (300 s)
    ▼                                              ├─ Set-Cookie: btt_rt  (Path=/api/auth)
  wp-admin, block editor, moderation queue         ▼
    │                                            /en/account, /en/incidents/submit
    │                                              │
    └────────────────┐              ┌──────────────┘
                     ▼              ▼
              ┌──────────────────────────┐
              │  wp_users  ·  wp_usermeta│   ← the ONLY shared component
              │  roles · capabilities    │
              └──────────────────────────┘
```

| | Editor path | Public-developer path |
|---|---|---|
| Credential | `wordpress_logged_in_*` cookie | `btt_at` JWT, wrapped in a cookie Next owns |
| Signed with | `AUTH_KEY` + `AUTH_SALT` | `GRAPHQL_JWT_AUTH_SECRET_KEY` |
| Who validates it | WordPress | WordPress. Next cannot, and must not be able to. |
| Revocable | yes, per session | no, only by expiry or key rotation |
| Reaches wp-admin | yes, that is the point | **never** — `admin_init` bounces the role (Lesson 03.5) |
| Reaches `/graphql` directly | yes, from the browser, with a nonce | **never** — only the Next server runtime does |
| Who is the confused deputy | nobody; the user talks to the authority | **Next.js**, which acts on the user's behalf. Key Concept 8. |

The load-bearing observation: **these two paths share a user table and nothing else.** Not a
credential, not a signing key, not a cookie name, not a session store. If the JWT signing key
leaks, editors are unaffected. If an editor's laptop is compromised, no public developer's
session is at risk. That separation is not free — it is why there are nine independent secrets in
`wordpress-headless/.env` instead of one — and it is the single highest-value thing this module
buys you.

### 6. The four forbidden storage locations, and the one documented exception

Every headless WordPress tutorial you will find online stores the JWT somewhere JavaScript can
read. This course forbids all four of the usual places, and the reason differs per place, which
is why a blanket rule is less useful than a table.

| Forbidden location | The specific attack it enables |
|---|---|
| `localStorage` | Any injected script reads it synchronously and exfiltrates it. WordPress sites run a dozen plugins, each of which can enqueue script into a page; one XSS anywhere on the origin is total session compromise, and the token survives a tab close. |
| `sessionStorage` | Identical read primitive, marginally shorter window. "Per tab" is not a security boundary — the attacker's script runs *in* the tab. |
| A URL, query string or hash | Leaks through `Referer` headers to third parties, browser history, server access logs, CDN logs, analytics beacons and every chat client that unfurls links. You cannot recall any of those. |
| A `NEXT_PUBLIC_` variable | Next **inlines the literal value into JavaScript that ships to every visitor** ([appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules), rule 4). This is not a leak to one attacker; it is publication. |

**Two** credentials in this course travel in a URL, and both are documented exceptions rather
than inconsistencies. It is worth understanding why each is allowed:

| Property | Preview token (17.2) | Email confirmation code (15.3) | A session credential |
|---|---|---|---|
| Lifetime | 120 seconds | 24 hours | 300 seconds to 30 days |
| Uses | **exactly one**, then destroyed server-side | **exactly one**, then deleted from user meta | unlimited until expiry |
| Grants | read one unpublished post | confirm one email and set one password | act as a user, repeatedly |
| At rest | not stored | a **sha256 hash**, so a database read yields nothing usable | — |
| Why a URL at all | wp-admin's Preview button is a link | proving inbox possession *is* the point of an emailed link | no reason whatsoever |

So the rule is not "never a token in a URL". The rule is precisely: **no *session* credential in
a URL, ever.** Say it that way, because the imprecise version is the one people abandon the first
time a genuine exception appears — and then keep abandoning.

The property that carries both exceptions is **single use**: the moment the credential is
consumed, the copy sitting in browser history, in a proxy log or in a forwarded email is
worthless. A session credential has no equivalent property, which is exactly why it may not go
in a URL.

> **Where this breaks in practice, and it is not an attacker.** The most common way a token
> reaches a log is an error tracker. Sentry, LogRocket and friends capture request headers,
> URLs and sometimes whole request bodies by default. A token in a URL is therefore in your
> error tracker, held by a third party, on a retention schedule you did not choose. Module 24
> configures the scrubbing; this lesson is where you decide there is nothing to scrub.

### 7. Why the browser never talks to `/graphql` — and the honest version of that claim

`WP_GRAPHQL_ENDPOINT` is a server-only variable. The browser never issues a GraphQL request, in
any lesson, in any module. Three consequences follow, and they are real:

| Removed from the app's own traffic | Because |
|---|---|
| **CORS policy** | No cross-origin request is ever made, so there is no `Access-Control-Allow-Origin` to configure, get wrong, or widen under deadline pressure. Appendix 03 §8 records that WPGraphQL CORS is deliberately not installed. |
| **Public introspection surface** | Nothing in the client bundle names the endpoint, so the schema is not one `curl` away from every visitor. |
| **An unmetered query surface** | An attacker who wants to run a deeply nested query has to find the endpoint first, and cannot borrow your app's credentials to do it. |

And now the honest part, because overstating this would be worse than not claiming it. From
[appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin):
**media `sourceUrl` values are public**, so `http://localhost:8080` appears in the HTML of any
page with a featured image. The WordPress host is discoverable regardless. Keeping the endpoint
server-side is therefore **not** obscurity-as-security, and the course does not pretend it is.

| What server-only endpoints actually buy | What they do not buy |
|---|---|
| No CORS policy to maintain | Hiding the WordPress host |
| No endpoint in the client bundle | Protection against a determined attacker |
| No browser-issued query your credentials could be borrowed for | Anything at all in production, on its own |

The controls that genuinely protect `/graphql` in production are query depth and complexity
limits, introspection off, persisted queries as an allowlist, and edge rate limiting — all of
them Module 24. Server-only fetching removes an entire *category* of mistake from your own
codebase. It is not a firewall.

### 8. The confused deputy: a server acting on a user's behalf

The editor path has one party with authority and one party asking. The public-developer path has
three: the user, Next.js, and WordPress. Next holds a credential that is not its own and uses it
to make requests it did not originate. That shape has a name and a failure mode.

```
     CONFUSED DEPUTY — the general shape
     ───────────────────────────────────────────────────────────────
     attacker ──── asks ────▶ deputy ──── acts with ────▶ authority
                             (holds a credential
                              it did not earn)

     Concretely, the version that goes wrong:
     attacker ─▶ Next Server Action ─▶ WordPress, using the APP TOKEN
                 "register this user"    the app token authorises anything
                                         registerDeveloper can do — for anyone
```

Two properties keep the design safe, and both are checkable rather than aspirational:

| Property | How it is enforced here |
|---|---|
| **The credential is scoped to the user it acts for** | `createIncident` is called with the caller's own `btt_at`, read from *their* cookie. WordPress resolves `get_current_user_id()` from that token. Next cannot substitute another user, because it holds no credential for another user. |
| **The request is not attacker-chosen** | The Server Action decides the operation and the shape of the variables. There is no pass-through GraphQL proxy, no client-supplied query string, and no endpoint that forwards an arbitrary document. Appendix 03 §8's rejection of a browser-side endpoint is what makes this true. |

The app token is where the shape genuinely applies, and Lesson 15.2 makes the argument concrete:
it authorises `registerDeveloper` and `submitHobtLead` for *anybody*, because there is no user
to scope it to. That is why both mutations are written to be safe when called by a stranger —
generic payloads, no user node returned, duplicates treated as success — and why the app token is
the credential the whole course is most paranoid about.

### 9. Authenticated, authorised, verified — three axes, three different failures

"Logged in" is one bit, and this application needs three. Confusing them produces three
distinguishable bugs, so it is worth naming all three before you write a single guard.

| Axis | Question | Answered by | Where it is decided | The bug when you skip it |
|---|---|---|---|---|
| **Authentication** | Who is this? | a valid, unexpired signature over `data.user.id` | WordPress, on every call | anonymous callers act as somebody |
| **Authorisation** | May they do this? | `current_user_can( 'create_incidents' )` | WordPress, in PHP (Lesson 03.5, Module 06) | a logged-in stranger publishes content |
| **Verification** | Have they proved the email is theirs? | `btt_verified` user meta | WordPress, via a `map_meta_cap` filter (Lesson 15.3) | a throwaway address floods the moderation queue |

The third axis is the one that has no equivalent in your Classic WordPress instincts, because
`users_can_register` sites normally either trust the email or send a password-reset link and
consider that proof. Here it is a separate, queryable fact:

```
   register  ──▶  btt_verified = 0   ──▶  authenticated ✅
                                          authorised    ❌  map_meta_cap returns do_not_allow
                                          verified      ❌
        │
        │ click the mailed, hashed, single-use, expiring code
        ▼
   verify    ──▶  btt_verified = 1   ──▶  authenticated ✅
                                          authorised    ✅  create_incidents now resolves
                                          verified      ✅
```

Notice what the middle state is: a user who can log in, see their account page and read their own
display name, and cannot create anything. That is a *useful* state, not a broken one, and getting
it right is why verification is enforced by a capability filter rather than an `if` inside the
mutation. Lesson 15.3 builds it; Lesson 15.5 proves it from the outside.

> **Say the module's thesis out loud now, because everything after this lesson is a proof of it:**
> **Next.js makes user-experience decisions; WordPress makes authorisation decisions.** If
> `guards.ts` were deleted tomorrow, the worst outcome is an ugly empty account page. The mutation
> behind it still refuses, in PHP, because the capability is checked where the write happens.

---

## Task

This lesson writes no application code, and it is not a reading exercise. You will mint a real
token-shaped credential with `openssl`, take it apart, break its signature on purpose, and then
write three artifacts into `docs/architecture.md` that Lessons 15.2 through 15.5 all cite. The
final step greps the code you already have to prove the storage rules are not aspirations.

### Step 1: Build a base64url toolkit, and mint a token by hand

The WPGraphQL JWT plugin arrives in Lesson 15.2, so there is nothing to `login` against yet. That
is fine: a JWT is a format, not a service, and you can produce a byte-accurate one with two
commands. Work from the repository root.

```bash
cd wordpress-headless

# base64url ENCODE: standard base64, then +/ -> -_ , then drop the = padding.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# base64url DECODE: put the padding back, swap the alphabet, then decode.
# openssl rather than `base64 -d`, because the -d flag is spelled differently
# on macOS and GNU coreutils and this has to work on both.
b64url_d() {
  local s="${1//-/+}"
  s="${s//_//}"
  case $(( ${#s} % 4 )) in 2) s="$s==" ;; 3) s="$s=" ;; esac
  printf '%s' "$s" | openssl base64 -A -d
}
```

Now the token. The payload below is the exact claim set WPGraphQL JWT Authentication issues, so
what you decode in Step 2 is the shape you will see for real in Lesson 15.2:

```bash
# A THROWAWAY key. It is not GRAPHQL_JWT_AUTH_SECRET_KEY and must never be.
# This exercise proves how a signature behaves; it does not mint a usable token.
DEMO_KEY="$(openssl rand -base64 32 | tr -d '\n')"

IAT=$(date +%s)
HEADER=$(printf '%s' '{"typ":"JWT","alg":"HS256"}' | b64url)
PAYLOAD=$(printf '{"iss":"http://localhost:8080","iat":%s,"nbf":%s,"exp":%s,"data":{"user":{"id":"7"}}}' \
  "$IAT" "$IAT" "$((IAT + 300))" | b64url)

SIG=$(printf '%s' "$HEADER.$PAYLOAD" | openssl dgst -sha256 -hmac "$DEMO_KEY" -binary | b64url)
JWT="$HEADER.$PAYLOAD.$SIG"

echo "$JWT"
```

**Verify §1:**

- [ ] The output is one line with **exactly two** dots and no `+`, `/` or `=` characters.
      `echo "$JWT" | tr -cd '.' | wc -c` prints `2`.
- [ ] `DEMO_KEY` lives in this shell session only. It is not in `.env`, not in `.zshrc`, and not
      in any file — [appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target).

### Step 2: Take it apart with no key at all

This is the step that changes how you think about JWT payloads. You are about to read the claims
of a signed credential using nothing but two `tr` calls.

```bash
# Split on dots. cut is enough; there are exactly three fields.
H=$(echo "$JWT" | cut -d. -f1)
P=$(echo "$JWT" | cut -d. -f2)
S=$(echo "$JWT" | cut -d. -f3)

b64url_d "$H" | jq .
b64url_d "$P" | jq .
```

Then read the claims out individually, because the names matter later:

```bash
b64url_d "$P" | jq -r '"iss=\(.iss)  iat=\(.iat)  exp=\(.exp)  user=\(.data.user.id)"'
b64url_d "$P" | jq -r '.exp - .iat | "lifetime: \(.) seconds"'
```

| Claim | Meaning | Who reads it in this course |
|---|---|---|
| `iss` | issuer — the WordPress site URL | nobody in this app; useful when one client talks to several backends |
| `iat` | issued at, Unix seconds | Lesson 15.4, to explain what `exp` is measured from |
| `nbf` | not before — the token is invalid earlier than this | WordPress, during verification |
| `exp` | expiry, Unix seconds | **`decodeExpiry()` in Lesson 15.4, and the proxy in 15.5** |
| `data.user.id` | the WordPress user ID, as a **string** | WordPress, to resolve `get_current_user_id()` |

**Verify §2:**

- [ ] Both decodes printed readable JSON. **You supplied no key.** If that feels wrong, it is the
      correct reaction and it is the point of the step.
- [ ] `lifetime: 300 seconds`.
- [ ] `data.user.id` is the **string** `"7"`, not the number `7`. WPGraphQL JWT stores it as a
      string, and a strict comparison against a number would silently never match.

### Step 3: Tamper with the payload and watch the signature stop matching

"Signed" is an abstraction until you have broken one. Promote the user to ID `1` and re-encode:

```bash
# Rewrite data.user.id to 1 — the administrator on a fresh install — and re-encode.
FORGED_PAYLOAD=$(b64url_d "$P" | jq -c '.data.user.id = "1"' | b64url)
FORGED="$H.$FORGED_PAYLOAD.$S"

# The payload really did change, and it really is readable.
b64url_d "$FORGED_PAYLOAD" | jq -r '.data.user.id'
# Expected: 1
```

Now do what a verifier does: recompute the HMAC over the first two segments and compare it with
the signature the token carries.

```bash
EXPECTED=$(printf '%s' "$H.$FORGED_PAYLOAD" | openssl dgst -sha256 -hmac "$DEMO_KEY" -binary | b64url)

echo "carried:  $S"
echo "expected: $EXPECTED"
[ "$S" = "$EXPECTED" ] && echo 'SIGNATURE VALID — something is very wrong' || echo 'signature mismatch — rejected'
```

**Verify §3:**

- [ ] The two strings differ, and the script prints `signature mismatch — rejected`.
- [ ] Re-run the same comparison against the **original** `$PAYLOAD` and it matches. One character
      of difference in the payload changes every byte of the expected signature, which is the
      avalanche property HMAC is chosen for.
- [ ] You now have a one-sentence answer to "can I trust the payload?": **only if you verified the
      signature, and you can only verify it if you hold the key.** Next.js holds no key.

### Step 4: Write the credential inventory into `docs/architecture.md`

Append Key Concept 4's inventory to the architecture document you started in Lesson 01.2. Fill in
the blast-radius column **in your own words** — copying the table teaches nothing, and the
coordinator of your own future incident review will be you.

```markdown
<!-- docs/architecture.md — append -->

## Credential inventory (Lesson 15.1)

Five credentials. The mistake that matters is not losing one, it is using one where another
belongs. Cookie attributes are the contract in appendix 04 §4 — not restated here.

| Credential | Represents | Lifetime | Transport | Stored in | Blast radius if stolen |
|---|---|---|---|---|---|
| btt_at (user JWT) | one human | 300 s | Authorization: Bearer | httpOnly cookie | TODO — write this yourself |
| btt_rt (refresh token) | that human's right to a new JWT | 30 d | mutation variable | httpOnly cookie, Path=/api/auth | TODO |
| BTT_APP_TOKEN / WP_APP_TOKEN | the Next.js application | until rotated | X-BTT-App-Token | Fly secret / Vercel env | TODO |
| BTT_REVALIDATE_SECRET | WordPress's right to purge cache | until rotated | HMAC over the body | both .env files | TODO |
| Preview token | one editor, one post, one click | 120 s, single use | URL query parameter | nowhere; consumed | TODO |

**Not on this list:** the wordpress_logged_in_* cookie. No part of next-app ever holds, reads
or forwards it, and that absence keeps the front end out of scope for wp-admin compromise.

**Revocation.** A JWT cannot be revoked. `exp` is the revocation window, logout ends the
session for one browser only, and rotating the eight salts plus GRAPHQL_JWT_AUTH_SECRET_KEY is
the only way to invalidate everything at once.
```

**Verify §4:**

- [ ] Five rows, and **no** `TODO` left in the blast-radius column.
- [ ] The cookie attribute table is **not** in your file. It has one home, and duplicating a
      contract is how the two copies start to disagree.

### Step 5: Write the two-audience threat model

Append the second artifact. This one is a diagram plus the one sentence people forget.

```markdown
<!-- docs/architecture.md — append -->

## Two audiences, two authentication paths (Lesson 15.1)

| | Editors | Public developers |
|---|---|---|
| Authenticate to | WordPress, at /wp-login.php | Next.js, at /{locale}/login |
| Credential | wordpress_logged_in_* cookie | btt_at JWT in a cookie Next owns |
| Signed with | AUTH_KEY + AUTH_SALT | GRAPHQL_JWT_AUTH_SECRET_KEY |
| Validated by | WordPress | WordPress — Next holds no signing key |
| Revocable | yes, per session | no; expiry or key rotation only |
| Reaches wp-admin | yes | never (admin_init bounce, Lesson 03.5) |
| Reaches /graphql from a browser | yes, with a nonce | never |

These two paths share `wp_users` and `wp_usermeta` and **nothing else** — no credential, no
signing key, no cookie name, no session store. A JWT-key leak does not touch editors; an
editor laptop compromise does not touch a public developer's session.

The cost, stated plainly: nine independent secrets in wordpress-headless/.env instead of one,
and a rotation procedure per secret. That is what the separation costs and it is worth it.

(Add your own sentence naming which single secret, if leaked, would compromise BOTH paths.)
```

**Verify §5:**

- [ ] You filled in the parenthesis. If you cannot name the secret, re-read Key Concept 5's table
      and ask which value appears in the "signed with" row for both columns when
      `GRAPHQL_JWT_AUTH_SECRET_KEY` and `AUTH_KEY` are set to the same string.

### Step 6: Write the storage rules and the one exception

The third artifact. Short, absolute, and with the exception stated precisely enough to survive
the first time someone finds it.

```markdown
<!-- docs/architecture.md — append -->

## Where a session credential may live (Lesson 15.1)

**Allowed:** an httpOnly cookie set by a Server Action or Route Handler; a server-side
environment variable; a secret store (Fly secrets, Vercel env).

**Forbidden, with the attack each one enables:**

| Location | Attack |
|---|---|
| localStorage | any injected script reads it synchronously and exfiltrates it; survives a tab close |
| sessionStorage | same read primitive, shorter window; "per tab" is not a boundary |
| a URL, query string or hash | leaks via Referer, history, access logs, CDN logs, analytics and link unfurlers |
| a NEXT_PUBLIC_ variable | Next inlines the literal value into JavaScript every visitor downloads |

**The two exceptions:** the Lesson 17.2 preview token (single use, 120-second TTL, exchanged
server-to-server, grants read access to one unpublished post) and the Lesson 15.3 email
confirmation code (single use, 24-hour TTL, stored only as a sha256 hash, grants one
email confirmation and one password set). The rule is precisely *no **session** credential in a
URL, ever* — not "no token in a URL". Single use is the property that carries both.

**Enforcement, not intention:** `grep -rn 'localStorage\|sessionStorage' next-app/src/` returns
nothing, and `npm run build && grep -r <secret value> .next/static/` returns nothing. Module 24
makes both a CI gate.
```

### Step 7: Prove the rules already hold in the code you have

An architecture note nobody checks is a wish. Run the checks now, while the answer is trivially
zero, so that the first non-zero answer is a signal rather than a surprise.

```bash
cd ../next-app

grep -rn 'localStorage\|sessionStorage' src/ ; echo "exit=$?"
grep -rn 'NEXT_PUBLIC_' src/ | grep -iv 'site_url\|default_locale'; echo "exit=$?"
grep -c 'GRAPHQL_JWT_AUTH_SECRET_KEY' .env.example; echo "exit=$?"
```

**Verify §7:**

- [ ] The first two greps print nothing and exit `1`. `grep` exits `1` when it finds nothing,
      which is the outcome you want and the opposite of what a green build usually looks like.
- [ ] The third prints `0`. Next.js does not hold WordPress's signing secret and therefore
      **could not** verify a token even if a future lesson wanted it to. That is the point of
      [appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key),
      and Lesson 15.4 turns it into a design decision rather than a limitation.
- [ ] Commit the three artifacts: `git add docs/architecture.md && git commit -m "docs(auth): credential inventory, threat model and storage rules"`.

---

## Verification

```bash
cd /path/to/headless-wordpress-fullstack-training

# 0. The base64url toolkit, again, so this block is self-contained.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
b64url_d() {
  local s="${1//-/+}"; s="${s//_//}"
  case $(( ${#s} % 4 )) in 2) s="$s==" ;; 3) s="$s=" ;; esac
  printf '%s' "$s" | openssl base64 -A -d
}

# 1. Mint a token with a throwaway key, in this session only
DEMO_KEY="$(openssl rand -base64 32 | tr -d '\n')"
IAT=$(date +%s)
H=$(printf '%s' '{"typ":"JWT","alg":"HS256"}' | b64url)
P=$(printf '{"iss":"http://localhost:8080","iat":%s,"nbf":%s,"exp":%s,"data":{"user":{"id":"7"}}}' \
  "$IAT" "$IAT" "$((IAT + 300))" | b64url)
S=$(printf '%s' "$H.$P" | openssl dgst -sha256 -hmac "$DEMO_KEY" -binary | b64url)
echo "$H.$P.$S" | tr -cd '.' | wc -c | tr -d ' '
# Expected: 2   — three segments, two separators, no padding characters

# 2. The header decodes to the algorithm the verifier must pin
b64url_d "$H" | jq -r '.alg'
# Expected: HS256

# 3. The payload round trip: readable JSON, no key supplied
b64url_d "$P" | jq -r '"iss=\(.iss) user=\(.data.user.id) lifetime=\(.exp - .iat)s"'
# Expected: iss=http://localhost:8080 user=7 lifetime=300s

# 4. NEGATIVE — a base64url payload is not a secret. This SUCCEEDS with no key,
#    and that success is the finding, not a bug.
b64url_d "$P" | grep -c 'data'
# Expected: 1   — anything you put in a JWT payload is public to the token holder

# 5. NEGATIVE — tampering with the payload invalidates the signature
FORGED_P=$(b64url_d "$P" | jq -c '.data.user.id = "1"' | b64url)
EXPECTED=$(printf '%s' "$H.$FORGED_P" | openssl dgst -sha256 -hmac "$DEMO_KEY" -binary | b64url)
[ "$S" = "$EXPECTED" ] && echo 'VALID — investigate' || echo 'signature mismatch — rejected'
# Expected: signature mismatch — rejected

# 6. ...and the untampered payload still verifies, so check 5 proves something
EXPECTED_OK=$(printf '%s' "$H.$P" | openssl dgst -sha256 -hmac "$DEMO_KEY" -binary | b64url)
[ "$S" = "$EXPECTED_OK" ] && echo 'signature valid' || echo 'MISMATCH — recompute'
# Expected: signature valid

# 7. NEGATIVE — no session credential is stored anywhere JavaScript can read
cd next-app
grep -rc 'localStorage' src/ 2>/dev/null | grep -v ':0$' ; echo "hits above? exit=$?"
# Expected: no lines listed, exit=1
grep -rc 'sessionStorage' src/ 2>/dev/null | grep -v ':0$' ; echo "hits above? exit=$?"
# Expected: no lines listed, exit=1

# 8. NEXT_PUBLIC_ is fully accounted for: exactly the two that exist today
grep -rho 'NEXT_PUBLIC_[A-Z_]*' src/ | sort -u
# Expected: NEXT_PUBLIC_DEFAULT_LOCALE and NEXT_PUBLIC_SITE_URL — and nothing else.
#           Appendix 04 §3.2 is the allowlist and holds five: TURNSTILE_SITE_KEY
#           arrives in Lesson 16.3, and SENTRY_DSN and RELEASE in Lesson 24.3.
#           Two now, five by the end of the course, and every one of the three
#           still to come has to argue why publishing it is safe.
grep -c 'NEXT_PUBLIC_' .env.example
# Expected: 2

# 9. NEGATIVE — Next does not hold WordPress's signing secret, in either env file
grep -c 'GRAPHQL_JWT_AUTH_SECRET_KEY' .env.example
# Expected: 0
grep -c 'GRAPHQL_JWT_AUTH_SECRET_KEY' .env.local
# Expected: 0   — so Next.js CANNOT verify a token, which Lesson 15.4 turns into a rule

# 10. NEGATIVE — the same variable IS set on the WordPress side. Asserted, never printed.
cd ../wordpress-headless
docker compose run --rm wpcli wp eval \
  'echo defined("GRAPHQL_JWT_AUTH_SECRET_KEY") && strlen(GRAPHQL_JWT_AUTH_SECRET_KEY) >= 32 ? "set\n" : "MISSING\n";'
# Expected: set
#           One value, one runtime. Lesson 02.5 generated it; nothing has moved it since.

# 11. ...and it is a DIFFERENT value from AUTH_KEY (appendix 04 §5)
docker compose run --rm wpcli wp eval \
  'echo GRAPHQL_JWT_AUTH_SECRET_KEY !== AUTH_KEY ? "distinct\n" : "IDENTICAL — regenerate one\n";'
# Expected: distinct

# 12. The three written artifacts exist and are not stubs
cd ..
test -s docs/architecture.md && echo 'architecture.md present and non-empty'
# Expected: architecture.md present and non-empty
grep -cE '^## (Credential inventory|Two audiences|Where a session credential)' docs/architecture.md
# Expected: 3
grep -c 'TODO' docs/architecture.md
# Expected: 0   — every placeholder replaced with your own words

# 13. The inventory has five rows and names the app token
grep -c 'BTT_APP_TOKEN' docs/architecture.md
# Expected: 1 or more
grep -c 'localStorage' docs/architecture.md
# Expected: 1   — named once, in the forbidden table, and nowhere in src/

# 14. Nothing secret is staged
git status --short
git check-ignore -v wordpress-headless/.env next-app/.env.local
# Expected: neither .env file appears in git status; check-ignore names a rule for both
```

Checks 4, 5 and 9 are the three that define this lesson. Check 4 proves the payload is public,
check 5 proves the signature is not forgeable, and check 9 proves that the runtime holding your
users' cookies cannot judge the tokens inside them. Every design decision in Lessons 15.2 to 15.5
is downstream of those three facts.

## Control Questions

1. A colleague proposes putting the user's email and role list into the JWT payload "so Next does
   not have to ask WordPress on every page". Name the two properties of a JWT payload that make
   this a data-disclosure decision rather than a caching optimisation, and say which of the two
   Verification checks demonstrates it.
2. `wp_destroy_current_session()` has no equivalent in this architecture. Describe what actually
   happens when a user clicks Log out, what an attacker holding a copy of that user's `btt_at`
   experiences, and how long they experience it for.
3. The credential inventory ranks the app token as having the largest blast radius, even though
   the refresh token lives 30 days and the app token is only ever held by servers. Justify that
   ranking in terms of what each credential lets an attacker *do*, and name the one operational
   property that makes the app token worse.
4. Lesson 17.2 puts a token in a URL, which Key Concept 6 forbids. State the rule precisely
   enough that both facts are true at once, then name three places a URL leaks to that a cookie
   does not.
5. Appendix 04 §6 says keeping `WP_GRAPHQL_ENDPOINT` server-only is not obscurity-as-security.
   Given that media `sourceUrl` values already publish the WordPress host, list what the decision
   genuinely buys you, and name the production control from Module 24 that does the work the
   server-only endpoint does not.

## Learn More

- [RFC 7519 — JSON Web Token](https://datatracker.ietf.org/doc/html/rfc7519) — read §4.1 only, the
  registered claim names; it is two pages and it is the source for every claim you decoded in Step 2
- [jwt.io introduction](https://jwt.io/introduction) — the clearest short explanation of the three
  segments, and a decoder you can paste your Step 1 token into to confirm your shell maths
- [OWASP — JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) —
  the algorithm-confusion and `alg: none` attacks named in Key Concept 2, with the mitigations
- [OWASP — HTML5 Security Cheat Sheet, Local Storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage) —
  the canonical short argument against `localStorage` for credentials, in the words of the people who catalogue the attacks
- [MDN — Set-Cookie: HttpOnly](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#httponly) —
  what the flag actually prevents, and what it does not; Lesson 15.4 depends on the distinction
- [`wp_set_auth_cookie()` source](https://developer.wordpress.org/reference/functions/wp_set_auth_cookie/) —
  read it next to Key Concept 3; the `session_tokens` write is the row that makes WordPress sessions revocable
- [`wp_destroy_all_sessions()`](https://developer.wordpress.org/reference/functions/wp_destroy_all_sessions/) —
  the function that has no JWT equivalent, and the reason salt rotation is the substitute
- [The confused deputy problem](https://en.wikipedia.org/wiki/Confused_deputy_problem) — the 1988
  framing of Key Concept 8; short, and it will change how you read every "call this API on the user's behalf" feature
- [MDN — Referer header and privacy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer) —
  the leak path that makes a token in a URL unrecallable, including which parts are sent cross-origin
