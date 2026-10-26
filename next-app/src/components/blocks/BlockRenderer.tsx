// Flat list → React tree. The ONLY place recursion happens in this system.
//
// No 'use client' directive, deliberately: this is a Server Component, so Lesson
// 14.4's client island lands INSIDE the tree instead of converting it. Key
// Concept 10.
import type { ReactNode } from 'react';

import { UnknownBlock } from '@/components/blocks/UnknownBlock';
import { blockRegistry } from '@/components/blocks/registry';
import type { Block, SupportedBlock, UnsupportedBlock } from '@/components/blocks/registry';

/** Deeper than this is a cycle or a mistake. Either way, refuse. */
const MAX_DEPTH = 12;

/** The bucket key for top-level blocks. WordPress clientIds are UUIDs, so this
 *  cannot collide with one. */
const ROOT = '::root';

/**
 * The runtime keys of the map. `satisfies BlockRegistry` in registry.ts is what
 * makes "runtime keys === compile-time keys" true, which is what makes the
 * predicate below honest. Key Concept 5.
 */
const SUPPORTED: ReadonlySet<string> = new Set(Object.keys(blockRegistry));

function isSupported(block: Block): block is SupportedBlock {
  return SUPPORTED.has(block.__typename);
}

type Tree = ReadonlyMap<string, readonly Block[]>;

function buildTree(blocks: readonly Block[]): Tree {
  // 1. Which clientIds this list actually contains.
  const present = new Set(
    blocks.map((b) => b.clientId).filter((id): id is string => typeof id === 'string')
  );

  // 2. One bucket per parent, filled in document order. Map preserves insertion
  //    order, so siblings need no sorting and there is no `order` field to sort on.
  const tree = new Map<string, Block[]>();
  for (const block of blocks) {
    const parent = block.parentClientId;

    // EDGE CASE 1 — a parentClientId nobody here owns. Adopt the orphan at the
    // root instead of dropping it: a paragraph in the wrong place gets reported,
    // a paragraph that vanished does not. Key Concept 7.
    const key = typeof parent === 'string' && present.has(parent) ? parent : ROOT;

    const bucket = tree.get(key);
    if (bucket === undefined) tree.set(key, [block]);
    else bucket.push(block);
  }

  return tree;
}

function BlockNode({
  block,
  locale,
  children,
}: {
  readonly block: Block;
  readonly locale: string;
  readonly children?: ReactNode;
}) {
  if (isSupported(block)) {
    // The ONE type assertion in this system, and here is why it is needed:
    // blockRegistry[k] holds the exact component type for k, but TypeScript
    // cannot relate the two sides of an indexed access when the key is itself a
    // union, so the call site has to widen. registry.ts is what makes it safe —
    // `satisfies BlockRegistry` already checked every value against its own key.
    const Component = blockRegistry[block.__typename] as (props: {
      readonly block: SupportedBlock;
      readonly locale: string;
      readonly children?: ReactNode;
    }) => ReactNode;

    return (
      <Component block={block} locale={locale}>
        {children}
      </Component>
    );
  }

  // LAYER 2 of the exhaustiveness check. `block` has been narrowed past every
  // supported __typename, so the only member left is the collapsed one — and this
  // annotation is the compiler agreeing. If a plugin upgrade ever splits that
  // member into two shapes, THIS line is what stops compiling. Key Concept 5.
  const unsupported: UnsupportedBlock = block;

  // `name` is the WordPress name (`btt/hobt-cta`), which is what you can act on.
  return <UnknownBlock name={unsupported.name ?? unsupported.__typename} />;
}

function renderLevel(
  tree: Tree,
  parentKey: string,
  locale: string,
  seen: ReadonlySet<string>,
  depth: number
): ReactNode {
  const level = tree.get(parentKey);
  if (level === undefined) return null;

  if (depth > MAX_DEPTH) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[blocks] refusing to recurse past depth ${MAX_DEPTH} under "${parentKey}"`);
    }
    return null;
  }

  return level.map((block, index) => {
    const id = block.clientId;

    // EDGE CASE 2 — a cycle. Unbounded recursion in a Server Component render is
    // a hung request, not a blank div, so refuse rather than repair.
    if (typeof id === 'string' && seen.has(id)) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[blocks] cycle: clientId "${id}" is its own ancestor`);
      }
      return null;
    }

    const children =
      typeof id === 'string'
        ? renderLevel(tree, id, locale, new Set([...seen, id]), depth + 1)
        : null;

    // key is the clientId, NEVER the index. Key Concept 9. `clientId` is typed
    // String and therefore nullable, so there is a fallback — and the fallback
    // reintroduces the index-key problem for that one block, which is the honest
    // cost of a nullable field the schema will not promise.
    return (
      <BlockNode key={id ?? `${parentKey}:${index}`} block={block} locale={locale}>
        {children}
      </BlockNode>
    );
  });
}

export function BlockRenderer({
  blocks,
  locale,
}: {
  // Exactly the shape the generated query type has: a nullable list of nullable
  // entries. With fragmentMasking off (Lesson 10.2) the spread is inlined, so a
  // route's `post.editorBlocks` is structurally this type and needs no adapter.
  readonly blocks: readonly (Block | null)[] | null | undefined;
  readonly locale: string;
}) {
  const list = (blocks ?? []).filter((b): b is Block => b !== null);
  if (list.length === 0) return null;

  const tree = buildTree(list);
  const roots = tree.get(ROOT);

  // Every block claims a parent that is present, so nothing is at the root: the
  // list is one big cycle. Say so rather than rendering an empty page.
  if (roots === undefined) {
    return <UnknownBlock name="the flat list is cyclic — no block is at the root" />;
  }

  return <>{renderLevel(tree, ROOT, locale, new Set(), 0)}</>;
}
