# Module 07 — The JavaScript Toolchain & TypeScript

## Prerequisites

Before starting this module you should have completed:

- **Module 01** — Kickoff & the Headless Contract (Lesson 01.3 verified your Node version)
- **Module 05** — WPGraphQL Fundamentals
- **Module 06** — GraphQL API Design & Schema Extensions, all four lessons

The WordPress stack must be running, because Lesson 07.2's script queries it for real.

> ⚠️ **This module is not React and it is not Next.js.** There is no JSX, no component and no
> browser. Every example runs in Node, and every type you write models the content you built in
> Modules 03–06 — `Incident`, `Scapegoat`, `SeverityLevel`. Learning TypeScript and React
> simultaneously is the most common way people bounce off this stack, so the course separates
> them deliberately. React is Module 08.

## Starting State

Module 06 verified clean. The API is a designed contract, and `next-app/` holds exactly one
committed file.

```bash
# 1. The API is designed, not just exposed
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ blameScore incidentDetails{ environment } } } }"}'
# Expected: a numeric blameScore, and environment as an ENUM value like PRODUCTION

# 2. The schema snapshot from Lesson 06.3 lives on the WordPress side
git ls-files wordpress-headless/schema.graphql
# Expected: wordpress-headless/schema.graphql

# 3. Node matches .nvmrc
nvm use && node -v && npm -v
# Expected: v22.x.x, and an npm 10 or 11 line

# 4. Nothing has been scaffolded into next-app yet
ls next-app/
# Expected: README.md only. No package.json, no node_modules.
```

## What You'll Learn

- **Node and npm** — the runtime, `package.json`, semver ranges, `npm ci` versus `npm install`,
  the lockfile, and what `node_modules` actually is
- **ESM versus CommonJS** — `import`/`export` against `require()`, `"type": "module"`, and why
  the split still causes pain in 2026
- **The modern JavaScript you skipped** — `const`/`let`, arrow functions, destructuring, spread,
  template literals, array methods, optional chaining, nullish coalescing, and
  Promises with `async`/`await`
- **TypeScript fundamentals** — structural typing, `interface` versus `type`, unions, literal
  types, `strict` mode, and reading a compiler error properly
- **TypeScript for real code** — generics, **discriminated unions**, `unknown` versus `any`,
  narrowing, type guards and the utility types you will actually use
- **Lint and format** — **ESLint** flat config, **Prettier**, and **PHPCS** with the WordPress
  Coding Standards, so both languages in the repo are checked

## What You'll Build

- `next-app/package.json` — the first `npm init`, with scripts and pinned dependencies
- `next-app/scripts/blame.mjs` — a plain-ESM Node script that queries WPGraphQL and prints live
  incidents to your terminal
- `next-app/tsconfig.json` — `strict: true`, no exceptions, with every setting justified
- `next-app/src/types/content.ts` — the content model from
  [appendix 03](../appendix/03-content-model-reference.md) as hand-written TypeScript
- `next-app/eslint.config.mjs`, `next-app/.prettierrc` — flat ESLint config and formatting
- `blame-the-tech-core/phpcs.xml.dist` — WordPress Coding Standards over your plugin, beside
  the code it describes so both containers and a CI runner find it by auto-discovery

After this module `npm run lint`, `npm run type-check` and `composer phpcs` all pass, and
`node scripts/blame.mjs` prints real incidents out of your own WordPress install.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Node, npm & package.json](01-node-npm-and-package-json.md) | Node 22, npm, semver, lockfiles | `next-app/package.json` and a working script runner |
| 2 | [The Modern JavaScript You Skipped](02-modern-javascript-you-skipped.md) | ESM, destructuring, `async`/`await` | `next-app/scripts/blame.mjs` querying live WPGraphQL |
| 3 | [TypeScript Fundamentals](03-typescript-fundamentals.md) | `tsc`, structural typing, `strict` | `next-app/tsconfig.json` and the first typed modules |
| 4 | [TypeScript for Real Code](04-typescript-for-real-code.md) | Generics, discriminated unions, narrowing | `next-app/src/types/content.ts` |
| 5 | [Linting, Formatting & Editor Setup](05-linting-formatting-and-editor-setup.md) | ESLint flat config, Prettier, PHPCS | `eslint.config.mjs`, `.prettierrc`, `phpcs.xml.dist` |

## What Gets Typed, and Why It Is Hand-Written

Module 10 generates all of this from `schema.graphql` with graphql-codegen. You write it by
hand first, once, on purpose — a generated type you cannot read is worse than no type at all,
and the codegen output in Module 10 is dense.

| Type | Models | Teaches |
|---|---|---|
| `SeverityLevel` | The four `severity` terms | String literal unions |
| `IncidentEnvironment` | The enum from [§3](../appendix/03-content-model-reference.md#3-registered-graphql-enums) | Union types mirroring a GraphQL enum |
| `Scapegoat` | The term plus its `scapegoatProfile` | Optional properties, nested objects |
| `Incident` | The post plus `incidentDetails` | Composition, `readonly`, nullability |
| `Connection<T>` | Any WPGraphQL connection | Generics |
| `Block` | The six blocks as a tagged union | **Discriminated unions** |

> **`Block` is here for Module 14.** The discriminated union you write in Lesson 07.4 — one
> variant per block, distinguished by a literal `name` field — is exactly the type the
> `BlockRenderer` switches on when it renders editor-composed pages. Writing it now, against a
> content model you already understand, means Module 14 is about recursion and React rather than
> about a type system you have never used.

## How to Work

1. **Type the code. Do not copy-paste it.** This is the module where that rule matters most:
   the syntax is new, and muscle memory is the actual deliverable.
2. **Read the compiler errors slowly.** TypeScript's messages are long and usually correct. The
   habit of reading the *last* line of a long error first will save you hours in Modules 09–14.
3. **Keep `tsc --watch` running.** Immediate feedback is the entire point of a type checker;
   running it once at the end teaches you nothing.
4. **Commit after every lesson.** `git add -A && git commit -m "feat(next): typed content
   model"`. Confirm `node_modules/` never appears in `git status`.
