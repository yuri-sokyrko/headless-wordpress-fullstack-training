import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreList({ block, children }: BlockComponentProps<'CoreList'>) {
  const ordered = block.attributes?.ordered === true;
  const Tag = ordered ? 'ol' : 'ul';
  const className = `my-4 pl-6 ${ordered ? 'list-decimal' : 'list-disc'}`;

  // BlockRenderer passes `null` — not an empty array — when a block has no
  // children in the flat list, so this distinguishes "modern list with
  // core/list-item children" from "legacy list with a values string".
  if (children !== null && children !== undefined) {
    return (
      <Tag data-block={block.__typename} className={className}>
        {children}
      </Tag>
    );
  }

  // Legacy (pre-6.0) list: the rows are an HTML string of <li>s in `values`.
  // The 'list' profile is the inline allowlist plus `li`, and nothing more.
  return (
    <RichText
      as={Tag}
      profile="list"
      dataBlock={block.__typename}
      html={block.attributes?.values}
      className={className}
    />
  );
}
