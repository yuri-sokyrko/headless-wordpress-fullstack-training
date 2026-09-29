# ADR 0006 — The `[locale]` segment from day one, and no `create-next-app`

## Status

Accepted — Module 09.

## Context

Two decisions taken together in Lesson 09.1, both about the shape of the project rather
than its behaviour. (Say what the repository already contained, and why the scaffold
could not run in it.)

## Options considered

| Option                                                                       | Verdict      |
| ---------------------------------------------------------------------------- | ------------ |
| `create-next-app` in a fresh directory, then move Modules 07–08 work into it | rejected — … |
| `create-next-app --example`, then reconcile                                  | rejected — … |
| Install `next` into the existing project and write the five files by hand    | **chosen**   |
| Add `[locale]` in Module 20, when i18n actually arrives                      | rejected — … |

## Decision

The correct one, with next on existing project.

## Consequences — including what this costs us

- We own `next.config.ts`, the `tsconfig.json` compiler options and the ESLint blocks, and
  we do not inherit future scaffold defaults for free.
- Every route is one segment deeper, forever, and every `<Link href>` must carry a locale.
- `/` and `/incidents` are 404s until Lesson 09.5's proxy exists.

## What would reverse this

A single-locale product with a hard commitment never
to translate would not have paid for the segment.
