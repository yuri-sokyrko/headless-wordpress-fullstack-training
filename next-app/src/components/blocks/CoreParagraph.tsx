// PLACEHOLDER for ONE lesson. Lesson 14.3 replaces the body with <RichText>.
//
// `content` is HTML — the editor put <strong>, <em> and <a> inside it. Rendering
// it as JSX text means React escapes it, so for this one lesson your paragraphs
// display their own tags. That is deliberate and it is not a bug: the alternative
// is an unsanitized dangerouslySetInnerHTML "just until 14.3", which is exactly
// the fallback nobody removes.
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreParagraph({ block }: BlockComponentProps<'CoreParagraph'>) {
  // Every attribute is nullable — Lesson 14.1 Key Concept 4.
  const content = block.attributes?.content ?? '';

  // An empty paragraph is a real thing editors leave behind. Render nothing
  // rather than a <p> with a margin, which shows up as a mystery gap.
  if (content.trim() === '') return null;

  return (
    <p data-block={block.__typename} className="my-4 leading-relaxed">
      {content}
    </p>
  );
}
