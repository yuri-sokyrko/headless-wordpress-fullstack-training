// Replaces Lesson 14.2's placeholder. The body now goes through RichText, so
// <strong> and <a> render as markup instead of as visible tags.
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreParagraph({ block }: BlockComponentProps<'CoreParagraph'>) {
  return (
    <RichText
      as="p"
      dataBlock={block.__typename}
      html={block.attributes?.content}
      // Arbitrary variants, because the <a> and <code> in here were written by
      // DOMPurify and no class of ours will ever be on them. Key Concept 10.
      className="[&_code]:bg-muted my-4 leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:px-1"
    />
  );
}
