// POST-only, cookieless, HMAC-signed. Four checks in a FIXED order, each with
// its own status code, and one of them deliberately says nothing.
//
// This route reads NO COOKIE. CSRF against it is not blocked — it is
// structurally impossible, because there is no ambient credential for a
// browser to borrow and a browser cannot compute the HMAC (Lesson 15.5 §8,
// layer three).
import { createHmac, timingSafeEqual } from 'node:crypto';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import type { ContentType, TaxonomyName } from '@/lib/graphql/tags';
import {
  incidentTag,
  listTag,
  pageTag,
  postTag,
  reviewTag,
  siteTag,
  taxonomyListTag,
  termTag,
} from '@/lib/graphql/tags';

export const dynamic = 'force-dynamic';

/**
 * ±300 seconds. Wide enough for real clock skew between a container and its
 * host; narrow enough that a captured request expires before it is useful.
 * The timestamp is INSIDE the signature, which is what makes it trustworthy.
 */
const WINDOW_SECONDS = 300;

/** WordPress `post_type` values this app renders. Also the version boundary — see below. */
const POST_TYPES = ['incident', 'post', 'tech_review', 'page'] as const;

/** WordPress taxonomy names this app renders. */
const TAXONOMIES = ['scapegoat', 'severity', 'tech_stack'] as const;

/**
 * `post_type` → the ContentType tags.ts understands. `tech_review` becomes
 * `review`: the GraphQL type name, the post_type string and the tag prefix are
 * three different words (appendix 03 §1), and this table is the only place that
 * fact is written down on the Next side.
 */
const CONTENT_OF: Record<(typeof POST_TYPES)[number], ContentType> = {
  incident: 'incident',
  post: 'post',
  tech_review: 'review',
  page: 'page',
};

/** taxonomy → TaxonomyName. `tech_stack` shortens to `stack`, same as tags.ts. */
const TAXONOMY_OF: Record<(typeof TAXONOMIES)[number], TaxonomyName> = {
  scapegoat: 'scapegoat',
  severity: 'severity',
  tech_stack: 'stack',
};

/** node-tag builder per ContentType, so the dispatch is exhaustive by type. */
const NODE_TAG: Record<ContentType, (slug: string) => string> = {
  incident: incidentTag,
  post: postTag,
  review: reviewTag,
  page: pageTag,
};

const PayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('post'),
    postType: z.enum(POST_TYPES),
    slug: z.string().trim().min(1),
    locale: z.string().min(2).max(8).optional(),
  }),
  z.object({
    type: z.literal('term'),
    taxonomy: z.enum(TAXONOMIES),
    slug: z.string().min(1),
    termId: z.number().int().positive(),
    locale: z.string().min(2).max(8).optional(),
  }),
  z.object({
    type: z.literal('options'),
    locale: z.string().min(2).max(8).optional(),
  }),
]);

type Payload = z.infer<typeof PayloadSchema>;

/** The test-only body. One shape, one value, nothing to be clever with. */
const E2eSchema = z.object({ type: z.literal('all') });

/**
 * Constant-time string compare.
 *
 * timingSafeEqual THROWS on a length mismatch, so the length check is required
 * rather than an optimisation — and comparing lengths in the open costs
 * nothing, because the length of a hex digest is public information.
 */
function equals(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/**
 * Every tag this endpoint can emit, built by tags.ts. Nothing here
 * concatenates a string, and `payload.locale` is deliberately unused: Module 18
 * emits locale-free tags and Module 20.4 is where the locale enters them.
 */
function tagsFor(payload: Payload): readonly string[] {
  if (payload.type === 'options') {
    return [siteTag()];
  }

  if (payload.type === 'term') {
    const taxonomy = TAXONOMY_OF[payload.taxonomy];

    return [
      termTag(taxonomy, payload.slug),
      // BOTH FORMS. Lesson 14.4's ScapegoatPicker tags with the term ID
      // because the block stores an ID and cannot know the slug before the
      // response arrives. This line is that debt discharged (§9).
      termTag(taxonomy, String(payload.termId)),
      taxonomyListTag(taxonomy),
      // A term's name changed, so every card that prints it is stale. All
      // three of these taxonomies are attached to incidents.
      listTag('incident'),
    ];
  }

  const content = CONTENT_OF[payload.postType];

  return [NODE_TAG[content](payload.slug), listTag(content)];
}

/**
 * The test-only cache reset. Lesson 23.6's global-setup calls this after
 * restoring fixtures/seeded.sql, because Next has no idea the database was
 * replaced and keeps serving the pre-import ISR cache (appendix 06 §7).
 *
 * E2E_MODE and E2E_SECRET reach THIS code from next-app/.env.local, because
 * this code runs inside the Next runtime. The Playwright process reads them
 * only from the invoking shell. Lesson 12.4 §9 argues that split.
 */
function handleE2E(presented: string, raw: string): Response {
  // 404, not 401 and not 403: in production this branch DOES NOT EXIST and the
  // response says so. A 401 would confirm there is something here to
  // authenticate against, which turns "does this deployment have a test hook?"
  // into a question with an answer.
  if (process.env.E2E_MODE !== '1') {
    return new Response(null, { status: 404 });
  }

  const expected = process.env.E2E_SECRET ?? '';

  // Fail closed on an unset secret, and 404 rather than 401 — an unconfigured
  // hook is an absent hook.

  if (expected === '') {
    return new Response(null, { status: 404 });
  }

  if (!equals(presented, expected)) {
    return new Response(null, { status: 401 });
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'body is not JSON' }, { status: 400 });
  }

  if (!E2eSchema.safeParse(body).success) {
    return Response.json({ error: 'payload failed validation' }, { status: 400 });
  }

  // THE SLEDGEHAMMER, and the only place in this course where it is correct.
  // `wp db reset && wp db import` replaced the entire content universe; no set
  // of tags expresses that, so "everything" is an accurate description rather
  // than a shortcut. Lesson 18.2 Key Concept 10 is why it is wrong elsewhere.
  revalidatePath('/', 'layout');

  return Response.json({ revalidated: ['*'] });
}

export async function POST(request: Request): Promise<Response> {
  // Read the raw body ONCE. Everything below operates on THIS string: the
  // bytes that were signed and the bytes that are parsed must be the same
  // bytes (§6). A second request.text() on a consumed stream throws, which is
  // the runtime enforcing the rule for you.
  const raw = await request.text();

  // ── 0. The test-only branch, checked FIRST, absent by default ────────
  const e2eSecret = request.headers.get('X-BTT-E2E-SECRET');

  if (e2eSecret !== null) {
    return handleE2E(e2eSecret, raw);
  }

  // ── 1. The replay window → 400 ───────────────────────────────────────
  const timestampHeader = request.headers.get('X-BTT-Timestamp');
  const timestamp = Number(timestampHeader);

  if (
    timestamp === null ||
    !Number.isInteger(timestamp) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WINDOW_SECONDS
  ) {
    // A distinguishable error is fine HERE: the timestamp is not a secret and
    // nobody can forge it into validity without the signature anyway.
    return Response.json({ error: 'timestamp outside the accepted window' }, { status: 400 });
  }

  // ── 2. The signature, over the RAW body → 401, silently ──────────────
  const secret = process.env.REVALIDATE_SECRET ?? '';

  if (secret === '') {
    // Fail closed. A server with no secret configured authenticates nobody.
    return new Response(null, { status: 401 });
  }

  // Sign over the HEADER'S EXACT BYTES, not over Number(...) re-stringified.
  const expected =
    'sha256=' +
    createHmac('sha256', secret).update(`${timestampHeader}.${raw}`, 'utf8').digest('hex');

  if (!equals(request.headers.get('X-BTT-Signature') ?? '', expected)) {
    // NO BODY AND NO REASON. A helpful error on a signature check is an
    // oracle: "bad length", "bad prefix" and "bad digest" are three separate
    // pieces of information an attacker would otherwise have to guess (§7).
    return new Response(null, { status: 401 });
  }

  // ── 3. Zod, AFTER the signature → 400 ────────────────────────────────
  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'body is not JSON' }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(body);

  if (!parsed.success) {
    // A valid signature proves the sender knows the secret. It does not prove
    // the payload is sane, and it does not prove the sender is the WordPress
    // VERSION you deployed — the two applications deploy independently. An
    // unrecognised postType is a loud 400 here rather than a tag nothing
    // carries and nobody notices (§8).
    return Response.json({ error: 'payload failed validation' }, { status: 400 });
  }

  // ── 4. Invalidate ────────────────────────────────────────────────────
  const tags = tagsFor(parsed.data);

  for (const tag of tags) {
    // The second argument is the cacheLife profile, required since Next 16.
    // 'max' = serve the stale entry while the fresh one is fetched, which is
    // what you want for public content behind a publish event.
    revalidateTag(tag, 'max');
  }

  // Echo what was invalidated. This body is the ONLY place either application
  // can see the tag strings that were actually used, and with
  // `blocking => false` WordPress will not read it — so it is for you, in a
  // terminal, with curl.
  return Response.json({ revalidated: tags });
}
