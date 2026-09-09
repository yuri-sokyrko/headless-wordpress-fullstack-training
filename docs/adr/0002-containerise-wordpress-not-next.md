<!-- docs/adr/0002-containerise-wordpress-not-next.md -->

# ADR 0002 — Containerise WordPress, run Next.js on the host

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Yuri Sokyrko
- **Supersedes:** —
- **Superseded by:** —

## Context

Local development needs a pinned PHP 8.3 with `mysqli`, `gd`, `exif`, `imagick` and `opcache`,
a real MySQL 8, an SMTP sink and a SQL console. None of that is reliably available from a host
package manager; all of it is available as an image. Next.js needs Node 22 — which `.nvmrc` plus
`nvm` already pins — plus a watcher firing thousands of times an hour across `node_modules`.

## Decision

The backend runs in Docker Compose and the front end does not. `wordpress-headless/` is five
services — `wordpress`, `db`, `adminer`, `mailpit` and an on-demand `wpcli` — declared in
`docker-compose.yml` and pinned to `wordpress:7.1-php8.4-apache` and `mysql:8.4`, while
`next-app/` runs on the host as `npm run dev` under the Node that `.nvmrc` selects. The direct
consequence, and the one that costs an afternoon when it is forgotten, is that WordPress cannot
reach Next at `localhost:3000` — inside a container `localhost` is that container. The address
is **`host.docker.internal:3000`**, which is why every service that talks outward carries an
`extra_hosts: ['host.docker.internal:host-gateway']` entry, and why Module 18's revalidation
webhook is configured with that hostname rather than the one in my browser's address bar.

## Alternatives Considered

| Alternative                            | How it would work                                                                                                                  | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both applications in Compose           | a `next` service with a bind mount for `src/`                                                                                      | Every file event has to cross the macOS file-sharing boundary, so Fast Refresh goes from instant to seconds and stays there. `node_modules` is the worse half — tens of thousands of small files that either live inside the mount and make `npm install` crawl, or live in an anonymous volume and are then invisible to my editor and to TypeScript. What I would gain is a Node version pin, which `.nvmrc` already gives me                                                                         |
| Neither in Docker (MAMP or host PHP)   | Homebrew PHP + MySQL, `npm run dev` alongside                                                                                      | The PHP version, its extension list, the MySQL version and every `php.ini` value stop being facts in git and become a preferences pane on one laptop, so "works on my machine" is unfalsifiable again. Module 24 could no longer promise that production runs the same base image as local — its `Dockerfile` builds `FROM wordpress:7.1-php8.4-apache`, the tag this decision pins — and I would have no `imagick` guarantee, no Mailpit sink, and no reproducible seed for the E2E suite in Module 23 |
| WordPress in Compose, Next on the host | Compose owns `wordpress`, `db`, `adminer`, `mailpit` and `wpcli`; `next-app/` runs under `npm run dev` with `nvm` reading `.nvmrc` | **Chosen.** The containerised half is the one where a pinned runtime prevents real, hard-to-diagnose bugs and where the file churn is a handful of PHP files; the host half is the one where a pinned runtime buys almost nothing and the file churn is continuous. What I pay is `host.docker.internal`, an unenforced Node version, and bind-mount latency on three directories — all of it below                                                                                                     |

## Consequences

### Positive

- **The backend runtime is a fact in the repository, not a memory.** PHP 8.4, the extension
  list, MySQL 8, `max_input_vars = 3000`, `memory_limit = 512M` — all of it is in
  `docker-compose.yml`, `php.ini` and `uploads.ini`, reviewable in a pull request and identical
  on a colleague's machine. `imagick` in particular is missing from a surprising number of
  hand-rolled PHP setups, and its absence shows up as broken image resizing rather than as an
  error.
- **Local and production share a base image, so Module 24 is a bump rather than a port.** The
  production `Dockerfile` starts `FROM wordpress:7.1-php8.4-apache` — the same tag running on my
  laptop — so a PHP-level surprise at deploy time is something I have already had a chance to
  meet locally.
- **Fast Refresh stays instant, because the watcher never crosses a VM boundary.** `next dev`
  reads and writes `node_modules` and `.next` on native APFS at native speed. This is the single
  largest quality-of-life difference in Modules 08 to 20, and it is invisible precisely because
  nothing is slow.
- **Development-only services cost nothing to add and nothing to remove.** Mailpit captures
  every `wp_mail()` so registration and lead notifications are inspectable and never leave my
  machine; Adminer is a 4 MB SQL console that renders `EXPLAIN` plans as a table for Lesson 02.3.
  Neither has a host install, neither needs uninstalling, and neither exists in production.
- **`npm` stays a normal command.** Installing a package, reading a stack trace, attaching a
  debugger and pointing an editor at the TypeScript server all work the way every Node tutorial
  says they do, with no `docker compose exec` prefix and no second filesystem to reason about.

### Negative

- **Bind-mounting `wp-content` on macOS is measurably slower than native filesystem access,**
  because every read crosses a filesystem translation layer. The affected directories are
  exactly three — `./wp-content/plugins`, `./wp-content/themes` and `./wp-content/mu-plugins` —
  and Module 03 notices first, when `docker compose run --rm composer install` writes a `vendor/`
  tree of thousands of small files through the mount. It is tolerable because the set is small
  and deliberate: `/var/lib/mysql`, `wp-content/uploads` and WordPress core are named volumes
  (`btt-db-data`, `btt-uploads`, `btt-wp-core`) running at native speed, and everything else is
  the container's disposable writable layer.
- **The local Next.js runtime is not pinned the way PHP is.** `.nvmrc` records the intended
  version but nothing enforces it — a colleague with Node 20 active gets a different dependency
  resolution and no error at install time. What would actually enforce it is `engine-strict=true`
  in an `.npmrc`, turning the `engines` field's warning into an install failure, or a version
  manager that switches automatically (Volta, or an `nvm` shell hook), or containerising the dev
  server and giving up everything above. The course accepts the risk because CI in Module 24 runs
  `actions/setup-node` with Node 22, so drift fails a pull request rather than production, and
  because the only local enforcement strong enough to be worth having is the one this ADR just
  rejected.
- **`localhost` means two different things depending on who is speaking, and nothing warns you.**
  From my browser WordPress is `localhost:8080`; from inside the `wordpress` container Next is
  `host.docker.internal:3000` and the database is `db:3306`. Getting it wrong produces
  `getaddrinfo … failed` or a connection refused, both of which name the symptom and not the
  cause, and both of which arrive in a container log rather than on screen.
- **The stack is asymmetric, so every runbook has two halves.** Starting work is
  `docker compose up -d` _and_ `npm run dev` in a second terminal; reading logs is
  `docker compose logs -f wordpress` _and_ the Next terminal. Onboarding, the Makefile in Lesson
  02.6 and the troubleshooting appendix all carry that split, and a newcomer who runs only one
  half sees a front end that renders with no data and no obvious reason.
- **The environment is split across two files with two loading mechanisms.**
  `wordpress-headless/.env` is read by Compose and interpolated into the container environment;
  `next-app/.env.local` is read by Next on the host. A value both sides need — the site URL, the
  revalidation secret — has to be written twice and can drift silently, which is why Lesson 02.5
  exists and why appendix 04 keeps a single inventory of both.

### Neutral

- **`extra_hosts: ['host.docker.internal:host-gateway']` is free on Docker Desktop and required
  on Linux.** Declaring it costs one line and makes the compose file portable to a colleague who
  is not on macOS, so it goes in from Lesson 02.2 even though nothing needs it until Module 18.
- **Module 24 does add a Next.js container, and it changes nothing here.** It exists purely as a
  smoke test that the production image builds; it is never the thing I develop against, so it
  neither restores symmetry nor reopens this decision.
- **The gap between "containerised" and "reproducible" is smaller than it looks but is not
  zero.** The image pins the distribution, PHP and Apache; it does not pin my kernel, my CPU
  architecture, or the contents of my database. `wp blame seed` in Module 04 exists to close the
  third of those, which is why the E2E suite in Module 23 can assert on actual content.

## Related

- ADR 0001 — the headless split (Lesson 01.3)
- Lesson 02.2 — the Compose file this decision produces
