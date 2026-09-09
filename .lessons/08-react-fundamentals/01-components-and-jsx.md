---
title: 'Components & JSX'
module: 8
lesson: 1
teaches: [react-components, jsx, react-dom-client, vite-scratch-harness]
produces: ['next-app/src/components/incidents/IncidentCard.tsx']
requires: [7.5]
---

# Lesson 08.1 — Components & JSX

## Quick Overview

React is a library with a very small surface: you write functions that return markup, and
React works out what the browser should look like. That is the whole idea. Everything else —
hooks, context, Server Components — is machinery built on top of it. This lesson gets you to
the point where you can write one of those functions, render it into a real page, and change
it and watch it update, without Next.js in the way.

You will build `IncidentCard`, the component that shows a single Blame The Tech incident. In
this lesson it renders hard-coded content, because the goal is the syntax and the render
mechanics, not the data. To see it in a browser you set up a throwaway Vite harness in
`next-app/scratch/` — thirty lines, gitignored, deleted in Lesson 09.1. Keeping the harness
separate from the real app is deliberate: React and Next.js are two different technologies,
and learning them simultaneously is why so many WordPress developers bounce off this part of
the stack.

By the end of this lesson you will have:

- `next-app/src/components/incidents/IncidentCard.tsx` — a typed React component rendering incident markup
- `react`, `react-dom` and their `@types` packages installed in `next-app/package.json`
- A gitignored Vite harness at `next-app/scratch/` that mounts the component with `createRoot`
- A running dev server on `http://localhost:5173` that hot-reloads when you edit the component
- A working answer to "what does JSX compile to?", verified by reading the compiled output

## Classic WP Analogy

You have written this component already, in PHP, hundreds of times:

| Classic WordPress | React |
|---|---|
| `template-parts/card-incident.php` | `src/components/incidents/IncidentCard.tsx` |
| `get_template_part('template-parts/card', 'incident')` | `<IncidentCard />` |
| `the_title()`, `esc_html($x)` | `{incident.title}` — escaped automatically |
| `<?php if ($x) : ?> … <?php endif; ?>` | `{x && …}` — an expression, not a statement |
| `class="incident-card"` | `className="incident-card"` |
| Child theme overrides the file | Nothing overrides it; you pass different props |

The mechanical difference is that a template part **echoes** — it writes into PHP's output
buffer and returns nothing useful — while a component **returns a value**. That value is a
plain JavaScript object describing what the UI should be, and React decides what to do with
it. `<IncidentCard />` is not "include this file", it is a function call whose result you can
store in a variable, put in an array, or pass to another component.

Here is where the analogy breaks, and it breaks in a way that will bite you within an hour:
**JSX is not a template language.** It has no `{{ }}`, no `@if`, no filters, no partial
inclusion by string name. It is JavaScript expression syntax that a compiler rewrites into
function calls, which is why `class` is a reserved word and becomes `className`, why you write
`{list.map(...)}` instead of a `foreach` block, and why you cannot drop an `if` statement into
the middle of returned markup — an `if` is a statement, and only expressions fit inside `{}`.
The second break is the one WordPress developers feel most: there is no `global $post` and no
`setup_postdata()`. A component knows nothing except what you hand it as props. That feels
like extra typing in Lesson 08.1 and turns into the reason the whole app is testable by
Module 12.

---

## Key Concepts

### 1. A component is a function that returns a value

A React component is a JavaScript function whose name starts with a capital letter and whose
return value describes UI. That is the entire definition. There is no base class to extend, no
interface to implement, no registration step, and no file-naming convention the framework
enforces.

The word **returns** is doing all the work. `get_template_part()` writes into PHP's output
buffer and hands you back `void`; `IncidentCard()` writes nothing anywhere and hands you back an
object. Everything React can do — reordering a list, rendering the same card twice with
different data, rendering it on a server and shipping the result as HTML — follows from the fact
that the description is a value you can hold.

```
get_template_part('template-parts/card','incident')
   │
   ├── opens the file, executes it, echoes into the output buffer
   └── returns void  ────────────────▶  nothing you can inspect

<IncidentCard />
   │
   ├── calls IncidentCard(), which returns a plain object
   └── returns { type: IncidentCard, props: {}, key: null }
                  │
                  └── React reads it and decides what the DOM should become
```

That object is called a **React element**. It is not a DOM node, it is not HTML, and it is not a
string. It is a description, and it is cheap to make — a few property assignments. React makes a
new one for every component on every render and compares the new description with the old one.

> **"It is just an object" is the load-bearing insight of this whole module.** If you keep it,
> every later surprise becomes predictable: why you can put elements in an array, why `key` is
> needed to tell two similar objects apart, why a component that returns the same description
> renders nothing new, and why Module 09 can run this exact function on a server where there is
> no DOM at all. If you lose it and start thinking of `<IncidentCard />` as "include that file",
> Lesson 08.3 will stop making sense.

| | `get_template_part()` | A React component |
|---|---|---|
| Identified by | a file path, resolved at run time | an imported binding, resolved at build time |
| Receives data via | `global $post`, plus an unchecked `$args` array | a typed props object, checked by `tsc` |
| Produces | output, immediately | a value, immediately; output later, if React decides |
| Can be called twice | yes, and it echoes twice | yes, and you get two independent elements |
| Overridable | yes, by a child theme, by file path | no — you pass different props, or compose it |
| Failure mode of a typo | a silently missing include | a build error naming the file and line |

The last row is worth stopping on. `get_template_part('template-parts/card', 'incidnet')` prints
nothing and reports nothing. `import { IncidentCrad } from './IncidentCard'` fails before the
code ever runs.

### 2. JSX compiles to function calls

JSX is not a template language and not part of JavaScript. It is a syntax extension that a
compiler rewrites into ordinary function calls before anything runs. In this project the
compiler is esbuild, driven by Vite; from Lesson 09.1 it is Next's own compiler. Neither
changes the rule.

```
YOU WRITE                                    THE COMPILER EMITS
────────────────────────────────────────     ────────────────────────────────────────
<h2 className="t">{title}</h2>               jsx('h2', { className: 't',
                                                        children: title })

<article>                                    jsxs('article', { children: [
  <h2>{title}</h2>                             jsx('h2', { children: title }),
  <p>{blame}</p>                               jsx('p',  { children: blame }),
</article>                                   ] })

<IncidentCard incident={x} />                jsx(IncidentCard, { incident: x })
```

`jsx` and `jsxs` come from `react/jsx-runtime`, which the compiler imports for you — that is
what `"jsx": "react-jsx"` in `tsconfig.json` selects. `jsxs` is the multiple-children variant;
the distinction is an optimisation and you never write either name yourself.

Three long-standing confusions dissolve the moment you read that middle column:

| Confusion | Explanation |
|---|---|
| Why `className`, not `class`? | The second argument is a **JavaScript object literal**, and `class` is a reserved word. Same reason `for` on a label becomes `htmlFor`. |
| Why can't I put an `if` in there? | Object property values are expressions. `if` is a statement. There is no syntax for a statement in that position. |
| Why does the attribute order not matter, but duplicate attributes lose? | They are object keys. The last one wins, silently. |

> **Read the compiled output once, today.** The Verification block below pipes
> `IncidentCard.tsx` through esbuild so you can see the `jsx()` calls with your own eyes. Five
> minutes there saves a week of treating JSX as magic. Every JSX question you will ever have —
> spread attributes, conditional attributes, why a `<>` fragment costs nothing — is answerable
> by asking "what object does that produce?"

### 3. Expressions go in braces; statements do not

`{}` inside JSX opens a slot for exactly one **expression**: something that evaluates to a
value. This is the single rule behind everything that looks like control flow in JSX.

| Works, and why | Does not work, and why |
|---|---|
| `{incident.title}` — a property access is an expression | `{if (x) { … }}` — `if` is a statement |
| `{cond ? <p>yes</p> : null}` — the conditional operator is an expression | `{for (…) { … }}` — `for` is a statement |
| `{cond && <p>maybe</p>}` — `&&` is an expression | `{switch (x) { … }}` — a statement |
| `{list.map((i) => <li key={i.slug}>{i.title}</li>)}` — a method call is an expression | `{const y = 1;}` — a declaration |
| `{`${n} min`}` — a template literal is an expression | `{return null}` — a statement |

The escape hatch is not a clever JSX trick. It is to compute above the `return`, in plain
JavaScript, where statements are legal:

```
function IncidentCard({ incident }) {
  let label;                          ← ordinary JavaScript. Any statement you like.
  switch (incident.status) { … }
  if (…) { … }

  return (
    <article>{label}</article>        ← JSX only needs the finished expression
  );
}
```

This is the opposite of the habit a template language builds. In Twig or Blade you push logic
*into* the template because the template is all you have. In JSX the template is inside a
function, so you push logic *out* of the markup and into the function body, and the markup stays
readable. Lessons 08.2 and 08.3 both lean on that.

### 4. Capitalisation decides whether it is your component or an HTML tag

The compiler distinguishes the two cases by the first character of the tag name, and by nothing
else.

```
<article />        → jsx('article', {})        a STRING. React looks for a DOM element.
<IncidentCard />   → jsx(IncidentCard, {})     an IDENTIFIER. React calls your function.
<incidentCard />   → jsx('incidentCard', {})   a STRING. React looks for a DOM element
                                               called <incidentcard>, finds nothing useful,
                                               and renders an empty unknown element.
```

`<incidentCard />` is legal JavaScript, produces no error at run time, and renders nothing you
wanted. In plain JavaScript that bug can survive a code review. Here it does not: TypeScript
knows the list of valid HTML tag names, so it rejects `incidentCard` with an error that names
the tag. The Verification block proves both halves — that the compiler emits a string, and that
`tsc` refuses it.

⚠️ The same rule applies to a component you reach through an object. `<icons.Warning />` works
because the compiler sees a member expression, not an identifier starting with a lowercase
letter. This trips people up in Module 11 when a component library is namespaced.

### 5. Escaping is the default, and there is no way to forget it

In a WordPress template every echoed value needs a deliberate escaper chosen to match its
context: `esc_html()` in body text, `esc_attr()` in an attribute, `esc_url()` in `href`. Forget
one and you have an XSS hole. The discipline is entirely yours.

JSX inverts it. Anything you interpolate — in a child slot or an attribute — is inserted as
**text**, never parsed as markup:

| You write | The browser shows |
|---|---|
| `{'<b>bold</b>'}` | the literal characters `<b>bold</b>` |
| `title={'" onmouseover="alert(1)'}` | an attribute whose value is that exact string |
| `<pre>{incident.incidentDetails?.stackTrace}</pre>` | the trace, verbatim, with `<` and `&` intact |

There is one opt-out, `dangerouslySetInnerHTML`, and its name is a deliberate act of hostile
design: it is long, it is ugly, it takes an object rather than a string
(`dangerouslySetInnerHTML={{ __html: html }}`), and you cannot type it by accident.

> **The stack trace is escaped, and that is the contract, not a convenience.**
> [Appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) says
> `stack_trace` is rendered in a `<pre>` and **escaped, never as HTML** — an incident's stack
> trace is attacker-supplied text from Module 16 onward. `<pre>{stackTrace}</pre>` satisfies
> that with no code. Lesson 09.3 will use `dangerouslySetInnerHTML` on a post's `content`
> field, and it will label it a dated debt every single time, because that is a WordPress
> field that legitimately contains markup. Module 14 pays it off with one sanitising component.
> Nothing in Module 08 opts out of escaping, and the Verification block checks that.

### 6. One root per return, and what a fragment costs

A component returns one element. Two sibling elements at the top of a `return` are a syntax
error, because the compiler would have to emit two function calls where one value is expected.

```
❌  return (                        ✅  return (              ✅  return (
      <h2>…</h2>                        <>                        <article>
      <p>…</p>                            <h2>…</h2>                <h2>…</h2>
    );                                    <p>…</p>                  <p>…</p>
                                        </>                       </article>
                                      );                        );
```

`<>…</>` is a **fragment**: a grouping that produces no DOM node. The long form,
`<Fragment key={…}>`, is the one you need when a fragment is inside a `.map()` and therefore
needs a `key` — Lesson 08.2 hits that.

The choice between a fragment and a wrapper `<div>` is not stylistic:

| | `<>…</>` | `<div>…</div>` |
|---|---|---|
| In the DOM | nothing | an element |
| Affects CSS layout | no | yes — it becomes a flex or grid child |
| Affects accessibility tree | no | usually not, but it can break `<dl>`, `<ul>` and `<table>` structure |
| Can take a `key` | only as `<Fragment key>` | yes |

**Prefer the fragment.** Reach for a wrapper element only when you actually want a box, or when
the correct HTML demands one. Wrapper `<div>`s added out of habit are how a codebase acquires
six nested divs around every card, and Module 11's grid and typography rules will care: a stray
`<div>` between a `<ul>` and its `<li>` children is invalid HTML that browsers silently repair,
differently.

### 7. `createRoot`, and the one mount point

Nothing renders until you ask. `react-dom/client` exposes `createRoot(container)`, which takes a
real DOM element and returns a root object with a `.render(element)` method.

```
scratch/index.html            <div id="root"></div>
        │
scratch/main.tsx              const container = document.getElementById('root')!;
        │                     createRoot(container).render(<App />);
        │
scratch/App.tsx               <App />  →  <IncidentCard />  →  <article>…</article>
        │
        ▼
the DOM inside #root          React owns every node under here. Do not touch it
                              from outside React — that is the jQuery habit this
                              whole model replaces.
```

One root per application. Calling `createRoot` twice on the same container is an error; React
tells you so. React 19 ships **only** the `react-dom/client` API — `ReactDOM.render` was removed
in React 19, so any tutorial that opens with `import ReactDOM from 'react-dom'` and calls
`ReactDOM.render(…, document.getElementById('root'))` is pre-18 and will hand you a removed
function. `react-dom/server` still exists and Module 09 leans on it heavily; you will use it
directly, once, in Lesson 08.5's Verification.

`document.getElementById()` returns `HTMLElement | null`, and `createRoot` refuses `null`. The
`!` in `main.tsx` is a **non-null assertion**: you are telling the compiler "I have read the
HTML, this element exists". It is the first time strict TypeScript meets the DOM, and it is the
one place in this course where `!` is honest — the element is declared two files away, in a file
you own, and you can verify the claim by reading it. Everywhere else, narrow with a real check.

### 8. `StrictMode` double-invokes your components, on purpose

Wrap the tree in `<StrictMode>` and React deliberately does three things extra in development:
it calls every component function twice, it runs every effect's setup, then its cleanup, then
its setup again, and it double-invokes state updater functions.

| | Development, inside `StrictMode` | Production build |
|---|---|---|
| Component function calls per render | 2 | 1 |
| Effect setup on mount | setup, cleanup, setup | setup |
| Purpose | surface impure renders and missing cleanup | none — the checks are stripped |

This is a feature, and it is established here rather than in Lesson 08.4 so that the double-run
is old news by the time it matters. It exists to break two specific kinds of wrong code
immediately rather than intermittently:

- A component that **mutates something outside itself while rendering** — pushing to a
  module-level array, incrementing a counter, writing to `localStorage` — produces visibly
  doubled results.
- An effect that **subscribes without unsubscribing** leaks on the very first mount, instead of
  waiting for a user to navigate away and then back.

> **If a doubled log line makes you delete `StrictMode`, you have thrown away the smoke
> detector because it went off.** Every doubled render in this module is either harmless (a
> `console.log`) or a genuine bug in your code. Lesson 08.4 exploits it deliberately. Leave it
> on; Lesson 09.1 keeps the equivalent behaviour in Next's dev server whether you like it or
> not.

---

## Task

### Step 1: Check the licences, then install React 19

Lesson 07.1 Key Concept 9 established the habit: `next-app` is MIT and takes no GPL
dependency, so the licence gets checked before the install, once per batch.

```bash
cd next-app

npm view react license
npm view react-dom license
npm view vite license
npm view @vitejs/plugin-react license
# Expected: MIT for all four
```

React and `react-dom` are **runtime dependencies** — they ship to the browser. Everything else
here is a build-time or type-only tool and belongs in `devDependencies`.

```bash
npm install react@^19 react-dom@^19

npm install --save-dev \
  @types/react \
  @types/react-dom \
  vite \
  @vitejs/plugin-react \
  eslint-plugin-react@^7.37.0 \
  eslint-plugin-react-hooks
```

**Verify §1:**

- [ ] `npm pkg get dependencies` lists **only** `react` and `react-dom`. If `vite` is in there,
      move it: `npm uninstall vite && npm install --save-dev vite`.
- [ ] `npm ls react` shows a single version. Two copies of React in one tree is the cause of the
      "invalid hook call" error you will otherwise meet in Lesson 08.3.

### Step 2: Move `tsconfig.json` from Node resolution to bundler resolution

Lesson 07.3 configured TypeScript to resolve modules exactly the way Node does, because the only
consumer was `node scripts/blame.mjs`. From this lesson on, a **bundler** reads your imports.
That is a different resolution algorithm with different rules, and the config has to say so.

Replace `next-app/tsconfig.json` with this. Six things change and the comments mark each one:

```jsonc
// next-app/tsconfig.json
{
  "compilerOptions": {
    /* ── Language and libraries ─────────────────────────────────────── */
    "target": "ES2023",
    // CHANGED: a browser exists now. DOM gives you `document` and the element
    // types; DOM.Iterable makes NodeList and FileList work in a for..of.
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    // NEW: compile JSX to jsx()/jsxs() imported from react/jsx-runtime, so no
    // file needs `import React`. Lesson 09.1 changes this to "preserve".
    "jsx": "react-jsx",
    // React's types travel with its imports, so only @types/node is global.
    "types": ["node"],

    /* ── Modules ────────────────────────────────────────────────────── */
    // CHANGED: emit plain ES modules and let the bundler decide the rest.
    "module": "ESNext",
    // CHANGED: resolve the way esbuild, Vite and Next do — extensionless
    // specifiers, "exports" maps honoured, no CommonJS interop guesswork.
    "moduleResolution": "bundler",
    // NEW: one alias for the whole project. `@/types/content`, never
    // `../../../types/content`. The Vite config repeats it in Step 4.
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "moduleDetection": "force",
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,

    /* ── Output ─────────────────────────────────────────────────────── */
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,

    /* ── Correctness — untouched. All of Lesson 07.3 still applies. ─── */
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  // CHANGED: .tsx files are components, and they are in the type-check surface.
  "include": ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts"]
}
```

What each change buys you, and what it costs:

| Change | Was | Now | Consequence |
|---|---|---|---|
| `jsx` | absent | `react-jsx` | `.tsx` files compile. Without it, every `<article>` is a syntax error. |
| `lib` | `["ES2023"]` | `+ DOM`, `+ DOM.Iterable` | `document`, `HTMLInputElement`, `setTimeout`. Also means a typo like `docuemnt` is now the *only* thing stopping you from writing browser code in a server file — Lesson 09.2 has more to say. |
| `module` | `NodeNext` | `ESNext` | No CommonJS emit path at all. |
| `moduleResolution` | `NodeNext` | `bundler` | `import { X } from './X'` resolves without an extension. Under `NodeNext` that was an error. |
| `baseUrl` + `paths` | absent | `@/* → ./src/*` | Every import in Modules 08 to 24 is `@/…`. A file can move between directories without rewriting its imports. |
| `include` | `src/**/*.ts` | `+ src/**/*.tsx` | Components are type-checked. |

Two things deliberately **not** in that list. `allowImportingTsExtensions` stays on, so
`scripts/blame.ts` keeps its `'../src/types/content.ts'` import and keeps running under `tsx`.
And `strict` and its companions are untouched: `noUncheckedIndexedAccess` in particular is about
to become the most talked-about flag in Lesson 08.2.

**Verify §2:**

- [ ] `npx tsc --showConfig | grep -E '"(jsx|moduleResolution)"'` prints `react-jsx` and
      `bundler`.
- [ ] `npm run type-check` is silent. Nothing you have written yet uses JSX, so this only proves
      the config parses and `scripts/blame.ts` survived the change.

### Step 3: Teach ESLint about React and hooks

Two plugins, added as flat-config blocks in `next-app/eslint.config.mjs`. The hooks rules do not
matter until Lesson 08.3, and they are wired now so that they are never retrofitted onto broken
code.

Add the two imports at the top of the file, beside the existing three:

```js
// next-app/eslint.config.mjs — edit: two new imports at the top
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
```

Then insert these two blocks **immediately before** `prettier`, which must stay last for the
reason Lesson 07.5 gave — `eslint-config-prettier` only disables rules, so anything after it
could switch a formatting rule back on and start a fight:

```js
// next-app/eslint.config.mjs — edit: insert both blocks directly above `prettier`
  // ── React ─────────────────────────────────────────────────────────────
  // .ts as well as .tsx: a custom hook is a plain function in a .ts file, and
  // rules-of-hooks has to see it (Lesson 08.4 writes one).
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,

      // Off because `jsx: react-jsx` compiles JSX with no React import. These
      // two would fire on every component file in the project.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // Off because TypeScript types the props. propTypes are the runtime
      // alternative and this project has a compile-time one.
      'react/prop-types': 'off',

      // Calling a hook conditionally breaks React's internal ordering. There is
      // no valid reason to do it, so: error.
      'react-hooks/rules-of-hooks': 'error',

      // The plugin ships this as a warning. `npm run lint` runs with
      // --max-warnings=0 (Lesson 07.5), so a warning already fails the build —
      // calling it a warning only hides which line is at fault.
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // The throwaway harness from Step 4 is outside tsconfig.json's `include`, so
  // the type-aware rules have no program to consult for it. Turn those off here
  // rather than adding a disposable directory to the type-check surface. The
  // syntactic rules, including rules-of-hooks, still apply. Lesson 09.1 deletes
  // the directory and this block with it.
  {
    files: ['scratch/**/*.{ts,tsx}'],
    ...tseslint.configs.disableTypeChecked,
  },
```

**Verify §3:**

- [ ] `npx eslint --print-config src/types/content.ts | grep -c react-hooks` is greater than
      `0`.
- [ ] `npm run lint` still passes. It has nothing React to look at yet, which is the point of
      doing this before there is any.

### Step 4: Build the throwaway harness — and exclude it from git first

React needs somewhere to mount. Next.js is that place from Lesson 09.1, and installing it now
would mean learning two technologies at once, which is the single most common way a WordPress
developer stalls on this stack. So: four disposable files, a dev server, and a deletion in
Lesson 09.1.

Exclude it **before** it exists, the way Lesson 05.1 excluded the scratch `queries.graphql` — a
personal scratch directory is a personal exclusion, and the tracked root `.gitignore` is a
documented teaching artifact that stays as it is:

```bash
cd ..    # repo root
printf '%s\n' 'next-app/scratch/' >> .git/info/exclude
mkdir -p next-app/scratch
git check-ignore -v next-app/scratch/main.tsx
```

**Verify §4a:**

- [ ] The output names `.git/info/exclude` and the pattern. **No output means the exclusion did
      not take** — stop and fix it before writing any file into that directory.

Now the four files.

```html
<!-- next-app/scratch/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blame The Tech — React scratch harness</title>
  </head>
  <body>
    <!-- The one mount point. main.tsx asserts this element exists. -->
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

```tsx
// next-app/scratch/main.tsx
// Mounts the harness. Deleted in Lesson 09.1, when Next.js owns the mount.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// `!` is a non-null assertion: getElementById returns HTMLElement | null, and
// createRoot refuses null. The claim is verifiable — the element is declared in
// index.html, which you just wrote. This is the only `!` in the course.
const container = document.getElementById('root')!;

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

```tsx
// next-app/scratch/App.tsx
// The page you iterate on. It grows through Lessons 08.2 to 08.5 and is then
// deleted. The COMPONENTS it mounts live in src/ and are permanent.
import { IncidentCard } from '@/components/incidents/IncidentCard';

export function App() {
  return (
    <main>
      <h1>Blame The Tech — incident board</h1>
      <IncidentCard />
    </main>
  );
}
```

```ts
// next-app/scratch/vite.config.ts
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // `__dirname` does not exist in an ES module (Lesson 07.2), and package.json
  // says "type": "module". This is the ESM spelling of the same thing.
  root: fileURLToPath(new URL('.', import.meta.url)),

  // Fast Refresh, and the JSX transform that reads "jsx" from tsconfig.json.
  plugins: [react()],

  resolve: {
    // The same alias tsconfig.json declares in `paths`. Two tools, two configs,
    // one truth: TypeScript resolves it for the editor, Vite resolves it for the
    // browser. Get them out of step and the editor is green while the page is
    // blank — Key Concept 2 of Lesson 09.1 revisits this.
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },

  server: {
    // Next takes :3000 from Lesson 09.1. These never collide, so you can run
    // both. strictPort makes a clash fail loudly instead of silently moving on.
    port: 5173,
    strictPort: true,
  },
});
```

> **The components under test do not live in `scratch/`.** They live in
> `next-app/src/components/incidents/`, and every one of them survives into the finished
> application. The harness only mounts them. That separation is the whole reason this module can
> be React-only without producing throwaway work: the real code is real from the first lesson,
> and only the page that renders it is disposable.

### Step 5: Write `IncidentCard`

Hard-coded content, on purpose. Lesson 08.2 replaces every literal below with a prop and
almost all of the markup survives that change. The data is incident `incident-01` exactly as
`wp blame seed` writes it (Lesson 04.5), so the card you are looking at is the card the real
query will fill.

One field is missing deliberately: **the card does not show `blameScore`.** The score is
computed server-side (appendix 03 §7) and it belongs on the incident detail page, next to the
inputs that produced it. A card shows facts an editor or a reporter entered. Lesson 10.5 turns
that instinct into a rule when it audits which fields each component actually needs.

```bash
cd next-app
mkdir -p src/components/incidents
```

```tsx
// next-app/src/components/incidents/IncidentCard.tsx
// One incident, hard-coded, so this lesson is about JSX and nothing else.
// Lesson 08.2 gives it a typed `incident` prop and narrows its field set to
// match one GraphQL fragment, at which point the <pre> below moves out.
//
// Content: incident-01 from `wp blame seed` — see appendix 03 §9.

export function IncidentCard() {
  return (
    <article className="incident-card">
      <h2>Deployed on a Friday (#1)</h2>

      {/* A machine-readable timestamp plus a human one. dateTime, not datetime:
          the compiler emits an object literal, so the property is camelCase. */}
      <p>
        Reported <time dateTime="2024-09-02T11:00:00">2 September 2024</time>
      </p>

      <p className="incident-card__severity">S1 — Catastrophic</p>

      <dl>
        <dt>Blamed on</dt>
        <dd>The Intern</dd>

        <dt>Downtime</dt>
        <dd>5 min</dd>

        <dt>Estimated cost</dt>
        <dd>$0</dd>

        <dt>Environment</dt>
        <dd>PRODUCTION</dd>
      </dl>

      {/* Escaped, per appendix 03 §4.1. A stack trace is attacker-supplied text
          from Module 16 onward, and there is no escaper to remember here: the
          braces make it text. Never dangerouslySetInnerHTML on this field. */}
      <pre>
        {`Traceback (most recent call last):
  File "app/handler.php", line 40
  RuntimeException: Deployed on a Friday`}
      </pre>
    </article>
  );
}
```

Four details in that file that are not obvious:

- `{/* … */}` is how you comment inside JSX. It is a braces slot containing a comment and
  nothing else, which is why the syntax looks odd.
- `<dl>`/`<dt>`/`<dd>` is the correct element for a list of name/value pairs, and Module 11's
  typography and Module 22's audit both assume it. Semantic HTML is cheaper to write now than to
  retrofit.
- The `<pre>` content is a **template literal inside braces**, not JSX text. Written as plain
  JSX text, the leading whitespace of each line would be collapsed by the compiler and the
  trace would come out on one line.
- There is no `key`, no `props`, and no `import React`. All three arrive later, or never.

The `<pre>` is the one part of this markup that does not survive Lesson 08.2. A stack trace is
detail-page content, not card content, and Lesson 08.2 explains the discipline that removes it.
It is here now because escaping is easiest to believe when you have watched it happen to a
string full of quotation marks.

### Step 6: Wire the script and start the server

```bash
npm pkg set scripts.scratch="vite scratch"
npm pkg get scripts.scratch
# Expected: "vite scratch"

npm run scratch
```

**Verify §6:**

- [ ] The terminal prints a local URL on port `5173`.
- [ ] `http://localhost:5173` shows the heading, the card, the definition list and the stack
      trace in a monospace block.
- [ ] The browser console is empty. A React warning here means a typo in an attribute name.
- [ ] `git status --short` at the repo root does **not** mention `scratch`.

### Step 7: Change one line and watch what survives

Leave the server running. In `IncidentCard.tsx`, change `The Intern` to `Mercury Retrograde` and
save.

**Verify §7:**

- [ ] The browser updates without a full page reload and without you touching it. That is
      Vite's Fast Refresh, driven by `@vitejs/plugin-react`.
- [ ] The scroll position is preserved. Fast Refresh replaces the component and keeps the rest
      of the page, which is why this is worth more than a reload — from Lesson 08.3 it also
      keeps your component's state, so a filter you set stays set while you edit the markup.
- [ ] Now break it on purpose: delete the closing `</article>`. Vite shows a full-screen error
      overlay naming the file and line. Put it back and the overlay disappears.
- [ ] Change `className` to `class` and save. React logs a warning naming the attribute, and the
      class is still applied — React is being forgiving here, and it will not be forgiving about
      much else. Change it back.

Then set `Mercury Retrograde` back to `The Intern`, so the card still matches the seeded data.

---

## Verification

```bash
cd next-app

# 1. React is a runtime dependency; the tooling is not
npm pkg get dependencies
# Expected: exactly react and react-dom, nothing else

# 2. One copy of React in the tree
npm ls react react-dom --depth=0
# Expected: react@19.x and react-dom@19.x, with no "invalid" or "deduped" conflict

# 3. The compiler is now configured for a bundler and for JSX
npx tsc --showConfig | grep -E '"(jsx|module|moduleResolution|baseUrl)"'
# Expected: "react-jsx", "esnext", "bundler", and a baseUrl ending in /next-app

# 4. The whole project type-checks, components included
npm run type-check && echo "types OK"
# Expected: no output from tsc, then "types OK"

# 5. Lint passes with the React and hooks rules loaded
npx eslint --print-config src/components/incidents/IncidentCard.tsx \
  | grep -c 'react-hooks/rules-of-hooks'
# Expected: 1
npm run lint && echo "lint OK"
# Expected: lint OK

# 6. READ THE COMPILED JSX. This is Key Concept 2, with your own file.
npx esbuild src/components/incidents/IncidentCard.tsx --loader=tsx --jsx=automatic | head -30
# Expected: an import from "react/jsx-runtime", then jsx(...) and jsxs(...) calls
#           whose first argument is the STRING "article", "h2", "dl" and so on,
#           and whose second argument is an object with className and children.

# 7. The dev server answers. Start it first, in a second terminal: npm run scratch
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/
# Expected: 200
curl -s http://localhost:5173/ | grep -o 'id="root"'
# Expected: id="root"

# 8. Vite really is compiling JSX on the way to the browser
curl -s http://localhost:5173/main.tsx | grep -c 'jsx'
# Expected: 1 or more. The browser never receives JSX; it receives function calls.

# 9. NEGATIVE — a lowercase component name is an HTML tag, not your component
cat > src/components/incidents/_case.tsx <<'TSX'
import { IncidentCard } from './IncidentCard';
export const wrong = <incidentCard />;
export const right = <IncidentCard />;
TSX
npx esbuild src/components/incidents/_case.tsx --loader=tsx --jsx=automatic | grep 'jsx('
# Expected: two calls — jsx("incidentCard", {}) with a STRING first argument, and
#           jsx(IncidentCard, {}) with an IDENTIFIER. The first renders an unknown
#           empty element and no error.
npm run type-check; echo "exit=$?"
# Expected: an error naming 'incidentCard' (TS2339 or TS2304), then exit=1.
#           TypeScript catches at build time what React shrugs off at run time.
rm src/components/incidents/_case.tsx

# 10. NEGATIVE — nothing in this module opts out of escaping
grep -rc 'dangerouslySetInnerHTML' src/ scratch/ | grep -v ':0$'
# Expected: no output at all. Lesson 09.3 introduces exactly one use, as a
#           labelled debt; Module 14 removes it. There is none here.

# 11. NEGATIVE — the harness is not, and cannot be, staged for commit
cd ..
git check-ignore -v next-app/scratch/App.tsx
# Expected: a line naming .git/info/exclude and the pattern next-app/scratch/
git status --short
# Expected: next-app/package.json, next-app/package-lock.json,
#           next-app/tsconfig.json, next-app/eslint.config.mjs and
#           next-app/src/components/incidents/IncidentCard.tsx.
#           NOT next-app/scratch/ — not one file from it.

# 12. Commit the permanent half only
git add next-app/package.json next-app/package-lock.json next-app/tsconfig.json \
  next-app/eslint.config.mjs next-app/src/components/incidents/IncidentCard.tsx
git commit -m "feat(web): React 19, a bundler tsconfig, and the first component"
git show --stat --oneline HEAD | grep -c scratch
# Expected: 0
```

Check 6 is the one to actually read rather than skim. Check 9 is the one that will save you an
afternoon: a component that renders nothing, with no error anywhere, is the least diagnosable
failure in React, and the only thing standing between you and it is a capital letter.

## Control Questions

1. `<IncidentCard />` and `get_template_part('template-parts/card', 'incident')` both put a card
   on the page. Name two things you can do with the result of the first that are impossible with
   the second, and say which property of the return value makes them possible.
2. `{if (incident.title.length > 40) { … }}` is a syntax error, but
   `{incident.title.length > 40 && <p>…</p>}` is not. Explain the difference in terms of what
   the compiler emits for the surrounding JSX, not in terms of React.
3. `<incidentCard />` compiles, runs and renders nothing. Describe what the compiler emitted,
   why React does not complain, and which tool in your project does complain.
4. `tsconfig.json` changed `moduleResolution` from `NodeNext` to `bundler` in this lesson.
   Name one import that was previously an error and is now legal, and say which program is
   responsible for making it work at run time.
5. `StrictMode` calls every component twice in development. Give one bug it is designed to
   expose that would otherwise appear only intermittently, and say why the double call disappears
   in a production build.

## Learn More

- [Your First Component](https://react.dev/learn/your-first-component) — react.dev's own
  framing of "a component is a function"; read it right after this lesson to hear the same
  claim in different words
- [Writing Markup with JSX](https://react.dev/learn/writing-markup-with-jsx) — the one-root
  rule, `className`, and the full list of renamed attributes
- [JavaScript in JSX with Curly Braces](https://react.dev/learn/javascript-in-jsx-with-curly-braces)
  — the expression-versus-statement rule, with the examples you will keep coming back to
- [TypeScript: JSX](https://www.typescriptlang.org/docs/handbook/jsx.html) — what `"jsx":
  "react-jsx"` actually selects, and how TypeScript knows `incidentCard` is not a tag
- [`createRoot`](https://react.dev/reference/react-dom/client/createRoot) — the API you used in
  `main.tsx`, including what happens if you call it twice on one container
- [`StrictMode`](https://react.dev/reference/react/StrictMode) — the exact list of things it
  double-invokes, and why each one is checked
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19) — worth ten minutes for
  the removals alone, which is what makes older tutorials fail
- [Vite: getting started](https://vite.dev/guide/) — the harness in Step 4 is roughly the
  smallest useful Vite project; this explains the parts you did not write
- [`moduleResolution`](https://www.typescriptlang.org/tsconfig/#moduleResolution) — the
  reference table for the change in Step 2, including why `bundler` and `NodeNext` disagree
