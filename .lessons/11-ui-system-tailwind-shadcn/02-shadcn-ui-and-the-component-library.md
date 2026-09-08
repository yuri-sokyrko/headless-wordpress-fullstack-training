---
title: 'shadcn/ui & the Component Library'
module: 11
lesson: 2
teaches: [shadcn-ui, radix-primitives, cva, class-merging, components-json, rsc-flag]
produces: ['next-app/components.json', 'next-app/src/components/ui/button.tsx', 'next-app/src/components/ui/card.tsx', 'next-app/src/components/ui/badge.tsx', 'next-app/src/components/ui/input.tsx', 'next-app/src/components/ui/label.tsx', 'next-app/src/components/ui/select.tsx', 'next-app/src/components/ui/dialog.tsx', 'next-app/src/components/ui/sheet.tsx', 'next-app/src/components/ui/skeleton.tsx', 'next-app/src/lib/utils.ts']
requires: [11.1]
---

# Lesson 11.2 — shadcn/ui & the Component Library

## Quick Overview

shadcn/ui is not a dependency. That single fact is the whole lesson. You run a CLI, it writes
`.tsx` files into `src/components/ui/`, and those files are now ordinary source files in your
repository — you read them, you edit them, you review their diffs, and nothing in
`package.json` points at "shadcn". What you *do* install are the Radix primitives underneath
the ones that need real behaviour: focus trapping in a dialog, keyboard navigation in a select,
correct `aria-*` wiring on both.

You will initialise `components.json`, generate the nine components the app actually uses, and
then immediately edit two of them so the ownership is not theoretical. `Button` becomes a `cva`
variant API with Blame The Tech's severity variants; `Badge` gets the four severity terms as
named variants driven by the tokens from Lesson 11.1. One `components.json` setting deserves
attention before you generate anything: `"rsc": true`, which tells the CLI to add `'use client'`
only to components that genuinely need it. Get that wrong and every card and badge in the app
becomes a Client Component, quietly undoing Lesson 09.2.

By the end of this lesson you will have:

- `next-app/components.json` with `"rsc": true`, the `@/*` alias and the Tailwind entry point configured
- Nine components in `next-app/src/components/ui/` — button, card, badge, input, label, select, dialog, skeleton
- A `cn()` helper and a `Button` rewritten as a `cva` variant API with Blame The Tech variants
- `Badge` variants for the four `severity` terms from the closed set, styled with Lesson 11.1's tokens
- A check that `'use client'` appears only in the files that need it, and a note of which those are and why

## Classic WP Analogy

There is an exact analogue in the WordPress world, and it is the distinction between a **starter
theme** and a **parent theme**:

| | Parent theme (MUI, Chakra, Bootstrap) | Starter theme (shadcn/ui) |
|---|---|---|
| How you get it | install and depend on it | copy it into your project |
| How you change it | child theme, overrides, `!important`, prop escape hatches | edit the file |
| Upstream updates | `composer update` and hope | there are none; you own it |
| Who owns the markup | the vendor | you |
| Bundle cost | the whole library | only what you copied |
| Code review | invisible | a normal diff |

You have felt both sides of this. A parent theme is fast for the first week and then you spend
a month fighting a `<header>` you cannot restructure, hooking `wp_nav_menu` filters to change
one class name. Underscores hands you plain files, and by day three the code looks like yours.
shadcn/ui is Underscores for React components, and it is the right default for exactly the
reason Underscores was: this is an application with a specific design, not a prototype that
needs a stock look.

The comparison breaks on **maintenance**, and the cost should be stated plainly. A parent theme
ships accessibility fixes, browser-quirk workarounds and security patches, and you get them by
updating. Copied components get none of that. When Radix fixes a focus bug in a dialog you get
it, because Radix *is* a dependency — but when shadcn improves the styling wrapper or fixes an
`aria-describedby` wiring mistake in its `Select`, nothing tells you. That is the trade: total
control, total responsibility. It is why Lesson 11.4 is a full audit lesson rather than a
footnote, and why Module 22 runs axe over these components in CI.

There is a second, smaller break worth naming: `src/components/ui/` is generated code that you
*do* edit, which makes it the exact opposite of `src/gql/` from Lesson 10.2. Same repository,
two directories of tool-written files, opposite rules. Write that down somewhere your future
self will read it.

---

## Key Concepts

### 1. Nothing in `package.json` says "shadcn", and that is the design

Run the CLI and this is what happens:

```
npx shadcn@latest add button
        │
        ├─▶ reads components.json          (your aliases, your CSS path, rsc: true)
        ├─▶ writes src/components/ui/button.tsx        ← a normal source file
        ├─▶ npm install @radix-ui/react-slot           ← a REAL dependency
        └─▶ exits. Nothing is left behind that knows it was generated.
```

There is no runtime, no provider, no theme object, no `ShadcnProvider`, and no version of
shadcn/ui installed anywhere. The CLI is a code generator you invoke with `npx` and never add
to `devDependencies` — pinning it would imply a dependency relationship that does not exist.

What *does* get installed is the layer underneath:

| Installed | Kind | Why it is a real dependency |
|---|---|---|
| `@radix-ui/react-dialog` etc. | runtime | focus trapping, keyboard handling, portals — see Key Concept 3 |
| `class-variance-authority` | runtime | the variant API in Key Concept 5 |
| `clsx` + `tailwind-merge` | runtime | `cn()`, Key Concept 6 |
| `lucide-react` | runtime | the icon set the generated components import |
| shadcn/ui itself | **nothing** | it is a `.tsx` file in your repo |

### 2. What you own, what upstream owns, and what that costs

The Classic WP Analogy above gave you the starter-theme comparison. Here is the part that
matters in practice — the maintenance boundary runs *through* each component, not around it:

```
   ┌─ src/components/ui/dialog.tsx ─────────── YOURS ─────────────┐
   │  the class strings, the radius, the animation, the markup    │
   │  structure, the exported component names                     │
   │      │                                                       │
   │      └── wraps ──▶ @radix-ui/react-dialog ── THEIRS ─────────│──┐
   │                    focus trap, Escape, aria-modal,           │  │
   │                    scroll lock, portal, id wiring            │  │
   └──────────────────────────────────────────────────────────────┘  │
                                                                     │
   a Radix accessibility fix reaches you via `npm update` ────────────┘
   a shadcn styling or wiring fix reaches you via ................ nothing
```

| | You get upstream fixes | You can restructure the markup |
|---|---|---|
| Radix behaviour | ✅ `npm update` | ❌ and you do not want to |
| shadcn wrapper | ❌ never | ✅ it is your file |
| A parent library (MUI, Chakra) | ✅ | ❌ props and overrides only |
| Verdict | **✅ correct for an app with a specific design** | |

The cost, stated plainly: if shadcn fixes an `aria-describedby` wiring bug in `select.tsx` next
month, nothing tells you and no tool notices. That is precisely why Lesson 11.4 is a full audit
lesson and why Module 22 runs axe over these files in CI. Copying the code means owning the
audit.

### 3. Radix gives you the behaviour that is genuinely hard

A dialog is not a `<div>` with `display: none` toggled. Getting one right means, at minimum:

| Requirement | What it takes |
|---|---|
| Focus moves into the dialog on open | store the trigger, `focus()` the first focusable child |
| `Tab` cannot escape the dialog | a focus trap: find all focusables, wrap at both ends |
| `Escape` closes it | a keydown listener scoped to the dialog, removed on unmount |
| Focus returns to the trigger on close | remember the trigger across an unmount |
| The background does not scroll | lock `<body>`, and compensate for the scrollbar width |
| Screen readers treat it as modal | `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, all with generated ids that match |
| It renders above everything | a portal, so no ancestor `overflow: hidden` clips it |
| Clicking outside closes it | a pointer-down listener that distinguishes inside from outside |

That is several hundred lines and a long tail of browser quirks. Radix ships all of it,
unstyled, and its components are headless by design — they render minimal DOM and hand you the
styling. This is the one place in this module where taking a dependency is unambiguously
correct: **behaviour you would get wrong is worth depending on; class strings are not.**

Radix also generates and wires the `id` attributes for `aria-labelledby` and
`aria-describedby`. Lesson 11.4 audits every `aria-*` in the codebase, and the Radix ones are
the ones you will not find in your own source — they are created at render time. Say so in the
audit rather than concluding they are missing.

### 4. `components.json` and the `"rsc": true` flag

`components.json` is the CLI's only memory. It records where your components live, what your
alias prefix is, which stylesheet holds the theme, and — the one that changes generated output
— whether this project uses React Server Components.

| Field | Value here | What it decides |
|---|---|---|
| `style` | `new-york` | which class strings the generator emits |
| `rsc` | `true` | **whether `'use client'` is added to a generated file** |
| `tsx` | `true` | `.tsx` output, not `.jsx` |
| `tailwind.css` | `src/app/[locale]/globals.css` | which file the CLI writes theme variables into |
| `tailwind.config` | `tailwind.config.ts` | the config path, for the plugin's sake |
| `tailwind.baseColor` | `neutral` | the palette it would generate — already written in Lesson 11.1 |
| `aliases.*` | `@/…` | the import specifiers in generated files |
| `iconLibrary` | `lucide` | which icon package generated files import from |

With `"rsc": true` the CLI adds `'use client'` only to components that genuinely need it — the
Radix-backed ones with state and event handlers. With `"rsc": false` it adds the directive to
**every** generated file, on the assumption you are in the Pages Router where the distinction
does not exist.

> **Getting `"rsc"` wrong quietly undoes Lesson 09.2.** `'use client'` at the top of
> `card.tsx` and `badge.tsx` means every page that renders an incident card ships React, the
> card component and the badge component to the browser — for markup that never changes after
> render. Nothing breaks. Nothing warns. Your First Load JS goes up by tens of kilobytes and
> you find out in Module 21 when the performance budget fails. Check the flag before you
> generate, not after.

### 5. `cva` is a variant API, and it gives you the prop types for free

`class-variance-authority` turns "a set of class strings, chosen by props" into a typed
function.

```ts
// (illustration) button.tsx — the shape, without the real class strings
const buttonVariants = cva('inline-flex items-center rounded-md', {
  variants: {
    variant: { default: 'bg-primary', outline: 'border bg-background' },
    size: { default: 'h-9 px-4', sm: 'h-8 px-3' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
```

Four parts, and the fourth is the one people miss:

| Part | Does |
|---|---|
| the first argument | the **base** classes, always applied |
| `variants` | named axes; each key becomes a prop, each sub-key a legal value |
| `defaultVariants` | what applies when the prop is omitted |
| `compoundVariants` | classes that apply only when two axes coincide — `variant: 'outline'` **and** `size: 'sm'` |

`VariantProps<typeof buttonVariants>` then extracts the prop types, so the component's public
API is derived from the variant map rather than declared twice. Add a variant and the prop type
widens with no other edit. This is why Badge's severity variants are worth building on `cva`
rather than a hand-written union: the four term slugs become four legal `variant` values, and
`<Badge variant={severity} />` type-checks against the closed set from
[appendix 03 §2](../appendix/03-content-model-reference.md#seeded-terms).

### 6. `cn()` is `clsx` plus `tailwind-merge`, and both halves are load-bearing

```ts
// (illustration) src/lib/utils.ts — the whole helper
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
```

Two different jobs:

| Library | Job | Without it |
|---|---|---|
| `clsx` | flattens arrays, objects and conditionals into one string | `` `a ${b ? 'c' : ''} ${d ?? ''}` `` and a stray double space |
| `tailwind-merge` | **removes the losing class when two utilities conflict** | Lesson 11.1 Key Concept 7 happens to you |

The second one is the reason this is not optional. `clsx('px-4', 'px-8')` returns
`"px-4 px-8"`, both classes reach the DOM, and the one that wins is whichever Tailwind emitted
later — not the one the caller asked for. `twMerge('px-4 px-8')` returns `"px-8"`: it knows
`px-4` and `px-8` are the same property, and it keeps the last.

```
cn('px-4 py-2', 'px-8')
  │
  ├─ clsx    → "px-4 py-2 px-8"      both padding classes present
  └─ twMerge → "py-2 px-8"           the conflict resolved in the caller's favour
```

This is what makes a component's `className` prop an actual override rather than a suggestion,
and it is why every generated component ends with
`className={cn(theVariants({ … }), className)}` — variants first, caller's `className` last.
Step 4 of the Task proves it in both directions.

### 7. `asChild` and Radix `Slot`: one element, not two

`<Button>` renders a `<button>`. A link that looks like a button must render an `<a>`. The
naive version nests them:

```tsx
// (illustration) HobtCtaBand.tsx — ❌ an anchor inside a button
<Button>
  <Link href="/en/hobt">Start Now</Link>
</Button>
```

That produces two interactive elements, one inside the other. Keyboard users `Tab` to the
button, then `Tab` again to the link; a screen reader announces "button, link, Start Now"; the
HTML is invalid, because `<button>` may not contain interactive content; and the click target
and the focus ring disagree about where the control is.

`asChild` fixes it by not rendering an element at all. `Slot` takes the props it was given —
the merged `className`, the `data-slot`, the event handlers — and forwards them onto its single
child:

```tsx
// (illustration) HobtCtaBand.tsx — ✅ one <a>, styled as a button
<Button asChild>
  <Link href="/en/hobt">Start Now</Link>
</Button>
```

One element in the DOM: an `<a href>` carrying the button's classes. Lesson 11.5's CTAs depend
on this, and so does Lesson 11.4 — `asChild` is the difference between a control a keyboard
user reaches once and one they reach twice.

### 8. Two directories of generated files, opposite rules

Lesson 10.2 made the same observation from the other side, and putting the two next to each
other is the clearest way to remember which is which:

| | `src/gql/` | `src/components/ui/` |
|---|---|---|
| Written by | `graphql-codegen` | the shadcn CLI |
| In git | ✅ committed | ✅ committed |
| You edit it | ❌ **never** — regeneration overwrites you | ✅ **always** — that is the point |
| Regenerated | every `npm run codegen`, verified in CI | only if you delete a file and re-add it |
| A diff means | the schema changed | you changed something |
| Reviewed as | a data contract | ordinary application code |

Same repository, same "this was written by a tool" feeling, opposite obligations. The
distinguishing question is whether the tool will ever run again over that file. Codegen will.
The shadcn CLI will not, unless you ask it to — and if you do, it overwrites your edits, which
is why `npx shadcn@latest add button` on a file you have customised needs the same care as a
`git checkout --theirs`.

---

## Task

### Step 1: Check the licences, then install the runtime dependencies

```bash
cd next-app

for pkg in class-variance-authority clsx tailwind-merge lucide-react \
           @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-label \
           @radix-ui/react-slot; do
  printf '%-32s ' "$pkg"; npm view "$pkg" license
done
# Expected: MIT for every line. `next-app` is MIT and this project takes no GPL
#           dependency — the habit from Lesson 07.1 Key Concept 9.

npm install class-variance-authority clsx tailwind-merge lucide-react \
  @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-label \
  @radix-ui/react-slot
```

These are **runtime** dependencies, not dev: `cva` and `cn` run when a component renders, and
Radix ships JavaScript to the browser for the interactive primitives.

### Step 2: Initialise, then correct `components.json` by hand

```bash
npx shadcn@latest init
```

Answer the prompts:

| Prompt | Answer | Why |
|---|---|---|
| Base color | `Neutral` | matches the `oklch` greys already in `globals.css` |
| Anything about creating a CSS file | **decline / point it at the existing one** | Lesson 11.1's stylesheet is the source of truth |

The CLI writes `components.json`, `src/lib/utils.ts`, and — this is the part to watch — it
tries to add its own theme variables to your stylesheet.

> ⚠️ **Review the `globals.css` diff before you accept it.** The CLI does not know that
> Lesson 11.1 already declared the entire canonical palette, so it may append a second
> `:root` block, a second `@theme inline` block, or a `@custom-variant dark` you already have.
> Keep Lesson 11.1's version and delete the duplicates. Two `:root` blocks setting
> `--background` is not an error — the later one silently wins, which is exactly the kind of
> bug that takes an hour.

It may also fail to locate the stylesheet at all, because `src/app/[locale]/globals.css` is not
where a CLI looks. Fix `components.json` by hand so every later `add` writes to the right
places:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/[locale]/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Every field, annotated:

- `$schema` — editor autocompletion for this file. No runtime effect.
- `style` — `new-york` is tighter and uses smaller radii than `default`. A one-way door in
  practice: switching later regenerates every file and discards your edits.
- `rsc: true` — Key Concept 4. **The field that matters most.**
- `tsx: true` — emit `.tsx`.
- `tailwind.config` — the file Lesson 11.1 created for the typography plugin.
- `tailwind.css` — where the CLI writes theme variables. Points at the `[locale]` path.
- `tailwind.baseColor` — the palette it *would* generate. Already superseded.
- `tailwind.cssVariables: true` — generated components reference `bg-background`, not
  `bg-neutral-50`. Required for the dark variant to work at all.
- `tailwind.prefix: ""` — no class prefix. A prefix is for retrofitting Tailwind into a legacy
  stylesheet; there is no legacy stylesheet here.
- `aliases.*` — the `@/*` paths added to `tsconfig.json` in Lesson 08.1. Get one wrong and
  generated files import from a path that does not resolve.
- `iconLibrary` — `lucide`, matching the `lucide-react` install in Step 1.

**Verify §2:**

- [ ] `components.json` exists at `next-app/components.json`, not inside `src/`.
- [ ] `"rsc"` is `true`.
- [ ] `"css"` is `src/app/[locale]/globals.css`.
- [ ] `git diff 'next-app/src/app/[locale]/globals.css'` shows either no change or changes you
      deliberately kept.

### Step 3: Generate the nine components, then read what landed

```bash
npx shadcn@latest add button card badge input label select dialog sheet skeleton

ls src/components/ui/
# Expected: badge.tsx  button.tsx  card.tsx  dialog.tsx  input.tsx
#           label.tsx  select.tsx  sheet.tsx  skeleton.tsx

grep -rl "'use client'" src/components/ui/
```

Read at least `dialog.tsx` and `card.tsx` end to end before continuing. `card.tsx` is about
sixty lines of `<div>`s with class strings and exports `Card`, `CardHeader`, `CardTitle`,
`CardDescription`, `CardContent`, `CardFooter` and `CardAction` — no dependency, no behaviour.
`dialog.tsx` is a set of thin wrappers around `@radix-ui/react-dialog` that add classes and an
overlay. That contrast *is* Key Concept 3.

> **If the CLI's output disagrees with the descriptions in this lesson, the CLI is right and
> the lesson is stale.** shadcn's generated files change between versions — a `data-slot`
> attribute appears, a component becomes a function declaration instead of a `forwardRef`, a
> class string gets tuned. The two files this lesson *depends* on are written out in full
> below, because the rest of the module imports them. For the other seven, read what you got.
>
> **And one non-obvious switch:** a **non-empty `tailwind.config` in `components.json` is what
> tells the CLI you are on Tailwind 3.** Because Lesson 11.1 kept a config file for the
> typography plugin, the CLI emits its Tailwind-3-era components — `React.forwardRef`,
> `bg-black/80` — into a Tailwind 4 project. They work, with one consequence worth knowing
> now: `animate-in`, `fade-in-0` and `zoom-in-95` come from `tailwindcss-animate`, a Tailwind 3
> plugin this course does not install, so those utilities compile to nothing. Nothing here
> depends on them, and Lesson 22.2 §9 is where it matters.

Which files carry `'use client'` is not a style choice; it follows from what the file does:

| File | `'use client'` | Why |
|---|---|---|
| `dialog.tsx` | yes | Radix dialog: state, portals, event listeners |
| `select.tsx` | yes | Radix select: keyboard navigation, popper positioning |
| `sheet.tsx` | yes | same primitive as dialog |
| `label.tsx` | yes | `@radix-ui/react-label` is itself a Client Component |
| `button.tsx` | **no** | `cva` + `Slot`, no state, no effects |
| `card.tsx` | **no** | `<div>`s and class strings |
| `badge.tsx` | **no** | same |
| `input.tsx` | **no** | an uncontrolled `<input>` is server-renderable |
| `skeleton.tsx` | **no** | one `<div>` with an animation class |

The four in the top group are load-bearing. The five in the bottom group are the whole reason
`"rsc": true` matters: a Server Component tree that renders a hundred badges ships zero
JavaScript for them.

### Step 4: Confirm `cn()`, and prove `tailwind-merge` is not decoration

The CLI wrote this during `init`. Confirm it matches, because everything else in the module
imports it:

```ts
// next-app/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The one class-name helper. `clsx` flattens conditionals; `tailwind-merge`
 * resolves conflicts so the LAST conflicting utility wins, which makes a
 * caller's `className` a real override. Never use one without the other.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

Now prove it. Write a two-line throwaway script:

```ts
// next-app/scripts/cn-check.ts
import { cn } from '../src/lib/utils.ts';

console.log(cn('px-4 py-2', 'px-8'));
```

```bash
npx tsx scripts/cn-check.ts
# Expected: py-2 px-8
#           px-4 is GONE. The caller's px-8 won, which is the whole point.
```

Break it deliberately, then put it back:

```bash
# Temporarily reduce cn() to clsx alone
sed -i.bak 's/twMerge(clsx(inputs))/clsx(inputs)/' src/lib/utils.ts
npx tsx scripts/cn-check.ts
# Expected: px-4 py-2 px-8
#           BOTH padding classes reach the DOM. Which one applies is decided by
#           Tailwind's output order, not by the caller. This is the failure mode
#           behind "why is my className override being ignored?"

mv src/lib/utils.ts.bak src/lib/utils.ts
npx tsx scripts/cn-check.ts
# Expected: py-2 px-8
rm scripts/cn-check.ts
```

### Step 5: Give `Button` its Blame The Tech variants

Rewrite `button.tsx`. This is the first file you own outright.

```tsx
// next-app/src/components/ui/button.tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base: applied to every button. Note `motion-reduce:transition-none` — the
  // reduced-motion habit Lesson 11.4 audits, established at the source rather
  // than retrofitted onto forty call sites.
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        // Blame The Tech: the one loud button in the app. Used for the HOBT
        // "Start Now" CTA in Lesson 11.5 and nowhere else, on purpose.
        blame: 'bg-severity-s1 text-white shadow-sm hover:bg-severity-s1/90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4 py-2',
        lg: 'h-11 px-6',
        // For the HOBT CTA band, where the button is the page's focal point.
        xl: 'h-14 px-8 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    // Render the child element instead of a <button>. Key Concept 7.
    readonly asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      // Variants first, caller's className last — twMerge lets the caller win.
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
```

> **`aria-disabled:` is in the base string on purpose.** A `disabled` attribute removes a
> control from the tab order entirely, so a keyboard user never encounters it and never hears
> why it is unavailable. `aria-disabled="true"` keeps the control focusable and announced as
> unavailable. Both need to *look* unavailable, so both get styled here. Lesson 11.5's inert
> "Get Demo" button uses the `aria-disabled` form, and Lesson 11.4 explains why that is the
> right default.

### Step 6: Give `Badge` the four severity variants, and delete the map from `IncidentCard`

The variant names are the **term slugs** themselves. That is a decision worth stating: the
alternative was short names (`s1`, `s2`) plus a lookup table from slug to name, and the lookup
table is a second place for the mapping to be wrong. Using the slug means the value WordPress
returns *is* the variant name, and the map is the identity.

```tsx
// next-app/src/components/ui/badge.tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import type { SeverityLevel } from '@/types/content';

// Total over SeverityLevel: `satisfies` rejects a missing key AND an extra one,
// so a fifth severity term is a compile error here rather than an unstyled badge
// in production. The four slugs are fixed by appendix 03 §2.
const severityVariants = {
  's1-catastrophic': 'border-severity-s1/30 bg-severity-s1/15 text-severity-s1',
  's2-major': 'border-severity-s2/30 bg-severity-s2/15 text-severity-s2',
  's3-minor': 'border-severity-s3/30 bg-severity-s3/15 text-severity-s3',
  's4-cosmetic': 'border-severity-s4/30 bg-severity-s4/15 text-severity-s4',
} satisfies Record<SeverityLevel, string>;

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground',
        // Spread last so the four slugs sit alongside the stock variants and
        // `variant` accepts either kind.
        ...severityVariants,
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
```

Now collect the payoff. `IncidentCard` keeps its `asSeverityLevel` guard — the boundary check
is still needed, because WPGraphQL types a term's `slug` as `String` — but its local
`SEVERITY_BADGE` map and its hand-written badge markup both go:

```tsx
// next-app/src/components/incidents/IncidentCard.tsx — replace the badge markup
// DELETE the SEVERITY_BADGE constant entirely; badge.tsx owns those four strings now.
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// …inside the component, where the hand-written <span> used to be:
{severity !== null ? <Badge variant={severity}>{SEVERITY_LABEL[severity]}</Badge> : null}
```

`variant={severity}` type-checks with no cast, because `severity` is `SeverityLevel` and the
`cva` variant keys are exactly `SeverityLevel` plus the four stock names. Wrap the card body in
`Card` / `CardHeader` / `CardTitle` / `CardContent` while you are in the file, and delete the
`rounded-lg border border-border bg-card p-5` string from Lesson 11.1 — `Card` carries it now.

**Verify §6:**

- [ ] `npm run type-check` passes.
- [ ] Delete `'s4-cosmetic'` from `severityVariants` and it **fails**, naming the missing
      property. Put it back.
- [ ] `grep -c 'SEVERITY_BADGE' src/components/incidents/IncidentCard.tsx` returns `0`.

### Step 7: Replace the placeholder in `loading.tsx` with `Skeleton`

Lesson 10.4 put temporary markup in the loading boundary — a paragraph of text, or a bare
`<div>`. Now there is a component for it.

```tsx
// next-app/src/app/[locale]/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Six cards, matching the grid from Lesson 11.1 Step 7. A skeleton that
          does not match the real layout causes the layout shift it was meant to
          prevent — Module 21 measures exactly that. */}
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-lg border border-border p-5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-3 h-6 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
```

`Skeleton` is one `<div>` with `animate-pulse` and a `bg-accent`. Lesson 11.4 adds the
reduced-motion treatment for it, because `animate-pulse` is exactly the kind of looping
animation `prefers-reduced-motion` exists for.

### Step 8: Write down the `'use client'` inventory and ADR 0008

Two documents. The first is an inventory you will check against reality at the end of the
module:

```markdown
<!-- docs/architecture.md — append -->
## The `'use client'` inventory (Lesson 11.2)

`'use client'` marks a **bundle boundary**, not a feature. A file gets it only when it needs
state, an event handler, a ref or a browser API.

| File | Why |
|---|---|
| `components/incidents/IncidentFilters.tsx` | `onChange` handlers |
| `components/incidents/IncidentSearch.tsx` | controlled input + `useRef` focus move |
| `components/incidents/IncidentFilterProvider.tsx` | `useState` + context |
| `components/ui/dialog.tsx` | Radix dialog |
| `components/ui/select.tsx` | Radix select |
| `components/ui/sheet.tsx` | Radix dialog primitive |
| `components/ui/label.tsx` | `@radix-ui/react-label` is a Client Component |
| `app/[locale]/error.tsx`, `app/global-error.tsx` | error boundaries are client-only in React |

Everything else is a Server Component, including every `ui/` primitive above that is not in
this list. Lesson 11.3 adds `layout/NavLink.tsx` and `layout/MobileNav.tsx`; nothing after
that should join the list in this module.
```

The second is the decision record. ADR numbers are permanent; this one is `0008`.

```markdown
<!-- docs/adr/0008-shadcn-copied-not-depended-on.md -->
# 0008 — Utility-first CSS, and components copied rather than depended on

## Status
Accepted (Module 11)

## Context
Blame The Tech needs a component library for buttons, cards, badges, dialogs and selects.
It has a specific visual design and a hard accessibility requirement (Module 22), and it is
an application, not a prototype needing a stock look.

## Options considered
| Option | Upstream fixes | Restructure markup | Bundle | Verdict |
|---|---|---|---|---|
| MUI / Chakra | ✅ | ❌ props and overrides only | whole library | ❌ fighting a vendor `<header>` |
| Headless UI + own styles | ✅ behaviour | ✅ | small | ⚠️ viable; smaller primitive set |
| Bootstrap / a CSS framework | ✅ | ❌ | whole stylesheet | ❌ no accessibility behaviour at all |
| **shadcn/ui + Radix, utility-first** | behaviour ✅, wrappers ❌ | ✅ | only what is copied | **✅** |

## Decision
Tailwind 4 for styling; Radix as a real dependency for behaviour; shadcn/ui as a generator
whose output is committed to `src/components/ui/` and edited freely.

## Consequences — including what this costs us
- Nobody upstream will ever ship a fix for `src/components/ui/*.tsx`. Accessibility
  regressions in those files are ours to find, which is why Lesson 11.4 audits them and
  Module 22 puts axe in CI.
- `npx shadcn@latest add <name>` on a customised file overwrites our edits.
- An invented utility class fails silently (Lesson 11.1). Mitigated by the editor plugin
  and Lesson 12.3's checks, not by a compiler.
- Two directories of generated code with opposite editing rules — see Lesson 10.2.

## What would reverse this
A design-system team owning the components as a versioned internal package, or a product
decision to adopt a stock look. Neither is true today.
```

---

## Verification

```bash
cd next-app

# 1. The nine expected files, and no more
ls src/components/ui/
# Expected: badge.tsx button.tsx card.tsx dialog.tsx input.tsx
#           label.tsx select.tsx sheet.tsx skeleton.tsx

ls src/components/ui/ | wc -l
# Expected: 9

# 2. THE THESIS OF THE LESSON, as a one-line check: shadcn is not a dependency
grep -c 'shadcn' package.json
# Expected: 0

# 3. NEGATIVE — and the counterpart. The Radix primitives ARE dependencies.
#    Read checks 2 and 3 together; the pair is the point.
grep -c '@radix-ui' package.json
# Expected: 4 or more

# 4. `cn` resolves conflicts in the caller's favour
printf "import { cn } from '../src/lib/utils.ts';\nconsole.log(cn('px-4 py-2','px-8'));\n" \
  > scripts/cn-check.ts
npx tsx scripts/cn-check.ts
# Expected: py-2 px-8

# 5. NEGATIVE — without twMerge, the caller's override loses
sed -i.bak 's/twMerge(clsx(inputs))/clsx(inputs)/' src/lib/utils.ts
npx tsx scripts/cn-check.ts
# Expected: px-4 py-2 px-8   ← both classes present; Tailwind's output order decides
mv src/lib/utils.ts.bak src/lib/utils.ts
npx tsx scripts/cn-check.ts
# Expected: py-2 px-8
rm scripts/cn-check.ts

# 6. `'use client'` is only where behaviour requires it
grep -rl "'use client'" src/components/ui/ | sort
# Expected: dialog.tsx, label.tsx, select.tsx, sheet.tsx (paths, one per line)

# 7. NEGATIVE — the presentational primitives are NOT Client Components
grep -l "'use client'" src/components/ui/button.tsx src/components/ui/card.tsx \
  src/components/ui/badge.tsx src/components/ui/skeleton.tsx
# Expected: no output. Any hit means "rsc" was false when you generated.

# 8. The severity variants are total over the closed term set
grep -c "s[1-4]-" src/components/ui/badge.tsx
# Expected: 4 or more

# 9. NEGATIVE — IncidentCard no longer owns the severity class strings
grep -c 'SEVERITY_BADGE\|severity-s1/15' src/components/incidents/IncidentCard.tsx
# Expected: 0

# 10. Types, lint and a production build
npm run type-check
# Expected: no errors
npm run lint
# Expected: no errors
npm run build
# Expected: success

# 11. The generated components compiled into real CSS
grep -c 'animate-pulse' .next/static/css/*.css
# Expected: 1 or more — Skeleton's class made it into the stylesheet

# 12. The decision records exist
test -f docs/adr/0008-shadcn-copied-not-depended-on.md && echo adr-ok
# Expected: adr-ok
grep -c "use client" docs/architecture.md
# Expected: 1
```

## Control Questions

1. `grep -c 'shadcn' package.json` returns `0` and `grep -c '@radix-ui' package.json` returns a
   number greater than zero. Explain what each result proves, and say which of the two you
   would expect to change if shadcn/ui shipped a fix to `select.tsx` tomorrow.
2. `"rsc": true` in `components.json`. Describe exactly what would be different in the
   generated `badge.tsx` if it were `false`, what would still work, and which module would be
   the first to notice the cost.
3. `cn(badgeVariants({ variant }), className)` puts the caller's `className` last. Explain why
   the order matters given that `tailwind-merge` runs over the whole string anyway, and predict
   the output of `cn('px-8', 'px-4')`.
4. The `severityVariants` object uses `satisfies Record<SeverityLevel, string>` rather than a
   type annotation. Name one thing `satisfies` catches that `: Record<SeverityLevel, string>`
   would not, and explain why `<Badge variant={severity} />` needs no cast at the call site.
5. `src/gql/` and `src/components/ui/` are both tool-written and both committed, yet one must
   never be edited and the other must be. State the single question that decides which is
   which, and describe what goes wrong if you get it backwards in each direction.

## Learn More

- [shadcn/ui: introduction](https://ui.shadcn.com/docs) — the project's own statement that it
  is not a component library, in their words
- [shadcn/ui: `components.json`](https://ui.shadcn.com/docs/components-json) — every field in
  Step 2, and the authoritative description of what `rsc` changes
- [shadcn/ui: theming](https://ui.shadcn.com/docs/theming) — the canonical CSS variable names
  Lesson 11.1 declared, and the Tailwind 4 `@theme inline` bridge
- [Radix Primitives: introduction](https://www.radix-ui.com/primitives/docs/overview/introduction)
  — the accessibility and behaviour guarantees Key Concept 3 lists, per primitive
- [Radix `Slot`](https://www.radix-ui.com/primitives/docs/utilities/slot) — how `asChild`
  forwards props onto a single child, and its rules about multiple children
- [`class-variance-authority`](https://cva.style/docs) — `variants`, `defaultVariants`,
  `compoundVariants` and `VariantProps`
- [`tailwind-merge`](https://github.com/dcastil/tailwind-merge) — the conflict-resolution rules,
  including how it handles arbitrary values and custom token names
- [React: `'use client'`](https://react.dev/reference/rsc/use-client) — the directive as a
  bundle boundary, which is the framing Key Concept 4 depends on
