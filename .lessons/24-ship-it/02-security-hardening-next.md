---
title: 'Security Hardening: Next.js'
module: 24
lesson: 2
teaches: [content-security-policy, security-headers, output-encoding, sanitisation-policy, server-action-csrf, rate-limiting, npm-audit, licence-compliance]
produces: ['next-app/next.config.ts', 'next-app/package.json']
requires: [24.1, 16.4, 14.3]
---

# Lesson 24.2 — Security Hardening: Next.js

## Quick Overview

The Next.js application is the part of the system the public actually talks to, and it holds the
session cookies. Its hardening is layered. **Headers first**: a Content Security Policy that
actually restricts script sources, plus `Strict-Transport-Security`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options`,
`Permissions-Policy` and a frame policy. CSP is the one that takes real work, because Next
inlines a small amount of bootstrap script and a naive `script-src 'self'` breaks the app — so
you generate a nonce per request in middleware and reference it, rather than reaching for
`'unsafe-inline'` and calling it done.

**Then the boundaries.** Zod at every entry point, because WordPress is not a trusted client and
neither is a form post. Output encoding by default, with `dangerouslySetInnerHTML` confined to
`src/components/blocks/RichText.tsx` and a strict sanitiser allowlist — one file, so a reviewer
can grep for the pattern and find exactly one hit. CSRF considerations on Server Actions,
including what Next gives you and what it does not. Rate limiting on every route handler that
does work, since `/api/revalidate` and `/api/auth/refresh` are unauthenticated by construction
until the signature or cookie is checked. Then `npm audit` in CI with a triage policy.

And **dependency licences**, which is a compliance control rather than a security one but belongs
in the same gate. `next-app` is proprietary application code, so **no GPL or AGPL dependency may
enter it** — a copyleft licence on a bundled library propagates its terms to what you distribute.
Meanwhile `wordpress-headless/wp-content/plugins/blame-the-tech-core` **is GPL, by design**,
because it is a WordPress plugin and derives from GPL code. Two directories in one repository
with genuinely opposite licence rules. Learn the distinction, then enforce it with an allowlist
per directory.

By the end of this lesson you will have:

- A nonce-based CSP in `next.config.ts` and `middleware.ts` — report-only first, then enforcing —
  plus the full security-header set, verified against the deployed response, not the config file
- A validation audit: every route handler, Server Action and webhook, each with a Zod schema at
  the boundary
- A written `dangerouslySetInnerHTML` policy and a lint rule keeping it to the one sanitising file
- Rate limiting on every route handler that does work, with the limits chosen and justified
- `npm audit` in CI with a triage and exception policy that is not "ignore everything"
- A per-directory licence allowlist: no GPL/AGPL in `next-app`, GPL required for the WordPress
  plugin, enforced as a check

## Classic WP Analogy

The escaping discipline transfers directly, and if you have written WordPress plugin code to
standard you already have the right reflexes.

| Classic WordPress | Next.js |
|---|---|
| `esc_html()`, `esc_attr()`, `esc_url()` | React escapes by default — the safe path is the default |
| `wp_kses_post()` on untrusted HTML | A sanitiser allowlist inside `RichText.tsx` |
| `wp_nonce_field()` + `check_admin_referer()` | Server Action origin checks and same-site cookies |
| `sanitize_text_field()` on `$_POST` | `zod.parse()` at the boundary |
| `$wpdb->prepare()` | No SQL here — but the same principle at the GraphQL variable layer |
| A security plugin adding headers | `headers()` in `next.config.ts`, versioned in git |
| GPL, because WordPress is GPL | **No GPL** — `next-app` is proprietary |

React's default escaping is a genuine improvement on the WordPress model: in PHP, forgetting
`esc_html()` produced working code with an XSS hole, so safety required vigilance on every
`echo`. In JSX, `{value}` is escaped and rendering raw HTML requires typing
`dangerouslySetInnerHTML` — a name chosen to be unpleasant. The unsafe path is opt-in, loud, and
greppable.

Where the analogy breaks is the licence row, and it is the one people get wrong because the
WordPress ecosystem's answer is so uniform. In WordPress, GPL is simply the water: core is GPL,
your plugin is GPL, the plugin you copied a helper from is GPL, and the only question anyone ever
asks is whether a JavaScript build artifact counts. Bringing that reflex into `next-app` is a real
problem. Bundling an AGPL library into a proprietary front end you distribute to every visitor's
browser is a licence violation with commercial consequences, and it happens by accident through a
transitive dependency nobody reviewed. **Two directories, two licence regimes, one repository** —
so the check has to be per-directory, and it has to run in CI, because no reviewer reads a
`package-lock.json` diff.

---

## Key Concepts

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
