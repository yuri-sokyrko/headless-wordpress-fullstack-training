import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

type Level = 2 | 3 | 4 | 5 | 6;

// Exhaustive by construction: widen `Level` and these two stop compiling until
// you add the row. The Record trick from Lesson 07.4.
const TAG: Record<Level, 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

const SIZE: Record<Level, string> = {
  2: 'text-2xl',
  3: 'text-xl',
  4: 'text-lg',
  5: 'text-base',
  6: 'text-sm',
};

export function CoreHeading({ block }: BlockComponentProps<'CoreHeading'>) {
  const raw = block.attributes?.level;

  // CLAMPED to 2-6. An editor who picks H1 in Gutenberg gets an <h2> here: the
  // route owns the page's single <h1> (Lesson 11.4) and Lesson 12.3's smoke spec
  // asserts toHaveCount(1) on every route. Key Concept 7 states what it costs.
  // `level` arrives as Float, so Math.trunc rather than a cast.
  const level: Level =
    typeof raw === 'number' && raw >= 2 && raw <= 6 ? (Math.trunc(raw) as Level) : 2;

  return (
    <RichText
      as={TAG[level]}
      dataBlock={block.__typename}
      html={block.attributes?.content}
      className={`mt-8 mb-3 font-semibold tracking-tight ${SIZE[level]}`}
    />
  );
}
