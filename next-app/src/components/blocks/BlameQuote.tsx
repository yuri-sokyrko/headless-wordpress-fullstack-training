// Renders the children BlockRenderer handed it, and nothing else. The block has
// InnerBlocks in the editor (Lesson 13.3) and this component never thinks about
// nesting — Lesson 14.2 Key Concept 9.
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function BlameQuote({ block, children }: BlockComponentProps<'BttBlameQuote'>) {
  const attribution = block.attributes?.attribution;

  // save() emits <blockquote> with NO <cite> — the front end renders the
  // attribution, per the block contract. figure/figcaption/cite matches CoreQuote
  // and HobtTestimonials, and avoids a <footer> inside a <blockquote>.
  return (
    <figure data-block={block.__typename} className="my-6">
      <blockquote className="border-border border-l-4 pl-4 text-lg italic">{children}</blockquote>
      {attribution !== null && attribution !== undefined && attribution.trim() !== '' ? (
        <figcaption className="text-muted-foreground mt-2 pl-4 text-sm">
          — <RichText as="cite" html={attribution} className="not-italic" />
        </figcaption>
      ) : null}
    </figure>
  );
}
