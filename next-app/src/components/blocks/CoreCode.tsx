// Does NOT import RichText, and Verification asserts it. Code is the one block
// where markup staying visible IS the feature — Key Concept 9.
import type { BlockComponentProps } from '@/components/blocks/registry';

/**
 * core/code stores its content already HTML-ESCAPED, so `<script>` is on disk as
 * `&lt;script&gt;`. Handed straight to JSX, React escapes the ampersand too and
 * the reader sees `&lt;script&gt;`. So decode — and note what this is NOT: not a
 * render. The result goes into JSX as a TEXT child, React escapes it again on the
 * way out, and there is no path from here to markup.
 *
 * `&amp;` is LAST. Decode it first and `&amp;lt;` becomes `<` in two passes
 * rather than the literal `&lt;` the editor typed.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&amp;/g, '&'],
];

function decodeEntities(value: string): string {
  return ENTITIES.reduce((acc, [pattern, char]) => acc.replace(pattern, char), value);
}

export function CoreCode({ block }: BlockComponentProps<'CoreCode'>) {
  const raw = block.attributes?.content ?? '';

  if (raw.trim() === '') return null;

  // <pre> preserves whitespace and tells assistive technology line breaks are
  // meaningful; <code> says the content is code. A styled <div> says neither.
  return (
    <pre
      data-block={block.__typename}
      className="bg-muted my-4 overflow-x-auto rounded-md p-4 text-sm"
    >
      <code>{decodeEntities(raw)}</code>
    </pre>
  );
}
