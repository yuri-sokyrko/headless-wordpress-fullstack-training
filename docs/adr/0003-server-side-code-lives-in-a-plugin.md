<!-- docs/adr/0003-server-side-code-lives-in-a-plugin.md -->

# ADR 0003 — Server-side code lives in a plugin

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** Yuri Sokyrko
- **Supersedes:** —
- **Superseded by:** —

## Context

The content model — post types, taxonomies, custom statuses, roles, capabilities and the
GraphQL surface — has to survive a theme switch, load in a PHPUnit bootstrap with no theme
present, ship inside a production image, and be versioned as its own unit with its own
`composer.json`. The `btt-headless` theme is a redirect stub with one job, and the front end is
a separate application.

## Decision

Every server-side registration in this project lives in `blame-the-tech-core`, a plugin with its
own header, its own `composer.json` and PSR-4 autoloading, activated explicitly rather than
assumed. I rejected `functions.php`, the habit I brought from Classic WordPress, because a theme
is not the site here: every registration in it would vanish on a theme switch, could only be
disabled by switching themes, and could not be loaded by Module 23's test bootstrap without
dragging a template layer along with it. I rejected `mu-plugins` for the opposite reason — it is
always on, so it cannot be deactivated to isolate a bug, which is precisely the property I am
buying. The price is real and I am choosing to pay it: deactivate this plugin and the `incident`
post type stops existing, so the 40 seeded incidents in `wp_posts` become invisible to every
query, every wp-admin menu and every GraphQL field — the rows survive, access to them does not,
which is why Module 24's `release_command` activates plugins explicitly instead of trusting
whatever the database happens to say. The single exception is `000-btt-hardening.php` in Module
24, which earns its place in `mu-plugins/` because environment hardening has to run before any
plugin loads and must not be deactivatable by anyone with access to the plugins screen.

## Consequences

- Anything in the plugin's activation hook runs on **every** deploy, not once, because Fly.io's
  `release_command` activates the plugin each release with no human watching — so every hook
  body must be idempotent, and Lesson 04.5's migration runner exists for the cases where it
  cannot be.
- `Requires PHP: 8.1` in the header is a hard gate: WordPress refuses activation below it, which
  turns "deployed onto the wrong PHP" from a confusing runtime failure into a refusal at
  activation time.

## Related

- ADR 0001 — the headless split, which made the theme a stub (Lesson 01.3)
- Lesson 03.1 — the four questions that decide plugin versus theme
- Module 24 — the hardening mu-plugin, and the `release_command` that activates this plugin
