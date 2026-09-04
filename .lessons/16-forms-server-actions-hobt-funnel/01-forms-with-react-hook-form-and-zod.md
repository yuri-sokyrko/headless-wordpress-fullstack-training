---
title: 'Forms with react-hook-form & Zod'
module: 16
lesson: 1
teaches: [react-hook-form, zod-schemas, shared-validation, accessible-form-errors, progressive-enhancement]
produces: ['next-app/src/lib/validation/schemas.ts', 'next-app/src/components/ui/form.tsx', 'next-app/src/app/[locale]/(auth)/register/page.tsx']
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
