# next-app/

**This directory is empty on purpose. You build it.**

> **There is no `create-next-app` step in this course.** It cannot run in a non-empty
> directory, and by Lesson 09.1 this one holds your Module 07 toolchain and your Module 08
> components. Lesson 09.1 installs `next` into the project you already have and hand-writes the
> four files the scaffold would have generated. If you scaffold this directory yourself you will
> get a different structure than the lessons assume, and Module 09 will fight you for five
> lessons.

Everything is inlined in the lessons. Go to
[`../.lessons/README.md`](../.lessons/README.md) and start at Module 01.

## Which module creates what

| Module | What lands here |
|---|---|
| 07 | `package.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`, `src/types/`, `scripts/blame.mjs` |
| 08 | `src/components/incidents/` — `IncidentCard`, `IncidentList`, the filter island (on fixtures) |
| 09 | `next` itself, `next.config.ts`, `src/app/[locale]/` route shells, `proxy.ts`, `src/app/api/health/route.ts` |
| 10 | `src/lib/graphql/{client,errors,tags}.ts`, `codegen.ts`, `src/graphql/` documents, `src/gql/` generated output, `error.tsx` / `loading.tsx` |
| 11 | `tailwind.config.ts`, `components.json`, `src/components/ui/` (shadcn), `src/components/layout/`, the `/hobt` shell |
| 12 | `vitest.config.ts`, `playwright.config.ts`, colocated `src/**/*.test.ts`, `e2e/smoke.spec.ts`, `e2e/global-setup.ts` |
| 14 | `src/components/blocks/` — `BlockRenderer.tsx`, `registry.ts`, one component per block, `RichText.tsx` |
| 15 | `src/lib/auth/{session,cookies,guards}.ts`, `src/actions/auth.ts`, `src/app/api/auth/refresh/route.ts` |
| 16 | `src/lib/validation/schemas.ts`, `src/actions/{incidents,leads}.ts`, `src/lib/rate-limit.ts`, the forms and dialogs |
| 17 | `src/app/api/preview/route.ts`, `preview/exit/route.ts`, `PreviewBanner` — the Faust spike lives in its own `faust-spike/` app and is deleted in Lesson 17.4 |
| 18 | `src/app/api/revalidate/route.ts`, per-route rendering config, `src/app/api/auth/session/route.ts` + `SessionMenu` (the session read moves out of the root layout so routes can be static again) |
| 19 | `generateMetadata` on every route, `src/lib/seo/yoastToMetadata.ts`, `app/sitemap.ts`, `app/robots.ts`, `opengraph-image.tsx` |
| 20 | `src/lib/i18n/{routing,request,navigation}.ts`, `src/messages/{en,uk,de}.json`, `LocaleSwitcher` |
| 21 | `lighthouserc.json`, `src/app/api/vitals/route.ts`, `src/components/layout/WebVitals.tsx`, `scripts/check-bundle-budget.mjs`, `next/font`, bundle-analyzer wiring nested inside `withNextIntl` |
| 22 | Accessibility fixes across `src/components/`, the severity-badge ink tokens and `--ring` in `src/app/[locale]/globals.css`, `FormErrorSummary`, `RouteFocus.tsx`, `e2e/a11y.spec.ts` and the `a11y` project |
| 23 | `tests/mocks/handlers.ts`, component tests, the full `e2e/` suite, `.mcp.json` |
| 24 | `next.config.ts` security headers and the CSP in `proxy.ts`, `src/lib/logger.ts`, `instrumentation.ts`, `vercel.json`, `scripts/check-patch-coverage.mjs` |

## Expected final tree

```
next-app/
├── package.json  tsconfig.json  next.config.ts        (M07, M09)
├── eslint.config.mjs  .prettierrc                     (M07)
├── tailwind.config.ts  components.json  postcss.config.mjs (M11)
├── codegen.ts                                         (M10) reads ../wordpress-headless/schema.graphql
├── vitest.config.ts  playwright.config.ts             (M12)
├── lighthouserc.json                                  (M21)
├── instrumentation.ts  instrumentation-client.ts      (M24) Sentry, server/edge and client
├── vercel.json                                        (M24)
├── .mcp.json                                          (M23) read when the workspace root is next-app/
├── .env.example                                       (M09) ← the ONLY env file in git
├── src/
│   ├── proxy.ts                                       locale + auth gate + token refresh
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── layout.tsx  page.tsx
│   │   │   ├── globals.css                            (M11) Tailwind entry point
│   │   │   ├── loading.tsx  error.tsx  not-found.tsx
│   │   │   ├── incidents/{page.tsx,[slug]/page.tsx,submit/page.tsx}
│   │   │   ├── scapegoats/{page.tsx,[slug]/page.tsx}
│   │   │   ├── blog/{page.tsx,[slug]/page.tsx}
│   │   │   ├── reviews/{page.tsx,[slug]/page.tsx}
│   │   │   ├── hobt/page.tsx
│   │   │   ├── (auth)/{login,register,verify}/page.tsx
│   │   │   ├── account/{layout.tsx,page.tsx}
│   │   │   ├── opengraph-image.tsx                    (M19) inside the segment: no
│   │   │   │                                          extension, so proxy would
│   │   │   │                                          307 a root-level one
│   │   │   └── [...slug]/page.tsx                     WP pages catch-all
│   │   ├── api/
│   │   │   ├── revalidate/route.ts                    (M18) HMAC-verified
│   │   │   ├── preview/route.ts  preview/exit/route.ts (M17)
│   │   │   ├── auth/refresh/route.ts                  (M15)
│   │   │   ├── vitals/route.ts                        (M21)
│   │   │   └── health/route.ts                        (M09)
│   │   ├── sitemap.ts  robots.ts  icon.svg            (M19) .xml/.txt/.svg bypass it
│   │   └── global-error.tsx
│   ├── actions/{auth,incidents,leads}.ts              'use server'
│   ├── components/
│   │   ├── ui/                                        shadcn — copied in, yours to edit
│   │   ├── blocks/                                    BlockRenderer + registry + one per block
│   │   ├── layout/                                    Header, Footer, MobileNav*, LocaleSwitcher*
│   │   ├── incidents/  scapegoats/  hobt/  preview/
│   │   └──                                            (* = 'use client')
│   ├── lib/{graphql,auth,validation,i18n,seo}/  rate-limit.ts  utils.ts
│   ├── graphql/                                       .graphql documents + fragments
│   ├── gql/                                           codegen output — COMMITTED
│   ├── messages/{en,uk,de}.json                       (M20)
│   └── types/                                         (M07) hand-written, replaced in M10
├── scripts/                                           blame.mjs (M07), check-tag-literals.mjs (M18),
│                                                      check-bundle-budget.mjs + bundle-baseline.json (M21),
│                                                      check-patch-coverage.mjs (M24)
├── e2e/                                               specs, fixtures, global-setup. Projects, in order:
│                                                      setup, smoke, mutations (M23), a11y (M22)
└── tests/mocks/                                       MSW handlers, the server harness, and the
                                                       `server-only` stub vitest.config.ts aliases (M23)
```

> **This tree lists every directory, but not every file.** Where a directory is named without
> its contents, lessons add files inside it — that is expected, and each lesson's front matter
> records exactly what it produces, in its `produces:` front matter. If a *directory* you have
> built is not listed here at all, you have drifted; check the module README's Starting State.

## Two things that surprise people

**`src/gql/` is committed, and the schema it generates from lives in the other app.**
Generated code in git feels wrong until you see why: CI regenerates from the committed
`wordpress-headless/schema.graphql` and fails if `src/gql/` is stale, which means **no CI job
ever needs a running WordPress or a database credential**. The schema sits on the WordPress
side because WordPress owns it — it is produced there by `wp graphql generate-static-schema`
in Lesson 06.3, and `codegen.ts` reads across with a relative path. Refreshing it is a
deliberate human action whose diff gets reviewed like any other change. Lesson 10.2 covers
it.

**The `[locale]` segment exists from Lesson 09.1**, with one locale, long before Module 20
teaches i18n. Adding it later would mean rewriting every route file. It is the cheapest
insurance in the whole course.

## Security ground rules for this directory

| Rule | Enforced by |
|---|---|
| No secret in a `NEXT_PUBLIC_` variable | `grep -r "$SECRET" .next/static/` in Lesson 09.5, then a CI gate in Module 24 |
| No token readable by JavaScript | Sessions are httpOnly cookies set by route handlers. Never `localStorage`. |
| `dangerouslySetInnerHTML` in exactly one file | `src/components/blocks/RichText.tsx`, sanitized with a strict allowlist |
| Every route handler and Server Action authenticated | The entry-point matrix in Lesson 15.5 |
| Server-only modules cannot be imported client-side | `import 'server-only'` in `src/lib/graphql/client.ts` and the credential-handling modules under `src/lib/auth/`. The pure helpers beside them — `tags.ts`, `errors.ts` — deliberately omit it so Module 12 can unit-test them in plain Node. |

See [the env reference](../.lessons/appendix/04-env-reference.md) for the full inventory.

---

**Start → [`../.lessons/07-javascript-toolchain-and-typescript/README.md`](../.lessons/07-javascript-toolchain-and-typescript/README.md)** (the first module that writes files here)
