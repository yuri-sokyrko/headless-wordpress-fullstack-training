---
title: 'Forms with react-hook-form & Zod'
module: 16
lesson: 1
teaches: [react-hook-form, zod-schemas, shared-validation, accessible-form-errors, progressive-enhancement]
produces: ['next-app/src/lib/validation/schemas.ts', 'next-app/src/lib/validation/schemas.test.ts', 'next-app/src/components/ui/form.tsx', 'next-app/src/components/auth/RegisterForm.tsx', 'next-app/src/app/[locale]/(auth)/register/page.tsx']
requires: [15.4]
---

# Lesson 16.1 — Forms with react-hook-form & Zod

## Quick Overview

The register form you built in Lesson 15.3 works, and it is not good enough. It re-renders on
every keystroke, it reports errors only after a round trip, its error messages are `<p>` tags no
screen reader announces, and its validation rules exist in two places that will eventually
disagree. This lesson fixes all four with **react-hook-form** for state and **Zod** for shape,
then extracts the result into form primitives that Lessons 16.2 and 16.3 reuse without
re-litigating any of it.

The important idea is not the libraries — it is where the schema lives. `src/lib/validation/schemas.ts`
exports one Zod schema per form, and **both** the client form and the Server Action import it. That
is deduplication for **UX, not a security control**, and the distinction matters enough to be said
plainly: the client-side parse exists so a user sees "that email is missing an `@`" without a
network round trip. It removes zero attack surface, because an attacker does not use your form.
The server-side parse in the Server Action is the boundary, and even that is not the last word —
WordPress re-validates independently, because Next.js is not a trusted client. One more subtlety
you will hit immediately: a Zod `regex` on a slug field confirms **shape**, not **existence**, so
`scapegoat` and `severity` slugs are additionally checked against a term allowlist fetched from
WordPress at submit time. `s9-apocalyptic` matches the pattern perfectly and is not a real term.

By the end of this lesson you will have:

- `src/lib/validation/schemas.ts` — `registerSchema`, `loginSchema` and `incidentSchema`, with
  inferred TypeScript types exported alongside each one
- `src/components/ui/form.tsx` — accessible field primitives wiring `aria-describedby`,
  `aria-invalid` and `role="alert"` automatically, so no form has to remember them
- `/en/register` rebuilt on `react-hook-form` with `zodResolver`, one re-render per field instead
  of one per keystroke
- Focus management: submitting an invalid form moves focus to the first invalid field, verified
  with the keyboard and not just by eye
- A Vitest spec asserting the schema rejects an over-long title, a bad email and a slug that does
  not exist in the allowlist
- A written note distinguishing the three validation layers — client UX, Server Action boundary,
  WordPress authority — and which of them you could delete without a security incident

## Classic WP Analogy

Every WordPress form you have written is the same three concerns in the same order. `sanitize_text_field()`,
`sanitize_email()` and `absint()` coerce input to a shape. Then a block of `if ( empty( $x ) )`
checks builds an error bag. Then, if the bag is empty, you write. `WP_Error` carries the codes and
messages back to the template, and `add_settings_error()` prints them. Gravity Forms and ACF do
this with more UI, but the shape is identical.

| Classic WordPress | This stack |
|---|---|
| `sanitize_email()`, `absint()`, `sanitize_text_field()` | a Zod schema's coercion and refinement |
| a hand-rolled error bag / `WP_Error` with codes | `safeParse().error.flatten().fieldErrors` |
| `add_settings_error()` output | `useActionState` state rendered under each field |
| ACF field validation rules in the group JSON | `schemas.ts`, in git, next to the code that uses it |
| `wp_verify_nonce()` on the POST | Next's Origin/Host check on Server Actions (Lesson 15.5) |
| `<input name="…">` and `$_POST['…']` | `FormData` — Server Actions receive exactly the same thing |

The last row is worth pausing on. A Server Action bound to a `<form action={…}>` receives a
`FormData` object, submitted by the browser's native form mechanism. If JavaScript has not loaded,
the form **still submits** — the same progressive enhancement you get from a plain
`admin-post.php` handler. That is not a nostalgic detail; it is why Lesson 16.3 uses a Server
Action for a revenue-critical lead form instead of a `fetch` in an `onSubmit`.

**Where the analogy breaks down:** `sanitize_text_field()` **modifies** its input and hands you
something safe-ish; Zod **rejects** input and hands you an error. Sanitising silently accepts a
subtly wrong value — `absint( 'abc' )` is `0`, and `0` is a legitimate-looking downtime figure.
Parsing refuses it and tells the user which field is wrong. Adopting a parse-don't-sanitise habit
is the actual upgrade here; the library is incidental.

The second break is about *where* validation is trusted. In a classic plugin, the PHP that
validates and the PHP that writes are the same file, so validating once is genuinely enough. Here
the validating code runs on Vercel and the writing code runs on Fly.io, and anyone can `curl`
`/graphql` directly. Client validation is a courtesy. Server Action validation is a boundary.
WordPress's own re-validation is the only layer an attacker cannot go around — and that is why it
is duplicated on purpose rather than factored out.

---

## Key Concepts

### 1. Controlled versus uncontrolled, counted rather than asserted

A **controlled** input keeps its value in React state. Every keystroke calls `setState`, which
re-renders the component that owns the state — and every child of it. An **uncontrolled** input
keeps its value in the DOM, where the browser has kept form values since 1995, and React never
sees the intermediate values at all.

`react-hook-form` is the uncontrolled option with the ergonomics of the controlled one. `register`
hands the input a `ref` and an `onBlur`, subscribes to the DOM node, and re-renders only when
something a human would notice changes: a field became invalid, a field became valid again, the
form became submittable.

```
useState PER FIELD                          react-hook-form
─────────────────────────────────           ─────────────────────────────────
type "incident" into `title`                type "incident" into `title`
  i  → setState → render whole form           i  → DOM only, 0 renders
  n  → setState → render whole form           n  → DOM only, 0 renders
  c  → setState → render whole form           ...
  ...  8 keystrokes = 8 renders               8 keystrokes = 0 renders
blur → validate → render                    blur → validate → 1 render IF the
                                                    error state actually changed
```

The incident form has **eleven** fields. A `useState`-per-field version of it re-renders eleven
inputs, two `Select` trees and the error region on every keypress in any of them.

> **Be honest about the size of this win.** On a two-field login form, nobody can measure the
> difference and `useState` is the simpler code. The re-render argument starts to matter at
> roughly eight fields, on a mid-range Android phone, when one of those fields is a `Select`
> rendering ten options. It is not why you should adopt this library on a small form. The reason
> that holds at any size is the next concept: one schema, imported by both sides.

| | `useState` per field | `react-hook-form` |
|---|---|---|
| Value lives in | React state | the DOM node |
| Renders per keystroke | 1 per owner component | 0 |
| Validation | hand-written, per field | one resolver, one schema |
| Error wiring | hand-written `aria-describedby` | `FormField` does it |
| Works with `<form action={…}>` | yes | yes — **if you do not intercept submit** |
| Right choice for two fields | ✅ | also fine |
| Right choice for eleven fields | ❌ | ✅ |

### 2. `zodResolver`, and the point of one schema

`react-hook-form` does not know what "valid" means. A **resolver** is the adapter that tells it.
`zodResolver(schema)` takes a Zod schema, runs it on the current values, and returns
react-hook-form's error shape.

```
                 src/lib/validation/schemas.ts
                      registerSchema
                            │
        ┌───────────────────┴────────────────────┐
        │                                        │
  RegisterForm.tsx  'use client'          src/actions/auth.ts  'use server'
  zodResolver(registerSchema)             registerSchema.safeParse(...)
        │                                        │
   messages under fields                  typed field errors returned
   BEFORE a network request               AFTER the request, authoritatively
```

That diagram is the lesson. The schema is one module, in one place, in git, and the two importers
disagree about nothing because there is nothing to disagree about. Compare the Lesson 15.3 version
you are replacing: a `field()` helper in `src/actions/auth.ts` doing `typeof`, trim, length and an
email regex, and a separate set of `if` statements in the form. Two implementations of one rule is
a rule that will drift, and it drifts in the direction where the client is more permissive than
the server — which shows up as an error message the user cannot act on.

The debt Lesson 15.4 labelled with this lesson's number is discharged here. That is the whole
mechanism: a stopgap is acceptable when it carries the number of the lesson that removes it.

### 3. Parse, do not sanitize

`sanitize_text_field()` transforms input and hands you something safe. Zod **refuses** input and
hands you an error. The difference is not stylistic; it decides whether a wrong value gets stored.

| WordPress | Zod equivalent | What the WordPress version silently accepts |
|---|---|---|
| `sanitize_text_field( $s )` | `z.string().trim()` | control characters become nothing; a 4000-character title becomes a 4000-character title |
| `absint( $n )` | `z.coerce.number().int().min(0)` | `absint('abc')` is `0`, `absint('-5')` is `5` |
| `sanitize_email( $e )` | `z.string().email()` | `sanitize_email('a b@x.test')` strips the space and returns something plausible |
| `wp_kses_post( $html )` | no equivalent, and that is correct | this one is genuinely a sanitiser, and it belongs in PHP where the HTML is stored |
| `in_array( $v, $allowed, true )` | `z.enum([...])` | nothing — this one is already a parse |
| `(float) $v` | `z.coerce.number()` | `(float) 'twelve'` is `0.0` |

The row that matters is `absint`. `absint( 'abc' ) === 0`, and `0` is a legitimate-looking
downtime figure. Nobody gets an error, the incident is stored, and the blame leaderboard averages
a zero into a real statistic. The failure is not a crash; it is a plausible wrong number, which is
the expensive kind.

> **`z.coerce.number()` has exactly the same trap, and you will walk into it.** `FormData` values
> are strings, an empty text input yields `''`, and `Number('')` is `0`. So
> `z.coerce.number().min(0)` accepts an empty field as zero — `absint`, reimplemented in
> TypeScript. The schema in the Task requires a non-empty string **first** and coerces second,
> and there is a test case for it.

### 4. The three validation layers, and which one you could delete

This is the centrepiece, so it gets numbers and a verdict.

```
  ┌─ LAYER 1 ── the browser ──────────────────────────────────────────┐
  │  zodResolver in RegisterForm.tsx        removes 0 attack surface  │
  │  purpose: the user sees "missing an @" without a round trip       │
  └───────────────────────────────────────────────────────────────────┘
                          │  HTTPS POST — an attacker starts HERE
                          ▼
  ┌─ LAYER 2 ── the Server Action ────────────────────────────────────┐
  │  registerSchema.safeParse(formData)     THE BOUNDARY of your app  │
  │  purpose: nothing malformed reaches WordPress from your code      │
  └───────────────────────────────────────────────────────────────────┘
                          │  GraphQL over HTTP — an attacker can start HERE too
                          ▼
  ┌─ LAYER 3 ── WordPress ────────────────────────────────────────────┐
  │  sanitize_email + is_email + mb_strlen (Lesson 06.2, in PHP)      │
  │  purpose: THE ONLY LAYER AN ATTACKER CANNOT GO AROUND             │
  └───────────────────────────────────────────────────────────────────┘
```

Now answer the question directly. **Which of these could you delete without causing a security
incident?**

| Layer | Delete it and you lose | Security incident? |
|---|---|---|
| 1 — the browser | good error messages and one round trip | **No.** An attacker never ran this code. |
| 2 — the Server Action | your own app's guarantee about what it sends WordPress | **No, not immediately** — layer 3 still refuses. You lose the ability to return typed field errors, and every bad submit becomes a GraphQL error you have to map back onto a field. |
| 3 — WordPress | everything | **Yes.** `curl` reaches `/graphql` directly. Appendix 04 §6 says the origin is discoverable from any media URL. |

So the honest hierarchy is: layer 3 is the control, layer 2 is the contract your application keeps
with itself, and layer 1 is user experience. Anyone who calls layer 1 "validation for security" has
mistaken a courtesy for a boundary. And note the asymmetry — the layer you would most miss on a
Tuesday afternoon is layer 1, and the layer whose absence ends your week is layer 3.

> **Where this breaks in the wild:** a team deletes layer 3 because "we already validate in the
> app". Six months later a second consumer appears — a mobile client, a partner integration, a
> Zapier webhook — and it validates nothing at all. Layer 3 is the only one whose guarantee
> survives a new caller you did not write.

### 5. Shape versus existence, and why the allowlist is fetched server-side

A regular expression proves a slug is **slug-shaped**. It cannot prove the slug **exists**.

```
z.string().regex(/^[a-z0-9-]+$/)          allowlist.includes(value)
──────────────────────────────────        ──────────────────────────────────
's1-catastrophic'   ✅ shape ok            's1-catastrophic'   ✅ it exists
's9-apocalyptic'    ✅ shape ok            's9-apocalyptic'    ❌ reject
'the-hacker'        ✅ shape ok            'the-hacker'        ❌ reject
```

`s9-apocalyptic` matches perfectly and is not one of the four `severity` terms in
[appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies). Lesson 06.2 already
solved this in PHP with `get_term_by()` and it throws `That severity does not exist.`. The Next
side needs the same answer earlier, so the user gets a field error instead of a GraphQL error.

Two structural rules follow, and both are load-bearing.

**The allowlist is fetched from WordPress, not hard-coded.** `severity` is a closed set of four
today. `scapegoat` is free-form and editors add to it. Hard-coding either into `schemas.ts` means
a new scapegoat term is rejected by your front end until someone deploys — a content change
requiring a code change, which is the thing this whole architecture exists to avoid.

**The allowlist is fetched at submit time, on the server, and never trusted from the form.** The
`<Select>` renders its options from the same fetched list, so the two agree; but the value the
action validates against is the list the action itself just fetched. If the allowlist arrived as a
hidden field, an attacker would simply send a longer one.

`incidentSchema` therefore cannot know the terms, and the file exports two things: the base schema,
and `refineTerms(allowed)` which returns the schema with a `superRefine` bolted on. The Task
implements that; Key Concept 6 covers why the alternative is worse.

### 6. `safeParse` versus `parse`, and why an action never throws on bad input

Two entry points, one difference:

| | `schema.parse(v)` | `schema.safeParse(v)` |
|---|---|---|
| On success | returns the parsed value | `{ success: true, data }` |
| On failure | **throws** `ZodError` | `{ success: false, error }` |
| In a Server Action | ❌ | ✅ |

A `throw` inside a Server Action is not a validation error the form can render. React serialises it
as an opaque server error, the nearest `error.tsx` boundary takes over, and the user lands on
"Something went wrong" **having lost everything they typed**. On an eleven-field incident form
that is not a bug report you will get; it is a user you will never see again.

`safeParse` gives you `error.flatten().fieldErrors`, which is a
`Record<string, string[] | undefined>` — a shape that is serialisable, so it can be the state
`useActionState` returns, so it can render under the right field. That is the same shape as a
`WP_Error` bag with codes, and `add_settings_error()` is the same rendering job.

```ts
// (illustration) the two halves of one decision — the real code is in the Task
const parsed = registerSchema.safeParse(raw);            // ✅ never throws on input
if (!parsed.success) {
  return { status: 'error', message: 'Check the fields below.', fieldErrors: parsed.error.flatten().fieldErrors };
}
```

The rule, stated once for the whole module: **`throw` is for things that are not the user's
fault.** Redis being unreachable, WordPress returning a 500, a missing environment variable — those
are exceptional. A malformed email address is the normal case for a public form.

### 7. Accessible form errors are a mechanism, not a style

An error message is only an error message if it is programmatically tied to the field it is about.
Four attributes do that, and `form.tsx` is where they get wired once so no form has to remember.

| Mechanism | On which element | What it buys |
|---|---|---|
| `aria-describedby="<desc-id> <msg-id>"` | the `<input>` | a screen reader reads the hint **and** the error after the label |
| `aria-invalid="true"` | the `<input>` | the field is announced as invalid, independently of the message |
| `role="alert"` | the message `<p>` | the text is announced when it appears, without moving focus |
| `useId()` | the `FormItem` wrapper | ids are unique when the same form renders twice on one page |

`useId()` is the one people skip. Hard-code `id="email-error"` and a page with a login form in a
dialog **and** a login form in the body has two elements with the same id; `aria-describedby`
resolves to the first, and half your users get somebody else's error message. React's `useId` is
render-stable across server and client, which is exactly why hand-rolling it with `Math.random()`
produces a hydration mismatch.

> **`role="alert"` on an element that is inserted into the DOM is the fragile version.** Some
> assistive technology only announces changes to a live region that already existed. So the
> `FormMessage` in the Task renders its `<p role="alert">` **always**, empty when there is no
> error. The cost, stated plainly: an empty paragraph per field in the DOM forever. The benefit is
> that the announcement is reliable rather than mostly reliable, and an empty `<p>` has no height.

### 8. Focus management, because nothing does it for you

Submit an invalid form and the browser does nothing. No focus moves, no scroll happens. A sighted
mouse user sees red text somewhere below the fold; a screen reader user hears nothing at all,
because focus is still on the submit button and no live region changed.

Three positions, and the course takes the third:

| Approach | Behaviour | Verdict |
|---|---|---|
| Do nothing | the user hunts | ❌ |
| Focus the error **summary** at the top | announced, one place to read | ✅ correct for a 40-field government form |
| Focus the **first invalid field** | announced, and the cursor is where the work is | ✅ **this course** |

`react-hook-form` exposes `setFocus(name)`. The subtlety is *when* to call it: after the server
answers, not only after a client-side parse, because the no-JavaScript path and the
session-expired path both produce errors that never went through the resolver. So the Task calls
`setFocus` from an effect keyed on the action's returned state, which covers every route to an
error with one code path.

Test it with the keyboard, not by eye: `Tab` to the submit button, press `Enter`, then press `Tab`
once. If the next stop is the field *after* the first invalid one, focus moved correctly.

### 9. Progressive enhancement, and the exact way react-hook-form breaks it

`<form action={serverAction}>` is a real HTML form. If JavaScript has not loaded, has failed to
load, or has been switched off, the browser does what browsers do: it POSTs to the action and
renders the response. Nothing about a Server Action requires client JavaScript to *submit* —
`useActionState` only upgrades the experience.

There is exactly one way to break that, and it is the default way most tutorials write this code:

```tsx
// (illustration) the line that deletes the no-JavaScript path
<form onSubmit={form.handleSubmit(onValid)}>
```

`handleSubmit` calls `event.preventDefault()` **unconditionally**, on every submit, before it knows
whether the values are valid. With JavaScript off the handler never runs and the form works; with
JavaScript on and a bug in `onValid`, the form silently does nothing at all. Worse, the failure
mode is invisible in development.

This course's rule: **no `onSubmit` on a form bound to a Server Action.** The Task's register form
has none, and Verification greps for `preventDefault` and expects zero hits. Three consequences,
named honestly:

| Consequence | Cost | Why it is acceptable |
|---|---|---|
| An invalid submit reaches the server | one round trip | The user already saw the message on blur. And this is the *same* code path a no-JS user takes, so it cannot rot. |
| Errors render from the action's state | a `useEffect` to feed them back into react-hook-form | One path to an error message instead of two. |
| The browser's own constraint validation fires first | `type="email"` rejects `bob` before your code sees it | That is a fourth layer, it is free, and it also works with JavaScript off. |

> **A conditional `preventDefault` is a legitimate design too.** Parse synchronously in `onSubmit`,
> call `preventDefault()` **only** when the parse fails, and you keep the round trip and the no-JS
> path. It is two more moving parts and one more thing to get wrong on a Friday, and it buys a
> round trip the user does not notice. This course chose the simpler one; if you choose the other,
> the test that must exist is "an invalid submit with JavaScript disabled still reaches the
> server".

---

## Task

### Step 1: Install the form primitives, with pinned majors

```bash
cd next-app

# The generator writes src/components/ui/form.tsx and adds nothing to package.json
# that it does not need. Do NOT let it install React Hook Form implicitly — the
# next command puts the versions in your lockfile where you can read them.
npx shadcn@latest add form

# Majors pinned on purpose. Read the note below before widening any of them.
npm install zod@^3 react-hook-form@^7 @hookform/resolvers@^3

npm ls zod react-hook-form @hookform/resolvers
```

Three majors, three reasons:

| Package | Pinned to | Why this major |
|---|---|---|
| `zod` | `^3` | Zod 4 moves the string formats to the top level (`z.email()` instead of `z.string().email()`) and reworks error customisation. Every schema in this lesson is a mechanical rename away from Zod 4; pinning keeps the lesson and the resolver's peer range in step. |
| `react-hook-form` | `^7` | `setFocus`, `mode: 'onBlur'` and the `FormProvider` context this lesson depends on are all v7 APIs |
| `@hookform/resolvers` | `^3` | v3 is the line whose peer dependency is Zod 3. `@hookform/resolvers/zod` is the import path. |

> **`npm install` and not `npx shadcn` for the runtime dependencies.** The CLI will happily add
> them for you, and then their versions live in whatever the CLI resolved on the day you ran it.
> A dependency you did not name is a dependency you will not think to upgrade.

**Verify §1:**

- [ ] `next-app/src/components/ui/form.tsx` exists.
- [ ] `npm ls zod` prints a `3.x` version, not `4.x`.
- [ ] `npm run type-check` is silent. If it complains about `zodResolver` generics, your
      `@hookform/resolvers` major does not match your `zod` major.

### Step 2: Edit the generated `form.tsx` — it is yours now

The generated file already wires `aria-describedby`, `aria-invalid` and `useId()`. Two things it
does not do: it unmounts the message element, and the message has no `role`. Both are Key Concept
7. Replace the generated `FormMessage` with this:

```tsx
// next-app/src/components/ui/form.tsx
// Generated by `npx shadcn@latest add form`, then edited. Per ADR 0008 this file
// is OURS: shadcn components are copied in, not depended on, so re-running
// `npx shadcn@latest add form` would overwrite this and must not be done
// casually. Lesson 11.2 Key Concept 5.
function FormMessage({ className, ...props }: React.ComponentProps<'p'>) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? '') : (props.children ?? '');

  // ALWAYS RENDERED, empty when there is no error. The generated version
  // returns null, which means the live region does not exist at the moment the
  // error appears — and some assistive technology only announces changes to a
  // region that was already there. An empty <p> has no height. Lesson 16.1 §7.
  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      role="alert"
      className={cn('text-sm font-medium text-destructive', className)}
      {...props}
    >
      {body}
    </p>
  );
}
```

Leave `FormItem`, `FormLabel`, `FormControl` and `FormDescription` exactly as generated, and read
`FormControl` before you move on — the `aria-describedby` it builds is the mechanism from Key
Concept 7, and you want to have seen it rather than trusted it.

**Verify §2:**

- [ ] `grep -c 'role="alert"' src/components/ui/form.tsx` returns `1`.
- [ ] `grep -c 'return null' src/components/ui/form.tsx` returns `0`. If it returns `1`, you
      edited a copy of `FormMessage` and left the original in place.
- [ ] `grep -c 'React.useId' src/components/ui/form.tsx` returns `1` or more — that is `FormItem`,
      untouched, and it is what makes two instances of one form safe.

### Step 3: Write every schema in the application

One file. Both halves import it.

```ts
// next-app/src/lib/validation/schemas.ts
// The single source of validation shape for the whole app. Imported by client
// forms AND by Server Actions — Lesson 16.1 §2.
//
// NO `import 'server-only'` here, deliberately. This module holds no endpoint,
// no credential and no secret; it holds rules, and both sides need them. The
// guard belongs on src/lib/graphql/client.ts and on src/lib/auth/*, which hold
// all three. Lesson 10.1 drew that line.
//
// EVERY bound below is mirrored by a check in PHP, named per field. WordPress
// re-validates independently (Lesson 06.2) and is the authority. If you widen a
// bound here, widen it there FIRST, or you have built a form that promises
// something the API refuses.
import { z } from 'zod';

/** The three locales the app ships. Module 20 makes them routable. */
export const LOCALES = ['en', 'uk', 'de'] as const;

/** kebab-case term slugs. SHAPE ONLY — existence is §5, and refineTerms(). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * FormData carries strings, and Number('') is 0. So require a non-empty string
 * FIRST and coerce SECOND. `z.coerce.number()` on its own is absint('abc'), and
 * a silent zero is a legitimate-looking downtime figure. Lesson 16.1 §3.
 */
function requiredNumber(label: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .pipe(z.coerce.number({ invalid_type_error: `${label} must be a number.` }));
}

/** Same, but an empty field means "not supplied" rather than an error. */
function optionalNumber(label: string) {
  return z
    .union([z.literal(''), z.string().trim().pipe(z.coerce.number({ invalid_type_error: `${label} must be a number.` }))])
    .transform((v) => (v === '' ? undefined : v));
}

// mutation-register-developer.php: sanitize_email() then is_email().
// 190 is wp_btt_leads.email VARCHAR(190) — appendix 03 §5.
const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(190, 'That email address is too long.')
  .email('That does not look like an email address.');

// mutation-register-developer.php: '' === $name || mb_strlen( $name ) > 80.
const displayName = z
  .string()
  .trim()
  .min(1, 'Enter a display name.')
  .max(80, 'Keep the display name to 80 characters or fewer.');

const locale = z.enum(LOCALES).default('en');

export const registerSchema = z.object({ email, displayName, locale });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  // No length or complexity rule on a LOGIN password. WordPress decides whether
  // it is correct; a client-side minimum here only tells an attacker how short
  // a password is worth trying, and locks out a legacy account with a shorter one.
  username: z.string().trim().min(1, 'Enter your username or email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifySchema = z.object({
  // mutation-register-developer.php mails wp_generate_password( 32, false, false ).
  uid: requiredNumber('a user id').pipe(z.number().int().positive()),
  token: z.string().trim().length(32, 'That verification link is not complete.'),
});
export type VerifyInput = z.infer<typeof verifySchema>;

export const incidentSchema = z.object({
  // mutation-create-incident.php: '' === $title, then mb_strlen( $title ) > 200.
  title: z
    .string()
    .trim()
    .min(1, 'Give the incident a title.')
    .max(200, 'Keep the title to 200 characters or fewer.'),
  // wp_kses_post() in PHP decides which HTML survives. There is no Zod
  // equivalent and there should not be: the sanitiser belongs where the value
  // is stored. All this bound does is refuse a novel.
  body: z.string().trim().max(20000, 'That is too long for one incident.').default(''),
  scapegoatSlug: z.string().trim().regex(SLUG, 'Choose a scapegoat.'),
  severitySlug: z.string().trim().regex(SLUG, 'Choose a severity.'),
  // require_past_datetime() in PHP: strtotime(), then reject the future.
  occurredAt: z
    .string()
    .trim()
    .min(1, 'When did it happen?')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'That is not a date we understand.')
    .refine((v) => Date.parse(v) <= Date.now(), 'An incident cannot have happened in the future.'),
  // mutation-create-incident.php: $downtime > 100000.
  downtimeMinutes: requiredNumber('the downtime in minutes').pipe(
    z.number().int('Whole minutes, please.').min(0, 'Downtime cannot be negative.').max(100000, 'Downtime must be 100000 minutes or fewer.')
  ),
  // mutation-create-incident.php: $cost < 0 || $cost > 1000000000.
  estimatedCostUsd: optionalNumber('the estimated cost').pipe(
    z.number().min(0, 'Cost cannot be negative.').max(1_000_000_000, 'That cost is out of range.').optional()
  ),
  // Real GraphQL enums (appendix 03 §3). The STORED kebab values, because that
  // is what the mutation input maps from — Lesson 06.1 §4.
  environment: z.enum(['production', 'staging', 'development', 'works-on-my-machine']),
  resolutionStatus: z.enum(['open', 'mitigated', 'blamed', 'wontfix']).default('open'),
  // mutation-create-incident.php: $blame < 0 || $blame > 100, default 73.
  blameConfidence: requiredNumber('a blame confidence')
    .pipe(z.number().min(0, 'Between 0 and 100.').max(100, 'Between 0 and 100.'))
    .default('73'),
  stackTrace: z.string().trim().max(5000, 'Trim the stack trace to 5000 characters.').default(''),
  reporterDisplayName: displayName.optional(),
  locale,
});
export type IncidentInput = z.infer<typeof incidentSchema>;

/** Term slugs that actually exist, fetched from WordPress at submit time. */
export type IncidentTermAllowlist = {
  readonly scapegoats: readonly string[];
  readonly severities: readonly string[];
};

/**
 * incidentSchema plus existence checks. A regex proves a slug is slug-shaped;
 * only a lookup proves it is a term, and `s9-apocalyptic` is the counterexample
 * (Lesson 16.1 §5, Lesson 06.2 §6).
 *
 * A FUNCTION rather than a refinement inside incidentSchema, because the schema
 * cannot know the terms and must not fetch them: a schema that performs I/O is
 * a schema you cannot unit-test and cannot import into a client component
 * without dragging WP_GRAPHQL_ENDPOINT with it.
 */
export function refineTerms(allowed: IncidentTermAllowlist) {
  return incidentSchema.superRefine((value, ctx) => {
    if (!allowed.scapegoats.includes(value.scapegoatSlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scapegoatSlug'],
        message: 'That scapegoat does not exist.',
      });
    }

    if (!allowed.severities.includes(value.severitySlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severitySlug'],
        message: 'That severity does not exist.',
      });
    }
  });
}
```

The design decision the note gestures at deserves the full argument, because the alternative looks
tidier and is worse.

| | `refineTerms(allowed)`, exported | `.superRefine()` written inline in the action |
|---|---|---|
| Unit-testable without a network | ✅ pass it two arrays | ❌ needs the action, needs a mock |
| Reused by the next action that touches an incident | ✅ import it | ❌ reimplemented, and it will drift |
| Message text lives with the other messages | ✅ | ❌ half in `schemas.ts`, half in `incidents.ts` |
| Number of exported schema shapes to keep straight | 2 | 1 |
| **Verdict** | ✅ **this course** | reasonable for exactly one call site, and there are three |

The cost, stated plainly: two names, `incidentSchema` and `refineTerms(...)`, and a reviewer has to
notice which one a call site used. The client form validates against the base schema and the action
validates against the refined one, so a hand-crafted POST with `severitySlug: "s9-apocalyptic"`
gets a field error from layer 2, while the `<Select>` never offers it in the first place.

### Step 4: Add the term-options query and regenerate

```graphql
# next-app/src/graphql/incidents.graphql — append to the existing document file
# The term ALLOWLIST, read at submit time and used to build the two <Select>s.
# hideEmpty: false because a brand-new scapegoat with no incidents yet is still
# a legal choice. `orderby` is deliberately absent: sorting fourteen terms in
# TypeScript costs nothing and does not pin the lesson to one WPGraphQL
# version's term-ordering enum.
query IncidentTermOptions {
  scapegoats(first: 100, where: { hideEmpty: false }) {
    nodes {
      slug
      name
    }
  }
  severities(first: 10, where: { hideEmpty: false }) {
    nodes {
      slug
      name
    }
  }
}
```

```bash
cd next-app
npm run codegen
# Expected: IncidentTermOptionsDocument and IncidentTermOptionsQuery in src/gql/graphql.ts
git status --short ../wordpress-headless/schema.graphql
# Expected: no output. Module 16 adds no GraphQL TYPES — every mutation and
#           connection it uses was registered in Lesson 06.2 — so there is no
#           `npm run schema:pull` anywhere in this module.
```

**Verify §4:**

- [ ] `grep -c 'IncidentTermOptionsDocument' src/gql/graphql.ts` returns `1` or more.
- [ ] `git status --short ../wordpress-headless/schema.graphql` is empty. A change here means you
      edited PHP that changes the schema, and this lesson does not.

### Step 5: Rebuild `/en/register`

Two files. The page reads `params` and stays a Server Component; the form is the client island.
The token never crosses that line and neither does the endpoint.

```tsx
// next-app/src/app/[locale]/(auth)/register/page.tsx
// Rebuilt in Lesson 16.1. Lesson 15.3's version validated with hand-written
// checks inside src/actions/auth.ts, which is the debt 15.4 labelled with this
// lesson's number.
import { RegisterForm } from '@/components/auth/RegisterForm';

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  // params is a Promise in Next 16. Every access awaited, every route async.
  const { locale } = await params;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Register as a reporter</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Reporters submit incidents for moderation. Submissions are reviewed before they appear.
      </p>

      {/* A plain serialisable prop. No session context, no token, no endpoint. */}
      <RegisterForm locale={locale} />
    </main>
  );
}
```

```tsx
// next-app/src/components/auth/RegisterForm.tsx
'use client';

import { useActionState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { register as registerAction } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { registerSchema, type RegisterInput } from '@/lib/validation/schemas';

export function RegisterForm({ locale }: { readonly locale: string }) {
  // Lesson 15.4's action, unchanged: (state, formData) => Promise<AuthFormState>.
  const [state, formAction, isPending] = useActionState(registerAction, { status: 'idle' as const });

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    // onBlur, not onChange: nobody wants "that is not an email address" after
    // typing the first character of one.
    mode: 'onBlur',
    defaultValues: { email: '', displayName: '', locale: 'en' },
  });

  // The ONE place errors become visible, whichever route they arrived by:
  // the client resolver, the action's safeParse, or a full no-JavaScript POST.
  // Lesson 16.1 §8 — nothing moves focus for you.
  useEffect(() => {
    if (state.status !== 'error' || !state.fieldErrors) {
      return;
    }

    const entries = Object.entries(state.fieldErrors) as [keyof RegisterInput, string[] | undefined][];

    for (const [name, messages] of entries) {
      if (messages?.[0]) {
        form.setError(name, { type: 'server', message: messages[0] });
      }
    }

    const first = entries.find(([, messages]) => Boolean(messages?.[0]));
    if (first) {
      form.setFocus(first[0]);
    }
  }, [state, form]);

  return (
    <Form {...form}>
      {/*
        NO onSubmit. `action` is the whole mechanism: with JavaScript off the
        browser POSTs this form natively and the action's own safeParse is the
        boundary. react-hook-form's handleSubmit would call preventDefault()
        unconditionally and delete that path. Lesson 16.1 §9.
      */}
      <form action={formAction} className="mt-8 space-y-6">
        <input type="hidden" name="locale" value={locale} />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email address</FormLabel>
              <FormControl>
                {/* type="email" for the mobile keyboard AND because the browser's
                    own constraint validation is a free fourth layer that also
                    works with JavaScript off. */}
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormDescription>We mail you a confirmation link. It expires in 24 hours.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input autoComplete="nickname" maxLength={80} {...field} />
              </FormControl>
              <FormDescription>Credited on your incidents. 80 characters or fewer.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {state.status === 'error' && state.message ? (
          // The form-level message, for failures that belong to no field:
          // the rate limiter, WordPress being unreachable, a bad app token.
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.message}
          </p>
        ) : null}

        {state.status === 'success' ? (
          <p role="status" className="text-sm font-medium">
            Check your inbox. The confirmation link is valid for 24 hours.
          </p>
        ) : null}

        <Button type="submit" variant="blame" size="xl" disabled={isPending}>
          {isPending ? 'Registering…' : 'Register'}
        </Button>
      </form>
    </Form>
  );
}
```

> **`AuthFormState` is Lesson 15.4's type, not this lesson's.** This component reads three members
> of it: `status`, `message` and `fieldErrors`. Lesson 16.2 writes the same shape for
> `IncidentFormState` and prints it in full. If your 15.4 state differs, adapt those three reads
> and nothing else in this lesson changes.

**Verify §5:**

- [ ] `npm run type-check` is silent. A complaint about `state.fieldErrors` means `AuthFormState`
      does not carry field errors yet; add them in `src/actions/auth.ts` before continuing, because
      Step 6's spec and the whole of Lesson 16.2 assume the shape.
- [ ] `grep -c 'preventDefault' src/components/auth/RegisterForm.tsx` returns `0`.
- [ ] `grep -c 'safeParse' src/actions/auth.ts` returns `1` or more, and
      `grep -c 'schemas' src/actions/auth.ts` returns `1` or more. The action must import the
      same module the form does; if it still has 15.3's local `field()` helper, delete it now.

### Step 6: Write the schema spec

```ts
// next-app/src/lib/validation/schemas.test.ts
// schemas.ts is pure and has no `server-only` guard, so it unit-tests in plain
// Node exactly like tags.ts and errors.ts (Lesson 12.2 §6).
import { describe, expect, it } from 'vitest';

import { incidentSchema, refineTerms, registerSchema } from '@/lib/validation/schemas';

const ALLOWED = {
  scapegoats: ['the-intern', 'dns', 'legacy-jquery'],
  severities: ['s1-catastrophic', 's2-major', 's3-minor', 's4-cosmetic'],
} as const;

/** A submission that passes, so each failing case differs by exactly one field. */
function validIncident(overrides: Record<string, unknown> = {}) {
  return {
    title: 'The cache served last Tuesday for six hours',
    body: '',
    scapegoatSlug: 'the-intern',
    severitySlug: 's2-major',
    occurredAt: '2024-06-01T09:00',
    downtimeMinutes: '42',
    estimatedCostUsd: '',
    environment: 'production',
    resolutionStatus: 'open',
    blameConfidence: '73',
    stackTrace: '',
    locale: 'en',
    ...overrides,
  };
}

describe('registerSchema', () => {
  it('accepts a plausible registration', () => {
    expect(registerSchema.safeParse({ email: 'dev@example.test', displayName: 'Dev', locale: 'en' }).success).toBe(true);
  });

  it('rejects an email with no @', () => {
    const result = registerSchema.safeParse({ email: 'dev.example.test', displayName: 'Dev' });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.email?.[0]).toBe('That does not look like an email address.');
  });

  it('rejects a display name over 80 characters, the bound PHP also enforces', () => {
    const result = registerSchema.safeParse({ email: 'dev@example.test', displayName: 'x'.repeat(81) });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.displayName?.[0]).toContain('80 characters');
  });

  it('trims before it measures, so whitespace is not a name', () => {
    expect(registerSchema.safeParse({ email: 'dev@example.test', displayName: '   ' }).success).toBe(false);
  });
});

describe('incidentSchema', () => {
  it('accepts the happy path and coerces the numeric strings FormData gives it', () => {
    const result = incidentSchema.safeParse(validIncident());

    expect(result.success).toBe(true);
    expect(result.data?.downtimeMinutes).toBe(42);
  });

  it('rejects a 201-character title', () => {
    const result = incidentSchema.safeParse(validIncident({ title: 'x'.repeat(201) }));

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.title?.[0]).toContain('200 characters');
  });

  // THE absint TEST. Number('') is 0, and 0 is a legitimate-looking downtime.
  // Lesson 16.1 §3 — this is the case a bare z.coerce.number() gets wrong.
  it('rejects an EMPTY downtime instead of silently reading it as zero', () => {
    const result = incidentSchema.safeParse(validIncident({ downtimeMinutes: '' }));

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.downtimeMinutes?.[0]).toContain('Enter');
  });

  it('accepts an explicit zero downtime, which is a real answer', () => {
    expect(incidentSchema.safeParse(validIncident({ downtimeMinutes: '0' })).success).toBe(true);
  });

  it('rejects a downtime above 100000, the bound mutation-create-incident.php enforces', () => {
    expect(incidentSchema.safeParse(validIncident({ downtimeMinutes: '100001' })).success).toBe(false);
  });

  it('rejects an occurredAt in the future rather than clamping it to now', () => {
    expect(incidentSchema.safeParse(validIncident({ occurredAt: '2099-01-01T00:00' })).success).toBe(false);
  });

  it('rejects an environment outside the enum', () => {
    expect(incidentSchema.safeParse(validIncident({ environment: 'works-on-your-machine' })).success).toBe(false);
  });
});

describe('refineTerms', () => {
  it('accepts a slug that is in the allowlist', () => {
    expect(refineTerms(ALLOWED).safeParse(validIncident()).success).toBe(true);
  });

  // SHAPE versus EXISTENCE. 's9-apocalyptic' matches the slug regex perfectly.
  it('rejects a well-shaped severity slug that is not a term', () => {
    const result = refineTerms(ALLOWED).safeParse(validIncident({ severitySlug: 's9-apocalyptic' }));

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.severitySlug?.[0]).toBe('That severity does not exist.');
  });

  it('rejects a well-shaped scapegoat slug that is not a term', () => {
    const result = refineTerms(ALLOWED).safeParse(validIncident({ scapegoatSlug: 'the-security-researcher' }));

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.scapegoatSlug?.[0]).toBe('That scapegoat does not exist.');
  });

  it('lets the base schema through unchanged, so one bad field yields one error', () => {
    const result = refineTerms(ALLOWED).safeParse(validIncident({ severitySlug: 's9-apocalyptic' }));

    expect(Object.keys(result.error?.flatten().fieldErrors ?? {})).toEqual(['severitySlug']);
  });
});
```

**Verify §6:**

- [ ] `npm test -- --run src/lib/validation/schemas.test.ts` reports **16 passed**.
- [ ] Delete the `.trim()` from `displayName` and the whitespace case fails. Put it back. A test
      you have not seen fail is a test you do not know works.

### Step 7: Write down the accessibility row and the three layers

Two appends, both to files earlier lessons created.

```markdown
<!-- docs/accessibility.md — append to the table Lesson 11.4 started.
     FOUR ROWS ONLY. Do not re-print the header: 11.4 wrote it, and a second
     header line renders as a literal row in the middle of the table. -->
| `role="alert"` | `ui/form.tsx` `FormMessage` | announces a validation message when it appears, without stealing focus | no — there is no element whose insertion is announced |
| `aria-invalid` | `ui/form.tsx` `FormControl` | the field is announced as invalid independently of its message | no |
| `aria-describedby` | `ui/form.tsx` `FormControl` | ties the hint **and** the error to the input | partly — `<label>` names it, nothing describes it |
| `role="status"` | `auth/RegisterForm.tsx` | announces the success message politely | no |

## Form errors — the pattern, once

Every form in this app uses `ui/form.tsx`, so every form gets the same four mechanisms without
remembering them. Three rules that are not in the code and have to be written down:

1. The message element is **always rendered**, empty when there is no error. Unmounting it makes
   the announcement unreliable.
2. Ids come from `useId()`. Two instances of one form on one page must not collide.
3. Focus moves to the **first invalid field**, from an effect keyed on the action's returned
   state — so the client resolver, the server parse and the no-JavaScript round trip all land in
   the same code path.
```

```markdown
<!-- docs/api-contract.md — append -->
## Input validation — the three layers (Lesson 16.1)

| Layer | Where | Purpose | Delete it and |
|---|---|---|---|
| 1 — browser | `zodResolver` in a client form | the user sees the problem without a round trip | messages get worse; **no** security change |
| 2 — Server Action | `schema.safeParse(formData)` in `src/actions/*` | this application never sends WordPress something malformed | typed field errors are lost; layer 3 still refuses |
| 3 — WordPress | `sanitize_*` + `is_email` + range checks in `includes/graphql/*.php` | **the only layer an attacker cannot go around** | a security incident |

Layer 1 removes zero attack surface: an attacker does not use the form. Layer 2 is the boundary of
*our* code. Layer 3 is the control, because `/graphql` is reachable directly and appendix 04 §6
says the origin is discoverable from any media URL.

Shape is not existence. A `regex` proves `s9-apocalyptic` is slug-shaped; only a lookup proves it
is a `severity` term. Term allowlists are fetched from WordPress **server-side at submit time**,
never accepted from the form.
```

**Verify §7:**

- [ ] `grep -c 'role="alert"' ../docs/accessibility.md` returns `1` or more.
- [ ] `grep -c 'the three layers' ../docs/api-contract.md` returns `1`.
- [ ] Every `aria-*` attribute in `src/components/ui/form.tsx` has a row. Lesson 11.4 made that a
      standing rule, and Verification check 12 there is the one that catches you.

---

## Verification

```bash
cd next-app

# 1. The three toolchains agree
npm run type-check
# Expected: no output
npm run lint
# Expected: no errors
npm test -- --run
# Expected: Test Files  N passed | Tests  M passed — and schemas.test.ts among
#           them with 16 tests

# 2. The new spec on its own, so the case count is visible
npm test -- --run src/lib/validation/schemas.test.ts
# Expected: Tests  16 passed

# 3. The generated form primitives are present and were edited, not just added
grep -c 'role="alert"' src/components/ui/form.tsx
# Expected: 1
grep -c 'React.useId' src/components/ui/form.tsx
# Expected: 1

# 4. The registration path works end to end. Count first.
BEFORE=$(cd ../wordpress-headless && docker compose run --rm -T wpcli \
  wp user list --role=incident_reporter --format=count | tr -d '\r')
echo "reporters before: $BEFORE"
# Expected: a number — 1 or more, because the seeder creates `reporter`

#    Now submit http://localhost:3000/en/register in a browser with a fresh
#    address, e.g. rhf-probe@example.test, and a display name.
AFTER=$(cd ../wordpress-headless && docker compose run --rm -T wpcli \
  wp user list --role=incident_reporter --format=count | tr -d '\r')
echo "reporters after: $AFTER"
# Expected: exactly BEFORE + 1

cd ../wordpress-headless && docker compose run --rm wpcli \
  wp user get rhf-probe@example.test --field=roles
# Expected: incident_reporter
curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].Subject'
# Expected: Confirm your Blame The Tech account
cd ../next-app

# 5. NEGATIVE — no client component knows where WordPress is. The endpoint is
#    server-only (appendix 04 §3.1) and a form that fetches it directly is the
#    named anti-pattern.
grep -rl 'WP_GRAPHQL_ENDPOINT' src/components/ | wc -l
# Expected: 0
grep -rl "'use client'" src/lib/validation/ | wc -l
# Expected: 0 — schemas.ts is neutral. It is imported BY both sides, not FROM one.

# 6. NEGATIVE — the no-JavaScript path was not deleted by an onSubmit handler
grep -rc 'preventDefault' src/components/auth/RegisterForm.tsx \
  'src/app/[locale]/(auth)/register/page.tsx'
# Expected: 0 for both files
grep -c 'handleSubmit' src/components/auth/RegisterForm.tsx
# Expected: 0 — handleSubmit calls preventDefault unconditionally (§9)
grep -c 'action={formAction}' src/components/auth/RegisterForm.tsx
# Expected: 1

# 7. NEGATIVE — prove it, do not assume it. In Chrome DevTools open the Command
#    Palette (Cmd/Ctrl+Shift+P), run "Disable JavaScript", reload
#    http://localhost:3000/en/register, submit a VALID registration, then run
#    "Enable JavaScript" again.
cd ../wordpress-headless && docker compose run --rm wpcli \
  wp user list --role=incident_reporter --format=count
# Expected: incremented again. The browser POSTed the form itself; React was
#           never involved. If this did NOT increment, something in the form
#           intercepts submit — go back to check 6.
cd ../next-app

# 8. NEGATIVE — the SAME module is imported on both sides of the boundary
grep -c "from '@/lib/validation/schemas'" src/actions/auth.ts
# Expected: 1
grep -c "from '@/lib/validation/schemas'" src/components/auth/RegisterForm.tsx
# Expected: 1
grep -rho 'field(' src/actions/auth.ts | wc -l
# Expected: 0 — Lesson 15.3's hand-rolled helper is gone, not kept "just in case"

# 9. NEGATIVE — safeParse everywhere, parse nowhere. A `parse` in an action
#    throws, React shows the error boundary, and the user loses their input (§6).
grep -rho 'safeParse' src/actions/ | wc -l
# Expected: 1 or more
grep -rhoE '(^|[^e])\.parse\(' src/actions/ | wc -l
# Expected: 0

# 10. NEGATIVE — a well-shaped slug that is not a term is refused. This is the
#     assertion that distinguishes shape from existence, and it runs as a test
#     rather than by hand because nothing in the UI can offer the value.
npm test -- --run src/lib/validation/schemas.test.ts -t 'not a term'
# Expected: Tests  2 passed  (severity and scapegoat)

# 11. The bounds in schemas.ts mirror the bounds in PHP, and the comments say so
grep -c 'mutation-create-incident.php' src/lib/validation/schemas.ts
# Expected: 4 or more — one per mirrored bound
grep -c 'mutation-register-developer.php' src/lib/validation/schemas.ts
# Expected: 1 or more

# 12. No schema change, therefore no schema:pull. Module 16 adds no GraphQL types.
git status --short ../wordpress-headless/schema.graphql
# Expected: no output

# 13. Nothing secret is staged, and the codegen output IS staged
git status --short src/gql/
# Expected: M src/gql/graphql.ts (and possibly others) — src/gql/ is committed
git check-ignore -v .env.local
# Expected: a .gitignore rule. NO OUTPUT MEANS STOP.
```

Checks 5, 6, 7 and 9 are the four that define this lesson. The endpoint never reaches a client
component, the form still submits with JavaScript off, no handler prevents that, and no Server
Action throws on input a human could plausibly type.

## Control Questions

1. `schemas.ts` deliberately has no `import 'server-only'`, while `src/lib/graphql/client.ts` does.
   State the rule that separates them, and say what would break in this lesson if you added the
   guard to `schemas.ts`.
2. A colleague replaces `requiredNumber('the downtime in minutes')` with
   `z.coerce.number().min(0).max(100000)` because it is shorter. Name the WordPress function their
   version has just reimplemented, give the input that proves it, and say what a moderator would
   see in the list table.
3. You delete layer 1 (the `zodResolver`), layer 2 (the action's `safeParse`) and layer 3 (the PHP
   checks), one at a time. For each, say what a user notices, what an attacker gains, and which
   deletion you would revert first at 2am.
4. `refineTerms(allowed)` is a function that returns a schema, and the client form validates against
   the unrefined `incidentSchema`. Describe the one submission that passes layer 1 and fails layer
   2 because of that, and explain why building the `<Select>` from the same fetched list makes it
   almost unreachable in a browser but not over `curl`.
5. `FormMessage` renders an empty `<p role="alert">` when there is no error, and the generated
   shadcn version returned `null`. Name the concrete accessibility failure the generated version
   risks, name the cost of the replacement, and say how you would detect the failure without a
   screen reader.

## Learn More

- [React: `<form>` and the `action` prop](https://react.dev/reference/react-dom/components/form) —
  read the progressive-enhancement paragraph; it is the whole basis of Key Concept 9
- [`useActionState`](https://react.dev/reference/react/useActionState) — the signature this form
  uses, and why the state has to be serialisable
- [react-hook-form: `useForm`](https://react-hook-form.com/docs/useform) — `mode`, `resolver` and
  `defaultValues`, the three options that change behaviour most
- [react-hook-form: `setFocus`](https://react-hook-form.com/docs/useform/setfocus) — the API behind
  Key Concept 8, including why it needs the field to be registered first
- [`@hookform/resolvers`](https://github.com/react-hook-form/resolvers) — the peer-dependency
  matrix; check it before you widen the `zod` major
- [Zod: basic usage and `safeParse`](https://zod.dev/) — skim `coerce`, `pipe` and `superRefine`,
  the three used in `schemas.ts`
- [shadcn/ui: Form](https://ui.shadcn.com/docs/components/form) — what the generator writes, so you
  can see exactly what Step 2 changed
- [W3C WAI: user notifications in forms](https://www.w3.org/WAI/tutorials/forms/notifications/) —
  the standards-body version of Key Concept 7, with the live-region caveat spelled out
- [WordPress: data validation](https://developer.wordpress.org/apis/security/data-validation/) —
  core's own sanitise-versus-validate table, which is the vocabulary Key Concept 3 borrows
