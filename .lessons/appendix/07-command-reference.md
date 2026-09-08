# Appendix 07 — Command Reference

Every command the course uses, grouped by what you are trying to do. Bookmark this one.

Run Docker commands from `wordpress-headless/`, and npm commands from `next-app/`, unless a
line says otherwise.

---

## 1. Docker & the stack

```bash
# Start everything, rebuild if a Dockerfile changed
docker compose up -d --build

# Start and wait until healthchecks pass (what CI uses)
docker compose up -d --wait

# What is running, and is it healthy?
docker compose ps
# Expected: wordpress, db, adminer, mailpit — all "running", db "(healthy)"

# Follow logs — the single most useful debugging command in Module 02
docker compose logs -f wordpress
docker compose logs -f db
docker compose logs --tail=100 wordpress

# Stop, keeping data
docker compose down

# Stop and DESTROY the database and uploads volumes
docker compose down -v          # ⚠️ re-run `wp blame seed` afterwards

# Restart one service
docker compose restart wordpress

# A shell inside the container
docker compose exec wordpress bash

# Port already in use?
lsof -i :8080
```

## 2. WP-CLI

Always through the `wpcli` service. **The stock `wordpress` image has no WP-CLI** — that is why
`docker-compose.yml` declares a separate `wpcli` service (Lesson 02.2). It runs as `www-data`, so
`--allow-root` is neither needed nor valid.

```bash
# General shape
docker compose run --rm wpcli wp <command>

# A shorter alias — add to your shell for the duration of the course
alias wpx='docker compose run --rm wpcli wp'

# Core
wpx core version
wpx core update-db

# Plugins
wpx plugin list
wpx plugin install wp-graphql --activate
wpx plugin activate blame-the-tech-core
wpx plugin deactivate --all

# Users — password from the environment, never a literal
wpx user list
wpx user create reporter reporter@example.test --role=incident_reporter --user_pass="$BTT_REPORTER_PASSWORD"
wpx user update editor --user_pass="$BTT_EDITOR_PASSWORD"

# Content
wpx post list --post_type=incident --format=table
wpx term list scapegoat --format=table
wpx post meta list <ID>

# Rewrites — run after touching any rewrite slug
wpx rewrite flush --hard

# Caches
wpx cache flush
wpx transient delete --all

# The course's own commands (Module 04 onward)
wpx blame seed --fresh --yes         # --yes is required with no TTY (CI)
wpx blame reset
wpx blame ensure-languages
wpx blame fixture status             # (Module 12, dev/CI only) the seeder digest

# The fixture cache crosses the container boundary on stdin/stdout, so the file
# lives on the HOST and the container never touches it. -T is mandatory.
docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql
docker compose run --rm -T wpcli wp blame fixture load  < ../fixtures/seeded.sql

# GraphQL schema snapshot (Module 06 / 23)
wpx graphql generate-static-schema
```

## 3. Database

```bash
# Export / import
docker compose exec -T db mysqldump -u"$WORDPRESS_DB_USER" -p"$WORDPRESS_DB_PASSWORD" btt > backup.sql
docker compose exec -T db mysql -u"$WORDPRESS_DB_USER" -p"$WORDPRESS_DB_PASSWORD" btt < backup.sql

# Via WP-CLI (handles charset correctly)
wpx db export /tmp/btt.sql --add-drop-table
wpx db import /tmp/btt.sql
wpx db reset --yes             # ⚠️ drops every table

# A SQL prompt
wpx db cli

# One-off query
wpx db query "SELECT COUNT(*) FROM wp_posts WHERE post_type='incident';"

# The Module 02 performance drills
wpx db query "EXPLAIN SELECT p.ID FROM wp_posts p
  INNER JOIN wp_postmeta m ON p.ID = m.post_id
  WHERE p.post_type='incident' AND m.meta_key='downtime_minutes' AND m.meta_value > 60;"

wpx db query "SELECT SUM(LENGTH(option_value)) AS autoload_bytes
  FROM wp_options WHERE autoload='yes';"
# Expected: ideally under ~800000. This loads on EVERY GraphQL request.

# Moving a database between environments
wpx search-replace 'https://old.example' 'http://localhost:8080' --all-tables --dry-run
```

Adminer at <http://localhost:8081> is easier for `EXPLAIN` output — it renders the plan as a
table.

## 4. Next.js

```bash
nvm use                        # honours .nvmrc → Node 22

npm install
npm run dev                    # http://localhost:3000
npm run build
npm start                      # serve the production build locally

npm run lint
npm run lint:fix
npm run type-check             # tsc --noEmit

# GraphQL types (Module 10)
npm run codegen                # generate src/gql/ from schema.graphql
npm run codegen:check          # fail if src/gql/ is stale — this is the CI gate
npm run schema:pull            # refresh schema.graphql from a RUNNING WordPress

# Bundle analysis (Module 21)
npm run analyze

# Prove no secret reached the client bundle (Module 09 / 24)
npm run build && grep -r "$REVALIDATE_SECRET" .next/static/
# Expected: no output
```

## 5. Tests

```bash
# Unit — Vitest (Module 12, 23)
npm test                       # watch mode
npm run test:watch             # the explicit spelling of `npm test`
npm run test:run               # single pass
npm run test:coverage
npx vitest run src/lib/graphql/tags.test.ts   # one file
npx vitest run -t "rejects anonymous"      # one test by name

# E2E — Playwright (Module 12, 23)
npx playwright install --with-deps         # once
npx playwright test
npx playwright test --headed
npx playwright test --ui                   # the best debugging tool in the course
npx playwright test e2e/auth.spec.ts
npx playwright test --project=mutations
npx playwright show-report
npx playwright show-trace test-results/**/trace.zip
npx playwright codegen http://127.0.0.1:3000   # 127.0.0.1, not localhost — Lesson 12.3

# Update visual baselines — only if you add them. This course does NOT: Lesson 12.1
# rules out snapshotting rendered markup, and nothing here calls toHaveScreenshot().
npx playwright test --update-snapshots

# Reset the DB and warm caches before an E2E run
npm run e2e:reset

# PHP (Module 23) — from wordpress-headless/
#
# The stock `wordpress` image has no Composer, just as it has no WP-CLI. Lesson 03.1 adds a
# `composer` service for installing dependencies; the plugin directory is bind-mounted, so the
# vendor/ tree it produces is visible to the `wordpress` container, which does have PHP.
PLUGIN=wp-content/plugins/blame-the-tech-core

docker compose run --rm composer install                 # writes $PLUGIN/vendor/

docker compose exec -w /var/www/html/$PLUGIN wordpress php vendor/bin/pest
docker compose exec -w /var/www/html/$PLUGIN wordpress php vendor/bin/pest --filter=ScapegoatStats
docker compose exec -w /var/www/html/$PLUGIN wordpress php vendor/bin/phpcs
docker compose exec -w /var/www/html/$PLUGIN wordpress php vendor/bin/phpcbf     # auto-fix
docker compose exec -w /var/www/html/$PLUGIN wordpress php vendor/bin/phpstan analyse

# Blocks (Module 13) — from the blocks plugin dir
npm run start                  # watch build
npm run build
npm run lint:js                # wp-scripts lint-js
npm test                       # wp-scripts test-unit-js
```

## 6. Quality gates (Module 21, 22, 24)

```bash
# Lighthouse
npx lhci autorun
npx lhci autorun --collect.url=http://localhost:3000/en/incidents

# Accessibility
npx playwright test e2e/a11y.spec.ts

# Secrets
npx gitleaks detect --no-git --redact

# Container CVEs
trivy image ghcr.io/<owner>/btt-wp:latest --severity HIGH,CRITICAL

# Dependency licences — no GPL/AGPL in next-app
npx license-checker --production --summary
```

## 7. GraphQL from the terminal

```bash
# Anonymous query
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ generalSettings { title } }"}' | jq

# With variables
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query($n:Int!){ incidents(first:$n){ nodes { title slug } } }","variables":{"n":3}}' | jq

# Authenticated — get a token first
TOKEN=$(curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation(\$u:String!,\$p:String!){ login(input:{username:\$u,password:\$p}){ authToken } }\",\"variables\":{\"u\":\"reporter\",\"p\":\"$BTT_REPORTER_PASSWORD\"}}" \
  | jq -r '.data.login.authToken')

curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ viewer { name roles { nodes { name } } } }"}' | jq

# Prove the mutation rejects anonymous callers — always verify the negative
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation{ createIncident(input:{title:\"x\"}){ incident{ id } } }"}' | jq '.errors[0].message'
# Expected: a permission error. NOT a created incident.
```

> **Never put a token in a shell history file or a URL.** These examples read from environment
> variables that you inject into the session, not from anything on disk. See
> [appendix 04](04-env-reference.md).

## 8. Deployment (Module 24)

```bash
# Fly.io — WordPress
fly auth login
fly secrets set WORDPRESS_DB_PASSWORD=... GRAPHQL_JWT_AUTH_SECRET_KEY=...   # runtime only
fly secrets list                                   # names only, never values
fly deploy --image ghcr.io/<owner>/btt-wp:<sha> --strategy=bluegreen
fly logs
fly status
fly ssh console
fly volumes snapshots list <volume-id>

# Rollback to a previous immutable image
fly deploy --image ghcr.io/<owner>/btt-wp:<previous-sha>

# Vercel — Next.js
vercel link
vercel env pull .env.local                         # gitignored
vercel --prod
vercel deployments list
vercel promote <deployment-url>                    # rollback

# CI locally
gh workflow list
gh run watch
gh pr checks
```

## 9. Git

```bash
git add -A
git commit -m "feat(wp): register the incident post type"
# Conventional commits. Types: feat fix docs style refactor test chore ci perf
# Scopes: wp block graphql web auth i18n e2e ci docker seed deps

git commit -m "feat(graphql)!: rename Incident.scapegoats to Incident.blamedOn"   # breaking

# Confirm a file is ignored BEFORE you put a secret in it
git check-ignore -v next-app/.env.local
# Expected: a .gitignore match. No output = STOP and fix .gitignore.

# Find where you broke it
git bisect start
git bisect bad
git bisect good <lesson-commit>
```

## 10. Ports

| Port | Service |
|---|---|
| 3000 | Next.js dev server (on the host) |
| 8080 | WordPress + `/graphql` + `/wp-admin` |
| 8081 | Adminer |
| 8025 | Mailpit web UI |
| 1025 | Mailpit SMTP |
| 3306 | MySQL |
