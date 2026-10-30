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
