---
title: 'Node, npm & package.json'
module: 7
lesson: 1
teaches: [node-runtime, npm-and-semver, package-json-scripts, lockfiles, esm-vs-cjs]
produces: ['next-app/package.json']
requires: [1.3]
---

# Lesson 07.1 — Node, npm & package.json

## Quick Overview

Node is a JavaScript runtime — V8 plus a standard library for files, networking and processes —
and for the rest of this course it is what runs your front end, your build, your tests and your
scripts. `npm` is its package manager, and `package.json` is the manifest that declares your
dependencies, your scripts and your module system. This lesson creates the first real file in
`next-app/`, and it spends most of its time on the four things that actually cause trouble
later: semver ranges, the lockfile, `npm ci` versus `npm install`, and `"type": "module"`.

Semver deserves the attention. `^16.3.0` means "any 16.x at or above 16.3.0", which is a
*range*, which means two developers running `npm install` a week apart can get different code
from an identical `package.json`. `package-lock.json` is what makes the install reproducible by
recording the exact resolved version of every package in the tree, and `npm ci` is the command
that installs *from the lockfile* and fails if the two disagree — which is why CI uses `npm ci`
and never `npm install`. You will also see what `node_modules/` is: a very large,
entirely regenerable directory that must never be committed, already covered by the repository's
`.gitignore`. And you will set `"type": "module"` so that `.js` files are ES modules, because
the ESM/CommonJS split is the one piece of legacy in the Node ecosystem you cannot avoid.

By the end of this lesson you will have:

- `next-app/package.json` created with `npm init`, `"type": "module"`, and Node 22 pinned in
  `engines`
- A `scripts` block with `typecheck`, `lint`, `format` and `blame` entries, wired in later
  lessons
- `package-lock.json` generated and committed, with the difference from `package.json`
  understood
- `node_modules/` confirmed absent from `git status`
- A demonstrated difference between `npm install` and `npm ci`, including `npm ci` failing on a
  deliberately desynchronised lockfile
- A written note on `dependencies` versus `devDependencies` and why it matters for a production
  image

## Classic WP Analogy

You met almost all of this in Module 03 under a different name. `package.json` is
`composer.json`. `npm` is Composer. `node_modules/` is `vendor/`. `package-lock.json` is
`composer.lock`. `npm ci` is `composer install` with a lockfile present, while `npm install` is
closer to `composer update`. Caret ranges are Composer's `^` ranges, and they mean the same
thing. If you understood why `vendor/` is gitignored and `composer.lock` is not, you already
understand this lesson's central point — you just have not applied it to JavaScript yet.

The pre-Composer WordPress comparison is worth making too, because it explains why any of this
exists. Installing a plugin through wp-admin gives you a directory of code at whatever version
happened to be current, with no record of what you installed or how to get it again. That is
what dependency management replaces: a manifest that declares intent, and a lockfile that
records exactly what satisfied it. The reason this course pins plugin versions in the WP-CLI
bootstrap command is the same reason `npm ci` exists.

**Where the analogy breaks down:** `vendor/` in a typical WordPress project holds a handful of
libraries with shallow trees, and Composer's flat autoloader means one version of each package.
`node_modules/` for a Next.js application holds hundreds of megabytes across thousands of
packages, npm allows *multiple versions of the same package* to coexist at different depths in
the tree, and a transitive dependency four levels down can and does break your build. The scale
changes the practices: lockfile discipline that is merely good hygiene in Composer is
load-bearing in npm, `npm ci` in CI is not optional, and the supply-chain concern is real enough
that Module 24 adds dependency scanning to the pipeline. Nothing in Classic WordPress prepares
you for a dependency graph you cannot read in one sitting.
---

## Key Concepts

### 1. What Node actually is, and `node` versus `npx`

Node is V8 — the JavaScript engine out of Chrome — bolted to a C library called libuv for
non-blocking file and network I/O, plus a standard library (`node:fs`, `node:path`,
`node:crypto`, `fetch`, `URL`). That is the whole product. It is not a framework, it has no
opinion about HTTP routing, and it ships no template engine.

The mental model that transfers best is the PHP CLI, not `mod_php`:

| PHP | Node | Note |
|---|---|---|
| `php script.php` | `node script.mjs` | Run a file |
| `php -r 'echo 1+1;'` | `node -e 'console.log(1+1)'` | Run an expression |
| `php -a` | `node` (no arguments) | Interactive REPL |
| `composer.json` | `package.json` | The manifest |
| `vendor/` | `node_modules/` | Installed code, gitignored |
| `composer.lock` | `package-lock.json` | The resolved tree, committed |
| `vendor/bin/phpcs` | `node_modules/.bin/eslint` | Installed executables |
| `composer exec` | `npx` | Run an installed (or fetched) executable |

`node` runs your code. `npx` runs a **package's executable**, looking first in
`node_modules/.bin` and only then downloading a temporary copy from the registry. That second
behaviour is the one to be careful with:

```bash
npx tsc --version     # uses node_modules/.bin/tsc if installed — otherwise DOWNLOADS a copy
npm run type-check    # only ever runs what your package.json says, from your own node_modules
```

> **Prefer `npm run <script>` over `npx <tool>` for anything the project owns.** `npx` on a
> package you have not installed silently fetches whatever version is current today, which is
> the opposite of the reproducibility this whole lesson is about. `npx` is for one-off tools you
> deliberately do not want as a dependency — `npx license-checker` later in this lesson is
> exactly that case.

### 2. `nvm`, `.nvmrc`, and one Node version per project

Node is not backwards-compatible enough to ignore. `nvm` (Node Version Manager) keeps several
Node versions on your machine and switches the one on your `PATH` per shell session. This
repository already pins its version — you do not create this file, you read it:

```bash
cat .nvmrc
# Expected: 22
```

`nvm use` with no argument walks up from your current directory looking for `.nvmrc` and
switches to the version it names. That is the entire mechanism, and it is why the file is two
characters long.

```
   your shell                          ~/.nvm/versions/node/
   ┌──────────────────────┐            ┌──────────────────┐
   │ cd next-app          │            │ v20.19.0         │
   │ nvm use              │──reads────▶│ v22.20.0   ◀─────┼── PATH now points here
   │   → "Now using v22"  │  .nvmrc    │ v24.8.0          │
   └──────────────────────┘            └──────────────────┘
```

Two things about `nvm` that catch people:

- **It is a shell function, not a binary.** `which nvm` prints nothing. That means you cannot
  call it from a script or a `Makefile` in the usual way, and CI does not use it at all — GitHub
  Actions uses `actions/setup-node` with `node-version-file: .nvmrc`, which reads the same file.
  Module 24 wires exactly that, so the file is the single source of truth in both places.
- **It is per shell session.** A new terminal is back on your default version. If you have ever
  been baffled by a build that works in one tab and not another, this is usually why.

`engines` in `package.json` records the same requirement for anyone who does not use `nvm`. By
default npm only *warns* on a mismatch; it becomes an error if a project sets
`engine-strict=true` in an `.npmrc`. This course leaves it as a warning and relies on `.nvmrc`
plus the CI check, because a hard error here is a fight you have with a colleague's machine, not
with a bug.

### 3. `package.json`, field by field

Only some of it matters to you now. The rest exists for publishing to the registry, which you
will never do with this package.

| Field | Value here | Why |
|---|---|---|
| `name` | `btt-next-app` | Must be lowercase, URL-safe. Irrelevant unless published, but npm requires it. |
| `version` | `0.1.0` | Also only meaningful when publishing. Do not bump it by hand. |
| `private` | `true` | **Refuses to publish.** One word that makes an accidental `npm publish` of your application impossible. |
| `license` | `MIT` | Matches the repository's `LICENSE`. Load-bearing for Key Concept 9. |
| `type` | `module` | Every `.js` file in this package is an ES module. Key Concept 4. |
| `engines` | `node: ">=22.0.0 <23"` | Declares the runtime contract. |
| `scripts` | see Key Concept 5 | Named shell commands, run with `npm run`. |
| `dependencies` | `{}` for now | Needed **at runtime, in production**. |
| `devDependencies` | `typescript`, `@types/node` | Needed only to build, lint, test or type-check. Key Concept 10. |

Fields deliberately absent: `main` (nothing imports this package), `files`, `keywords`,
`repository`, `author` — all publishing metadata. `npm init -y` writes some of them; you will
delete them, because a field nobody reads is a field that will eventually be wrong.

### 4. `"type": "module"` — the one piece of Node legacy you cannot avoid

Node shipped in 2009 with its own module system, CommonJS: `require()` and `module.exports`.
ES modules — `import`/`export` — were standardised later and are what every tool, tutorial and
framework now uses. Node supports both, and decides which one a file is by its extension and by
`package.json`.

| File | With `"type": "module"` | Without it |
|---|---|---|
| `x.js` | ES module | CommonJS |
| `x.mjs` | ES module | ES module |
| `x.cjs` | CommonJS | CommonJS |

That is the whole rule. Setting `"type": "module"` once means `.js` means what you expect and
you never think about it again.

The differences that actually bite:

| | CommonJS | ES modules |
|---|---|---|
| Import | `const fs = require('node:fs')` | `import fs from 'node:fs'` |
| Export | `module.exports = { a }` | `export const a = …` |
| Conditional import | yes — `require()` is a function call | no — `import` is hoisted and static; use `await import()` |
| Top-level `await` | no | **yes** |
| `__dirname` | available | absent; use `import.meta.dirname` |
| Extension in relative paths | optional | **required** — `./util.js`, not `./util` |

The last row of that table is the one people trip over hardest coming from PHP, where
`require __DIR__ . '/inc/util'` never needed the extension either. In ESM, relative specifiers
are URLs, and URLs do not guess.

> **Why not just use CommonJS and avoid all this?** Because static `import` is what makes
> tree-shaking, `import type` erasure and the server/client boundary in Module 09 possible. A
> tool can see the whole dependency graph without executing a line of your code. `require()` can
> appear inside an `if`, so it cannot. That analysability is the entire point, and it is worth
> the extension you now have to type.

### 5. `scripts` are shell commands with a better `PATH`

An npm script is a string handed to your shell, with one addition: `node_modules/.bin` is
prepended to `PATH`. That is the whole feature, and it is why `"lint": "eslint ."` works even
though `eslint` is not installed globally.

```bash
npm run lint                 # runs the "lint" script
npm run                      # lists every script — surprisingly useful
npm run lint -- --fix        # everything after `--` is passed THROUGH to eslint
npm test                     # `test`, `start`, `stop` and `restart` may omit `run`
```

Composer's `scripts` block is the same idea, with the same "just a command line" nature. Two
npm-specific details worth knowing:

- **`pre`/`post` hooks.** A script named `prebuild` runs automatically before `build`. Convenient
  and, in a large project, a good way to make a build mysterious. This course uses none.
- **Exit codes are the contract.** A script that fails must exit non-zero, or CI will treat a
  broken build as a pass. Every script this module adds respects that, and the placeholder
  scripts you write in the Task deliberately exit `1` so that a lesson you have not reached yet
  cannot silently report success.

### 6. Semver ranges, and why a range is not a version

`"typescript": "^5.9.2"` is not a version. It is a **range**, and npm picks the highest published
version inside it at install time.

| Range | Accepts | Rejects | Read it as |
|---|---|---|---|
| `^5.9.2` | `5.9.3`, `5.14.0` | `6.0.0`, `5.9.1` | "compatible with 5.9.2" — minor and patch may move |
| `~5.9.2` | `5.9.3`, `5.9.99` | `5.10.0` | "patches only" |
| `5.9.2` | `5.9.2` | everything else | exact pin |
| `>=5.9.2` | anything newer, forever | nothing | almost always a mistake |
| `*` / `latest` | anything | nothing | a bug waiting for a release |

The special case that surprises everyone: for `0.x` versions, **the minor is treated as the
breaking position**. `^0.3.1` accepts `0.3.9` and rejects `0.4.0`. Pre-1.0 packages break in
minors, and semver encodes that.

```
package.json                 registry (grows over time)              package-lock.json
"typescript": "^5.9.2"       5.9.2   5.9.3   5.11.0   6.0.0          "version": "5.9.3"
        │                      ·       ·        ·        ✗            "resolved": "https://…"
        └── "any 5.x ≥ 5.9.2" ─┴───────┴────────┘                     "integrity": "sha512-…"
             a RANGE — resolved fresh on every `npm install`           ONE answer, recorded
```

**The recommendation: `^` for everything, and let the lockfile do the pinning.** Exact pins in
`package.json` look safer and are usually worse — they force a manual bump for every security
patch across a tree of a thousand packages, so in practice they stop being bumped at all. The
range says what you *accept*; the lockfile records what you *got*. Those are two different
questions and it is right that two different files answer them.

### 7. The lockfile, `npm ci` and `npm install`

`package-lock.json` records, for every package in the tree — direct and transitive — the exact
resolved version, the tarball URL, and an `integrity` hash of its contents. It is committed. It
is also large, boring, and merge-conflict-prone, and the correct way to resolve a conflict in it
is to take either side and re-run `npm install`.

| | `npm install` | `npm ci` |
|---|---|---|
| Reads | `package.json`, using the lockfile as a starting point | **the lockfile only** |
| Writes the lockfile | yes | never |
| Existing `node_modules/` | mutates in place | **deletes it first** |
| Manifest and lock disagree | resolves, and rewrites the lock | **fails**, with `EUSAGE` |
| Needs a lockfile | no | yes |
| Roughly | `composer update` (with a lock as a hint) | `composer install` with a lock present |
| Use it | when you are adding or upgrading a dependency | **CI, Docker builds, and any time you want exactly what is committed** |

The integrity hashes are the part worth pausing on. They are why a compromised registry mirror
cannot hand you a different tarball under the same version number without the install failing.
`npm ci` verifies every one of them; that is a large part of why it exists.

> **`npm ci` failing is good news.** It means `package.json` and `package-lock.json` have
> drifted — usually because someone hand-edited a version and did not re-install. If CI ran
> `npm install` instead, it would silently *fix* the drift by resolving a different tree than
> anyone tested, and nobody would ever find out. The Task makes this failure happen on purpose
> so you recognise the error text.

### 8. `node_modules/`, hoisting, and the transitive surface

`node_modules/` is a materialised copy of the resolved tree. npm **hoists** as much as it can to
the top level so that packages share one copy, and nests only where two packages need
incompatible versions of the same dependency.

```
next-app/
├── package.json          "typescript": "^5.9.2"       ← what YOU asked for
├── package-lock.json     every package + version + integrity hash   ← committed
└── node_modules/         hundreds of MB, fully regenerable, NEVER committed
    ├── typescript/
    ├── undici-types/     ← you never asked for this. @types/node did.
    ├── .bin/
    │   └── tsc  ──────▶ ../typescript/bin/tsc         ← what `npm run` puts on PATH
    └── some-tool/
        └── node_modules/
            └── semver/   ← nested, because it needs a version the top level cannot satisfy
```

Two consequences you should hold on to:

- **The same package can exist at several versions in one install.** Composer's flat autoloader
  cannot do this and would fail the resolution instead. npm's nesting is more forgiving and
  quietly larger, and it is why `npm ls <pkg>` can print the same name three times.
- **Almost nothing in there is yours.** Two direct devDependencies pull in a tree of dozens.
  `npm ls --all` prints it; `npm ls <pkg>` shows *who* asked for something you did not.

This is the supply-chain surface, and it deserves plain language rather than alarm. Every package
in that tree runs on your machine when you build, and — for `dependencies` — in production. Some
of them execute install scripts. The practices that follow from that are unglamorous and cheap:

| Practice | Command | Why |
|---|---|---|
| Install from the lockfile in CI | `npm ci` | Verifies integrity hashes; no surprise resolutions |
| Know what you actually pulled | `npm ls --depth=0`, `npm ls --all` | Direct versus transitive |
| Look for known advisories | `npm audit`, `npm audit --omit=dev` | The second one is the set that ships |
| Check registry signatures | `npm audit signatures` | Proves the tarballs came from npm's own signing key |
| Distrust install scripts | `npm ci --ignore-scripts` | A postinstall script is arbitrary code, run before you have read anything |
| Fewer dependencies | — | The only measure that reliably works |

Module 24 makes `npm audit` a CI gate and adds dependency scanning. Nothing about that is
optional theatre — `next-app` is the artifact that will hold session cookies and app tokens.

### 9. Licences: why `next-app` may not contain GPL, while the plugin must

This is the part most JavaScript tutorials skip, and it is the one that can cost real money. The
two halves of this repository sit under **two different licence regimes on purpose**.

```
   wordpress-headless/                        next-app/
   ┌────────────────────────────────┐         ┌────────────────────────────────┐
   │ blame-the-tech-core            │         │ package.json  "license": "MIT" │
   │ A WordPress plugin.            │         │                                │
   │ WordPress is GPL-2.0-or-later, │         │ Permissive only:               │
   │ a plugin is a derivative work, │         │ MIT · ISC · BSD · Apache-2.0   │
   │ so the plugin IS GPL.          │         │                                │
   │ GPL dependencies: fine.        │         │ GPL / AGPL dependency: ❌      │
   └────────────────────────────────┘         └────────────────────────────────┘
        copyleft, by design                        permissive, by requirement
```

WordPress is licensed GPL-2.0-or-later, and the accepted reading in the WordPress world is that a
plugin which calls WordPress APIs is a derivative work and inherits that licence. So GPL is not a
problem on the WordPress side — it is the *rule* on the WordPress side, and a GPL Composer
dependency in `blame-the-tech-core` is entirely correct.

`next-app` is a separate program with a separate licence. Pulling a GPL or AGPL npm package into
it and then distributing the result obliges you to release the whole under those terms — and
"distributing" is broader than it sounds: a bundled JavaScript file served to a browser is
distribution, and AGPL's network clause reaches a hosted application that users merely interact
with.

| Licence | `next-app` | The WordPress plugin | Why |
|---|---|---|---|
| MIT, ISC, BSD-2, BSD-3, Apache-2.0 | ✅ | ✅ | Permissive. Attribution, no reciprocity. |
| MPL-2.0 | ⚠️ per-file copyleft | ✅ | Usually fine, but read it before you rely on it |
| GPL-2.0, GPL-3.0, LGPL | ❌ | ✅ **expected** | Copyleft reaches the whole distributed work |
| AGPL-3.0 | ❌ | ⚠️ avoid | Network use counts as distribution |
| SSPL, BUSL, "source available" | ❌ | ❌ | Not open source; per-deployment terms |
| No `license` field at all | ❌ | ❌ | No licence means no permission granted |

Checking is one command, and it costs less than the conversation you would otherwise have with a
lawyer:

```bash
npm view typescript license           # Expected: Apache-2.0
npm view @types/node license          # Expected: MIT
npx license-checker --production --summary   # the whole shipped tree, grouped by licence
```

> **Check the licence before you add the dependency, not after.** Removing a package once code
> depends on it is a refactor; declining to add it is a decision. Module 24 turns
> `license-checker` into a CI gate that fails the build on a GPL or AGPL package in `next-app`,
> so a dependency that slips through now becomes someone's blocked pull request later.

### 10. `dependencies` versus `devDependencies`

The split is not bookkeeping. It decides what ships.

| | `dependencies` | `devDependencies` |
|---|---|---|
| Installed by `npm ci` | yes | yes |
| Installed by `npm ci --omit=dev` | yes | **no** |
| In the production container | yes | no |
| Examples here | (none yet — Module 09 adds `next`, `react`) | `typescript`, `@types/node`, `eslint`, `prettier` |
| Composer equivalent | `require` | `require-dev` |

Put a build tool in `dependencies` and it ships: a larger image, a longer install, and more code
with a CVE attached to it that a production runtime never needed. Put a runtime library in
`devDependencies` and your production build fails at import time, which at least tells you
immediately. The second mistake is cheap; the first is the one that quietly persists for years.

TypeScript is a `devDependency` even though every file in the app is TypeScript, because types
are erased before anything runs. Lesson 07.3 makes that concrete.

---

## Task

### Step 1: Confirm your Node version comes from `.nvmrc`

Do not create `.nvmrc` — the repository already ships it. Read it, then make your shell honour
it.

```bash
cd /path/to/headless-wordpress-fullstack-training
cat .nvmrc
nvm use
node -v
npm -v
which node
```

**Verify §1:**

- [ ] `cat .nvmrc` prints `22`.
- [ ] `nvm use` says something like `Now using node v22.20.0 (npm v10.9.3)`.
- [ ] `node -v` prints `v22.` followed by anything.
- [ ] `which node` contains `.nvm/versions/node/v22` — **not** `/usr/local/bin/node` or
      `/opt/homebrew/bin/node`. If it does, a system Node is shadowing nvm and you will get
      confusing failures in Module 09. Fix it now.

### Step 2: Initialise the package

`next-app/` currently contains exactly one file, its `README.md`. That is correct — do **not**
run `create-next-app`, which Lesson 09.1 does with specific flags.

```bash
cd next-app
ls -a
# Expected: README.md and nothing else

npm init -y
cat package.json
```

`npm init -y` writes a generic manifest with fields you do not want. Look at it once so you know
what the defaults are, then replace the whole file.

### Step 3: Write the real `package.json`

Replace the generated file with this, exactly:

```json
{
  "name": "btt-next-app",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "description": "Blame The Tech — front end for the headless WordPress API",
  "type": "module",
  "engines": {
    "node": ">=22.0.0 <23",
    "npm": ">=10"
  },
  "scripts": {
    "blame": "echo 'Lesson 07.2 writes scripts/blame.mjs and wires this script.' && exit 1",
    "type-check": "echo 'Lesson 07.3 adds tsconfig.json and runs tsc --noEmit here.' && exit 1",
    "typecheck": "npm run type-check",
    "lint": "echo 'Lesson 07.5 adds eslint.config.mjs and wires this script.' && exit 1",
    "format": "echo 'Lesson 07.5 adds .prettierrc and wires this script.' && exit 1",
    "format:check": "echo 'Lesson 07.5 adds .prettierrc and wires this script.' && exit 1"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

Five things in there are deliberate and worth naming, because JSON cannot carry comments and you
will read this file a hundred more times:

- **`"private": true`** makes `npm publish` refuse. Your application is not a library.
- **`"type": "module"`** is what makes `.js` mean ES module (Key Concept 4).
- **`"license": "MIT"`** matches the repository's `LICENSE` and is the fact that makes a GPL
  dependency here a licensing problem rather than a preference (Key Concept 9).
- **The placeholder scripts exit `1`.** They exist so `npm run` documents what is coming, and
  they fail loudly rather than reporting a false success. Each names the lesson that replaces it.
- **`typecheck` is an alias for `type-check`.** Both spellings appear across the course and in
  other people's projects; one line makes both work, and the alias costs nothing.

### Step 4: Check two licences, then install two devDependencies

The licence check comes first. Every time.

```bash
npm view typescript license
# Expected: Apache-2.0

npm view @types/node license
# Expected: MIT
```

Both permissive, so both are allowed in `next-app`. Install them as **dev** dependencies —
neither exists at runtime:

```bash
npm install --save-dev typescript@^5.9.2 @types/node@^22
```

**Verify §4:**

- [ ] `package.json` now has a `devDependencies` block containing `typescript` and
      `@types/node`, both with a `^` range.
- [ ] `dependencies` is still `{}`. Nothing this project needs at runtime exists yet.
- [ ] `package-lock.json` was created.
- [ ] `node_modules/` was created.

### Step 5: Read what you just installed

Two direct dependencies are never two packages.

```bash
npm ls --depth=0
# Expected: your two devDependencies, at their resolved versions

npm ls --all | wc -l
# Expected: more than 2. Every extra line is a transitive dependency.

npm ls undici-types
# Expected: it appears under @types/node — nobody asked for it directly
```

Then look at the difference between what you asked for and what you got:

```bash
npm pkg get devDependencies.typescript
# Expected: a RANGE, e.g. "^5.9.2"

grep -A3 '"node_modules/typescript"' package-lock.json | grep '"version"'
# Expected: one exact version, e.g. "version": "5.9.3" — the range's answer, recorded
```

### Step 6: Confirm `node_modules/` is ignored before you commit anything

```bash
cd ..
git check-ignore -v next-app/node_modules
git status --short next-app/
```

**Verify §6:**

- [ ] `git check-ignore` names a rule, something like `.gitignore:15:node_modules/`.
- [ ] `git status --short` lists `next-app/package.json` and `next-app/package-lock.json` as new,
      and does **not** mention `node_modules`.
- [ ] If `node_modules` appears in `git status`, stop and fix the root `.gitignore` before you
      commit. Removing hundreds of megabytes from git history afterwards is a genuinely bad
      afternoon.

### Step 7: Make `npm ci` fail on purpose

You need to recognise this error, because you will eventually cause it for real.

```bash
cd next-app

# 1. A clean, honest install first
npm ci
# Expected: it removes node_modules, reinstalls from the lockfile, no warnings about mismatch

# 2. Now desynchronise the manifest by hand — a version the lockfile has never seen
npm pkg set devDependencies.typescript="^4.9.0"
npm ci
# Expected: FAILURE. `npm ci` can only install packages when your package.json and
#           package-lock.json are in sync … Missing: typescript@4.9.x from lock file

# 3. Put it back
npm pkg set devDependencies.typescript="^5.9.2"
npm ci
# Expected: a clean install again
```

**Verify §7:**

- [ ] Step 2 exited non-zero and mentioned `package-lock.json` being out of sync.
- [ ] `git diff -- package-lock.json` is empty. `npm ci` never writes the lockfile — that is
      exactly why CI uses it.
- [ ] Step 3 restored a clean install.

> **Had you run `npm install` instead of `npm ci` at step 2**, it would have succeeded: npm would
> have resolved TypeScript 4.9, rewritten the lockfile, and left you with a tree nobody had ever
> tested. That difference is the entire reason both commands exist.

### Step 8: Commit the manifest and the lockfile together

```bash
cd ..
git add next-app/package.json next-app/package-lock.json
git commit -m "feat(web): initialise next-app package with Node 22 and strict manifest"
```

They are one change. A `package.json` committed without its lockfile is a change to what you
*accept* with no record of what you *got*, which is how two developers end up debugging two
different dependency trees.

---

## Verification

```bash
cd next-app

# 1. Node comes from .nvmrc, not from a system install
nvm use && node -v && which node
# Expected: v22.x.x, and a path under .nvm/versions/node/v22

# 2. npm agrees with the engines field
npm -v
# Expected: 10.x or newer

# 3. The manifest declares an ES-module package
npm pkg get type private license
# Expected: { "type": "module", "private": true, "license": "MIT" }

# 4. `.js` really is an ES module here — `require` must NOT exist
node --input-type=module -e "require('node:fs')"
# Expected: ReferenceError: require is not defined in ES module scope
#           This is the NEGATIVE that proves "type": "module" took effect.

# 5. Both devDependencies resolved, and nothing landed in dependencies
npm ls --depth=0
npm pkg get dependencies
# Expected: typescript and @types/node listed; then {}

# 6. Their licences are still permissive (Key Concept 9)
npm view typescript license && npm view @types/node license
# Expected: Apache-2.0 then MIT — neither GPL nor AGPL

# 7. The lockfile pins exact versions, unlike the manifest's ranges
npm pkg get devDependencies.typescript
grep -A3 '"node_modules/typescript"' package-lock.json | grep '"version"'
# Expected: a range such as "^5.9.2", then a single exact version such as "5.9.3"

# 8. `npm ci` installs from the lockfile and does not modify it
npm ci && git diff --exit-code -- package-lock.json && echo "lockfile untouched"
# Expected: lockfile untouched

# 9. `npm ci` FAILS when the manifest and lockfile disagree (prove the negative)
npm pkg set devDependencies.typescript="^4.9.0"
npm ci; echo "exit=$?"
# Expected: an EUSAGE error naming package-lock.json, and exit=1 (not 0)
npm pkg set devDependencies.typescript="^5.9.2"
npm ci >/dev/null && echo "restored"
# Expected: restored

# 10. An unfinished script fails loudly instead of reporting success (prove the negative)
npm run lint; echo "exit=$?"
# Expected: the "Lesson 07.5 adds eslint.config.mjs" message, then exit=1

# 11. The alias resolves to the same placeholder
npm run type-check; echo "exit=$?"
# Expected: the Lesson 07.3 message, then exit=1

# 12. node_modules is ignored; the two files that matter are tracked
cd .. && git check-ignore -v next-app/node_modules
git ls-files next-app/
# Expected: a .gitignore rule for node_modules; then README.md, package.json,
#           package-lock.json — and nothing else

# 13. Nothing was scaffolded that should not be
ls next-app/
# Expected: README.md, node_modules, package.json, package-lock.json.
#           No src/, no next.config.ts, no app/ — Module 09 creates those.
```

If check 4 prints anything other than a `ReferenceError`, `"type": "module"` did not take
effect, and every import in the next four lessons will behave in ways the text does not
describe. Fix it before continuing.

## Control Questions

1. Two developers clone this repository a month apart, both run `npm install`, and both get a
   different `typescript` version despite an identical `package.json`. Explain how, and name the
   file and the command that together make that impossible.
2. `npm ci` in CI is not a stylistic preference. Describe the concrete failure that `npm install`
   in CI would hide, and say what state the deployed artifact would be in when it happened.
3. A colleague adds a package licensed AGPL-3.0 to `next-app` and the same package to
   `blame-the-tech-core`. One is a licensing problem and one is not. Say which, and why the same
   package can be acceptable in one directory and not the other.
4. `"type": "module"` changes the meaning of `.js` files. Name three things that stop working in
   an ES module that work in CommonJS, and one thing that only works in an ES module.
5. You have exactly two direct devDependencies and `npm ls --all` prints dozens of lines. Explain
   what those extra lines are, name the command that tells you which direct dependency asked for
   a given one, and say why `npm audit --omit=dev` is the more interesting audit of the two.

## Learn More

- [Node.js: Modules — Packages](https://nodejs.org/api/packages.html) — the authoritative
  `"type"`, `exports` and extension-resolution rules; the only place where the ESM/CJS table in
  Key Concept 4 is definitive
- [npm docs: `package.json`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json) — every
  field, including the publishing ones this course omits and why
- [npm docs: `npm ci`](https://docs.npmjs.com/cli/v10/commands/npm-ci) — read the "in sync"
  paragraph; it is the exact failure you triggered in Step 7
- [The semver specification](https://semver.org/) — short, and clears up the `0.x` special case
  that catches everyone
- [node-semver: ranges](https://github.com/npm/node-semver#ranges) — the *implementation* npm
  actually uses, including `^`, `~` and pre-release handling
- [nvm](https://github.com/nvm-sh/nvm#nvmrc) — the `.nvmrc` lookup rules, and why `nvm` cannot be
  a binary
- [npm docs: `npm audit signatures`](https://docs.npmjs.com/cli/v10/commands/npm-audit) — the
  registry-signature check from Key Concept 8, which most projects have never run
- [SPDX licence list](https://spdx.org/licenses/) — the identifiers `npm view <pkg> license`
  prints, so you can tell `BSD-3-Clause` from `BUSL-1.1` at a glance
- [WordPress: GPL and the "derivative work" position](https://wordpress.org/about/license/) —
  the reasoning behind the plugin side of Key Concept 9, in the project's own words
