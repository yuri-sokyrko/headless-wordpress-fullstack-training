---
title: 'Linting, Formatting & Editor Setup'
module: 7
lesson: 5
teaches: [eslint-flat-config, prettier, phpcs-wordpress-standards, editor-integration, lint-vs-format]
produces: ['next-app/eslint.config.mjs', 'next-app/.prettierrc', 'wordpress-headless/phpcs.xml.dist']
requires: [7.3]
---

# Lesson 07.5 — Linting, Formatting & Editor Setup

## Quick Overview

Two tools with two jobs that people constantly conflate. **Prettier** is a formatter: it owns
whitespace, quotes, line width and trailing commas, it has almost no options on purpose, and its
value is that formatting stops being a topic in code review. **ESLint** is a linter: it finds
patterns that are legal but wrong — an unused variable, a missing `await`, a React hook called
conditionally — and it is where project-specific rules live. Running both, with Prettier owning
formatting and ESLint explicitly not fighting it, is the configuration this lesson sets up, using
ESLint's flat config format in `eslint.config.mjs`.

Then the other language in the repository gets the same treatment.
`wordpress-headless/phpcs.xml.dist` runs **PHP_CodeSniffer** with the WordPress Coding Standards
over `blame-the-tech-core`, catching the things you would otherwise be told in review: missing
escaping on output, unprepared SQL, Yoda conditions, naming and documentation conventions. The
security sniffs are the ones that earn their keep — PHPCS will flag an unescaped `echo` and an
interpolated `$wpdb` query, both of which are invariants this course refuses to break. Finally
you wire the editor: format on save, ESLint inline, and the PHPCS integration, because a linter
you have to remember to run is a linter you will stop running. Module 24 turns all three into CI
gates and a pre-commit hook; getting them green now means that gate never has a backlog.

By the end of this lesson you will have:

- `next-app/eslint.config.mjs` — flat config with the TypeScript plugin and Prettier
  interoperation configured, not guessed
- `next-app/.prettierrc` and the formatting settings aligned with the repository's
  `.editorconfig`
- `wordpress-headless/phpcs.xml.dist` running WordPress Coding Standards over the plugin, with a
  documented and minimal exclusion list
- `npm run lint`, `npm run format:check` and `npm run type-check` all passing on a clean tree
- `composer phpcs` passing over `blame-the-tech-core`, including the escaping and SQL sniffs
- Format-on-save and inline diagnostics working in your editor for both TypeScript and PHP

## Classic WP Analogy

You have met PHPCS already, or at least its output: the WordPress Coding Standards ruleset is
what tells you to use tabs, to write `if ( true === $x )`, to escape late with `esc_html()`, and
to run every query through `$wpdb->prepare()`. If you have submitted a patch to a WordPress
project you have been asked to run it. That half of this lesson is a familiar tool applied to
your own plugin, and the ruleset is the same one core uses.

ESLint and Prettier are that idea for the JavaScript half, split into two tools because the
JavaScript ecosystem separates concerns that PHPCS bundles together. PHPCS both checks style and
fixes it with `phpcbf`, and it mixes formatting sniffs with genuine bug and security sniffs in
one ruleset. In JavaScript, formatting is Prettier's (non-negotiable, near-configuration-free)
job, and correctness is ESLint's, which is a cleaner split once you stop expecting one tool. The
motivation is identical in both languages: a machine enforcing consistency means human review can
be about design instead of about quote characters.

**Where the analogy breaks down:** PHPCS is advisory. It runs when you run it, it is not part of
executing your code, and a plugin with 400 PHPCS warnings works perfectly — plenty of shipped
WordPress plugins are exactly that. In this project the JavaScript toolchain is not advisory:
`tsc` failing means the Next.js build fails, which means the deploy fails, and Module 24 makes
ESLint failure block the pull request. The feedback moves from "someone might mention this in
review" to "this does not ship". That is a real change in how it feels to work, and the way to
make it pleasant rather than obstructive is to have the editor tell you within a second of
typing — which is why the editor-setup half of this lesson is not an optional extra.

---

## Key Concepts

### 1. Formatting is not linting

The distinction that makes the rest of the lesson make sense.

| | Prettier | ESLint |
|---|---|---|
| Owns | whitespace, quotes, semicolons, line width, trailing commas | correctness patterns |
| Options | deliberately few | hundreds, and project-specific |
| Reads your code as | a syntax tree it reprints from scratch | a syntax tree it inspects |
| Typical finding | none — it just rewrites | "this `await` is missing", "this variable is unused" |
| Disagreement is | not possible; there is one output | a design conversation |

Prettier's near-total lack of options is the feature. It reprints your file from the AST, which
means the output is a function of the code, not of how you typed it — so formatting stops being
a thing anyone argues about or notices in review.

The two tools overlap historically: ESLint used to ship stylistic rules (`quotes`, `semi`,
`indent`). Leaving those on while Prettier also runs produces the worst outcome — two tools
fighting over the same lines, and a save loop that never settles. §4 turns them off explicitly.

### 2. Flat config: what changed, and why every tutorial you find is out of date

ESLint 9 replaced `.eslintrc.*` with `eslint.config.mjs`. It is not a rename.

```
OLD — .eslintrc.json                 NEW — eslint.config.mjs
──────────────────────────────       ──────────────────────────────
cascading: ESLint walks UP the       ONE file at the project root.
directory tree merging configs       No cascade, no surprises.

"extends": ["airbnb"]                import + spread an array:
  ↳ resolved by magic string           export default [ base, ...tsPlugin ]

"env": { "browser": true }           languageOptions.globals

.eslintignore                        `ignores` key in the config array

plugins: ["@typescript-eslint"]      plugins: { '@typescript-eslint': plugin }
  ↳ string, resolved by convention     ↳ a real imported object
```

The config is **an array of objects, applied in order, later objects overriding earlier ones for
files they match.** That is the whole model. An object with no `files` key applies to everything;
an object with `files: ['**/*.ts']` applies only there.

```js
// next-app/eslint.config.mjs — the shape, not the final file
export default [
  { ignores: ['.next/**', 'src/gql/**'] },        // applies globally
  js.configs.recommended,                          // base JS rules
  ...tseslint.configs.recommended,                 // spread — it is an array
  { files: ['**/*.ts'], rules: { /* overrides */ } },
  prettierConfig,                                  // LAST — turns off style rules
];
```

Order matters and the last entry is deliberate: `eslint-config-prettier` only *disables* rules,
so it has to come after everything that might enable them.

> **`src/gql/**` is in `ignores` from the start.** Module 10 generates that directory, and
> linting generated code is a waste of everyone's time — you cannot fix it, and regenerating
> would undo the fix. Same reasoning as not linting `vendor/`.

### 3. `typescript-eslint`: two tiers, and the one worth the cost

`typescript-eslint` offers rule sets at two levels, and the difference is whether ESLint gets
type information.

| | `recommended` | `recommendedTypeChecked` |
|---|---|---|
| Needs a `tsconfig.json` | no | **yes** |
| Speed | fast | noticeably slower — it runs the type checker |
| Catches | syntax-level problems | `await` on a non-promise, unhandled promise rejections, unsafe `any` flowing through calls |
| Example it alone finds | — | `if (incident.severities)` where the value is an array that is always truthy |

This course uses **`recommendedTypeChecked`**, and pays the speed cost, because the rules it adds
are exactly the ones that matter in an app whose data arrives as untyped JSON from a network
call. `no-floating-promises` alone justifies it: a forgotten `await` on a GraphQL call produces a
page that renders before its data arrives, intermittently, and only under load.

Enabling it needs one extra block:

```js
// next-app/eslint.config.mjs (fragment — full file in the Task)
languageOptions: {
  parserOptions: {
    projectService: true,          // find the nearest tsconfig automatically
    tsconfigRootDir: import.meta.dirname,
  },
},
```

`projectService: true` is the modern replacement for listing `project: ['./tsconfig.json']`. It
lets the parser resolve the right `tsconfig` per file, including for files not in the project.

### 4. `--max-warnings=0`, because a warning is a lie

ESLint has two severities. In practice a project has two states: zero problems, or an
ever-growing list nobody reads.

```
warnings allowed                     --max-warnings=0
──────────────────────────────       ──────────────────────────────
day 1:    0 warnings                 day 1:    exit 0
day 30:  14 warnings, CI green       day 30:   you fixed all 14, or
day 90: 106 warnings, CI green                 deliberately turned 3 rules off
day 180: nobody reads the output              CI is still meaningful
```

So `npm run lint` is `eslint . --max-warnings=0`. If a rule is not worth fixing, turn the rule
off in the config with a comment explaining why — that decision is reviewable in a diff.
Leaving it as a permanent warning is not a decision, it is a deferral.

The same argument applies to `// eslint-disable-next-line`: acceptable with a reason on the same
line, unacceptable bare. Module 24 adds `reportUnusedDisableDirectives` so that stale
suppressions are themselves errors.

### 5. PHPCS and the sniffs that actually earn their keep

`phpcs.xml.dist` runs the WordPress Coding Standards over the plugin. Most of what it reports is
style — tabs, Yoda conditions, spacing inside parentheses — and that is fine but not why it is
here. These four are:

| Sniff | Catches | Why it matters here |
|---|---|---|
| `WordPress.Security.EscapeOutput` | `echo $incident->post_title;` | An unescaped echo is XSS. Escaping every output is a rule this course does not bend — here it is enforced mechanically rather than by review. |
| `WordPress.DB.PreparedSQL` | `$wpdb->get_results( "... $slug ..." )` | Interpolated SQL. The `wp_btt_leads` table in Module 16 is where this becomes real. |
| `WordPress.Security.NonceVerification` | `$_POST` read without a nonce check | Flags admin handlers; will also flag your moderation bulk action if you forget |
| `WordPress.Security.ValidatedSanitizedInput` | `$_GET['x']` used unsanitised | The boundary rule, in PHP |

`phpcbf` — the "beautifier" — auto-fixes the style sniffs. It cannot fix the four above, by
design: escaping is a decision about the data, not about the syntax.

> **The `.dist` suffix is a convention, not decoration.** `phpcs.xml.dist` is the committed team
> ruleset. PHPCS also reads `phpcs.xml` first if it exists, and that filename is gitignored — so
> a developer can keep a local override without touching the shared config. Same pattern as
> `.env.example` versus `.env`.

Two exclusions this project makes deliberately, both with reasons that belong in the file:

- **`WordPress.Files.FileName`** — WPCS wants `class-plugin.php`; Lesson 03.1 uses PSR-4, which
  requires `Plugin.php`. The autoloader wins.
- **`Squiz.Commenting.FileComment`** on `includes/*.php` — the procedural files carry a docblock
  on the function, not the file. Excluding one sniff beats adding forty boilerplate headers.

Anything else you exclude, you justify in a comment. An unexplained exclusion is how a ruleset
quietly becomes decorative.

### 6. The editor is where this pays off

All three tools can run from the terminal, and if that is the only way you run them you will
stop. The loop that works is: the editor tells you while you type, the terminal confirms before
you commit, CI enforces on the pull request.

```
     you type            ──▶  editor shows it inline        (< 1 second)
     you save            ──▶  Prettier reformats            (automatic)
     you commit          ──▶  lint-staged runs on staged    (Module 24)
     you open a PR       ──▶  CI blocks the merge           (Module 24)
```

Committing `.vscode/settings.json` is a deliberate choice. It is arguably the developer's
business, but the alternative is every contributor configuring format-on-save independently and
one of them not doing it, which shows up as a 400-line whitespace diff. `extensions.json`
recommends rather than installs, which is the right level of pushiness.

---

## Task

### Step 1: Install the JavaScript tooling

```bash
cd next-app

npm install --save-dev \
  eslint@^9 \
  @eslint/js \
  typescript-eslint \
  eslint-config-prettier \
  prettier
```

**Verify §1:**

- [ ] `npx eslint --version` prints `v9.x`.
- [ ] `package.json` has all five under `devDependencies`, not `dependencies` — none of this
      ships to a user.

### Step 2: Write the flat config

```js
// next-app/eslint.config.mjs
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  // ── Never linted ────────────────────────────────────────────────────
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      // Generated by graphql-codegen in Module 10. Linting generated code is
      // pointless: you cannot fix it, and regenerating would undo the fix.
      'src/gql/**',
    ],
  },

  js.configs.recommended,

  // Type-aware rules. Slower than `recommended`, and worth it — see §3.
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A forgotten `await` on a GraphQL call is the bug this whole tier
      // exists to catch. Error, not warning.
      '@typescript-eslint/no-floating-promises': 'error',

      // `_`-prefixed args are intentionally unused (React event handlers,
      // catch bindings). Everything else is a mistake.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // `any` defeats the entire point of Module 07. Use `unknown` and narrow.
      '@typescript-eslint/no-explicit-any': 'error',

      // Stale suppressions are themselves errors.
      // (Also set at the top level below, for files this block does not match.)
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // Plain JS config files are not in the TS project — turn type-aware rules
  // off for them rather than adding them to tsconfig.
  {
    files: ['*.mjs', '*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // LAST. eslint-config-prettier only DISABLES rules, so anything after it
  // could re-enable a formatting rule and start a fight with Prettier.
  prettier,
];
```

**Verify §2:**

- [ ] `prettier` is the final element of the array. If it is not, move it.
- [ ] `npx eslint .` runs without a *configuration* error. It may well report code problems —
      that is Step 7.

### Step 3: Configure Prettier to agree with `.editorconfig`

The repository root already has an `.editorconfig` (2-space indent, LF, 100 columns). Prettier
reads it, but state the overlapping values explicitly so there is no ambiguity:

```json
// next-app/.prettierrc
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

```bash
# The Tailwind plugin sorts class strings into a canonical order. Installed now
# because Module 11 introduces Tailwind and a class-order diff is pure noise.
npm install --save-dev prettier-plugin-tailwindcss
```

```
# next-app/.prettierignore
.next
coverage
playwright-report
src/gql
```

### Step 4: Wire the scripts

Lesson 07.1 left three placeholders that exit `1`. Replace them:

```json
// next-app/package.json (fragment)
  "scripts": {
    "blame": "node scripts/blame.mjs",
    "type-check": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "verify": "npm run type-check && npm run lint && npm run format:check"
  }
```

`verify` is the one you will actually type. Module 24 runs the same three commands as separate CI
jobs so a failure names itself, but locally one command is what gets used.

**Verify §4:**

- [ ] `npm run lint` no longer prints the Lesson 07.5 placeholder message.
- [ ] `npm run type-check` runs `tsc`, and still passes from Lesson 07.3.

### Step 5: PHP_CodeSniffer for the plugin

The `composer` service is where Composer lives — the stock `wordpress` image has neither
Composer nor WP-CLI — see [appendix 07 §2](../appendix/07-command-reference.md#2-wp-cli).

```bash
cd ../wordpress-headless

docker compose run --rm composer require --dev \
  wp-coding-standards/wpcs:^3.1 \
  phpcompatibility/phpcompatibility-wp:^2.1 \
  dealerdirect/phpcodesniffer-composer-installer:^1.0
```

```xml
<?xml version="1.0"?>
<!-- wordpress-headless/phpcs.xml.dist -->
<ruleset name="Blame The Tech Core">
  <description>WordPress Coding Standards for the blame-the-tech-core plugin.</description>

  <!-- What to scan -->
  <file>wp-content/plugins/blame-the-tech-core</file>
  <exclude-pattern>*/vendor/*</exclude-pattern>
  <exclude-pattern>*/node_modules/*</exclude-pattern>
  <exclude-pattern>*/build/*</exclude-pattern>

  <arg name="basepath" value="."/>
  <arg name="extensions" value="php"/>
  <arg name="parallel" value="8"/>
  <arg name="colors"/>
  <!-- s = show sniff names, so an exclusion can be written accurately -->
  <arg value="sp"/>

  <config name="minimum_wp_version" value="6.8"/>
  <config name="testVersion" value="8.3-"/>

  <rule ref="WordPress">
    <!-- WPCS wants class-plugin.php; PSR-4 (Lesson 03.1) requires Plugin.php.
         The autoloader is not negotiable, so this sniff loses. -->
    <exclude name="WordPress.Files.FileName"/>
  </rule>

  <!-- Procedural includes/ files document the function, not the file. Excluding
       one sniff beats forty boilerplate file headers. -->
  <rule ref="Squiz.Commenting.FileComment">
    <exclude-pattern>*/includes/*.php</exclude-pattern>
  </rule>

  <rule ref="PHPCompatibilityWP"/>

  <rule ref="WordPress.WP.I18n">
    <properties>
      <property name="text_domain" type="array">
        <element value="blame-the-tech"/>
      </property>
    </properties>
  </rule>

  <!-- Every global must be prefixed. `btt` for functions and options,
       `Blame\Core` for the namespaced code. -->
  <rule ref="WordPress.NamingConventions.PrefixAllGlobals">
    <properties>
      <property name="prefixes" type="array">
        <element value="btt"/>
        <element value="Blame\Core"/>
      </property>
    </properties>
  </rule>
</ruleset>
```

Add the scripts to the plugin's `composer.json`:

```json
// wordpress-headless/wp-content/plugins/blame-the-tech-core/composer.json (fragment)
  "scripts": {
    "phpcs": "phpcs --standard=../../../phpcs.xml.dist",
    "phpcbf": "phpcbf --standard=../../../phpcs.xml.dist"
  }
```

**Verify §5:**

- [ ] `docker compose run --rm composer exec -- phpcs -i` lists `WordPress` and
      `PHPCompatibilityWP` among the installed standards. If not, the
      `phpcodesniffer-composer-installer` did not run — re-run `composer install`.

### Step 6: Wire the editor

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "eslint.useFlatConfig": true,
  "eslint.workingDirectories": [{ "directory": "next-app", "changeProcessCWD": true }],
  "[php]": { "editor.defaultFormatter": null, "editor.formatOnSave": false },
  "phpcs.enable": true,
  "phpcs.standard": "wordpress-headless/phpcs.xml.dist",
  "files.eol": "\n",
  "editor.rulers": [100],
  "search.exclude": { "**/src/gql": true, "**/vendor": true, "**/.next": true }
}
```

```json
// .vscode/extensions.json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "bmewburn.vscode-intelephense-client",
    "ValeryanM.vscode-phpsab"
  ]
}
```

> **`formatOnSave` is off for PHP on purpose.** Prettier does not format PHP, and letting an
> unconfigured formatter reflow WordPress-standard PHP produces a diff that PHPCS then
> complains about. Run `composer phpcbf` deliberately instead.

### Step 7: Fix what they report

Now the part that is actually work. Run all four and fix until clean.

```bash
cd ../../next-app 2>/dev/null || cd next-app
npm run format          # rewrites files — commit this separately
npm run lint:fix        # fixes what is mechanically fixable
npm run lint            # fix the rest by hand
npm run type-check

cd ../wordpress-headless
docker compose run --rm composer run phpcbf   # auto-fix style
docker compose run --rm composer run phpcs    # fix the rest by hand
```

**Verify §7:**

- [ ] `npm run verify` exits `0`.
- [ ] PHPCS reports no **errors**. Warnings you have consciously accepted are acceptable only if
      you turned the sniff off in the ruleset with a comment — see §4's argument.
- [ ] Commit the pure-formatting churn as its own commit
      (`style: apply prettier and phpcbf`) so it never mixes with a behavioural change.

---

## Verification

```bash
cd next-app

# 1. ESLint 9 with flat config, and the config itself is valid
npx eslint --version
# Expected: v9.x.x
npx eslint --print-config src/types/content.ts > /dev/null && echo "config resolves"
# Expected: config resolves

# 2. The full gate passes
npm run verify
# Expected: exits 0, no output from tsc, "All matched files use Prettier code style!"

# 3. Prettier is disabling ESLint's stylistic rules, not fighting them
npx eslint --print-config src/types/content.ts | jq -r '.rules.quotes, .rules.semi'
# Expected: two nulls or "off" entries — eslint-config-prettier turned them off.
#           If either is ["error", ...], `prettier` is not last in the array.

# 4. Generated and vendored code is genuinely ignored
npx eslint --no-ignore --print-config src/gql/index.ts >/dev/null 2>&1; \
  npx eslint src/gql 2>&1 | grep -c "ignored" || true
# Expected: src/gql is skipped. (The directory may not exist until Module 10 — that is fine.)

# 5. THE NEGATIVE: a real bug is caught, not just formatting
cat > /tmp/lint-probe.ts <<'PROBE'
async function boom(): Promise<string> { return 'x'; }
export function caller(): void {
  boom();                      // no await — no-floating-promises
  const bad: any = 1;          // no-explicit-any
  const unused = bad;          // no-unused-vars
}
PROBE
cp /tmp/lint-probe.ts src/lint-probe.ts
npx eslint src/lint-probe.ts; echo "exit=$?"
# Expected: exit=1, with THREE errors named:
#   @typescript-eslint/no-floating-promises
#   @typescript-eslint/no-explicit-any
#   @typescript-eslint/no-unused-vars
# If no-floating-promises is absent, type-aware linting is not active (§3).
rm src/lint-probe.ts

# 6. --max-warnings=0 really is wired
grep -o 'max-warnings=0' package.json
# Expected: max-warnings=0

# 7. PHP: the standards are installed and the ruleset loads
cd ../wordpress-headless
docker compose run --rm composer exec -- phpcs -i
# Expected: a list including WordPress, WordPress-Core and PHPCompatibilityWP

docker compose run --rm composer run phpcs
# Expected: no ERRORS. Style warnings you have justified are acceptable.

# 8. THE NEGATIVE THAT MATTERS: the security sniffs are live
docker compose run --rm composer exec -- \
  phpcs --standard=../../../phpcs.xml.dist --sniffs=WordPress.Security.EscapeOutput,WordPress.DB.PreparedSQL \
  --report=summary .
# Expected: the sniffs run and report 0 errors.
#           These two are why PHPCS is in this project — Module 16 writes the
#           $wpdb code they guard.

# 9. Editor config is committed for everyone, not just you
cd ..
test -f .vscode/settings.json && test -f .vscode/extensions.json && echo "editor config committed"
# Expected: editor config committed

# 10. Nothing generated or vendored got committed by accident
git status --short | grep -E 'node_modules|vendor/|\.next/' || echo "clean"
# Expected: clean
```

Check 5 is the one that proves the setup rather than merely running it. If
`no-floating-promises` does not fire, you have a linter that checks style and misses the class of
bug this configuration exists to catch.

## Control Questions

1. `eslint-config-prettier` is the last element of the config array. Describe concretely what
   goes wrong if you put it second, and name a rule that would demonstrate the problem.
2. `recommendedTypeChecked` is slower than `recommended` because it runs the type checker. Give
   one specific bug it catches that `recommended` cannot, and explain why type information is
   required to catch it.
3. `npm run lint` uses `--max-warnings=0`. A colleague argues warnings are useful as a soft
   signal. Give the counter-argument, and describe what you would do instead with a rule you do
   not want to fix right now.
4. `phpcs.xml.dist` excludes `WordPress.Files.FileName`. Explain what that sniff wants, why this
   project cannot comply, and what would break if you complied anyway.
5. PHPCS can auto-fix indentation with `phpcbf` but cannot auto-fix a
   `WordPress.Security.EscapeOutput` finding. Explain the difference in terms of what each sniff
   actually knows about your code.

## Learn More

- [ESLint — Configuration files](https://eslint.org/docs/latest/use/configure/configuration-files) —
  the flat-config reference. Read the "Configuration Objects" section; the array-order model in §2
  is the whole thing.
- [typescript-eslint — Getting Started](https://typescript-eslint.io/getting-started/typed-linting/) —
  specifically the typed-linting page, for `projectService` and the performance trade-off
- [Prettier — Option Philosophy](https://prettier.io/docs/en/option-philosophy) — why there are
  so few options; worth reading once so you stop looking for the ones that do not exist
- [`eslint-config-prettier`](https://github.com/prettier/eslint-config-prettier) — the list of
  rules it turns off, which is also a good history of what ESLint used to do
- [WordPress Coding Standards](https://github.com/WordPress/WordPress-Coding-Standards) — the
  ruleset itself; the `WordPress-Extra` versus `WordPress-Core` distinction is worth understanding
- [PHPCS — Annotated ruleset](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Annotated-Ruleset) —
  every element available in `phpcs.xml.dist`, including the `exclude-pattern` scoping used in §5
- [`prettier-plugin-tailwindcss`](https://github.com/tailwindlabs/prettier-plugin-tailwindcss) —
  installed now, earns its place in Module 11
