# Module 23 — Testing Deep Dive & Agentic QA

## Prerequisites

Before starting this module you should have completed:

- **Module 12** — Vitest, Playwright and the deterministic seeder are already installed and green
- **Module 16** — the Server Actions and the moderation flow, which are the things worth testing
- **Module 18** — cache tags and revalidation, because ISR is what makes E2E tests flaky
- **Module 22** — accessibility, because the selector contract in Lesson 23.7 is the a11y work
  cashing in

> ⚠️ **Do not try to unit-test an async Server Component.** It cannot be done through React
> Testing Library, no configuration fixes it, and the hours you spend trying are the most
> commonly wasted hours in App Router testing. The rule is in Lesson 23.1 and repeated in 23.3:
> if a component is `async` or reads `cookies()` / `headers()`, unit-test the `lib/` function it
> awaits and cover the rendered output in Playwright.

## Starting State

Module 22 complete: zero serious axe violations, keyboard-navigable end to end.

```bash
# 1. The Module 12 suites are still green
cd next-app && npm test -- --run && npx playwright test --project=smoke
# Expected: both exit 0

# 2. The a11y gate passes
npx playwright test --project=a11y
# Expected: 0 critical, 0 serious across the six routes × three locales

# 3. The seeder is deterministic — same data, twice
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli wp blame seed --fresh --yes
# Expected: identical slugs and post dates as the previous run
```

## What You'll Learn

- **A testing strategy you can defend** — the pyramid applied to a two-application stack, and
  what belongs at each level
- **Component testing** — React Testing Library with `user-event`, and **MSW v2** as a typed fake
  WPGraphQL so component tests never touch a container
- **Testing the server** — `vi.mock('next/cache')` and `vi.mock('next/headers')` to test Server
  Actions and route handlers, including the negative cases that matter most
- **PHP unit tests** — **Pest** with **Brain Monkey**, testing plugin logic with WordPress mocked out
- **PHP integration tests** — **`wp-phpunit`** against a real MySQL, inside the existing Compose
  container, asserting registration, ACF field-group keys and resolver behaviour
- **The GraphQL contract** — a committed `schema.graphql`, codegen drift as a CI failure, and
  `@graphql-eslint` on every document
- **E2E depth** — `storageState` auth, read/mutation project separation, and the ISR
  cache-coherency gotcha that makes a passing test fail in a suite
- **Agentic QA** — Playwright MCP under real guardrails, charter-driven exploration, and the
  discipline of converting a finding into a deterministic spec a human reviewed

## What You'll Build

- `docs/testing-strategy.md` — the pyramid for this stack, with the RSC rule written down
- `tests/mocks/handlers.ts` — MSW v2 GraphQL handlers reused by every component test
- Component tests for the client islands, and unit tests for Server Actions and route handlers
  that prove the negatives: no JWT in a response body, zero GraphQL calls when unauthenticated
- `wordpress-headless/.../tests/Unit/` (Pest + Brain Monkey) and `tests/Integration/`
  (`wp-phpunit`), both runnable in the existing `wordpress` container
- A committed `schema.graphql` with a drift check, plus `@graphql-eslint` in the lint run
- A full `e2e/` suite: auth setup project, moderation → webhook → public list, draft preview,
  Polylang locale routing
- `.mcp.json` with an isolated, origin-restricted Playwright MCP server, a least-privilege
  `e2e_agent` WordPress user, and `.agent-artifacts/` gitignored
- `docs/agentic-qa.md` — the charters, the findings, and the honest-limits table
- Reviewed, hardened, checked-in specs for the bugs the agent actually found

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Testing Strategy & the Pyramid](01-testing-strategy-and-the-pyramid.md) | — | `docs/testing-strategy.md` and the RSC testing rule |
| 2 | [Component Testing with RTL & MSW](02-component-testing-with-rtl-and-msw.md) | RTL, `user-event`, MSW v2 | A typed fake WPGraphQL and the island tests |
| 3 | [Testing Server Components & Actions](03-testing-server-components-and-actions.md) | `vi.mock` of `next/cache`, `next/headers` | Server Action and route-handler tests, negatives first |
| 4 | [Testing WordPress PHP with Pest](04-testing-wordpress-php-with-pest.md) | Pest, Brain Monkey | Pure PHP unit tests with WordPress mocked |
| 5 | [WP Integration & GraphQL Contract Tests](05-wp-integration-and-graphql-contract-tests.md) | `wp-phpunit`, `graphql()`, `@graphql-eslint` | Registration, ACF-key and resolver tests; the schema gate |
| 6 | [E2E Depth: Auth, Preview & i18n](06-e2e-depth-auth-preview-and-i18n.md) | `storageState`, Playwright projects | The real E2E suite, and the ISR coherency fix |
| 7 | [Agentic QA: Guardrails & Setup](07-agentic-qa-guardrails-and-setup.md) | Playwright MCP, `.mcp.json` | An isolated agent, `e2e_agent`, the selector contract |
| 8 | [Agent-Driven Exploratory Testing](08-agent-driven-exploratory-testing.md) | Charters, traces | Real findings from a real exploration run |
| 9 | [From Agent Findings to Deterministic Specs](09-from-agent-findings-to-deterministic-specs.md) | Spec hardening, diff guards | Checked-in specs and the honest-limits table |

## The Agentic QA Architecture

Lesson 23.7 builds this. Every arrow that does not exist is as important as the ones that do.

```
┌──────────────────────────┐
│  Agent (Claude Code)     │   charter, not a script:
│  reads a CHARTER         │   "explore incident submission; try to publish
│  proposes a diff         │    without moderator approval; report surprises"
└────────────┬─────────────┘
             │ MCP (stdio)
             ▼
┌──────────────────────────────────────────────────────────┐
│  Playwright MCP server                                   │
│  --isolated            no persisted profile              │
│  --allowed-origins     localhost:3000;localhost:8080     │
│  --blocked-origins *   everything else refused           │
│  --save-trace          → .agent-artifacts/  (gitignored) │
│  drives the ACCESSIBILITY TREE, not screenshots          │
└────────────┬─────────────────────────────────────────────┘
             │ HTTP, localhost only
             ▼
┌───────────────────────┐        ┌──────────────────────────────┐
│  next-app :3000       │───────▶│  WordPress :8080 (Compose)   │
│  LOCAL, DISPOSABLE    │        │  seeded, resettable          │
│  E2E_MODE=1           │        │  login: e2e_agent            │
└───────────────────────┘        │  least privilege, password    │
                                 │  from a secret store at RUN   │
       ✗ production              │  time — never a committed file│
       ✗ real user data          └──────────────────────────────┘
       ✗ deploy secrets
       ✗ any non-localhost origin
```

## How to Work

1. **Work 23.1 through 23.6 in order before touching the agent.** The agent's output is only
   useful if you can convert it into a spec, and Lesson 23.9 assumes you can write one.
2. **Run the PHP tests inside the existing `wordpress` container.** One stack, one mental model,
   the same PHP version as production. Lesson 23.5 explains why, and gives `wp-env` the aside it
   needs so upstream Gutenberg documentation still makes sense.
3. **Point the agent at localhost and nothing else.** Lesson 23.7 comes before Lesson 23.8 on
   purpose: the guardrails are set up before the agent is ever given a task.
4. **Commit after every lesson.** `git commit -m "test(e2e): cover moderation through the revalidation webhook"`
