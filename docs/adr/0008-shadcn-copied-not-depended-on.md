# 0008 — Utility-first CSS, and components copied rather than depended on

## Status

Accepted (Module 11)

## Context

Blame The Tech needs a component library for buttons, cards, badges, dialogs and selects.
It has a specific visual design and a hard accessibility requirement (Module 22), and it is
an application, not a prototype needing a stock look.

## Options considered

| Option                               | Upstream fixes            | Restructure markup          | Bundle              | Verdict                              |
| ------------------------------------ | ------------------------- | --------------------------- | ------------------- | ------------------------------------ |
| MUI / Chakra                         | ✅                        | ❌ props and overrides only | whole library       | ❌ fighting a vendor `<header>`      |
| Headless UI + own styles             | ✅ behaviour              | ✅                          | small               | ⚠️ viable; smaller primitive set     |
| Bootstrap / a CSS framework          | ✅                        | ❌                          | whole stylesheet    | ❌ no accessibility behaviour at all |
| **shadcn/ui + Radix, utility-first** | behaviour ✅, wrappers ❌ | ✅                          | only what is copied | **✅**                               |

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
