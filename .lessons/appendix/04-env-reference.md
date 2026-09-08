# Appendix 04 — Environment & Secrets Reference

**This is a contract.** Modules 02, 09, 15, 16, 18 and 24 all cite it. Variable names here are
final.

It is also the security spine of the course. Read §1 before you create your first `.env` file
— the order in which you do things matters, and doing it backwards is how secrets end up in
git history forever.

---

## 1. The five rules

**1. `.env.example` is the only env file that may exist in git.**
`.gitignore` ignores `.env` and `.env.*`, then re-includes `.env.example` with `!`. The
tracked example contains variable **names** and `__CHANGE_ME__` placeholders. Never a value —
not even a fake-looking one, because a fake-looking one gets copied into production by someone
in a hurry.

**2. Set up the ignore rule *before* the secret exists.**

```bash
# Do this FIRST — before you write a single real value
git check-ignore -v next-app/.env.local
# Expected: .gitignore:NN:.env.*	next-app/.env.local
#
# No output means the file is NOT ignored. Stop. Fix .gitignore. Then continue.
```

A secret that has been committed once is compromised even after you delete it, because it
lives in the object database and in every clone. Rotate it, do not just remove it.

**3. Never bake a secret into a Docker image.**
No `ARG`, no `ENV`, no `COPY .env`. `docker history` prints build args in plain text, and every
layer you push sits in the registry for anyone with pull access. Secrets are **runtime-only**:
`fly secrets set`, Vercel environment variables, GitHub Actions secrets.

**4. `NEXT_PUBLIC_` is an instruction, not a hint.**
The prefix tells Next.js to **inline the literal value into JavaScript that anyone can read**.
There is no such thing as a secret `NEXT_PUBLIC_` variable. §3 lists the only four that exist
in this app, and each one has a written justification.

**5. Every environment gets its own values.**
Local ≠ staging ≠ production, for every salt, every token and every password. Sharing a JWT
secret between local and production means a laptop compromise is a production compromise.

---

## 2. WordPress — `wordpress-headless/.env`

Loaded by Docker Compose via `env_file:`, read in `wp-config.php` with `getenv()`.

| Variable | Secret | Local example | Notes |
|---|---|---|---|
| `WORDPRESS_DB_HOST` | no | `db:3306` | The Compose **service name**, never `localhost` |
| `WORDPRESS_DB_NAME` | no | `btt` | |
| `WORDPRESS_DB_USER` | no | `btt` | Never `root`, in any environment |
| `WORDPRESS_DB_PASSWORD` | **yes** | `__CHANGE_ME__` | |
| `WORDPRESS_TABLE_PREFIX` | no | `wp_` | |
| `WP_HOME` | no | `http://localhost:8080` | |
| `WP_SITEURL` | no | `http://localhost:8080` | |
| `WP_ENVIRONMENT_TYPE` | no | `local` | `local` \| `staging` \| `production` — drives the hardening branches in Module 24 |
| `WORDPRESS_DEBUG` | no | `1` | `0` in production, always |
| `AUTH_KEY` | **yes** | 64+ random chars | |
| `SECURE_AUTH_KEY` | **yes** | 64+ random chars | |
| `LOGGED_IN_KEY` | **yes** | 64+ random chars | |
| `NONCE_KEY` | **yes** | 64+ random chars | |
| `AUTH_SALT` | **yes** | 64+ random chars | |
| `SECURE_AUTH_SALT` | **yes** | 64+ random chars | |
| `LOGGED_IN_SALT` | **yes** | 64+ random chars | |
| `NONCE_SALT` | **yes** | 64+ random chars | |
| `GRAPHQL_JWT_AUTH_SECRET_KEY` | **yes** | 64+ random chars | **Must differ from `AUTH_KEY`** — see §5 |
| `GRAPHQL_JWT_AUTH_CORS_ENABLE` | no | `false` | Set explicitly, and explicitly **off**. When on, WPGraphQL JWT Authentication emits CORS headers and returns the refresh token in an `X-JWT-Refresh` response header — both of which only help a *browser* client, and the browser never reaches `/graphql` in this app. Lesson 15.2. |
| `BTT_APP_TOKEN` | **yes** | 48+ random chars | Shared with Next. Server-to-server only. §4 |
| `BTT_REVALIDATE_SECRET` | **yes** | 48+ random chars | HMAC key for the revalidation webhook |
| `BTT_LEAD_IP_HMAC_KEY` | **yes** | 32+ random chars | Pseudonymises lead IPs — the raw IP is never stored |
| `BTT_FRONTEND_URL` | no | `http://host.docker.internal:3000` | Where WordPress posts revalidations and redirects previews |
| `BTT_EDITOR_PASSWORD` | **yes** | session only | Seeder account password. Injected into the session, **never written to `.env`** — see §7. |
| `BTT_REPORTER_PASSWORD` | **yes** | session only | Same. |
| `BTT_E2E_PASSWORD` | **yes** | session only | Same, for the least-privilege `e2e_agent` user used from Module 23. |
| `BTT_SMTP_HOST` | no | `mailpit` | |
| `BTT_SMTP_PORT` | no | `1025` | |
| `BTT_S3_ENDPOINT` | no | — | Production media offload (R2/S3) |
| `BTT_S3_BUCKET` | no | — | |
| `BTT_S3_REGION` | no | — | |
| `BTT_S3_KEY` | **yes** | — | |
| `BTT_S3_SECRET` | **yes** | — | |
| `ACF_PRO_LICENSE` | **yes** | `__CHANGE_ME__` | ACF PRO licence key (repeaters and options pages are PRO-only) |
| `DISALLOW_FILE_EDIT` | no | `false` local, `true` prod | No code execution from wp-admin |
| `DISALLOW_FILE_MODS` | no | `false` local, `true` prod | No plugin installs in production |

### Generating the eight salts plus the JWT secret

```bash
# 1. Nine independent 64-char values. Never reuse one for two variables.
for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY \
         AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT \
         GRAPHQL_JWT_AUTH_SECRET_KEY; do
  printf '%s=%s\n' "$k" "$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64)"
done
# Expected: nine KEY=<64 chars> lines. Paste into wordpress-headless/.env (gitignored).

# 2. Confirm you are not about to commit them
git check-ignore -v wordpress-headless/.env
# Expected: a .gitignore match. No output = STOP.
```

> **Rotating the eight salts logs every user out immediately.** That is not a bug — it is the
> incident-response procedure. If you suspect session theft, rotating salts is how you revoke
> every session at once. Module 24 walks the rotation.

`host.docker.internal` matters more than it looks. Next runs on the **host**, not in Compose,
so WordPress inside the container cannot reach `localhost:3000`. On Linux you need
`extra_hosts: ["host.docker.internal:host-gateway"]`; on Docker Desktop it is free. This is
the number-one cause of "my revalidation webhook silently does nothing".

---

## 3. Next.js — `next-app/.env.local`

### 3.1 Server-only (no prefix)

Never sent to the browser. Importing one of these into a client component is a build error if
you guard the module with `import 'server-only'` — Lesson 10.1 does exactly that.

| Variable | Secret | Local example | Notes |
|---|---|---|---|
| `WP_GRAPHQL_ENDPOINT` | no, but **deliberately not public** | `http://localhost:8080/graphql` | §6 explains why it stays server-side |
| `WP_REST_BASE` | no | `http://localhost:8080/wp-json` | For `/btt/v1/preview/verify` |
| `WP_APP_TOKEN` | **yes** | `__CHANGE_ME__` | Mirrors `BTT_APP_TOKEN` |
| `REVALIDATE_SECRET` | **yes** | `__CHANGE_ME__` | Mirrors `BTT_REVALIDATE_SECRET` |
| `PREVIEW_SHARED_SECRET` | **yes** | `__CHANGE_ME__` | |
| `TURNSTILE_SECRET_KEY` | **yes** | `__CHANGE_ME__` | Cloudflare Turnstile server key |
| `UPSTASH_REDIS_REST_URL` | **yes** | `__CHANGE_ME__` | Rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | **yes** | `__CHANGE_ME__` | |
| `RESEND_API_KEY` | **yes** | `__CHANGE_ME__` | Optional lead notification |
| `E2E_MODE` | no | unset | `1` only in the test stack — gates the test-only revalidate hook. **Playwright does not read `.env.local`**: `playwright.config.ts` and `e2e/global-setup.ts` see this only from the invoking shell (`E2E_MODE=1 npx playwright test`). Deliberate — Lesson 12.4. |
| `E2E_SECRET` | **yes** | `__CHANGE_ME__` | Required header for that hook. Read from this file inside the Next runtime (Module 18); read from the shell by the test harness (Lesson 12.4). |
| `SENTRY_DSN` | **yes** | — | Module 24 |

### 3.2 Public (`NEXT_PUBLIC_*`) — all four of them

| Variable | Value | Why publishing it is safe |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | It is already in the address bar |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `en` | Not a secret in any sense |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare site key | **Designed** to be public. The *secret* key is the one in §3.1 |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | `blamethe.tech` | Optional analytics |

Nothing else. Ever.

```bash
# The verification step from Lesson 09.5 — also a CI gate in Module 24
npm run build
grep -r "$REVALIDATE_SECRET" .next/static/ 2>/dev/null
# Expected: no output.
#           Any hit means a server-only secret reached the client bundle.
```

> **The named anti-pattern: `NEXT_PUBLIC_WORDPRESS_URL`.** Every headless WordPress tutorial
> on the internet does this so the browser can query GraphQL directly. It publishes your
> endpoint, invites introspection and unmetered querying, and forces you to maintain a CORS
> policy you would not otherwise need. This course fetches GraphQL **only** from the server.

---

## 4. The two credentials

These are different things with different lifetimes and different blast radii. Confusing them
is the most consequential mistake available in this architecture.

| | `btt_at` (user JWT) | `BTT_APP_TOKEN` (app token) |
|---|---|---|
| Represents | **a human user** | **the Next.js application** |
| Issued by | WordPress `login` mutation | you, once, with `openssl rand` |
| Lifetime | 300 s (refreshed via `btt_rt`) | until rotated |
| Sent as | `Authorization: Bearer <jwt>` | `X-BTT-App-Token: <token>` |
| Used for | `createIncident`, `viewer`, anything acting **as** someone | `registerDeveloper`, `submitHobtLead`, `/preview/verify` — operations with no logged-in user |
| Stored in | httpOnly cookie | Vercel env / Fly secret |
| In the browser? | as an opaque httpOnly cookie the browser cannot read | **never, under any circumstances** |

WordPress compares the app token with `hash_equals()`, not `==`, to avoid a timing oracle.

### Session cookies

| Cookie | Contents | httpOnly | Secure | SameSite | Path | Max-Age |
|---|---|---|---|---|---|---|
| `btt_at` | WP auth JWT | ✓ | ✓ (prod) | `Lax` | `/` | 300 s |
| `btt_rt` | WP refresh token | ✓ | ✓ (prod) | **`Strict`** | **`/api/auth`** | 30 d |
| `btt_preview_jwt` | short-lived preview JWT | ✓ | ✓ | `Lax` | `/` | 300 s |
| `__prerender_bypass`, `__next_preview_data` | Next `draftMode` | ✓ | ✓ | Next-managed | `/` | session |
| `NEXT_LOCALE` | `en` \| `uk` \| `de` | ✗ | ✓ | `Lax` | `/` | 1 y |

> **`btt_rt` has `Path=/api/auth` and `SameSite=Strict` for a reason.** It is not attached to
> page loads, block fetches, or Server Action posts — it travels on exactly one endpoint. That
> narrows the blast radius of any future XSS or accidental request logging, and it is a
> five-word config change.

**No `localStorage`. No `sessionStorage`. No token in a URL, query string, hash, or
`NEXT_PUBLIC_` variable.** Anything JavaScript can read, an injected script can exfiltrate,
and a WordPress site with a dozen plugins is a large injection surface.

The **one** permitted token-in-a-URL is the preview token (Lesson 17.2): single-use,
120-second TTL, exchanged server-to-server, and not a session credential. The rule is precise
— *no **session** credential in a URL, ever*. URLs leak through `Referer` headers, browser
history, server access logs and chat clients.

---

## 5. Why `GRAPHQL_JWT_AUTH_SECRET_KEY` must differ from `AUTH_KEY`

Separate blast radius. `AUTH_KEY` signs WordPress's own login cookies;
`GRAPHQL_JWT_AUTH_SECRET_KEY` signs API tokens issued to the front end. If they are the same
value, then anything that leaks one leaks both, and an API-layer mistake becomes a wp-admin
compromise.

Related, and stated explicitly in Lesson 15.5: **Next.js does not hold
`GRAPHQL_JWT_AUTH_SECRET_KEY` at all.** Next could verify JWTs locally with `jose`, but that
would mean Vercel holds WordPress's signing secret — and a Vercel compromise would then mint
valid WordPress administrator tokens. Instead Next treats the JWT as **opaque**, decoding the
payload only to read `exp` as a cheap "should I refresh?" heuristic. Every real authorisation
decision is made by WordPress when the token is presented.

---

## 6. The honest caveat about hiding the WordPress origin

Media `sourceUrl` values are public, so the WordPress host is discoverable regardless of
whether `WP_GRAPHQL_ENDPOINT` is a public variable. Keeping it server-only removes the
endpoint from the app's own traffic and from your client bundle — it is **not**
obscurity-as-security, and the course does not pretend it is.

The actual controls, all taught in Module 24:

| Control | Mechanism |
|---|---|
| Disable introspection in production | WPGraphQL setting + `graphql_debug` off |
| Query depth and complexity limits | WPGraphQL settings — reject depth > 10 |
| **Persisted queries (allowlist)** | WPGraphQL Smart Cache. In production only hash-registered operations execute. The strongest available control. |
| Edge rate limiting on `/graphql` | Cloudflare in front of Fly.io |
| Media on a separate domain | R2/S3 with a custom domain — media URLs stop pointing at the origin |
| Origin lock | Restrict `/graphql` to Vercel egress where feasible |

---

## 7. Secret injection per target

| Target | Mechanism | Rule |
|---|---|---|
| Local WordPress | `wordpress-headless/.env` (gitignored) + `env_file:` in Compose | Never `environment:` with a literal value in a committed compose file |
| Local Next | `next-app/.env.local` (gitignored) | Only `.env.example` is tracked |
| **Docker image** | **nothing** | Never `ARG`/`ENV` a secret. Runtime-only. |
| Fly.io | `fly secrets set K=V` — encrypted at rest, injected as env at boot, triggers a rolling restart | `fly.toml` `[env]` holds **only** non-secret config |
| Vercel | Project → Environment Variables, scoped Production / Preview / Development, "Sensitive" flag on secrets | Preview and Production use **different** `WP_GRAPHQL_ENDPOINT` and `WP_APP_TOKEN` |
| GitHub Actions | Repository/Environment secrets, least-privilege `permissions:`, environment protection on deploy jobs | Only `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `FLY_API_TOKEN`, `E2E_*`, `CODECOV_TOKEN` |
| Your shell | inject into the active session only | Do not persist tokens to `.zshrc`, `.bashrc`, or any dotfile |

> **CI never needs WordPress credentials.** `schema.graphql` is committed, so
> `npm run codegen:check` regenerates types from the file rather than introspecting a live
> WordPress. That removes an entire class of flaky CI and means no CI job ever holds a
> database password or a JWT secret. Refreshing the schema is a deliberate human action
> (`npm run schema:pull` against a running WP) whose diff is reviewed like any other change.

Never `echo` a secret in a workflow. Use `::add-mask::` for anything derived, and keep
`ACTIONS_STEP_DEBUG` off for deploy jobs.

---

## 8. `.env.example` shape

Sectioned, every variable present, secrets as `__CHANGE_ME__`, with a header that states the
rule.

**This is the file's *final* shape, not its first.** Lesson 09.1 creates it holding only the
variables Module 09 introduces; Modules 10, 12, 15, 16, 17, 18 and 24 each append their own as
they arrive. §9 says which module adds what. A learner at the end of Module 09 whose
`.env.example` is six lines long has not made a mistake.

```dotenv
# next-app/.env.example
#
# Copy to .env.local and fill in.  NEVER commit .env.local.
# Anything NOT prefixed NEXT_PUBLIC_ stays on the server.
# Anything prefixed NEXT_PUBLIC_ is baked into JavaScript the whole world can read.

# ── WordPress connection (server-only) ──────────────────────────────
WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql
WP_REST_BASE=http://localhost:8080/wp-json

# ── Shared secrets — must match wordpress-headless/.env ─────────────
WP_APP_TOKEN=__CHANGE_ME__
REVALIDATE_SECRET=__CHANGE_ME__
PREVIEW_SHARED_SECRET=__CHANGE_ME__

# ── Public — inlined into the client bundle ─────────────────────────
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_DEFAULT_LOCALE=en
```

---

## 9. Which module introduces what

| Module | Variables it introduces |
|---|---|
| 02 | All of §2 except the S3, app-token and `BTT_*_PASSWORD` rows — plus the whole of §1 |
| 04 | `ACF_PRO_LICENSE`, and the three `BTT_*_PASSWORD` session variables the seeder reads |
| 09 | `WP_GRAPHQL_ENDPOINT`, `NEXT_PUBLIC_SITE_URL`, the `NEXT_PUBLIC_` boundary lesson |
| 10 | `WP_REST_BASE` |
| 12 | `E2E_MODE`, `E2E_SECRET` |
| 15 | `GRAPHQL_JWT_AUTH_CORS_ENABLE`, `WP_APP_TOKEN`, and the cookie table in §4. `GRAPHQL_JWT_AUTH_SECRET_KEY` and `BTT_APP_TOKEN` already exist — Lesson 02.5 wrote them into `wordpress-headless/.env`, and Lesson 15.2 *verifies* them rather than creating them. |
| 16 | `TURNSTILE_*`, `UPSTASH_*`, `BTT_LEAD_IP_HMAC_KEY`, `RESEND_API_KEY` |
| 17 | `PREVIEW_SHARED_SECRET` |
| 18 | `REVALIDATE_SECRET`, `BTT_REVALIDATE_SECRET`, `BTT_FRONTEND_URL` |
| 24 | `BTT_S3_*`, `SENTRY_DSN`, `DISALLOW_FILE_*`, and all of §7 |
