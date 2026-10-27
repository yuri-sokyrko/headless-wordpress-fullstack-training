import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreListItem({ block, children }: BlockComponentProps<'CoreListItem'>) {
  return (
    <li data-block={block.__typename} className="my-1">
      <RichText html={block.attributes?.content} className="[&_a]:underline" />
      {/* A nested list is a child block of the ITEM, not of the outer list. */}
      {children}
    </li>
  );
}
