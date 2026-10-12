export type NavItem = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
  readonly children: readonly NavItem[];
};

// Typed STRUCTURALLY rather than by importing a generated type. That keeps these
// two functions testable in Module 12 without a codegen run, and it means a schema
// refresh that adds a field to MenuItem does not touch this file.
type RawMenuItem = {
  readonly id: string;
  readonly parentId?: string | null;
  readonly order?: number | null;
  readonly label?: string | null;
  readonly uri?: string | null;
  readonly target?: string | null;
};

/**
 * WordPress `uri` → Next path. Key Concept 7.
 *   '/about/'  + 'en' → '/en/about'
 *   '/'        + 'en' → '/en'
 *   'https://…'       → unchanged (a custom link pointing off-site)
 */
export function toLocalePath(uri: string | null | undefined, locale: string): string {
  if (uri === null || uri === undefined || uri === '') return `/${locale}`;
  if (/^https?:\/\//i.test(uri)) return uri;

  const trimmed = uri.replace(/^\/+/, '').replace(/\/+$/, '');

  return trimmed === '' ? `/${locale}` : `/${locale}/${trimmed}`;
}

/** Flat menuItems → a sorted tree. Key Concept 3. */
export function toNavTree(items: readonly RawMenuItem[], locale: string): readonly NavItem[] {
  // A mutable twin of NavItem, plus the sort key. `Node[]` is assignable to
  // `readonly NavItem[]` on the way out, so the readonly contract survives.
  type Node = {
    id: string;
    label: string;
    href: string;
    external: boolean;
    children: Node[];
    order: number;
  };

  // Pass 1 — every item becomes a node, with an empty children array.
  const byId = new Map<string, Node>();
  for (const item of items) {
    const uri = item.uri ?? null;
    byId.set(item.id, {
      id: item.id,
      label: item.label ?? '',
      href: toLocalePath(uri, locale),
      // A custom link pointing off-site, or an item an editor set to open in a
      // new tab. Both need rel="noopener" on the anchor.
      external: item.target === '_blank' || (uri !== null && /^https?:\/\//i.test(uri)),
      children: [],
      order: item.order ?? 0,
    });
  }

  // Pass 2 — attach each node to its parent, or collect it as a root.
  const roots: Node[] = [];
  for (const item of items) {
    const node = byId.get(item.id);
    if (node === undefined) continue;
    const parent = item.parentId != null ? byId.get(item.parentId) : undefined;
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  // `order` is per level, so sort each level independently.
  const sortLevel = (level: Node[]): Node[] => {
    level.sort((a, b) => a.order - b.order);
    for (const node of level) sortLevel(node.children);
    return level;
  };

  return sortLevel(roots);
}
