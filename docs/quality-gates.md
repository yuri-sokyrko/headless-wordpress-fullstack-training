# Quality gates

## Entry-point verification matrix (Lesson 15.5)

Every route handler and every Server Action in the application, against five independent
questions. **Every cell has a real answer, and "n/a" always carries its reason.**

| Entry point                     | AuthN                                                        | AuthZ                                              | Validation                                                       | Rate limit                                             | CSRF                                                         |
| ------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| `GET /api/health` (09.5)        | none — deliberately public                                   | n/a: reads nothing user-specific, writes nothing   | n/a: takes no input                                              | **none, on purpose** — a monitor must not be throttled | n/a: reads no cookie, so there is nothing to ride            |
| `POST /api/auth/refresh` (15.4) | the `btt_rt` cookie IS the credential; WordPress verifies it | n/a: renewing your own session needs no capability | n/a: no request body is read                                     | **none — a real gap.** See below.                      | `SameSite=Strict` + `Path=/api/auth`: unreachable cross-site |
| `GET /api/auth/refresh` (15.4)  | same                                                         | same                                               | `?next=` validated as a same-origin path (open-redirect defence) | **none — same gap**                                    | same                                                         |
| `login` action (15.4)           | this action creates it                                       | n/a                                                | hand-written `field()`; **Zod in 16.1**                          | in-memory `Map`, **per instance** — Upstash in 16.2    | Origin/Host check + `allowedOrigins`                         |
| `logout` action (15.4)          | n/a: clearing your own cookies needs no proof                | n/a                                                | takes no input                                                   | none — the worst case is being signed out              | Origin/Host + `SameSite=Lax`                                 |
| `register` action (15.3)        | app token, server-side only, `hash_equals()` in PHP          | holding the app token IS the authorisation         | hand-written; **re-validated in PHP** (06.2)                     | in-memory `Map`, per instance                          | Origin/Host                                                  |
| `verify` action (15.3)          | app token                                                    | app token, plus the single-use code                | hand-written + `absint()` in PHP                                 | none — the single-use code is the limit                | Origin/Host                                                  |
| `submitIncident` (16.2)         | STUB                                                         | STUB                                               | STUB                                                             | STUB                                                   | STUB                                                         |
| `submitLead` (16.3)             | STUB                                                         | STUB                                               | STUB                                                             | STUB                                                   | STUB                                                         |
| `GET /api/preview` (17.2)       | STUB                                                         | STUB                                               | STUB                                                             | STUB                                                   | STUB                                                         |
| `GET /api/preview/exit` (17.2)  | STUB                                                         | STUB                                               | STUB                                                             | STUB                                                   | STUB                                                         |
| `POST /api/revalidate` (18.3)   | STUB                                                         | STUB                                               | STUB                                                             | STUB                                                   | STUB — cookieless + HMAC, so structurally immune             |
| `POST /api/vitals` (21.x)       | STUB                                                         | STUB                                               | STUB                                                             | STUB                                                   | STUB                                                         |

### Known gaps, named rather than hidden

1. **`/api/auth/refresh` has no rate limit.** A caller with a stolen refresh token can mint access
   tokens as fast as they like, and an attacker with no token can hammer the endpoint. Lesson 16.2
   builds the shared limiter; this row is the reminder to apply it here too.
2. **The rate limiter is in-memory.** A `Map` does not survive a cold start or span instances, and
   `x-forwarded-for` is client-controlled without a trusted proxy. Lesson 15.4 §10 lists all four
   failure modes. Expires in Lesson 16.2.
3. **Validation is hand-written.** `src/actions/auth.ts` has a local `field()` helper. Expires in
   Lesson 16.1, which replaces it with `src/lib/validation/schemas.ts`.
4. **Session lifetime is strict by construction.** `btt_rt` is scoped to `Path=/api/auth`, so
   proxy cannot tell an expired session from no session. Five minutes of complete inactivity
   ends the session. Accepted: it is the price of the narrowest cookie in the app (15.5 §5).

### The rules behind the columns

- **AuthN.** "The cookie is present" is not authentication. WordPress verifies every user token,
  on every call. Next holds no signing key (appendix 04 §5).
- **AuthZ.** "The page is guarded" is not authorization. `guards.ts` is a UX redirect; deleting it
  makes no data reachable that was not reachable before.
- **Validation.** Client-side validation is a user-experience feature. The server control is
  `safeParse` in the action AND independent re-validation in PHP (Lesson 06.2 §3).
- **Rate limit.** Fails **closed**: if the limiter cannot answer, refuse the write.
- **CSRF.** Three layers: Next's Origin/Host check on Server Actions,
  `experimental.serverActions.allowedOrigins`, and `SameSite` on the session cookies. Where an
  endpoint carries real authority, the design removes the ambient credential instead — no cookie,
  HMAC over the body.

(Add your own row: which entry point would you attack first, and which cell is the reason?)

## PII and logging (Lesson 16.3)

`wp_btt_leads` is the only place in this application that stores personal data. Five rules, no
exceptions, and each one is grep-checkable.

| Rule                                              | Enforced by                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The raw IP is never stored                        | there is no `ip` column. `ip_hash CHAR(64)` cannot hold a dotted quad                                                                                                                                                                                       |
| `ip_hash` is a **keyed** HMAC, never a plain hash | `hash_hmac( 'sha256', $ip, BTT_LEAD_IP_HMAC_KEY )`. An unkeyed IPv4 hash is brute-forceable in seconds — 2^32 inputs                                                                                                                                        |
| No email, IP or token in a log line               | `grep -rn 'console' next-app/src/actions/` returns nothing. The one `catch` that binds an error reads `error.errors` — WordPress's own fixed message set — and never serialises the object, which can carry the request options and therefore the app token |
| No request body in an error path                  | the generic `REFUSED` message, from a fixed set                                                                                                                                                                                                             |
| Duplicates are accepted, not reported             | `UNIQUE KEY (email, source)` in MySQL. Telling a caller the address is known is an enumeration oracle                                                                                                                                                       |

**Why logging is a data-protection question and not an ops one.** A log line has no schema, no
retention policy, no deletion-request workflow and much wider read access than the database — and
it is replicated to wherever the log drain points. Anything you log, you have published to a system
with none of the controls you built. Module 24's Sentry `beforeSend` scrubber is checked against
this table.

Rotating `BTT_LEAD_IP_HMAC_KEY` makes historic hashes unlinkable from new ones. That is a deletion
mechanism, and it costs you abuse-detection history. `docs/runbook.md` records the date.

Add this row to the entry-point matrix from Lesson 15.5:

| Entry point           | AuthN                                                                                                               | AuthZ                                                                                                                                                                    | Validation                                                | Rate limit                  | CSRF                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------- | -------------------------------- |
| `submitLead` (action) | none — the caller is anonymous by definition; the **application** authenticates to WordPress with `X-BTT-App-Token` | n/a, and here is why: there is no subject to authorise. Entitlement to write is decided by the spam stack — honeypot, Cloudflare-issued timestamp, Turnstile, rate limit | `leadSchema.safeParse`, then PHP re-validates every field | Upstash per IP, fail closed | Next Origin/Host on action POSTs |
