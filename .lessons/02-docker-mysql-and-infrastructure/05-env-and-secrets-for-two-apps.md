---
title: 'Env & Secrets for Two Apps'
module: 2
lesson: 5
teaches: [gitignore-before-secrets, env-file-boundary, next-public-boundary, salt-generation, env-example-shape]
produces: ['wordpress-headless/.env.example']
requires: [2.4]
---

# Lesson 02.5 — Env & Secrets for Two Apps

## Quick Overview

You already have a working `.env` from Lesson 02.2. This lesson turns it into a contract. You
will generate the eight WordPress salts plus `GRAPHQL_JWT_AUTH_SECRET_KEY` as nine independent
random values, write `wordpress-headless/.env.example` with every variable name present and
`__CHANGE_ME__` for every secret, and confirm that the real file is ignored — in that order,
because the order is the lesson. The full inventory is in
[appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv); this lesson
does not restate it, it teaches you how to hold it.

The ordering rule is the part to internalise: **set up the ignore rule before the secret
exists.** `git check-ignore -v wordpress-headless/.env` must print a match *before* you write a
value into that file, because a secret committed once is compromised in every clone and in the
object database forever — deleting it is not remediation, rotating it is. The second idea is
forward-looking. `next-app/` gets its own env file in Module 09, and it has a rule WordPress
does not: the `NEXT_PUBLIC_` prefix is an instruction to inline the literal value into
JavaScript that anyone can read. There is no such thing as a secret `NEXT_PUBLIC_` variable.
You learn the boundary now, four modules before you can violate it, because the anti-pattern
(`NEXT_PUBLIC_WORDPRESS_URL`) is in nearly every headless WordPress tutorial you will find
while searching for help.

By the end of this lesson you will have:

- `wordpress-headless/.env.example` — sectioned, every variable named, no value that is not a
  placeholder
- Nine independently generated 64-character secrets in an ignored `wordpress-headless/.env`
- `git check-ignore -v` output proving both `wordpress-headless/.env` and
  `next-app/.env.local` are ignored, before the second file exists
- A written explanation of why `GRAPHQL_JWT_AUTH_SECRET_KEY` must differ from `AUTH_KEY`
- The `NEXT_PUBLIC_` rule and the four variables that will ever legitimately carry the prefix
- `BTT_FRONTEND_URL` set to `http://host.docker.internal:3000`, ready for Module 18

## Classic WP Analogy

The WordPress.org salt generator is the closest thing you have used to this. You visited a URL,
it produced eight `define()` lines of random characters, you pasted them into `wp-config.php`,
and you understood — correctly — that rotating them logs every user out. All of that is
unchanged here. The salts are the same salts, they do the same job, and rotating them is still
the fastest way to revoke every session at once. What changes is the destination: the values go
into an ignored `.env` and reach PHP through `getenv()`, so the same `wp-config.php` serves
local, staging and production with three different sets of secrets.

The other familiar piece is your host's control panel. When you set a database password in
cPanel or through `fly secrets set`, you are doing what `.env` does locally — supplying a value
at runtime rather than storing it in code. `.env.example` is the missing half of that
arrangement: a tracked, reviewable list of *what must be supplied*, with no hint of what the
values are. It is documentation that fails loudly, because a missing variable becomes a startup
error rather than a subtly broken feature.

**Where the analogy breaks down:** Classic WordPress has exactly one process, so a secret is
either available to PHP or it is not, and PHP never ships anything to the browser that it did
not deliberately `echo`. This architecture has a second application with a **build step**, and a
build step can bake a value into a file it then serves to the public. That is a failure mode
with no Classic WordPress equivalent at all — nothing in `wp-config.php` can accidentally end
up in a JavaScript bundle, but `NEXT_PUBLIC_REVALIDATE_SECRET` would be in every visitor's
browser within one deploy, with no error, no warning and no log line. The prefix is the only
guardrail, and it is a naming convention.

---

## Key Concepts

### 1. Config in the environment, code in the repository

The rule comes from [the twelve-factor app](https://12factor.net/config): **anything that varies
between deployments is configuration, and configuration lives in the environment.** Not in code,
not in a committed file, not in a `switch` on the hostname.

The test for whether something is config is one question: *would this value be different on
someone else's machine, or in production?* If yes, it is config.

| Value | Config? | Where it goes |
|---|---|---|
| `WORDPRESS_DB_HOST` | yes | `.env` — `db:3306` locally, a private hostname on Fly.io |
| `WORDPRESS_DB_PASSWORD` | yes, **and secret** | `.env` locally, `fly secrets set` in production |
| `WP_HOME` | yes | `.env` — `http://localhost:8080` locally |
| The eight WordPress salts | yes, **and secret** | `.env`, and different in every environment |
| `$table_prefix = 'wp_'` | yes, but never varies here | `.env`, defaulted |
| The `incident` post type registration | **no** | `blame-the-tech-core`, in git (Module 03) |
| The redirect in `functions.php` | **no** | the theme, in git (Lesson 02.4) |

The payoff is that `wp-config.php` from Lesson 02.4 has **no branches**. There is no
`if ($_SERVER['HTTP_HOST'] === 'localhost')`. The same file runs locally, in CI and on Fly.io,
and the only thing that differs is the environment it reads. That is what makes Module 24's
deploy boring, and boring deploys are the goal.

> **The cost, stated plainly:** a missing variable is now a runtime failure rather than a
> compile-time one, and the error can be unhelpful. `WORDPRESS_DB_PASSWORD` unset produces
> "Error establishing a database connection" and nothing else. The mitigations are the
> `${VAR:?required}` guards you already wrote in Lesson 02.2 §6, and `.env.example` — a tracked,
> reviewable list of what must be supplied.

### 2. The ordering rule: the ignore rule exists before the secret does

This is the one habit in the module worth more than the rest combined, and it is a *sequence*,
not a syntax.

```
✅ CORRECT ORDER                         ❌ THE ORDER THAT LOSES A SECRET
─────────────────────────────────        ─────────────────────────────────
1. git check-ignore -v .env              1. write .env with real values
2. see a rule printed                    2. git add -A
3. NOW write the real values             3. git commit
4. git status  →  .env absent            4. notice
                                         5. git rm --cached .env  ← does NOT help
                                         6. rotate everything     ← the only fix
```

A secret that has been committed once is compromised even after you delete it, because it stays
in the object database, in every reflog, and in every clone anyone has pulled. `git rm --cached`
removes it from the *next* commit and from nothing else. History rewriting with `git filter-repo`
does not help either once the commit has been pushed, because you cannot recall a fetch.

**The remedy for a leaked secret is rotation, not deletion.** Assume it is public, generate a new
one, replace it everywhere, and — for the eight WordPress salts specifically — accept that every
user gets logged out, which is the point rather than a side effect.

> **`git check-ignore` prints nothing when a file is *not* ignored, and exits `1`.** That is the
> opposite of most tools, and it means "no output" is the failure case, not the success case.
> Read the output, not the exit status, and never assume silence means safety. This is exactly
> the check Lesson 02.2 Step 1 made you run before your first `.env` existed.

The rule and its four siblings are [appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules).
Read them there rather than here; this lesson is the drill, that file is the contract.

### 3. `.env` and `.env.example` — the only env file in git is the one with no values

`.gitignore` in this repo ignores every real env file and then re-includes exactly one:

```
.env
.env.*
!.env.example
```

Order matters. Git evaluates patterns top to bottom and the **last matching pattern wins**, so
the negation must come after the broad ignore. Reverse those three lines and `.env.example`
becomes untracked with no error, no warning, and no way to notice until a colleague clones the
repo and has nothing to copy from.

| | `.env` | `.env.example` |
|---|---|---|
| In git | **never** | **always** |
| Contains | real values | variable **names** and `__CHANGE_ME__` |
| Who writes it | you, once per machine | whoever adds a variable |
| Reviewed | no | yes, in the pull request that adds the variable |
| If it is missing | the stack fails to start | nobody knows which variables exist |

> **Never put a plausible-looking fake value in `.env.example`.** Not
> `WORDPRESS_DB_PASSWORD=changeme123`, not a 64-character string you generated and then decided
> was "only an example". A value that looks real gets copied into production by someone in a
> hurry at 18:00 on a Friday, and now production is running a credential that is published in
> your repository. `__CHANGE_ME__` cannot be mistaken for a working value, and a stack that
> refuses to boot with it is a stack that told you what was wrong.

The second job of `.env.example` is documentation that cannot rot: adding a variable to
`wp-config.php` without adding it to `.env.example` is visible in code review, because the
reviewer can see one file changed and not the other.

### 4. Nine secrets, not eight: the salts plus a separate JWT key

WordPress uses eight independent random values. You have generated them before, from the
WordPress.org generator, and pasted them into `wp-config.php`.

| Constant | Signs / obscures |
|---|---|
| `AUTH_KEY`, `AUTH_SALT` | the non-SSL auth cookie |
| `SECURE_AUTH_KEY`, `SECURE_AUTH_SALT` | the SSL auth cookie |
| `LOGGED_IN_KEY`, `LOGGED_IN_SALT` | the "logged in" cookie |
| `NONCE_KEY`, `NONCE_SALT` | nonces, and password-reset keys |

And this project adds a ninth, which is **not** a WordPress salt and must **not** share a value
with one:

| Constant | Signs | Held by |
|---|---|---|
| `GRAPHQL_JWT_AUTH_SECRET_KEY` | the JWTs WPGraphQL issues to the front end | **WordPress only** |

The reason is blast radius, and it is worth being concrete about:

```
        SAME VALUE                              DIFFERENT VALUES
   ┌──────────────────────┐               ┌──────────────────────┐
   │  AUTH_KEY  ==  JWT   │               │  AUTH_KEY            │  wp-admin sessions
   └──────────┬───────────┘               └──────────────────────┘
              │                           ┌──────────────────────┐
   a leak in the API layer                │  GRAPHQL_JWT_…_KEY   │  API tokens
   forges wp-admin sessions               └──────────────────────┘
              │                                      │
              ▼                                      ▼
   full site compromise                   an API-layer leak forges API
                                          tokens, and nothing else
```

If one value signs both, then anything that leaks one leaks both, and a mistake in a GraphQL
resolver becomes an administrator session. Two values means the API layer and the admin layer
fail independently. This is [appendix 04 §5](../appendix/04-env-reference.md#5-why-graphql_jwt_auth_secret_key-must-differ-from-auth_key),
and it is a five-second decision that you make once.

Related, and stated fully in Lesson 15.5: **Next.js never holds
`GRAPHQL_JWT_AUTH_SECRET_KEY` at all.** Next could verify JWTs locally, but then Vercel would
hold WordPress's signing secret, and a Vercel compromise could mint valid WordPress
administrator tokens. Next treats the token as opaque.

> **Rotating the eight salts logs every user out immediately.** That is not a bug — it is the
> incident-response procedure. If you suspect session theft, rotating salts is how you revoke
> every session at once, and Module 24 walks the rotation. Knowing this now is why you generate
> them with `openssl` instead of pasting from a web page: a value that came from your machine
> can be regenerated on your machine, at 3 a.m., without a browser.

### 5. Two applications, two env files, one shared pair of values

`next-app/` gets its own env file in Module 09. It is a *separate* file with a *separate*
lifecycle, and only two values legitimately appear in both.

```
   wordpress-headless/.env               next-app/.env.local
   (gitignored)                          (gitignored, from Module 09)
   ┌───────────────────────────┐         ┌───────────────────────────┐
   │ WORDPRESS_DB_*            │         │ WP_GRAPHQL_ENDPOINT       │
   │ WP_HOME  WP_SITEURL       │         │ WP_REST_BASE              │
   │ 8 salts                   │         │                           │
   │ GRAPHQL_JWT_AUTH_SECRET…  │◀── ✗ ──▶│ (never)                   │
   │ BTT_APP_TOKEN             │◀── = ──▶│ WP_APP_TOKEN              │  must match
   │ BTT_REVALIDATE_SECRET     │◀── = ──▶│ REVALIDATE_SECRET         │  must match
   │ BTT_FRONTEND_URL          │         │ NEXT_PUBLIC_SITE_URL      │
   └───────────────────────────┘         └───────────────────────────┘
     read by PHP via getenv()              read by Node via process.env
```

The two matched pairs are shared secrets for server-to-server calls — one identifies the Next
application to WordPress (`X-BTT-App-Token`, Module 16), the other is the HMAC key for the
revalidation webhook (Module 18). Both are introduced properly in their own modules; the full
inventory is [appendix 04 §2 and §3](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv),
and this lesson deliberately does not restate it, because two copies of a variable list drift.
What matters now is the shape: **the same name never appears on both sides.** `BTT_APP_TOKEN` in
WordPress, `WP_APP_TOKEN` in Next. That looks like pointless friction until you are debugging a
mismatch and need to know instantly which application a variable belongs to.

### 6. `NEXT_PUBLIC_` is an instruction, not a hint

You cannot violate this yet — there is no `next-app/` until Module 09 — and that is exactly why
it is taught now. By the time you *can* violate it you will be four modules deep in a build, and
every headless WordPress tutorial you find while searching for help will be violating it.

The prefix does not mean "this is probably fine to expose". It is an instruction to the bundler:

```
   next-app/.env.local                 next build                  .next/static/chunks/*.js
   ┌────────────────────────┐                                      ┌────────────────────────┐
   │ REVALIDATE_SECRET=…    │──── stays on the server ────▶ ✗      │                        │
   │ WP_APP_TOKEN=…         │──── stays on the server ────▶ ✗      │                        │
   │ NEXT_PUBLIC_SITE_URL=… │──── literal text substitution ──────▶│ "http://localhost:3000"│
   └────────────────────────┘                                      └────────────────────────┘
                                                                    served to every visitor,
                                                                    cached by every CDN
```

Three consequences worth holding:

| Fact | Consequence |
|---|---|
| The value is inlined as a **literal** at build time | Rotating it requires a rebuild, not a restart |
| The value ships in a public asset | **There is no such thing as a secret `NEXT_PUBLIC_` variable** |
| There is no warning | No build error, no lint failure, no log line. The only guardrail is the name. |

[Appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-four-of-them) lists
the only four variables in this application that will ever carry the prefix, each with a written
justification. Nothing else. Ever. Module 09 adds a `grep` over `.next/static/` proving no
server-only value reached the bundle, and Module 24 makes it a CI gate.

> **The named anti-pattern is `NEXT_PUBLIC_WORDPRESS_URL`.** Almost every headless WordPress
> tutorial defines it, so the browser can query `/graphql` directly. Learn to recognise it as a
> smell rather than a pattern, because you will meet it in the first search result for every
> problem you have in Modules 09 to 16.

### 7. Why the WordPress endpoint URL is server-only

`WP_GRAPHQL_ENDPOINT` is not a secret. It still has no prefix, deliberately, and the reasoning is
architectural rather than about secrecy.

| If the browser holds the endpoint | If only the Next server holds it |
|---|---|
| You need a CORS policy on `/graphql` | **No CORS configuration anywhere in this course** |
| Introspection is reachable from the app's own traffic | The public surface is Next's routes only |
| Anyone can issue arbitrary queries at your origin | Only queries you wrote are ever executed |
| Rate limiting must live at the WordPress origin | Rate limiting lives at Vercel's edge |

That is why [appendix 03 §8](../appendix/03-content-model-reference.md#8-plugin-inventory)
deliberately does **not** install WPGraphQL CORS: there is no CORS policy to get wrong because
the browser never talks to `/graphql` at all.

And the honest caveat, because pretending otherwise would teach you the wrong lesson: media
`sourceUrl` values are public, so the WordPress host is discoverable regardless. Keeping the
endpoint server-only removes it from your client bundle and from the app's own traffic — it is
**not** obscurity-as-security, and the real controls are persisted queries, depth and complexity
limits, and edge rate limiting, all listed in
[appendix 04 §6](../appendix/04-env-reference.md#6-the-honest-caveat-about-hiding-the-wordpress-origin)
and all taught in Module 24.

### 8. Where secrets come from, per target

Local development is the only place a secret sits in a file on disk, and even there the file is
gitignored and machine-local. Everywhere else it is injected at runtime by a secret store.

| Target | Mechanism | The rule |
|---|---|---|
| Local WordPress | `wordpress-headless/.env` + `env_file:` | Never a literal in a committed compose file |
| Local Next (Module 09) | `next-app/.env.local` | Only `.env.example` is tracked |
| **A Docker image** | **nothing, ever** | `docker history` prints build args and every layer sits in the registry |
| Fly.io (Module 24) | `fly secrets set` | `fly.toml` `[env]` holds only non-secret config |
| Vercel (Module 24) | project environment variables | Preview and Production get **different** values |
| GitHub Actions | repository/environment secrets | CI never needs a WordPress credential at all |
| Your own shell | injected into the live session | **Never** persisted to `.zshrc`, `.bashrc` or any dotfile |

The last row is the one people ignore. The admin password you generated in Lesson 02.2 Step 8
lived in one shell session and died with it, on purpose. A token in `.zshrc` is a token in a file
that is backed up, synced, shared in dotfile repositories and read by every process you run. Your
password manager is the store; the session environment is the transport.

> **CI never holds a WordPress credential**, and that is a design property rather than luck.
> `wordpress-headless/schema.graphql` is committed, so `npm run codegen:check` regenerates types
> from a file instead of introspecting a live site —
> [appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target).

---

## Task

You already have a working `.env` from Lesson 02.2 with the two database passwords in it. You are
now going to add the nine remaining secrets, write the tracked `.env.example`, and prove that
nothing secret is staged — in that order, because the order is the lesson.

Run everything from `wordpress-headless/`.

### Step 1: Prove the ignore rules before generating anything

```bash
cd wordpress-headless

# The file that must be ignored
git check-ignore -v .env

# The file Module 09 will create — checked now, four modules early, on purpose
git check-ignore -v ../next-app/.env.local

# And the one file that must NOT be ignored
git check-ignore -v .env.example ; echo "exit=$?"
```

**Verify §1:**

- [ ] The first command names a rule — `.gitignore:72:.env` is line 72 of the root file, the
      first of the three lines quoted in Key Concept 3.
- [ ] The second names a rule too, even though `next-app/.env.local` does not exist yet. An
      ignore rule for a file that does not exist is the correct state — that is what "before the
      secret exists" means.
- [ ] The third prints **no output** and `exit=1`. That is the `!.env.example` negation winning.
      If it instead names a rule, your `.gitignore` has the negation before the broad ignore, and
      Step 4 would silently produce an untracked file.

### Step 2: Generate nine independent secrets

Nine values, each generated separately. Do not generate one and reuse it, and do not paste from
a web page.

```bash
for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY \
         AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT \
         GRAPHQL_JWT_AUTH_SECRET_KEY; do
  printf '%s=%s\n' "$k" "$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64)"
done
```

That prints nine `KEY=<64 characters>` lines. `tr -d '=+/'` strips the base64 characters that
would need quoting inside a `.env` file, and `cut -c1-64` gives every value the same length.

Two more tokens, which Modules 16 and 18 will use and which
[appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv) already
reserves names for. Generating them now means the two applications never have to be
reconfigured mid-module:

```bash
printf 'BTT_APP_TOKEN=%s\n'         "$(openssl rand -base64 36 | tr -d '\n=+/' | cut -c1-48)"
printf 'BTT_REVALIDATE_SECRET=%s\n' "$(openssl rand -base64 36 | tr -d '\n=+/' | cut -c1-48)"
```

> **Those eleven generated lines are now in your terminal scrollback.** That is acceptable — they are on
> your machine and about to be in a gitignored file on the same machine. What is *not*
> acceptable is pasting them into a chat message, a ticket, a lesson file, or a shell startup
> script. Close the terminal when you are done, and if your shell records history to disk, clear
> the entries.

### Step 3: Write the full `.env`

Paste the eleven generated lines into the file below, replacing every `__CHANGE_ME__`. Keep the
two database passwords you already generated in Lesson 02.2 — do not regenerate them, or MySQL
(which stored the user with the old one in `btt-db-data`) will stop accepting connections.

```dotenv
# wordpress-headless/.env
#
# GITIGNORED. Never commit this file. Every value here is machine-local.
# The full inventory, with which variables are secret and why, is the contract in
# .lessons/appendix/04-env-reference.md — this file does not duplicate it.

# ── Database ─────────────────────────────────────────────────────────
MYSQL_DATABASE=btt
MYSQL_USER=btt
WORDPRESS_DB_HOST=db:3306
WORDPRESS_DB_NAME=btt
WORDPRESS_DB_USER=btt
WORDPRESS_TABLE_PREFIX=wp_

# Kept from Lesson 02.2. Do NOT regenerate — the MySQL volume remembers them.
WORDPRESS_DB_PASSWORD=__CHANGE_ME__
MYSQL_ROOT_PASSWORD=__CHANGE_ME__

# ── URLs ─────────────────────────────────────────────────────────────
# Both point at WORDPRESS, not at Next. Lesson 02.4 Key Concept 3.
WP_HOME=http://localhost:8080
WP_SITEURL=http://localhost:8080

# Where WordPress finds Next. Not localhost — Next runs on the HOST.
BTT_FRONTEND_URL=http://host.docker.internal:3000

# ── Environment and debugging ───────────────────────────────────────
WP_ENVIRONMENT_TYPE=local
WORDPRESS_DEBUG=1
DISALLOW_FILE_EDIT=false
DISALLOW_FILE_MODS=false

# ── The eight WordPress salts ───────────────────────────────────────
# Nine INDEPENDENT values from Step 2. Never reuse one for two variables.
# Rotating these logs every user out — that is the revocation procedure.
AUTH_KEY=__CHANGE_ME__
SECURE_AUTH_KEY=__CHANGE_ME__
LOGGED_IN_KEY=__CHANGE_ME__
NONCE_KEY=__CHANGE_ME__
AUTH_SALT=__CHANGE_ME__
SECURE_AUTH_SALT=__CHANGE_ME__
LOGGED_IN_SALT=__CHANGE_ME__
NONCE_SALT=__CHANGE_ME__

# ── The ninth secret: NOT a WordPress salt ──────────────────────────
# Signs the JWTs WPGraphQL issues to Next (Module 15). MUST differ from
# AUTH_KEY — separate blast radius. Next never holds this value.
GRAPHQL_JWT_AUTH_SECRET_KEY=__CHANGE_ME__

# ── Server-to-server credentials (Modules 16 and 18) ────────────────
# BTT_APP_TOKEN mirrors WP_APP_TOKEN in next-app/.env.local.
# BTT_REVALIDATE_SECRET mirrors REVALIDATE_SECRET there.
BTT_APP_TOKEN=__CHANGE_ME__
BTT_REVALIDATE_SECRET=__CHANGE_ME__

# ── Mail: captured by Mailpit, never delivered ──────────────────────
BTT_SMTP_HOST=mailpit
BTT_SMTP_PORT=1025
```

**Verify §3:**

- [ ] No `__CHANGE_ME__` remains: `grep -c '__CHANGE_ME__' .env` prints `0`.
- [ ] All nine generated values are different from each other:
      `grep -E '^(AUTH_KEY|SECURE_AUTH_KEY|LOGGED_IN_KEY|NONCE_KEY|AUTH_SALT|SECURE_AUTH_SALT|LOGGED_IN_SALT|NONCE_SALT|GRAPHQL_JWT_AUTH_SECRET_KEY)=' .env | cut -d= -f2- | sort -u | wc -l`
      prints `9`. **If it prints anything less, you reused a value.**
- [ ] `git status --short` does **not** mention `.env`.

### Step 4: Write the tracked `.env.example`

Same variables, same order, same section comments — and not one real value. This is the file
that goes in git.

```dotenv
# wordpress-headless/.env.example
#
# Copy to .env and fill in.  NEVER commit .env.
# Generate every __CHANGE_ME__ yourself; do not ask a colleague for theirs, and
# do not copy them between environments. Local, staging and production each get
# their own values — see .lessons/appendix/04-env-reference.md.
#
#   for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY \
#            AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT \
#            GRAPHQL_JWT_AUTH_SECRET_KEY; do
#     printf '%s=%s\n' "$k" "$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64)"
#   done

# ── Database ─────────────────────────────────────────────────────────
MYSQL_DATABASE=btt
MYSQL_USER=btt
WORDPRESS_DB_HOST=db:3306
WORDPRESS_DB_NAME=btt
WORDPRESS_DB_USER=btt
WORDPRESS_TABLE_PREFIX=wp_
WORDPRESS_DB_PASSWORD=__CHANGE_ME__
MYSQL_ROOT_PASSWORD=__CHANGE_ME__

# ── URLs. Both WP_* values point at WORDPRESS, not at Next ──────────
WP_HOME=http://localhost:8080
WP_SITEURL=http://localhost:8080
BTT_FRONTEND_URL=http://host.docker.internal:3000

# ── Environment and debugging. Production: local=production, debug=0 ─
WP_ENVIRONMENT_TYPE=local
WORDPRESS_DEBUG=1
DISALLOW_FILE_EDIT=false
DISALLOW_FILE_MODS=false

# ── Eight WordPress salts. Nine independent values, 64 chars each ───
AUTH_KEY=__CHANGE_ME__
SECURE_AUTH_KEY=__CHANGE_ME__
LOGGED_IN_KEY=__CHANGE_ME__
NONCE_KEY=__CHANGE_ME__
AUTH_SALT=__CHANGE_ME__
SECURE_AUTH_SALT=__CHANGE_ME__
LOGGED_IN_SALT=__CHANGE_ME__
NONCE_SALT=__CHANGE_ME__

# ── The ninth: MUST DIFFER from AUTH_KEY. Next never holds it ───────
GRAPHQL_JWT_AUTH_SECRET_KEY=__CHANGE_ME__

# ── Server-to-server credentials (Modules 16, 18) ───────────────────
BTT_APP_TOKEN=__CHANGE_ME__
BTT_REVALIDATE_SECRET=__CHANGE_ME__

# ── Mail: Mailpit captures everything, delivers nothing ─────────────
BTT_SMTP_HOST=mailpit
BTT_SMTP_PORT=1025
```

**Verify §4:**

- [ ] `grep -c '__CHANGE_ME__' .env.example` prints `14` — thirteen placeholder values plus
      the one named in the header comment. Every secret is a placeholder and nothing else is.
- [ ] The two files have the same variable names in the same order:
      `diff <(grep -oE '^[A-Z_]+=' .env | sort) <(grep -oE '^[A-Z_]+=' .env.example | sort)`
      prints nothing.
- [ ] `git status --short` shows `.env.example` as new, and **only** `.env.example`.

### Step 5: Recreate the stack and confirm WordPress reads the salts

The container reads `.env` at start, so new variables need a recreate rather than a restart:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate wordpress
docker compose ps
```

Now confirm the constants arrived — **without printing them.** `wp config get AUTH_KEY` and
`wp config list` both echo the value to your terminal, so use assertions instead:

```bash
docker compose run --rm wpcli wp eval 'foreach ([
  "AUTH_KEY","SECURE_AUTH_KEY","LOGGED_IN_KEY","NONCE_KEY",
  "AUTH_SALT","SECURE_AUTH_SALT","LOGGED_IN_SALT","NONCE_SALT",
  "GRAPHQL_JWT_AUTH_SECRET_KEY",
] as $c) { printf("%-28s %s\n", $c,
  (defined($c) && strlen(constant($c)) >= 32) ? "ok" : "MISSING OR TOO SHORT"); }'
```

**Verify §5:**

- [ ] All nine lines say `ok`. A `MISSING OR TOO SHORT` means either the variable is absent from
      `.env` or `wp-config.php` is not reading it — check Lesson 02.4 Step 2.
- [ ] `docker compose ps` still shows four services running with `db` `(healthy)`.
- [ ] You did not run `wp config get` on a salt. If you did, the value is in your scrollback and
      your shell history; regenerate that one value and repeat Step 3 for it.

### Step 6: Commit the example, and only the example

```bash
git add wordpress-headless/.env.example
git status --short
git commit -m "feat(docker): document every WordPress env var in .env.example"
```

**Verify §6:**

- [ ] `git status --short` before the commit shows exactly one staged file.
- [ ] `git show --stat HEAD` lists `wordpress-headless/.env.example` and nothing else.
- [ ] `git log -p -1 | grep -c '__CHANGE_ME__'` is `14`, which is a nice way of saying the
      commit contains placeholders and zero secrets.

---

## Verification

```bash
cd wordpress-headless

# 1. The ignore rule exists for the real file...
git check-ignore -v .env
# Expected: a line naming a .gitignore rule. NO OUTPUT MEANS STOP.

# 2. ...and for the Next file that does not exist yet
git check-ignore -v ../next-app/.env.local
# Expected: a line naming a .gitignore rule

# 3. NEGATIVE: the example must NOT be ignored — the `!` negation wins
git check-ignore .env.example ; echo "exit=$?"
# Expected: no output, then exit=1

# 4. NEGATIVE: no real env file is tracked, anywhere in the repo
git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example'
# Expected: NO OUTPUT. Any line here is a committed secret — rotate it, do not just delete it.

# 5. NEGATIVE: nothing secret is staged or modified right now
git status --porcelain | grep -E '\.env$|\.env\.local$|wp-config\.php$'
# Expected: no output

# 6. The example contains ONLY placeholders — eleven of them, and no 40+ char value
grep -c '__CHANGE_ME__' .env.example
# Expected: 14   — 13 placeholder values, plus the one in the header comment
grep -nE '=[A-Za-z0-9]{40,}' .env.example
# Expected: NO OUTPUT. A hit means a real value reached the tracked file.

# 7. The two files declare the same variables in the same order
diff <(grep -oE '^[A-Z_]+=' .env | sort) <(grep -oE '^[A-Z_]+=' .env.example | sort)
# Expected: no output

# 8. The real file has no placeholders left, and nine DISTINCT secrets
grep -c '__CHANGE_ME__' .env
# Expected: 0
grep -E '^(AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(KEY|SALT)=|^GRAPHQL_JWT_AUTH_SECRET_KEY=' .env \
  | cut -d= -f2- | sort -u | wc -l
# Expected: 9   — fewer means you reused a value for two variables

# 9. WordPress actually received them, asserted without printing any of them
docker compose run --rm wpcli wp eval 'foreach ([
  "AUTH_KEY","SECURE_AUTH_KEY","LOGGED_IN_KEY","NONCE_KEY","AUTH_SALT",
  "SECURE_AUTH_SALT","LOGGED_IN_SALT","NONCE_SALT","GRAPHQL_JWT_AUTH_SECRET_KEY",
] as $c) { printf("%-28s %s\n", $c, (defined($c) && strlen(constant($c)) >= 32) ? "ok" : "FAIL"); }'
# Expected: nine lines, all "ok"

# 10. NEGATIVE: the JWT key is NOT the same value as AUTH_KEY
docker compose run --rm wpcli wp eval 'echo (GRAPHQL_JWT_AUTH_SECRET_KEY !== AUTH_KEY)
  ? "distinct — correct" : "IDENTICAL — regenerate one of them", PHP_EOL;'
# Expected: distinct — correct

# 11. NEGATIVE: no secret leaked into the merged Compose configuration
docker compose -f docker-compose.yml -f docker-compose.dev.yml config | grep -c 'CMD-SHELL'
# Expected: 1
docker compose -f docker-compose.yml -f docker-compose.dev.yml config | grep -A1 'CMD-SHELL'
# Expected: the literal string $MYSQL_ROOT_PASSWORD, not your password

# 12. The site still works with the new salts — you were logged out, which is correct
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/wp-admin/
docker compose run --rm wpcli wp option get blogname
# Expected: 302 (wp-admin redirects an unauthenticated visitor), then: Blame The Tech

# 13. The commit contains placeholders and nothing else
git show --stat HEAD | tail -3
# Expected: only wordpress-headless/.env.example changed
```

Checks 3, 4 and 6 are the three that matter. Check 3 catches a misordered `.gitignore`, check 4
catches a secret already in history, and check 6 catches the mistake almost everybody makes at
least once — pasting a real value into the file that is meant to have none.

## Control Questions

1. You wrote a real `WORDPRESS_DB_PASSWORD` into `.env`, committed it, noticed, and ran
   `git rm --cached .env && git commit`. Explain precisely what is still compromised and why,
   then state the only correct remediation and what it costs.
2. `git check-ignore -v .env.example` prints nothing and exits `1`, while
   `git check-ignore -v .env` prints a rule. Explain both results in terms of the three lines in
   `.gitignore`, and describe what would break if those three lines were reordered.
3. `AUTH_KEY` and `GRAPHQL_JWT_AUTH_SECRET_KEY` are both 64 random characters generated the same
   way. Give the concrete attack that becomes possible if they hold the same value, and say which
   application is deliberately never given the second one.
4. A colleague adds `NEXT_PUBLIC_WP_APP_TOKEN` so a client component can call WordPress
   directly. Describe exactly what happens at `next build`, why no error is raised, how you would
   detect it after the fact, and what the correct design is instead.
5. `.env.example` contains `WORDPRESS_DB_PASSWORD=__CHANGE_ME__` rather than a realistic-looking
   value. Give two independent reasons the placeholder is safer, and name the failure mode a
   realistic-looking value produces in a real team.

## Learn More

- [The Twelve-Factor App: Config](https://12factor.net/config) — the two pages this lesson's
  first Key Concept is an application of
- [`gitignore` in the Git reference](https://git-scm.com/docs/gitignore) — the pattern-precedence
  rules that make `!.env.example` work, and the directory caveat that makes it fail
- [`git check-ignore`](https://git-scm.com/docs/git-check-ignore) — read the exit-status section,
  because "no output" being the failure case surprises everyone once
- [WordPress: Editing wp-config.php — security keys](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/)
  — what each of the eight salts actually signs, in core's own words
- [`openssl rand`](https://docs.openssl.org/master/man1/openssl-rand/) — where your entropy comes
  from, and why `$RANDOM` is not an acceptable substitute
- [Next.js: Environment Variables](https://nextjs.org/docs/app/guides/environment-variables) —
  the `NEXT_PUBLIC_` inlining rule from the framework itself, before you can violate it
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
  — rotation, storage and injection, and a sober list of everything that leaks secrets
- [gitleaks](https://github.com/gitleaks/gitleaks) — the scanner Module 24 adds to CI; running it
  against your own history now is five seconds well spent
