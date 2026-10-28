// The __typename → component map, plus the type machinery that makes it complete.
//
// NO `import 'server-only'` here, deliberately: Module 23 unit-tests block
// components in a plain Node process, where that package throws on purpose. The
// same reasoning as tags.ts and errors.ts in Module 10.
import type { ReactNode } from 'react';

import { CoreParagraph } from '@/components/blocks/CoreParagraph';
import { CoreCode } from '@/components/blocks/CoreCode';
import { CoreHeading } from '@/components//blocks/CoreHeading';
import { CoreList } from '@/components/blocks/CoreList';
import { CoreListItem } from '@/components/blocks/CoreListItem';
import { CoreQuote } from '@/components/blocks/CoreQuote';
import { BlameQuote } from '@/components/blocks/BlameQuote';
import { HobtCta } from '@/components/blocks/HobtCta';
import { IncidentCallout } from '@/components/blocks/IncidentCallout';
import { IncidentTicker } from '@/components/blocks/IncidentTicker';
import { ScapegoatPicker } from '@/components/blocks/ScapegoatPicker';
import type { EditorBlocksFragment } from '@/gql/graphql';

/** One entry of the flat list from Lesson 14.1's fragment. */
export type Block = NonNullable<NonNullable<EditorBlocksFragment['editorBlocks']>[number]>;

/**
 * Distributes over the union (that is what `T extends unknown ?` is for) and
 * keeps the members that selected `attributes`. The collapsed member cannot have
 * it: `attributes` is declared per concrete block type and never on the
 * EditorBlock interface. `'attributes' extends keyof T` and NOT
 * `T extends { attributes: unknown }` — codegen emits nullable selected fields as
 * OPTIONAL properties, and every object type is assignable to one whose extra
 * property is optional, so the structural test would match all of them.
 */
type WithAttributes<T> = T extends unknown ? ('attributes' extends keyof T ? T : never) : never;

/** The blocks this app renders. DERIVED from the fragment — never hand-listed. */
export type SupportedBlock = WithAttributes<Block>;

/** The residual: the collapsed member. `UnknownBlock` renders these. */
export type UnsupportedBlock = Exclude<Block, SupportedBlock>;

export type SupportedBlockTypename = SupportedBlock['__typename'];

/**
 * Props every block component receives, and the complete list.
 * · `block`   — narrowed to this component's own type, so no casts inside it.
 * · `locale`  — a locale-prefixed href is a block's business; Lesson 14.1 listed
 *               "WordPress's locale, not the route's" as a cost of renderedHtml,
 *               and this prop is how that promise is kept. A string, so it
 *               crosses the client boundary in Lesson 14.4 with no ceremony.
 * · `children`— the rendered subtree, handed IN by BlockRenderer. A component
 *               never renders its own children. Key Concept 8.
 */
export type BlockComponentProps<TTypename extends SupportedBlockTypename> = {
  readonly block: Extract<SupportedBlock, { readonly __typename: TTypename }>;
  readonly locale: string;
  readonly children?: ReactNode;
};

/**
 * A MAPPED type, not Record<SupportedBlockTypename, SomeComponent>: mapping the
 * key into the props means each entry is checked against its own block type, so
 * `CoreHeading: CoreParagraph` is a compile error too, not just a missing key.
 */
export type BlockRegistry = {
  readonly [K in SupportedBlockTypename]: (props: BlockComponentProps<K>) => ReactNode;
};

/**
 * `satisfies`, not `: BlockRegistry`. An annotation would widen this to the mapped
 * type and BlockRenderer's `Object.keys(blockRegistry)` would lose the literal key
 * set it depends on. `satisfies` checks and keeps the narrow type.
 *
 * Adding a `... on X` inline fragment to editorBlocks.graphql without adding a row
 * here is a type error NAMING X. Deleting a row while the fragment still names the
 * type is the same error. Task Step 7 proves it.
 */
export const blockRegistry = {
  CoreParagraph,
  CoreHeading,
  CoreList,
  CoreListItem,
  CoreQuote,
  CoreCode,
  BttIncidentCallout: IncidentCallout,
  BttBlameQuote: BlameQuote,
  BttScapegoatPicker: ScapegoatPicker,
  BttIncidentTicker: IncidentTicker,
  BttHobtCta: HobtCta,
  // 14.5 → CoreImage
} satisfies BlockRegistry;
