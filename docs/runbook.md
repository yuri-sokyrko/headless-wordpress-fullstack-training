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

## The incident moderation queue

**Where.** `http://localhost:8080/wp-admin/edit.php?post_type=incident`. It defaults to
`post_status=pending` for anyone holding `publish_incidents`; the "All" link at the top of the
screen is the escape hatch.

**Who.** `editor` and `administrator`. `incident_reporter` has no `publish_incidents` capability
at all and is redirected away from wp-admin on `admin_init`, so there is nothing to configure and
nothing to audit.

**Approve** publishes the incident and sets `is_verified`. **Reject** returns it to `draft` — not
trash, so nothing is destroyed by a mis-click and an editor can still fix and publish it. Both send
the reporter a mail linking to `/{locale}/account`, never to wp-admin.

**Pausing submissions.** Site Settings → `incident_submission_open` → off. The submit page then
renders an explanatory panel and the Server Action refuses before it validates anything. It is a
content setting, not an authorisation control: a reporter with a valid JWT can still call
`createIncident` directly, and that is by design.

**After approving, the archive is stale.** The detail page appears immediately because it has never
been cached; `/en/incidents` and the scapegoat pages wait for the revalidate window. That gap closes
in Lesson 18.3, which signs a webhook from the same `transition_post_status` hook this queue uses.

**Rotating `BTT_LEAD_IP_HMAC_KEY`** (Lesson 16.3) makes every stored `ip_hash` unlinkable from every
new one. That is a deletion mechanism and it destroys abuse-detection history. Record the date here
when you do it.

**Fixture note.** Module 15's `map_meta_cap` filter withholds `create_incidents` from a reporter
whose `btt_verified` meta is not `1`. A seeded or pre-existing reporter has no such meta, so run
`wp user meta update reporter btt_verified 1` once after a fresh seed, or the submit form refuses a
correctly authenticated reporter with a permission error.
