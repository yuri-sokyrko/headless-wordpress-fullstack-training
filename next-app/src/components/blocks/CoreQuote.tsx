import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreQuote({ block, children }: BlockComponentProps<'CoreQuote'>) {
  const citation = block.attributes?.citation;

  // <figure>/<blockquote>/<figcaption>/<cite>, the same pairing
  // HobtTestimonials uses in Lesson 11.5. NOT a <footer> inside the blockquote:
  // that would be legal, and `grep '<footer'` returning nothing under
  // src/components/blocks/ is a cheaper invariant than a rule about nesting
  // contexts. Key Concept 8.
  return (
    <figure data-block={block.__typename} className="my-6">
      <blockquote className="border-border border-l-4 pl-4 italic">{children}</blockquote>
      {citation !== null && citation !== undefined && citation.trim() !== '' ? (
        <figcaption className="text-muted-foreground mt-2 pl-4 text-sm">
          <RichText as="cite" html={citation} className="not-italic" />
        </figcaption>
      ) : null}
    </figure>
  );
}
