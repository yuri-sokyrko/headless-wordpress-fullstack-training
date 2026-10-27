// THE ONLY dangerouslySetInnerHTML IN next-app/. Module 24 turns the grep that
// proves it into a CI gate and Lesson 24.2 adds a lint rule. If a second
// occurrence seems necessary, the design is wrong — Key Concept 6.
//
// No `import 'server-only'`, deliberately: Module 23 renders block components in
// a plain Node process, and working there is the entire reason this package is
// the isomorphic build.
import DOMPurify from 'isomorphic-dompurify';
import type { ElementType, ReactNode } from 'react';

/** Inline formatting, and nothing else. Every addition needs an argument. */
const INLINE_TAGS = ['a', 'b', 'br', 'code', 'em', 'i', 'mark', 's', 'strong', 'sub', 'sup'];

/** The same, plus `li`, for a legacy core/list `values` string. Key Concept 8. */
const LIST_TAGS = [...INLINE_TAGS, 'li'];

/** Everything a link needs. No `id`, no `class`, no `style`. */
const ALLOWED_ATTR = ['href', 'title', 'rel', 'target'];

/**
 * https, http, mailto, a site-relative path, or a fragment. The `(?!\/)` is what
 * rejects protocol-relative `//evil.example`. `javascript:`, `data:` and
 * `vbscript:` match nothing here, so DOMPurify drops the ATTRIBUTE and keeps the
 * <a> and its text — the link becomes inert prose, which is the right outcome.
 */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|\/(?!\/)|#)/i;

// Module scope, not inside the component: DOMPurify hooks are global to the
// instance, so registering per render would add one hook per paragraph.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // Text and comment nodes reach hooks too, and they have no getAttribute.
  if (!('getAttribute' in node)) return;
  if (node.nodeName !== 'A') return;
  if (node.getAttribute('target') !== '_blank') return;

  // FORCE rel, do not strip target. An editor who asked for a new tab meant it;
  // what they did not mean was to hand the opened page a window.opener handle on
  // yours. Modern browsers imply noopener for _blank, older ones do not, and an
  // editor cannot be asked to remember which.
  node.setAttribute('rel', 'noopener norefferrer');
});

export function RichText({
  as: Tag = 'span',
  html,
  className,
  profile = 'inline',
  dataBlock,
}: {
  /** The element to render. `p`, `h2`, `cite`, `ul` — the caller decides. */
  readonly as?: ElementType;
  readonly html: string | null | undefined;
  readonly className?: string;
  /** `'list'` adds `li` and nothing else. Key Concept 2. */
  readonly profile?: 'inline' | 'list';
  /** Lets the caller keep the data-block convention on the element we render. */
  readonly dataBlock?: string;
}): ReactNode {
  // An empty attribute is a real thing editors leave behind. Render nothing
  // rather than an element with a margin, which shows up as a mystery gap.
  if (html === null || html === undefined || html.trim() === '') return null;

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: profile === 'list' ? LIST_TAGS : INLINE_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Redundant with the allowlist ON PURPOSE: a future edit that widens
    // ALLOWED_TAGS cannot let these back in by accident.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'img', 'svg'],
    FORBID_ATTR: ['style', 'srcset', 'sizes', 'formaction'],
    // `<span>hello</span>` becomes `hello`, not nothing. A paste from Word should
    // lose its markup, not its words.
    KEEP_CONTENT: true,
    // DOMPurify permits data-* by default. `data-block` is written by components,
    // never by editors.
    ALLOW_DATA_ATTR: false,
    // An aria-* an editor pasted is an accessibility claim nobody reviewed.
    ALLOW_ARIA_ATTR: false,
  });

  return (
    <Tag className={className} data-block={dataBlock} dangerouslySetInnerHTML={{ __html: clean }} />
  );
}
