---
title: 'Mapping Core Blocks & Safe HTML'
module: 14
lesson: 3
teaches: [core-block-mapping, dompurify, html-allowlist, dangerously-set-inner-html, xss-boundary, heading-level-mapping]
produces: ['next-app/src/components/blocks/RichText.tsx', 'next-app/src/components/blocks/CoreParagraph.tsx', 'next-app/src/components/blocks/CoreHeading.tsx', 'next-app/src/components/blocks/CoreList.tsx', 'next-app/src/components/blocks/CoreQuote.tsx', 'next-app/src/components/blocks/CoreCode.tsx']
requires: [14.2]
---

# Lesson 14.3 — Mapping Core Blocks & Safe HTML

## Quick Overview

Editors write mostly core blocks — paragraphs, headings, lists, quotes and code — so these five
components carry the majority of the site's actual content. Each one is small, and each one
makes a decision that is easy to get subtly wrong: a heading maps its `level` attribute to a
real `<h1>`–`<h6>` element rather than a styled `<div>`, a list respects `ordered`, a code block
escapes rather than renders, and a quote keeps its citation semantically attached.

The substantial part is `RichText.tsx`. A paragraph's `content` attribute genuinely is HTML —
the editor produced `<strong>`, `<em>` and `<a>` inside it, and there is no structured
representation of inline formatting to fall back on. So this is the one place the course
accepts HTML from WordPress and renders it, and it does so through a single component that
sanitizes with `isomorphic-dompurify` against a **strict allowlist**: the inline tags and
nothing else. No `<script>`, no `<iframe>`, no `<style>`, no event-handler attributes, no
`javascript:` URLs. This is the only file in `next-app/` containing
`dangerouslySetInnerHTML`, that fact is enforceable with `grep`, and Module 24 turns the grep
into a CI gate.

By the end of this lesson you will have:

- `next-app/src/components/blocks/RichText.tsx` — `isomorphic-dompurify` with an explicit tag and attribute allowlist
- Five core block components — paragraph, heading, list, quote and code — registered in the Lesson 14.2 registry
- A heading component that maps `level` to the correct element and preserves document heading order
- A stored XSS attempt written into a post by an editor account, verified as inert on the front end
- A `grep` proving exactly one occurrence of `dangerouslySetInnerHTML` in `next-app/src/`

## Classic WP Analogy

You already run an HTML allowlist on every piece of user content in every plugin you ship:

| Classic WordPress | Here |
|---|---|
| `wp_kses_post($html)` | `DOMPurify.sanitize(html, { ALLOWED_TAGS: […] })` |
| `wp_kses($html, $custom_allowed)` | the strict allowlist in `RichText.tsx` |
| `esc_html()` on anything not meant to be markup | JSX escaping, which is the default |
| `esc_url()` on every `href` | DOMPurify's URI scheme filtering |
| `wp_allowed_protocols()` | the allowlist's `ALLOWED_URI_REGEXP` |
| One `wp_kses` call at the output boundary | one `RichText` component at the output boundary |

The instinct is identical, and if you have ever written `wp_kses($content, ['a' => ['href' =>
[]], 'strong' => [], 'em' => []])` you have written this component's configuration in another
language. The principle is the same too: allowlist, never denylist, and apply it at the point of
output rather than at the point of storage, because storage-time filtering is one plugin update
away from being bypassed.

The analogy breaks in three ways, all of which favour being stricter here than you would be in
PHP.

**`wp_kses_post()` is much more permissive than you probably think.** It is the allowlist for
content authored by users who hold `unfiltered_html`-adjacent trust, and it permits `<iframe>`,
`style` attributes, `data-*` attributes and a long tail of tags nobody audits. That is a
reasonable default for a Classic theme rendering into a page that WordPress also controls. It is
not a reasonable default for a React application where an injected `<iframe>` sits inside your
authenticated session's origin. The allowlist in `RichText.tsx` is roughly eight tags and three
attributes, and every addition to it should require an argument.

**The trust boundary is different.** In Classic WordPress, `the_content()` output is authored by
people with `edit_posts`, and the site's own admin surface is the same origin, so the
"editors are trusted" assumption is at least coherent.
[The capability matrix](../appendix/03-content-model-reference.md#6-roles-and-capabilities) in
this app gives `edit_posts` to editors only and deliberately withholds it from
`incident_reporter` — but "only editors" is still a larger set than "only you", and a
compromised editor account should not be able to run script in your visitors' browsers.
Sanitizing is what makes that true.

**React defaults to safe, and PHP defaults to unsafe.** In PHP, `echo $x` is an XSS hole and you
must remember `esc_html()`. In JSX, `{x}` is escaped and injecting HTML requires typing
`dangerouslySetInnerHTML` — a name chosen to be unpleasant. That inversion is a genuine security
win, and it means the rule here can be absolute rather than aspirational: **one file, reviewed,
tested, and grep-enforceable.** Any second occurrence in this codebase is a bug, regardless of
what it renders.

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
