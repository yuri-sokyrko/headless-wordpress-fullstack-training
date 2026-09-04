---
title: 'The Modern JavaScript You Skipped'
module: 7
lesson: 2
teaches: [destructuring-and-spread, arrow-functions, promises-async-await, array-methods, optional-chaining, esm-imports]
produces: ['next-app/scripts/blame.mjs']
requires: [6.3, 7.1]
---

# Lesson 07.2 — The Modern JavaScript You Skipped

## Quick Overview

Your JavaScript is probably jQuery-shaped: `var`, `function`, callbacks, `$.ajax`, and `$.each`.
None of that is wrong, and all of it still runs. But every line of JavaScript in the next
seventeen modules is written in a dialect that arrived after jQuery stopped being the default,
and reading React code without it is like reading PHP without knowing what `=>` does in an
array. This lesson covers exactly the subset you need, with no completeness ambition:
`const`/`let` and block scope, arrow functions and lexical `this`, destructuring and spread,
template literals, `map`/`filter`/`reduce`/`find`, optional chaining and nullish coalescing,
and Promises with `async`/`await`.

You learn it by building something real. `scripts/blame.mjs` uses Node's built-in `fetch` to
`POST` one of your Module 05 operations to `http://localhost:8080/graphql`, destructures the
response, maps the incident nodes into a printable shape, sorts them by `blameScore`, and prints
a table to your terminal. It reads an endpoint from the environment rather than hard-coding it,
and it exits non-zero on a GraphQL `errors` array — because a script that prints "no incidents"
when the API returned an error is worse than one that crashes. By the end you will have
your first end-to-end proof that the API you spent five modules designing is consumable from
JavaScript, using nothing but the standard library.

By the end of this lesson you will have:

- `next-app/scripts/blame.mjs` printing live incidents from WPGraphQL, sorted by `blameScore`
- The script reading `WP_GRAPHQL_ENDPOINT` from the environment, with a clear error if it is
  absent
- Non-zero exit and a readable message when the response contains a GraphQL `errors` array
- `npm run blame` wired into `package.json`
- Working examples of destructuring, spread, arrow functions, `map`/`filter`/`reduce`, optional
  chaining and `async`/`await` — each one used for a real purpose in that script, not in a toy
- A written comparison of the same logic in jQuery-era JavaScript and in modern JavaScript

## Classic WP Analogy

Almost every construct here has a PHP counterpart you use without thinking:

| Modern JavaScript | Your PHP equivalent |
|---|---|
| `const { title, slug } = incident` | `list($title, $slug)` / `['title' => $title] = $arr` |
| `[...a, ...b]`, `{ ...defaults, ...opts }` | `array_merge()`, `wp_parse_args()` |
| `items.map(fn)` | `array_map()` |
| `items.filter(fn)` | `array_filter()` |
| `items.reduce(fn, 0)` | `array_reduce()` |
| `nodes?.[0]?.title` | `$nodes[0]['title'] ?? null` with `isset()` guards |
| `value ?? fallback` | `$value ?? $fallback` |
| `` `Score: ${score}` `` | `"Score: {$score}"` |
| `async`/`await` | no real equivalent — PHP is synchronous |

The last row is the one that matters. Everything above it is a syntax swap: you already think in
`array_map`, so `.map()` is a new spelling of a familiar idea. `wp_parse_args()` and object
spread solve the same "defaults plus overrides" problem. Optional chaining is the `isset()`
ladder you have written a thousand times, compressed. If you translate the table in both
directions once, most of modern JavaScript stops looking foreign.

**Where the analogy breaks down:** PHP is synchronous, and that shapes how you think about every
function you have ever written. `wp_remote_get()` blocks; the next line runs when the response
has arrived; there is one thread of execution and it is the one you are reading. JavaScript is
single-threaded but **asynchronous**: `fetch()` returns a Promise immediately, the function
yields, and the rest of your code runs before the response exists. `async`/`await` makes that
look sequential, which is a mercy, but the underlying model is genuinely different and it leaks
in ways PHP never does — a forgotten `await` gives you a `Promise` where you expected a value, a
`.map()` with an `async` callback gives you an array of Promises rather than an array of
results, and a rejected Promise nobody awaited fails silently. These are the mistakes to expect,
and this lesson makes each of them on purpose so you recognise the symptom later.
---

## Key Concepts

### 1. Modules: `import`/`export` versus globals, and versus PHP's `require`

In the jQuery era, code shared state through the global object. `wp_enqueue_script()` existed to
put files on the page in an order where the globals happened to exist before they were used, and
the dependency array was you telling WordPress what that order was.

```
CLASSIC WP                                  ESM
──────────────────────────────────────      ──────────────────────────────────────────────
wp_enqueue_script( 'btt-filters',           import { filterIncidents } from './filters.js';
  '/js/filters.js',                         import { renderTable }    from './table.js';
  array( 'jquery', 'btt-table' ),
  '1.0.2', true );                          · the file names ITS OWN dependencies
                                            · order is derived, not declared
· YOU maintain the order                    · nothing is global
· `window.$`, `window.bttTable`             · a typo is a build error, not `undefined`
```

| | `wp_enqueue_script` | PHP `require` | ESM `import` |
|---|---|---|---|
| Names its own dependencies | no — the caller does | the file does | the file does |
| Can be conditional | yes | yes — it is a statement | **no** — hoisted and static |
| What you get | side effects on `window` | everything the file defined | exactly the names you asked for |
| A missing name is | `undefined` at runtime | a fatal error | **a build error** |
| Tooling can see the graph | no | not reliably | **yes** |

`export const x`, `export function f()` and `export default` on one side;
`import { x, f } from './mod.js'` on the other. **Prefer named exports.** A default export has no canonical name, so every importer picks its
own and grep stops working. This course uses named exports everywhere except where a framework
demands otherwise (Module 09's route files).

The `import` being *static* is the part with consequences: `if (x) import './debug.js'` is not
legal, because the statement is hoisted above your code. A genuinely conditional load is
`await import()` — a different thing, with a different name, which is exactly right.

### 2. `const`, `let`, and the death of `var`

`var` is function-scoped and hoisted, which means it leaks out of blocks in ways that read as
bugs. `let` and `const` are block-scoped, and `const` additionally forbids reassignment.

| | `var` | `let` | `const` |
|---|---|---|---|
| Scope | the whole function | the enclosing `{ }` | the enclosing `{ }` |
| Reassign | yes | yes | **no** |
| In a `for` loop closure | one shared binding | **a fresh binding per iteration** | — |

The last row is the classic bug: a `setTimeout` inside `for (var i …)` logs `3, 3, 3`, because
all three closures captured the same binding. With `let` it logs `0, 1, 2`.

**`const` by default, `let` when you must reassign, `var` never.** The one honest caveat:
`const` freezes the *binding*, not the value. `const row = {}; row.blame = 5;` is legal — the
same distinction as a PHP object handle held in a variable you never reassign. If you want the
value frozen too, `Object.freeze()`, and you will rarely want it.

`blame.mjs` contains exactly one `let`, in `fetchGraphQL`, because `response` is assigned inside
a `try` and read after it. That is the shape of the rule in practice.

### 3. Arrow functions, and what happened to `this`

`function toRow(node) { return node.title; }`, `const toRow = function (node) { … }` and
`const toRow = (node) => node.title` are three spellings of one idea — the last with an implicit
return, no braces and no `return` keyword.

Two real differences, and only two:

| | `function` | `=>` |
|---|---|---|
| `this` | bound at **call time** by how it was called | inherited from the enclosing scope, permanently |
| `arguments` | available | absent |
| Can be a constructor | yes | no |
| Implicit return | no | yes, when the body is one expression |

The `this` behaviour is the one jQuery trained out of you in the wrong direction. In a jQuery
handler, `this` was the DOM element and the callback style depended on that. In modern code you
avoid `this` almost entirely — the closest PHP analogy is a closure that captures with
`use ($that)` versus one that does not, except an arrow function captures automatically and
cannot be rebound.

One trap worth memorising: to return an object literal implicitly you must wrap it in
parentheses — `(node) => ({ title: node.title })`. Without them, `{ … }` is read as a function
body containing a label, the function returns `undefined`, and nothing complains.

**Use arrows for callbacks — `.map()`, `.filter()`, `.sort()` — and named `function`
declarations for top-level functions.** Named functions get their name into stack traces, which
matters more than it sounds when a GraphQL error surfaces four frames deep.

### 4. Destructuring and spread

You already do this in PHP; the JavaScript version is just used far more often.

| PHP | JavaScript |
|---|---|
| `[$a, $b] = $arr;` | `const [a, b] = arr;` |
| `['title' => $t] = $arr;` | `const { title } = obj;` |
| `['title' => $t] = $arr;` with a rename | `const { title: heading } = obj;` |
| `$t = $arr['title'] ?? 'Untitled';` | `const { title = 'Untitled' } = obj;` |
| `array_merge($a, $b)` | `[...a, ...b]` |
| `wp_parse_args($args, $defaults)` | `{ ...defaults, ...args }` |
| `function f(...$rest)` | `function f(...rest)` |
| `f(...$args)` | `f(...args)` |

```js
// next-app/scripts/blame.mjs — destructuring in the wild (illustration)
const { title, slug, incidentDetails } = node; // pull three fields out
const { downtimeMinutes = 0 } = incidentDetails ?? {}; // nested, with a default
const [worst, ...rest] = rows; // first element, then the remainder

function report({ rows, limit = 10 }) {} // destructured parameters = named arguments
```

Destructured parameters give JavaScript the named arguments PHP 8 added. And
`{ ...defaults, ...args }` is `wp_parse_args()` exactly, including the "later wins" rule.

Spread is a **shallow** copy — `{ ...incident }` shares every nested object, exactly as PHP's
`clone` does. For a deep copy of plain data, Node 22 has `structuredClone(value)`.

### 5. Template literals

Backticks. Interpolation with `${}`, and multi-line without concatenation.

| PHP | JavaScript |
|---|---|
| `"Score: {$score}"` | `` `Score: ${score}` `` |
| `sprintf('%s (%d)', $t, $n)` | `` `${t} (${n})` `` |
| heredoc `<<<TXT` | a multi-line backtick string |

Any expression works inside `${}`, not just a variable — `` `${rows.length} incidents` ``. A
template literal is also how a GraphQL document gets into a JavaScript file: the Task writes
`const QUERY = /* GraphQL */` followed by a backtick string. That comment marker is not syntax,
it is a convention editors and codegen recognise so you get GraphQL highlighting and validation
inside a plain string. Module 10 replaces the pattern with `.graphql` documents.

### 6. `?.` and `??` — the two you already know from PHP 8

These are genuinely the same feature under the same name. If you use `?->` and `??` in PHP, you
are done here.

| PHP 8 | JavaScript | Result when the left side is null/undefined |
|---|---|---|
| `$obj?->prop` | `obj?.prop` | `null` / `undefined`, no error |
| `$arr['a']['b'] ?? null` | `arr?.a?.b` | `undefined`, no error |
| — | `arr?.[0]` | array/index access, guarded |
| `$a ?? $b` | `a ?? b` | `b` only when `a` is `null` or `undefined` |

The one difference to hold on to: **`??` is not `||`.**

```js
// next-app/scripts/blame.mjs — ?? versus || (illustration)
const minutes = incident.downtimeMinutes ?? 0; // 0 stays 0
const wrong = incident.downtimeMinutes || 0; // 0 becomes 0 — fine here
const label = incident.title ?? 'Untitled'; // '' stays ''
const alsoWrong = incident.title || 'Untitled'; // '' becomes 'Untitled' — a silent lie
```

`||` falls back on **any** falsy value, so a real `0` downtime or a genuinely empty string gets
replaced by your default. This matters constantly in a headless build, where `0` and `''` are
legitimate answers from the API and `null` means "not set". `blame.mjs` uses `??` everywhere for
exactly that reason.

### 7. Array methods, and the four places PHP habits mislead you

The concepts map one-to-one. The **signatures do not**, and this is where a fluent PHP developer
loses an hour.

| PHP | JavaScript | Watch out |
|---|---|---|
| `array_map($fn, $a)` | `a.map(fn)` | **PHP takes the callback first. Nothing else in PHP does.** |
| `array_filter($a, $fn)` | `a.filter(fn)` | PHP **preserves keys**; JS re-indexes. No `array_values()` needed |
| `array_reduce($a, $fn, $init)` | `a.reduce(fn, init)` | Same order. In JS, omitting `init` on an empty array **throws** |
| `array_search($n, $a)` | `a.indexOf(n)` / `a.findIndex(fn)` | Returns `-1`, never `false` |
| first match of a filter | `a.find(fn)` | Returns `undefined`, never `false` |
| `array_sum($a)` | `a.reduce((sum, n) => sum + n, 0)` | — |
| `count($a)` | `a.length` | A property, not a call |
| `usort($a, $cmp)` | `a.sort(cmp)` — mutates; `a.toSorted(cmp)` — copies | Default sort is **lexicographic**: `[10, 9].sort()` is `[10, 9]` |

The four real trip hazards, stated plainly:

1. **Argument order.** `array_map($fn, $a)` but `$a.filter($fn)`. Muscle memory from PHP will put
   the callback first, and JavaScript will hand you a `TypeError` several frames away.
2. **Callback arity.** PHP callbacks get the value. JavaScript callbacks get
   `(value, index, array)`, and any extra parameters your function accepts get filled in:

   ```js
   // next-app/scripts/blame.mjs — the canonical arity trap (illustration)
   ['1', '2', '3'].map(parseInt); // [1, NaN, NaN] — parseInt's 2nd arg is a radix
   ['1', '2', '3'].map((s) => parseInt(s, 10)); // [1, 2, 3] — say what you mean
   ```

3. **Keys.** `array_filter` leaves gaps in the numeric keys; `.filter()` returns a dense array.
4. **Mutation.** `.sort()` and `.reverse()` change the array in place *and* return it, so
   `const sorted = rows.sort(…)` has silently reordered `rows` too. Node 22's `.toSorted()` and
   `.toReversed()` copy instead — use them unless you mean to mutate.

Chaining is the point of all of this, and it reads top to bottom like a pipeline:

```js
// next-app/scripts/blame.mjs — the shape of the real thing (illustration)
const rows = data.incidents.nodes.map(toRow).sort((a, b) => b.blame - a.blame).slice(0, 10);
```

A comparator returns a **number**, not a boolean: negative for "a first", positive for "b
first", zero for "equal". `(a, b) => b.blame - a.blame` is descending. Returning `true`/`false`
from a comparator is a bug that produces almost-sorted output, which is the worst kind.

### 8. Truthiness, `==` and `===`

PHP had its own reckoning with this in version 8, when `0 == "foo"` stopped being `true`. Both
languages ended up somewhere defensible and **not in the same place**.

| Value | Truthy in PHP? | Truthy in JS? |
|---|---|---|
| `0`, `0.0` | no | no |
| `'0'` | **no** | **yes** |
| `''` | no | no |
| `[]` / `{}` (empty) | **no** | **yes** — every object is truthy |
| `null` | no | no |
| `undefined` | — | no |

The two rows in bold are the ones that will catch you. `if (rows)` is `true` for an empty array,
so the emptiness check in `blame.mjs` is `rows.length === 0`, not `!rows`.

`'1' == 1` is `true`, `'' == 0` is `true`, `[] == ''` is `true`, `null == 0` is `false`, and
`NaN === NaN` is `false` (use `Number.isNaN()`). `null == undefined` is `true`, and that is the
one genuinely useful case.

**Use `===` and `!==` always.** The one defensible exception is `value == null`, which catches
both `null` and `undefined`; the `eqeqeq` ESLint rule you enable in Lesson 07.5 permits exactly
that form and nothing else.

### 9. Promises, `async`/`await` and `Promise.all`

This is the row of the analogy table with no PHP equivalent, so it gets the most space.

A **Promise** is an object representing a result that does not exist yet. It is `pending`, then
either `fulfilled` with a value or `rejected` with an error. `await` suspends the enclosing
`async` function until it settles, and unwraps it — value returned, or error thrown.

```
PHP — synchronous                        JavaScript — asynchronous
────────────────────────────────────     ─────────────────────────────────────────────
$a = wp_remote_get($u1);   ← blocks      const p1 = fetch(u1);   ← returns a Promise NOW
$b = wp_remote_get($u2);   ← blocks      const p2 = fetch(u2);   ← returns a Promise NOW
// elapsed: t1 + t2                      const [a, b] = await Promise.all([p1, p2]);
                                         // elapsed: max(t1, t2)
```

| You want | Write |
|---|---|
| One result, then the next | `const a = await one(); const b = await two(a);` |
| Several independent results | `const [a, b] = await Promise.all([one(), two()]);` |
| Several, and one may fail | `const results = await Promise.allSettled([...]);` |
| A deadline | `AbortSignal.timeout(8_000)`, passed to `fetch` |

`Promise.all` rejects as soon as **any** input rejects — usually right for a page that cannot
render without all of its data. `Promise.allSettled` never rejects and hands you an array of
`{ status, value }` / `{ status, reason }`, which is what you want when a failing sidebar must
not take down the article.

The three mistakes, all of which you should make once on purpose:

| Mistake | Symptom |
|---|---|
| Forgotten `await` | `Promise { <pending> }` where a value should be; `.length` is `undefined`; `if (promise)` is always `true` |
| `async` callback inside `.map()` | An array of Promises, not results. Fix: `await Promise.all(items.map(async (i) => …))` |
| Rejection nobody handles | Node 22 terminates the process with `ERR_UNHANDLED_REJECTION`. In a browser it merely logs, to a console nobody has open |

```js
// next-app/scripts/blame.mjs — await inside map does NOT do what it looks like (illustration)
const wrong = nodes.map(async (n) => await enrich(n)); // Promise[] — every entry pending
const right = await Promise.all(nodes.map((n) => enrich(n))); // the values
```

`await` at the top level of a module is legal in ESM — another reason `blame.mjs` is an ES module
— but the script still wraps `main()` in `try`/`catch`, because an uncaught top-level rejection
prints a stack trace where you wanted one readable line.

### 10. `fetch`, JSON, and the three layers of a GraphQL error

`fetch` is built into Node 22; there is nothing to install. Its API has two behaviours that are
correct, surprising, and directly responsible for the most common headless-WordPress bug.

**`fetch` does not throw on an HTTP error.** A 404 or a 500 is a perfectly successful HTTP
exchange as far as `fetch` is concerned: the Promise fulfils, and `response.ok` is `false`. Only
network-level failure — DNS, connection refused, TLS, abort — rejects.

**GraphQL does not use HTTP status codes for GraphQL errors.** A query with a misspelled field
returns **HTTP 200** with a JSON body containing an `errors` array and usually `data: null`. So a
script that checks only `response.ok` sees a perfect request and prints "no incidents".

```
fetch(endpoint, …)
   │
   ├─ rejects? ───────────▶ LAYER 1  network: DNS, refused, TLS, AbortSignal timeout
   │
   ├─ response.ok false? ─▶ LAYER 2  HTTP 4xx/5xx — fetch did NOT throw. WordPress down,
   │                                  wrong path, PHP fatal (a 500 with an HTML body)
   │
   ├─ body.errors set? ───▶ LAYER 3  GraphQL: bad field, bad variable, permission denied.
   │                                  HTTP was 200 and everything above was happy
   │
   └─ body.data ──────────▶ your data. Individual fields inside may still be null
```

All three layers must be checked, in that order, and `blame.mjs` checks all three. Skipping
layer 3 is the bug this lesson exists to inoculate you against — Module 10 turns these checks
into `src/lib/graphql/errors.ts` and every query in the app goes through them.

JSON handling is mercifully dull. `JSON.parse(s)` is `json_decode($s, true)` with no assoc flag
— you always get objects. `JSON.stringify(v)` is `json_encode($v)`, and it silently drops
`undefined` and functions while turning a `Date` into an ISO string. And `await response.json()`
parses the body, **throwing** if the body is not JSON.

That last one matters: when WordPress emits a PHP notice before its JSON, `response.json()`
throws `SyntaxError: Unexpected token '<'`. If you ever see that, the response body is HTML —
`curl` the endpoint and read it. This is also why Lesson 02.2 set `WP_DEBUG_DISPLAY` to `false`.

**The same request, twenty years apart:**

```
jQuery era                                  This lesson
─────────────────────────────────────       ─────────────────────────────────────────────
$.ajax({                                    const res = await fetch(endpoint, { … });
  url: endpoint, type: 'POST',              if (!res.ok) throw new Error(res.status);
  data: JSON.stringify({ query: q }),       const body = await res.json();
  success: function (body) {                if (body.errors) throw new Error(…);
    var rows = [];
    $.each(body.data.incidents.nodes,       const rows = body.data.incidents.nodes
      function (i, n) {                       .map(toRow)
        rows.push({ title: n.title,           .sort((a, b) => b.blame - a.blame);
          blame: n.blameScore || 0 });
      });
    render(rows);
  },
  error: function () { /* network only */ } });
```

Same work. The differences that are not cosmetic: errors travel with the value instead of into a
separate callback, the timeout is expressed rather than hoped for, and the transformation is a
pipeline you can read instead of a loop pushing into an accumulator.

---

## Task

### Step 1: Point the script at your endpoint, in this shell only

The endpoint is configuration, not a constant. Export it into this shell session — do **not**
create an env file. `next-app/.env.example` is Lesson 09.1's job and is the only env file this
project ever commits.

```bash
cd next-app
export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql
echo "$WP_GRAPHQL_ENDPOINT"
```

Confirm WordPress is actually answering before you blame your JavaScript:

```bash
curl -s -X POST "$WP_GRAPHQL_ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ title blameScore } } }"}'
```

**Verify §1:**

- [ ] The `curl` prints JSON containing a `title` and a numeric `blameScore`.
- [ ] If it prints an `errors` array mentioning `blameScore`, go back to Lesson 06.1 — the field
      is registered there.
- [ ] If it prints HTML, the stack is not up — run `docker compose ps` in `wordpress-headless/`.

### Step 2: Create the script directory

```bash
mkdir -p scripts
```

### Step 3: Write `scripts/blame.mjs`

Type it. Every construct in here is one you will use in every file for the next seventeen
modules, and the syntax reaching your fingers is the actual deliverable.

```js
// next-app/scripts/blame.mjs
// The blame leaderboard, straight out of WPGraphQL. Plain ESM, zero dependencies.
//   export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql && npm run blame
// The endpoint is never hard-coded: it differs per environment, and a URL frozen into a
// committed file is one habit away from a credential frozen into a committed file.

const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
const limit = Number(process.env.BLAME_LIMIT ?? 10);
const TIMEOUT_MS = 8_000;

const QUERY = /* GraphQL */ `
  query BlameBoard($first: Int!) {
    incidents(first: $first, where: { orderby: { field: DATE, order: DESC } }) {
      nodes {
        id
        title
        slug
        blameScore
        severities(first: 1) {
          nodes { name slug }
        }
        scapegoats(first: 1) {
          nodes { name slug }
        }
        incidentDetails {
          downtimeMinutes
          environment
        }
      }
    }
  }
`;

// POST one GraphQL operation and return `data`, or throw something a human can act on.
async function fetchGraphQL(query, variables) {
  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      // fetch has NO default timeout. Without this, a wedged WordPress wedges the script.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    // LAYER 1 — fetch rejects only for network-level failure: DNS, refused, aborted.
    throw new Error(`cannot reach ${endpoint} within ${TIMEOUT_MS} ms`, { cause });
  }

  // LAYER 2 — a 4xx/5xx is a RESOLVED promise. fetch does not throw on HTTP status.
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${endpoint}`);
  }

  const body = await response.json();

  // LAYER 3 — GraphQL answers 200 with an `errors` array. This is the check people forget.
  if (body.errors?.length) {
    const detail = body.errors.map((error) => error.message).join('\n  - ');
    throw new Error(`GraphQL reported ${body.errors.length} error(s):\n  - ${detail}`);
  }

  if (!body.data) {
    throw new Error('the response contained neither `data` nor `errors`');
  }

  return body.data;
}

// One GraphQL node into one flat row: destructuring, optional chaining and `??`.
function toRow(node) {
  const { title, slug, blameScore, incidentDetails } = node;

  return {
    title,
    slug,
    blame: Math.round(blameScore ?? 0),
    severity: node.severities?.nodes?.[0]?.slug ?? 'unclassified',
    scapegoat: node.scapegoats?.nodes?.[0]?.name ?? 'nobody yet',
    minutes: incidentDetails?.downtimeMinutes ?? 0,
    environment: incidentDetails?.environment ?? 'UNKNOWN',
  };
}

const COLUMNS = [
  { key: 'blame', label: 'BLAME', width: 6 },
  { key: 'severity', label: 'SEVERITY', width: 17 },
  { key: 'minutes', label: 'MIN', width: 5 },
  { key: 'scapegoat', label: 'SCAPEGOAT', width: 22 },
  { key: 'title', label: 'INCIDENT', width: 42 },
];

function cell(value, width) {
  const text = String(value);
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

function renderTable(rows) {
  const header = COLUMNS.map(({ label, width }) => cell(label, width)).join(' ');
  const rule = COLUMNS.map(({ width }) => '─'.repeat(width)).join(' ');
  const body = rows.map((row) => COLUMNS.map(({ key, width }) => cell(row[key], width)).join(' '));

  return [header, rule, ...body].join('\n');
}

async function main() {
  if (!endpoint) {
    throw new Error(
      'WP_GRAPHQL_ENDPOINT is not set.\n' +
        '  export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql'
    );
  }

  const data = await fetchGraphQL(QUERY, { first: limit });
  const rows = (data.incidents?.nodes ?? []).map(toRow).sort((a, b) => b.blame - a.blame);

  // An empty array is TRUTHY — `if (!rows)` would never fire. Key Concept 8.
  if (rows.length === 0) {
    console.log('No incidents found. Seed the site, then try again:');
    console.log('  docker compose run --rm wpcli wp blame seed --fresh');
    return;
  }

  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
  const catastrophic = rows.filter((row) => row.severity === 's1-catastrophic');
  const [worst] = rows;

  console.log(`\nBlame board — the ${rows.length} most recent incidents\n`);
  console.log(renderTable(rows));
  console.log(
    `\n${rows.length} incidents · ${totalMinutes} minutes of downtime · ` +
      `${catastrophic.length} catastrophic · top scapegoat: ${worst.scapegoat}\n`
  );
}

try {
  await main();
} catch (error) {
  console.error(`\nblame: ${error.message}`);
  if (error.cause) {
    console.error(`  cause: ${error.cause.message}`);
  }
  // `exitCode`, not `exit(1)`: this lets buffered output flush before the process ends.
  process.exitCode = 1;
}
```

### Step 4: Wire the npm script

Replace the `blame` placeholder from Lesson 07.1:

```bash
npm pkg set scripts.blame="node scripts/blame.mjs"
npm run blame
```

**Verify §4:**

- [ ] A table prints, with a `BLAME` column of numbers descending.
- [ ] Severity slugs look like `s1-catastrophic` — contract slugs, not display names.
- [ ] The footer line names a top scapegoat, and `echo $?` prints `0`.

### Step 5: Break it three ways, on purpose

Each break exercises one of the three error layers, and each has a distinct symptom you want to
recognise later at 6 pm on a Friday.

```bash
# LAYER 0 — configuration missing
env -u WP_GRAPHQL_ENDPOINT npm run blame; echo "exit=$?"
# Expected: "WP_GRAPHQL_ENDPOINT is not set", then exit=1

# LAYER 1 — nothing listening on that port
WP_GRAPHQL_ENDPOINT=http://localhost:9/graphql npm run blame; echo "exit=$?"
# Expected: "cannot reach …", a cause line, then exit=1

# LAYER 2 — a real server, wrong path. WordPress answers 404 with HTML.
WP_GRAPHQL_ENDPOINT=http://localhost:8080/not-graphql npm run blame; echo "exit=$?"
# Expected: an HTTP 404 message, then exit=1
```

Now the important one — layer 3. Introduce a typo in the query on purpose: change
`blameScore` to `blaimScore` in `scripts/blame.mjs`, run it, and read the output.

**Verify §5:**

- [ ] The typo produces `GraphQL reported 1 error(s):` and a message naming the unknown field.
- [ ] `echo $?` prints `1`.
- [ ] **The HTTP status was 200.** Had the script checked only `response.ok`, it would have
      printed an empty table and exited `0` — a green script reporting nothing wrong.
- [ ] Fix the typo back to `blameScore` and confirm the table returns.

### Step 6: Commit

```bash
cd .. && git add next-app/package.json next-app/scripts/blame.mjs
git commit -m "feat(web): query WPGraphQL from a plain ESM node script"
```

---

## Verification

```bash
cd next-app
export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql

# 1. The stack is answering the query this script sends
curl -s -X POST "$WP_GRAPHQL_ENDPOINT" -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ title blameScore } } }"}' | head -c 120
# Expected: {"data":{"incidents":{"nodes":[{"title":"…","blameScore":…

# 2. The script runs and prints a table
npm run blame
# Expected: a BLAME / SEVERITY / MIN / SCAPEGOAT / INCIDENT table, then a summary line

# 3. It exits zero on success, and the row count honours the environment, not a hard-coded constant
npm run blame >/dev/null 2>&1; echo "exit=$?"
BLAME_LIMIT=3 npm run blame | grep 'incidents ·'
# Expected: exit=0, then a line starting "3 incidents · " — the limit came from the environment

# 4. NEGATIVE — missing configuration fails loudly instead of defaulting
env -u WP_GRAPHQL_ENDPOINT npm run blame 2>&1 | grep -c 'WP_GRAPHQL_ENDPOINT is not set'
env -u WP_GRAPHQL_ENDPOINT npm run blame >/dev/null 2>&1; echo "exit=$?"
# Expected: 1, then exit=1

# 5. NEGATIVE — layers 1 and 2. Nothing on port 9; then a real server on the wrong path.
WP_GRAPHQL_ENDPOINT=http://localhost:9/graphql npm run blame 2>&1 | grep -c 'cannot reach'
WP_GRAPHQL_ENDPOINT=http://localhost:8080/not-graphql npm run blame 2>&1 | grep -c 'HTTP 404'
# Expected: 1, then 1 — note that the 404 did NOT make fetch throw

# 6. NEGATIVE — layer 3, the whole point. A bad field is HTTP 200 with an errors array.
curl -s -o /dev/null -w 'status=%{http_code}\n' -X POST "$WP_GRAPHQL_ENDPOINT" \
  -H 'Content-Type: application/json' -d '{"query":"{ incidents(first:1){ nodes{ nope } } }"}'
# Expected: status=200   ← a 200 that carries an error. This is why layer 3 exists.

curl -s -X POST "$WP_GRAPHQL_ENDPOINT" -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ nope } } }"}' | grep -c '"errors"'
# Expected: 1

# 7. No endpoint is hard-coded into the request
grep -c 'localhost' scripts/blame.mjs
# Expected: 2 — both of them help text (the header comment and the error message).
#           fetch() is called with `endpoint`, which comes from the environment.

# 8. Nothing secret and nothing generated is staged
cd .. && git status --short next-app/
# Expected: package.json and scripts/blame.mjs only. No node_modules, no .env
```

If check 6 prints anything but `status=200`, something in front of WordPress is rewriting
responses — investigate before Module 10 builds a client on this assumption.

## Control Questions

1. `fetch` resolved, `response.ok` was `true`, and the table printed zero rows while WordPress
   held forty incidents. Name the check that was missing, why the HTTP status could not have told
   you, and where in the script that check belongs.
2. `const minutes = incident.downtimeMinutes || 0` and
   `const minutes = incident.downtimeMinutes ?? 0` differ for exactly one input value that this
   API genuinely returns. Name the value, and describe what the user sees in each case.
3. Rewrite `nodes.map(async (n) => await enrich(n))` so it produces enriched values rather than
   Promises, and say what `rows.length` would have been in the broken version.
4. `array_map($fn, $a)` and `$a.map(fn)` take their arguments in opposite orders, and
   `['1','2','3'].map(parseInt)` returns `[1, NaN, NaN]`. Explain the second one, and say what
   the two facts have in common.
5. `if (rows)` is `true` when `rows` is `[]`, and `if ($rows)` is `false` when `$rows` is `[]` in
   PHP. Given that, explain why `blame.mjs` tests `rows.length === 0`, and name one other value
   whose truthiness differs between the two languages.

## Learn More

- [MDN: Destructuring assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring)
  — the nested and default-value forms, which are where it stops being obvious
- [MDN: Optional chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining)
  — including `?.[]` and `?.()`, both of which `blame.mjs` uses
- [MDN: Nullish coalescing](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing)
  — read the "short-circuiting" section, then never write `||` for a default again
- [MDN: Array instance methods](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array#instance_methods)
  — which methods mutate and which copy, the reference behind Key Concept 7
- [MDN: Using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)
  — the clearest explanation of chaining, error propagation and the composition helpers
- [MDN: Using the Fetch API — checking success](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#checking_that_the_fetch_was_successful)
  — Mozilla stating plainly that a 404 is not an error
- [MDN: `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
  — the one-line deadline used in `fetchGraphQL`
- [GraphQL spec: Response format](https://spec.graphql.org/October2021/#sec-Response) — the
  normative statement that `errors` and `data` travel together in a 200 response
