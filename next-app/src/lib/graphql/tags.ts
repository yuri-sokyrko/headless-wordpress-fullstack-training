// The ONLY place cache tag strings are constructed. Two call sites have to agree
// on every string: the `fetch` that ATTACHES the tag, and the revalidation route
// Module 18 builds that EXPIRES it. `incident:dns` in one and `incident-dns` in
// the other invalidates nothing, returns 200 and logs nothing — a bug that looks
// exactly like a caching problem for as long as you are willing to stare at it.
// Module 12 unit-tests the exact output of every function below.
//
// WordPress never builds a tag string. Module 18's webhook sends IDENTIFIERS —
// type, post type, slug, locale — and the Next route turns them into tags with
// the functions here. That is deliberate: the cross-language contract is then a
// short enumerated vocabulary that Zod validates, so a drifted identifier is a
// loud 400 rather than a silent success.
//
// No `import 'server-only'` here, deliberately: this file is pure string manipulation
// with no secret and no I/O, and Module 12 runs its tests in a plain Node process where
// the `server-only` module throws on purpose.

/** The four content types that get their own tags. Singular — see `listTag`. */
export type ContentType = 'incident' | 'post' | 'review' | 'page';

/** Taxonomy prefixes. `stack` is shortened from `tech_stack`; the tag is not the slug. */
export type TaxonomyName = 'scapegoat' | 'severity' | 'stack';

const PLURAL: Record<ContentType, string> = {
  incident: 'incidents',
  post: 'posts',
  review: 'reviews',
  page: 'pages',
};

/** English plurals, spelled out rather than derived — `severitys` is not a word. */
const TAXONOMY_PLURAL: Record<TaxonomyName, string> = {
  scapegoat: 'scapegoats',
  severity: 'severities',
  stack: 'stacks',
};

/**
 * A slug is editorial input, so normalise it rather than trusting it. No ASCII
 * allowlist: WordPress slugs may be non-Latin, and Module 20 adds locales where they
 * are. The only forbidden character is the separator itself.
 */
function segment(slug: string): string {
  const value = slug.trim().toLocaleLowerCase();

  if (value === '') {
    throw new Error('cache tag: empty slug — the caller has nothing to tag with');
  }

  if (value.includes(':')) {
    throw new Error(`cache tag: slug "${slug}" contains ":", which is the separator`);
  }

  return value;
}

/** `type[:locale]:slug`. The locale segment exists for Module 20 and is omitted here. */
function nodeTag(type: ContentType, slug: string, locale: string | undefined): string {
  const parts = locale === undefined ? [type, slug] : [type, locale, slug];

  return parts.map(segment).join(':');
}

export function incidentTag(slug: string, locale?: string): string {
  return nodeTag('incident', slug, locale);
}

export function postTag(slug: string, locale?: string): string {
  return nodeTag('post', slug, locale);
}

export function reviewTag(slug: string, locale?: string): string {
  return nodeTag('review', slug, locale);
}

export function pageTag(slug: string, locale?: string): string {
  return nodeTag('page', slug, locale);
}

/**
 * Takes the SINGULAR type name and returns the plural tag: `listTag('incident')` reads
 * as "the list of incidents" at the call site, and produces `incidents`. Passing
 * `'incidents'` is a compile error, which is the whole reason for the asymmetry.
 */
export function listTag(type: ContentType, locale?: string): string {
  const plural = PLURAL[type];

  return locale === undefined ? plural : `${plural}:${segment(locale)}`;
}

/** `scapegoat:the-intern`, `severity:s1-catastrophic`, `stack:react`. */
export function termTag(taxonomy: TaxonomyName, slug: string): string {
  return `${taxonomy}:${segment(slug)}`;
}

/**
 * The LIST of terms in a taxonomy: `scapegoats`, `severities`, `stacks`.
 *
 * Separate from `listTag` on purpose. `listTag` takes a `ContentType` and
 * `taxonomyListTag` takes a `TaxonomyName`, so `listTag('scapegoat')` is a
 * compile error rather than the string `undefined` — and the two vocabularies
 * are genuinely different: a scapegoat is a term, not a post, and the thing
 * that changes it is `saved_term` rather than `transition_post_status`.
 *
 * Locale is APPENDED here, matching `listTag`, not infixed as it is for a node.
 */
export function taxonomyListTag(taxonomy: TaxonomyName, locale?: string): string {
  const plural = TAXONOMY_PLURAL[taxonomy];

  return locale === undefined ? plural : `${plural}:${segment(locale)}`;
}

/** The SCF options page from appendix 03 section 4.5. One entry, one tag. */
export function siteTag(): string {
  return 'site-settings';
}

/** `menu:primary`. Lesson 11.3 uses `menuTag('primary')` for the header nav. */
export function menuTag(location: string): string {
  return `menu:${segment(location)}`;
}
