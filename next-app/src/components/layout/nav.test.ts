import { describe, expect, it } from 'vitest';

import { toLocalePath, toNavTree } from '@/components/layout/nav';

/**
 * `noUncheckedIndexedAccess` (Lesson 07.3) types items[i] as T | undefined, and it
 * is right to. Throwing here reports the real problem — "the tree has no root" —
 * instead of crashing on undefined.label three lines later.
 */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`nth(${index}): out of range, lenfth is ${items.length}`);
  }

  return item;
}

// The five items Lesson 05.4 created by hand, in the order it created them.
// `parentId` is OMITTED rather than set to undefined: exactOptionalPropertyTypes
// is on, and "absent" is a different statement from "present and undefined".
const SEEDED_PRIMARY = [
  { id: 'mi-1', label: 'Incidents', uri: '/incidents/', order: 1 },
  { id: 'mi-2', label: 'Scapegoats', uri: '/scapegoats/', order: 2 },
  { id: 'mi-3', label: 'Reviews', uri: '/reviews/', order: 3 },
  { id: 'mi-4', label: 'Blog', uri: '/blog/', order: 4 },
  {
    id: 'mi-5',
    label: 'Catastrophic only',
    uri: '/incidents/?severity=s1-catastrophic',
    // Order 1 AT ITS OWN LEVEL. If sorting were global this would come first.
    order: 1,
    parentId: 'mi-1',
  },
] as const;

describe('toLocalePath', () => {
  it('prefixes the locale and drops WordPress trailing slashes', () => {
    expect(toLocalePath('/about/', 'en')).toBe('/en/about');
  });

  it('maps the site root to the locale root', () => {
    expect(toLocalePath('/', 'en')).toBe('/en');
  });

  it('treats empty, null and undefined as the locale root', () => {
    expect(toLocalePath('', 'en')).toBe('/en');
    expect(toLocalePath(null, 'en')).toBe('/en');
    expect(toLocalePath(undefined, 'en')).toBe('/en');
  });

  it('leaves an absolute URL alone, whatever the case of the scheme', () => {
    expect(toLocalePath('https://example.test/pricing', 'en')).toBe('https://example.test/pricing');
    expect(toLocalePath('HTTP://example.test', 'en')).toBe('HTTP://example.test');
  });

  it('collapses repeated leading and trailing slashes', () => {
    expect(toLocalePath('/incidents/?severity=s1-catastrophic', 'en')).toBe(
      '/en/incidents/?severity=s1-catastrophic'
    );
  });
});

describe('toNavTree', () => {
  it('turns the seeded flat list into four roots and one child', () => {
    const tree = toNavTree(SEEDED_PRIMARY, 'en');

    expect(tree).toHaveLength(4);
    expect(tree.map((item) => item.label)).toEqual(['Incidents', 'Scapegoats', 'Reviews', 'Blog']);
    expect(nth(tree, 0).children).toHaveLength(1);
    expect(nth(nth(tree, 0).children, 0).label).toBe('Catastrophic only');
  });

  it('sorts `order` per level, independently', () => {
    // The child has order 1, the same as the first root. A global sort would have
    // hoisted it; a per-level sort leaves Incidents first among the roots.
    const tree = toNavTree(SEEDED_PRIMARY, 'en');

    expect(nth(tree, 0).label).toBe('Incidents');
  });

  it('locale-prefixes every href through toLocalePath', () => {
    const tree = toNavTree(SEEDED_PRIMARY, 'en');

    expect(tree.map((item) => item.href)).toEqual([
      '/en/incidents',
      '/en/scapegoats',
      '/en/reviews',
      '/en/blog',
    ]);
  });

  it('promotes an item whose parentId is not in the list to a root', () => {
    // The REAL behaviour, asserted rather than fixed. An editor can delete a
    // parent and leave the child, and a nav that silently loses an item is worse
    // than one that shows it at the top level. Change the behaviour and this test
    // is where the conversation happens.
    const tree = toNavTree(
      [{ id: 'orphan', label: 'Orphan', uri: '/orphan/', order: 1, parentId: 'deleted' }],
      'en'
    );

    expect(tree).toHaveLength(1);
    expect(nth(tree, 0).label).toBe('Orphan');
  });

  it('marks target="_blank" and absolute URLs as external', () => {
    const tree = toNavTree(
      [
        { id: 'a', label: 'Newsletter', uri: '/news/', order: 1, target: '_blank' },
        { id: 'b', label: 'Status', uri: 'https://status.example.test', order: 2 },
        { id: 'c', label: 'Blog', uri: '/blog/', order: 3 },
      ],
      'en'
    );

    expect(tree.map((item) => item.external)).toEqual([true, true, false]);
  });

  it('turns a null label into an empty string rather than rendering "null"', () => {
    const tree = toNavTree([{ id: 'a', label: null, uri: '/x/', order: 1 }], 'en');

    expect(nth(tree, 0).label).toBe('');
  });

  it('returns an empty tree for an empty menu', () => {
    expect(toNavTree([], 'en')).toEqual([]);
  });
});
