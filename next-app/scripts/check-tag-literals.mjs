// Fails if a cache-tag-shaped string literal appears anywhere under src/
// outside tags.ts and its test.
//
// This is deliberately a script rather than an ESLint rule TODAY, and the shape
// is chosen so Module 24 can promote it: an explicit, commented pattern list
// translates into a `no-restricted-syntax` rule almost mechanically, and a
// shell one-liner does not.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = 'src';

/** The two files whose whole job is to construct these strings. */
const ALLOWED = new Set(['src/lib/graphql/tags.ts', 'src/lib/graphql/tags.test.ts']);

/**
 * `src/gql/` is codegen output, committed and never hand-edited (Lesson 10.2).
 * A typed-document-node AST is full of `"value":"incidents"` — GraphQL FIELD
 * names, not cache tags. Skipping a generated directory is not an exception to
 * the rule; it is the rule not applying.
 */
const SKIP_DIRS = new Set(['src/gql']);

/** A single line may opt out with this marker AND a reason after it. */
const ESCAPE = 'not-a-cache-tag';

/** Every shape tags.ts can emit, as a literal somebody might type by hand. */
const PATTERNS = [
  // node and term tags: 'incident:…', 'scapegoat:…', 'menu:…'
  /['"`](incident|post|review|page|menu|scapegoat|severity|stack):/,
  // list tags, whole-string: 'incidents', 'severities', 'stacks'
  /['"`](incidents|posts|reviews|pages|scapegoats|severities|stacks)['"`]/,
  // the one singleton
  /['"`]site-settings['"`]/,
];

async function* walk(dir) {
  if (SKIP_DIRS.has(relative('.', dir))) return;

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

const hits = [];

for await (const path of walk(ROOT)) {
  const rel = relative('.', path);
  if (ALLOWED.has(rel)) continue;

  const lines = (await readFile(path, 'utf8')).split('\n');

  lines.forEach((line, index) => {
    if (line.includes(ESCAPE)) return;

    for (const pattern of PATTERNS) {
      if (pattern.test(line)) {
        hits.push(`${rel}:${index + 1}: ${line.trim()}`);
        break; // stop checking other patterns for this line
      }
    }
  });
}

if (hits.length > 0) {
  console.error(
    `${hits.length} hand-typed cache tag literal(s). Build them with ` +
      `src/lib/graphql/tags.ts instead — a tag PHP cannot reproduce invalidates ` +
      `nothing and reports success (Lesson 18.2 §3):`
  );
  for (const hit of hits) console.error(`  - ${hit}`);
  process.exit(1);
}

console.log('no hand-typed cache tag literals under src/');
