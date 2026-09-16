---
title: 'Navigation, Linking & Layouts'
module: 9
lesson: 4
teaches: [next-link, nested-layouts, generate-static-params, not-found, use-pathname, prefetching]
produces: ['next-app/src/app/[locale]/blog/page.tsx', 'next-app/src/app/[locale]/blog/[slug]/page.tsx', 'next-app/src/app/[locale]/reviews/page.tsx', 'next-app/src/app/[locale]/reviews/[slug]/page.tsx', 'next-app/src/app/[locale]/scapegoats/page.tsx', 'next-app/src/components/layout/NavLink.tsx']
requires: [9.3]
---

# Lesson 09.4 — Navigation, Linking & Layouts

## Quick Overview

Blame The Tech has one working section. This lesson builds the other three — the blog, the tech
reviews and the scapegoat leaderboard — and connects them with real navigation. The routes
themselves are repetition of Lesson 09.3, which is intentional: writing the same server-fetch
shape four times is how it stops being novel, and the reviews route adds the one genuinely new
data problem in Phase 2, the SCF repeater that arrives as a list of objects rather than a list
of strings.

The new mechanics are navigational. `<Link>` replaces `<a>` and gives you client-side
navigation with automatic prefetching, so moving between sections re-renders the page below the
layout without a full document load. `generateStaticParams` tells Next which dynamic slugs to
prerender at build time — the direct equivalent of asking WordPress to warm its page cache, but
declared in code. And `notFound()` gives you a real 404 from inside a component, which is the
piece that makes a bad slug behave correctly rather than rendering an empty shell.

By the end of this lesson you will have:

- `next-app/src/app/[locale]/blog/page.tsx` and `blog/[slug]/page.tsx` on the `posts` connection
- `next-app/src/app/[locale]/reviews/page.tsx` and `reviews/[slug]/page.tsx`, including the `pros` and `cons` repeaters
- `next-app/src/app/[locale]/scapegoats/page.tsx` — the blame leaderboard, ordered by term `count`
- Site navigation added inline to `src/app/[locale]/layout.tsx` with locale-aware `<Link href>` values
- `generateStaticParams` on all three dynamic routes, and `notFound()` on a slug that does not exist

## Classic WP Analogy

Every piece of this lesson has a Classic WordPress counterpart, and the counterparts are the
functions you reach for without thinking:

| Classic WordPress | App Router | Note |
|---|---|---|
| `<a href="<?php the_permalink(); ?>">` | `<Link href={`/${locale}/blog/${slug}`}>` | you build the URL; there is no permalink structure to consult |
| `wp_nav_menu(['theme_location' => 'primary'])` | hard-coded `<Link>` list, for now | Module 11 extracts it, Module 20 localises it |
| `get_header()` in every template | `layout.tsx`, applied automatically | you cannot forget to call it |
| `is_page('about')` for active state | `usePathname()` in a Client Component | requires `'use client'` — that is why the nav is an island |
| `status_header(404); get_404_template();` | `notFound()` | throws; nothing after it runs |
| Warming the cache with a crawler | `generateStaticParams()` | declared in code, runs at build |

The analogy holds well for building URLs and for the header-and-footer wrapper. It breaks on
three things worth naming.

**There is no permalink structure.** In WordPress, `the_permalink()` consults the rewrite rules,
so changing `/blog/%postname%/` to `/articles/%postname%/` updates every link on the site. In
Next the URL is a string you construct, and the folder name is the only source of truth. If you
rename `blog/` to `articles/` you will be editing `<Link>` calls. That is the cost of the
explicitness you gained in Lesson 09.1, and it is why the `[locale]` segment being present from
day one matters so much.

**`<Link>` prefetches.** Hovering a link in production quietly fetches the target route's data
before you click, which is why navigation feels instant and also why your WordPress access log
shows GraphQL requests for pages nobody visited. `<a href>` has no such behaviour, and neither
does WordPress. It is a genuine performance win with a genuine cost, and Module 18 revisits it
once caching exists.

**Layouts persist; `get_header()` does not.** A WordPress page load reconstructs the header from
scratch every time. A Next layout is rendered once and then survives every client-side
navigation below it, keeping its state. This is the behaviour that makes the app feel like an
app, and it is also the reason a `useEffect` in a layout does not re-run when the page changes —
a distinction that produces genuinely confusing bugs if you expect PHP's request lifecycle.

---

## Key Concepts

### 1. `<Link>` versus `<a>`, and what prefetching costs

`<a href="/en/blog">` works. It also throws away the application: a full document request, a new
JavaScript execution context, the layout re-created, every client component re-hydrated. `<Link>`
intercepts the click, asks the server for just the part of the tree that changed, and swaps it in.

| | `<a href>` | `<Link href>` |
|---|---|---|
| What the browser fetches | a whole HTML document | an RSC payload for the changed segments |
| Layout above the change | re-created | **preserved**, with its state |
| Client components | re-downloaded, re-hydrated | already there |
| Scroll position | reset by the browser | managed by the router |
| Works with JavaScript off | ✅ | ✅ — it renders a real `<a>`, so the click falls back |

Use `<Link>` for every internal URL and `<a>` for every external one. That is the whole rule.

The part that is not free is **prefetching**. In production, `<Link>` asks the server for the
target route before the click, so navigation feels instantaneous. Which means your server renders
pages nobody asked for, and your WordPress access log fills with GraphQL requests for incidents
nobody read.

| `prefetch` | Behaviour |
|---|---|
| default (unset) | Next decides, based on whether the route is static or dynamic and where the nearest loading boundary is. Conservative for dynamic routes. |
| `prefetch={true}` | Fetch the full route eagerly. Fastest clicks, most wasted work. |
| `prefetch={false}` | Nothing until the click. |

This project has no `loading.tsx` and no cache policy, so every route is dynamic and every prefetch
that does happen becomes a live WordPress query. Step 7 of the Task makes you watch that in the
access log, which is the only way this fact becomes real. Module 18 revisits it once caching exists
and a prefetch can be served from a cache instead of from PHP.

> **This is a genuine architectural cost, not a Next.js flaw.** Prefetching trades server work for
> perceived speed. On a marketing site with cached pages it is close to free; on an uncached page
> that runs an expensive GraphQL query per hover, it is a load-testing tool you installed by
> accident.

### 2. `usePathname` is a hook, so the active-nav bit is an island

Highlighting the current page needs to know the current URL. `usePathname()` is a hook from
`next/navigation`, so the component that calls it must be a Client Component — and if you called
it from `layout.tsx`, the whole layout would move into the client graph.

So the navigation splits, and the split is instructive:

```
layout.tsx                        SERVER   builds the URL strings, knows the locale
  └─ <nav>                        SERVER   markup only
       └─ NavLink  'use client'   CLIENT   one hook, one aria-current attribute
            └─ <Link>             CLIENT
```

Five link labels and five hrefs stay on the server. One tiny component — a hook call and an
attribute — is all that ships. That is the same "push the boundary down" instinct as Lesson 09.2's
provider, applied to a much smaller problem, and it is the shape Module 11's `Header` keeps when it
takes this nav over.

The Classic WordPress equivalent is `is_page('about')` inside `wp_nav_menu`'s walker: same
decision, made on the server, from state PHP already has. Next has to ask the browser, because on a
client-side navigation the server was never involved.

### 3. `generateStaticParams` is cache warming, declared in code

Export `generateStaticParams` from a dynamic route and Next calls it at build time to learn which
values of that segment exist:

```tsx
// The whole API. It runs at build, on the server, and may fetch. — (illustration)
export async function generateStaticParams() {
  const data = await fetchPosts(50);
  return data.posts.nodes.map((post) => ({ locale: 'en', slug: post.slug }));
}
```

Because `[locale]` is a dynamic segment too, the returned objects carry **both** params. A child
segment can also return only its own key and inherit the parent's, but spelling out both is
unambiguous and survives Module 20 adding locales.

| | WordPress cache warming | `generateStaticParams` |
|---|---|---|
| Where the list lives | a crawler script, or a plugin's settings | in the route file, next to the query |
| When it runs | on a cron, after a deploy, hopefully | during `next build`, always |
| A URL not in the list | served slowly, then cached | rendered on demand — see `dynamicParams` |
| Reviewable | not really | it is a diff |

`dynamicParams` is `true` by default, which means a slug that was not in the list still works: Next
renders it on demand. Set `export const dynamicParams = false` and anything not in the list is a
404 instead. Default `true` is right here, because an editor publishing an incident should not have
to wait for a deploy to see it.

> **The honest note about this module.** Next 16 does not cache `fetch` by default, and a route
> whose data comes from an uncached fetch is rendered on demand rather than prerendered — so the
> build output marks these routes `ƒ (Dynamic)`, and `generateStaticParams` currently buys you very
> little beyond a reviewable list of what exists. That is not a mistake in the code you are about
> to write; it is the missing cache policy from the module README's third debt. Lesson 10.3 adds
> `revalidate` and tags, and the same `generateStaticParams` starts producing real build-time
> prerenders. Write it now, where it belongs, so that lesson is a one-line change.

### 4. `notFound()` and the file that is not here yet

`notFound()` throws, Next catches, and it renders the nearest `not-found.tsx` with HTTP 404. There
is no `not-found.tsx` in this project, so Next's built-in page answers — and because there is no
layout above `[locale]` (Lesson 09.1 Key Concept 7), that built-in page is not wrapped in your
`<html>` either.

Three routes in this lesson call it, always in the same place and always for the same reason: the
query returned `null` for the requested slug. Get into the habit of the shape:

```tsx
// Guard immediately after the fetch, before any field access. — (illustration)
const { post } = await fetchPost(slug);
if (!post) notFound();
```

Lesson 10.4 adds `not-found.tsx`, `error.tsx` and `loading.tsx` together, because they are one
decision about what a failing route looks like rather than three unrelated files.

### 5. Nested layouts, and why `blog/layout.tsx` does not exist

Any folder may have its own `layout.tsx`, which wraps everything below it and nests inside the
layouts above it. You could give the blog one — a sidebar, a category list, a "subscribe" band.

This lesson deliberately does not, and the reason is a rule worth keeping: **a layout is for what
is shared by, and persists across, several routes below it.** `/en/blog` and `/en/blog/[slug]` do
share a heading, but they are two routes, and the sidebar you would put there does not exist yet
because Module 11 owns visual structure and Module 11 will want it in `Header`/`Footer` instead.

| Adding `blog/layout.tsx` now | Not adding it |
|---|---|
| One more file to move when Module 11 restructures | ✅ nothing to move |
| A place to fetch the category list once | you do not have a category list |
| Persists across blog navigations | two routes is not enough to notice |

The cost of the decision is real, and it is a duplicated `<h1>`: `/en/blog` and each post repeat a
little markup. That is the cheaper mistake. A layout added before it has two genuine consumers is
an abstraction you will have to unpick.

### 6. There is no permalink structure. The folder is the truth

In WordPress, `the_permalink()` consults the rewrite rules. Change `/blog/%postname%/` to
`/articles/%postname%/` in Settings → Permalinks and every link on the site updates, because no
template ever hard-coded a URL.

In the App Router you build the URL string yourself, and the folder name is the only source of
truth. There is no indirection and there is no settings screen. Renaming `blog/` to `articles/`
means:

```
mv src/app/[locale]/blog src/app/[locale]/articles       ← the route moves
grep -rn '/blog' src/                                    ← now fix every one of these
```

Plus the redirect for the old URLs, which is your problem now (Module 24 owns redirects). This is
the bill for Lesson 09.1's explicitness: nothing is decided at runtime, so nothing can be changed
at runtime either. Two habits make it survivable — always compose hrefs from the `locale` you
already awaited, and never write a bare `/blog` string in a component that is not the nav.

### 7. The SCF repeater shape, and the moment your type surprises you

`pros` and `cons` are SCF **repeaters** with a single Text sub-field called `item`. They do not
arrive as `string[]`. They arrive as a list of objects:

```json
{ "pros": [{ "item": "The docs have a search box" }, { "item": "It has not deleted prod yet" }] }
```

[Appendix 03 §4.3](../appendix/03-content-model-reference.md#43-tech-review-fields) states this,
and Lesson 05.3 made you look at it in GraphiQL. It is worth a section here because this is the
first time it reaches TypeScript, and the mapping is where people write the bug:

```tsx
// ❌ renders "[object Object]" five times, with no error anywhere. — (illustration)
{review.techReviewFields.pros.map((p) => <li key={p}>{p}</li>)}

// ✅ the sub-field is the string, and it is nullable. — (illustration)
{review.techReviewFields.pros?.map((p) => <li key={p.item}>{p.item}</li>)}
```

Every layer of a repeater is nullable: the repeater itself (no rows), each row (present but empty),
and the sub-field. That is not SCF being awkward — it is SCF being honest, because none of the
three can be guaranteed by a field group. Module 10's generated types spell all three out, which is
the moment "why is my generated type so full of `| null`?" gets its answer: because your content
model really is.

### 8. The leaderboard is one indexed read, and that is why `scapegoat` is a taxonomy

`ScapegoatLeaderboard` orders by `count`, which WordPress maintains in `wp_term_taxonomy.count`
every time a term relationship changes.

```
TAXONOMY (what we chose)                  POST META (the alternative)
────────────────────────────              ──────────────────────────────────
SELECT t.name, tt.count                   SELECT meta_value, COUNT(*)
FROM wp_terms t                           FROM wp_postmeta
JOIN wp_term_taxonomy tt USING(term_id)   WHERE meta_key = 'scapegoat'
WHERE tt.taxonomy = 'scapegoat'           GROUP BY meta_value
ORDER BY tt.count DESC                    ORDER BY 2 DESC

one indexed read of a maintained counter  a full scan of an EAV table, grouped
                                          on an unindexed 65 KB TEXT column
```

Lesson 05.4 ran `EXPLAIN` on both. This is the payoff of the modelling decision in
[appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies), and it arrives in the
front end as a page that needs no aggregation, no caching and no pagination — the query returns ten
rows and each one already knows its score.

The cost, which appendix 03 also states: terms have no revisions and no rich editorial body. The
`Scapegoat Profile` term field group covers what this app needs; a scapegoat with a long-form
article would force the decision open again.

---

## Task

### Step 1: Grow the hand-written response types

Append to the file from Lesson 09.3. It is about to get long, and the length is the argument.

```ts
// next-app/src/types/graphql-responses.ts (fragment — append to the file from Lesson 09.3,
// keeping its header comment. Add TechReviewVerdict to the existing import at the top:
//   import type { …, TechReviewVerdict } from '@/types/content';

/* ── Blog ─────────────────────────────────────────────────────────────── */

export interface PostNodeResponse {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly date: string;
}

/** `query PostsList($first: Int!, $after: String)` */
export interface PostsQueryResponse {
  readonly posts: {
    readonly pageInfo: PageInfo;
    readonly nodes: readonly PostNodeResponse[];
  };
}

/** `query PostBySlug($slug: ID!)` */
export interface PostBySlugQueryResponse {
  readonly post: (PostNodeResponse & { readonly content: string | null }) | null;
}

/* ── Tech reviews ─────────────────────────────────────────────────────── */

/**
 * One row of an SCF repeater. NOT a string — appendix 03 §4.3.
 * All three levels are nullable: the list, the row, and the sub-field.
 */
export interface RepeaterItemResponse {
  readonly item: string | null;
}

export interface TechReviewFieldsResponse {
  readonly companyName: string;
  readonly ratingOverall: number;
  readonly ratingDx: number;
  readonly ratingDocs: number;
  readonly ratingIncidentResponse: number;
  readonly verdict: TechReviewVerdict;
  readonly pros: readonly RepeaterItemResponse[] | null;
  readonly cons: readonly RepeaterItemResponse[] | null;
  readonly reviewedAt: string;
}

export interface ReviewNodeResponse {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly date: string;
  readonly techReviewFields: TechReviewFieldsResponse;
}

/** `query ReviewsList($first: Int!, $after: String)` */
export interface ReviewsQueryResponse {
  readonly techReviews: {
    readonly pageInfo: PageInfo;
    readonly nodes: readonly ReviewNodeResponse[];
  };
}

/** `query ReviewBySlug($slug: ID!)` */
export interface ReviewBySlugQueryResponse {
  readonly techReview: (ReviewNodeResponse & { readonly content: string | null }) | null;
}

/* ── Scapegoats ───────────────────────────────────────────────────────── */

export interface ScapegoatNodeResponse {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  // ⚠️ Same lie as downtimeMinutes: the schema says `count` is nullable, and this
  // whole page is an ORDER BY on it. Lesson 10.2 removes the possibility.
  readonly count: number;
  readonly scapegoatProfile: {
    readonly tagline: string | null;
    readonly defensiveness: number | null;
  } | null;
}

/** `query ScapegoatLeaderboard($first: Int!)` */
export interface ScapegoatLeaderboardQueryResponse {
  readonly scapegoats: {
    readonly nodes: readonly ScapegoatNodeResponse[];
  };
}
```

Seven exported response types in one hand-written file, none of them checked against
`wordpress-headless/schema.graphql`. Add the rows to the table in `docs/api-contract.md` as you go —
Lesson 10.2 reads that table.

### Step 2: Build the blog routes

Two files, and the shape is Lesson 09.3's, on purpose. Repetition is the assignment: by the fourth
copy of this pattern you stop reading it as Next.js and start reading it as "fetch, guard, render".

```tsx
// next-app/src/app/[locale]/blog/page.tsx
import Link from 'next/link';
import type { GraphQLPayload, PostsQueryResponse } from '@/types/graphql-responses';

const POSTS_LIST = /* GraphQL */ `
  query PostsList($first: Int!, $after: String) {
    posts(
      first: $first
      after: $after
      where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        slug
        date
      }
    }
  }
`;

// The fifth copy of these twelve lines. Lesson 10.1 deletes four of them.
async function fetchPosts(first: number): Promise<PostsQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: POSTS_LIST, variables: { first } }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<PostsQueryResponse>;
  if (payload.errors?.length) {
    console.error('[btt] PostsList errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data for PostsList');
  return payload.data;
}

export default async function BlogPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { posts } = await fetchPosts(10);

  return (
    <main>
      <h1>Blog</h1>
      <ul>
        {posts.nodes.map((post) => (
          <li key={post.id}>
            {/* Compose the href from the locale you already awaited. Never a bare '/blog'. */}
            <Link href={`/${locale}/blog/${post.slug}`}>{post.title}</Link>
            <time dateTime={post.date}>{post.date.slice(0, 10)}</time>
          </li>
        ))}
      </ul>
      {posts.pageInfo.hasNextPage ? <p>More posts exist. Pagination lands in Module 18.</p> : null}
    </main>
  );
}
```

`PostCardFields` from Lesson 05.3 also selects `excerpt` and `featuredImage`. This route selects
neither: an excerpt is a *second* HTML blob, and a featured image needs `next/image` plus styling
that does not exist until Module 11. Select what you render — a query is a contract about work the
server does on your behalf.

```tsx
// next-app/src/app/[locale]/blog/[slug]/page.tsx
import { notFound } from 'next/navigation';
import type { GraphQLPayload, PostBySlugQueryResponse, PostsQueryResponse } from '@/types/graphql-responses';

const POST_BY_SLUG = /* GraphQL */ `
  query PostBySlug($slug: ID!) {
    post(id: $slug, idType: SLUG) {
      id
      title
      slug
      date
      content
    }
  }
`;

const POST_SLUGS = /* GraphQL */ `
  query PostSlugs($first: Int!) {
    posts(first: $first, where: { status: PUBLISH }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        slug
        date
      }
    }
  }
`;

async function query<TData>(document: string, variables: Record<string, unknown>): Promise<TData> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: document, variables }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<TData>;
  if (payload.errors?.length) {
    console.error('[btt] GraphQL errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data');
  return payload.data;
}

// Runs at build time. Both params, because [locale] is dynamic too.
export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await query<PostsQueryResponse>(POST_SLUGS, { first: 50 });
  return data.posts.nodes.map((post) => ({ locale: 'en', slug: post.slug }));
}

export default async function PostPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { post } = await query<PostBySlugQueryResponse>(POST_BY_SLUG, { slug });

  if (!post) notFound();

  return (
    <main>
      <h1>{post.title}</h1>
      <time dateTime={post.date}>{post.date.slice(0, 10)}</time>

      {/* DEBT (Module 09 → Module 14): the post body as one opaque HTML string. The same
          debt Lesson 09.3 took on the incident route, taken again here on purpose. */}
      <div dangerouslySetInnerHTML={{ __html: post.content ?? '' }} />
    </main>
  );
}
```

Notice what changed in the helper: it is now generic over the response type, because this file runs
two documents. That is the third variation of the same twelve lines in the repository, which is
precisely how a codebase ends up with three slightly different HTTP clients. Lesson 10.1 replaces
all of them with one.

Notice also that the second document is named `PostSlugs` and not `PostsList`. A GraphQL operation
is identified by its name, so two documents called `PostsList` with different selection sets are
two answers to the same question — harmless while the documents are inline strings, and a hard
error the moment Lesson 10.2 collects every document in the project into one codegen run.

### Step 3: Build the reviews routes — structured data next to a blob

The list page renders the SCF ratings as real markup. Nothing here is a string of HTML.

```tsx
// next-app/src/app/[locale]/reviews/page.tsx
import Link from 'next/link';
import type { GraphQLPayload, ReviewsQueryResponse } from '@/types/graphql-responses';

const REVIEWS_LIST = /* GraphQL */ `
  query ReviewsList($first: Int!, $after: String) {
    techReviews(first: $first, after: $after, where: { status: PUBLISH }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        slug
        date
        techReviewFields {
          companyName
          ratingOverall
          ratingDx
          ratingDocs
          ratingIncidentResponse
          verdict
          reviewedAt
        }
      }
    }
  }
`;

async function fetchReviews(first: number): Promise<ReviewsQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: REVIEWS_LIST, variables: { first } }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<ReviewsQueryResponse>;
  if (payload.errors?.length) {
    console.error('[btt] ReviewsList errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data for ReviewsList');
  return payload.data;
}

export default async function ReviewsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { techReviews } = await fetchReviews(8);

  return (
    <main>
      <h1>Tech Reviews</h1>
      <ul>
        {techReviews.nodes.map((review) => {
          const f = review.techReviewFields;
          return (
            <li key={review.id}>
              <Link href={`/${locale}/reviews/${review.slug}`}>{review.title}</Link>
              <p>
                {f.companyName} — verdict <strong>{f.verdict}</strong>, overall {f.ratingOverall}
                /10 (DX {f.ratingDx}, docs {f.ratingDocs}, incident response{' '}
                {f.ratingIncidentResponse})
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
```

The detail page is the most important file in this lesson, because it puts the two ways of getting
content out of WordPress side by side on one screen: **structured fields you can style, reorder and
reason about, and one opaque string you cannot.**

```tsx
// next-app/src/app/[locale]/reviews/[slug]/page.tsx
import { notFound } from 'next/navigation';
import type {
  GraphQLPayload,
  ReviewBySlugQueryResponse,
  ReviewsQueryResponse,
} from '@/types/graphql-responses';

const REVIEW_BY_SLUG = /* GraphQL */ `
  query ReviewBySlug($slug: ID!) {
    techReview(id: $slug, idType: SLUG) {
      id
      title
      slug
      date
      content
      techReviewFields {
        companyName
        ratingOverall
        ratingDx
        ratingDocs
        ratingIncidentResponse
        verdict
        reviewedAt
        pros {
          item
        }
        cons {
          item
        }
      }
    }
  }
`;

const REVIEW_SLUGS = /* GraphQL */ `
  query ReviewSlugs($first: Int!) {
    techReviews(first: $first, where: { status: PUBLISH }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        slug
        date
        techReviewFields {
          companyName
          ratingOverall
          ratingDx
          ratingDocs
          ratingIncidentResponse
          verdict
          reviewedAt
        }
      }
    }
  }
`;

async function query<TData>(document: string, variables: Record<string, unknown>): Promise<TData> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: document, variables }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<TData>;
  if (payload.errors?.length) {
    console.error('[btt] GraphQL errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data');
  return payload.data;
}

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await query<ReviewsQueryResponse>(REVIEW_SLUGS, { first: 20 });
  return data.techReviews.nodes.map((review) => ({ locale: 'en', slug: review.slug }));
}

export default async function ReviewPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const { techReview } = await query<ReviewBySlugQueryResponse>(REVIEW_BY_SLUG, { slug });

  if (!techReview) notFound();

  const f = techReview.techReviewFields;

  return (
    <main>
      <h1>{techReview.title}</h1>
      <p>
        {f.companyName} · reviewed {f.reviewedAt} · verdict <strong>{f.verdict}</strong>
      </p>

      {/* STRUCTURED: four numbers this page can sort, badge, chart or hide. */}
      <dl>
        <dt>Overall</dt>
        <dd>{f.ratingOverall}/10</dd>
        <dt>Developer experience</dt>
        <dd>{f.ratingDx}/10</dd>
        <dt>Documentation</dt>
        <dd>{f.ratingDocs}/10</dd>
        <dt>Incident response</dt>
        <dd>{f.ratingIncidentResponse}/10</dd>
      </dl>

      {/* STRUCTURED: the repeaters. Every level nullable — Key Concept 7. */}
      <h2>Pros</h2>
      <ul>
        {f.pros?.map((row) => (row.item ? <li key={row.item}>{row.item}</li> : null))}
      </ul>

      <h2>Cons</h2>
      <ul>
        {f.cons?.map((row) => (row.item ? <li key={row.item}>{row.item}</li> : null))}
      </ul>

      {/* DEBT (Module 09 → Module 14): and here is the same content model's other half —
          the review body as one opaque HTML string. Everything above this line is data.
          This line is a blob. That contrast is the argument for Module 14. */}
      <div dangerouslySetInnerHTML={{ __html: techReview.content ?? '' }} />
    </main>
  );
}
```

**Verify §3:**

- [ ] `/en/reviews` lists eight reviews with their four ratings.
- [ ] A review's Pros and Cons render as list items of text — **not** as `[object Object]`. If you
      see that string, you mapped the row instead of `row.item`.
- [ ] On the detail page, everything above the blob is styleable markup and the blob is one
      undifferentiated `<div>`. Look at it in the element inspector; that picture is what Module 14
      removes.

### Step 4: Build the scapegoat leaderboard

No pagination, no aggregation, no `COUNT(*)`. The taxonomy already knows.

```tsx
// next-app/src/app/[locale]/scapegoats/page.tsx
import type { GraphQLPayload, ScapegoatLeaderboardQueryResponse } from '@/types/graphql-responses';

const SCAPEGOAT_LEADERBOARD = /* GraphQL */ `
  query ScapegoatLeaderboard($first: Int!) {
    scapegoats(first: $first, where: { orderby: COUNT, order: DESC, hideEmpty: false }) {
      nodes {
        id
        name
        slug
        count
        scapegoatProfile {
          tagline
          defensiveness
        }
      }
    }
  }
`;

async function fetchLeaderboard(first: number): Promise<ScapegoatLeaderboardQueryResponse> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SCAPEGOAT_LEADERBOARD, variables: { first } }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<ScapegoatLeaderboardQueryResponse>;
  if (payload.errors?.length) {
    console.error('[btt] ScapegoatLeaderboard errors:', payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new Error('WPGraphQL returned no data for ScapegoatLeaderboard');
  return payload.data;
}

export default async function ScapegoatsPage() {
  // The ten seeded terms from appendix 03 §2, ordered by wp_term_taxonomy.count.
  const { scapegoats } = await fetchLeaderboard(10);

  return (
    <main>
      <h1>The Blame Leaderboard</h1>
      <ol>
        {scapegoats.nodes.map((scapegoat) => (
          <li key={scapegoat.id}>
            <strong>{scapegoat.name}</strong> — blamed {scapegoat.count} times
            {scapegoat.scapegoatProfile?.tagline ? (
              <em> “{scapegoat.scapegoatProfile.tagline}”</em>
            ) : null}
            {/* Both levels nullable: the term may have no profile, and the profile may
                have no value. `typeof` covers both in one readable check. */}
            {typeof scapegoat.scapegoatProfile?.defensiveness === 'number' ? (
              <span> (defensiveness {scapegoat.scapegoatProfile.defensiveness}/10)</span>
            ) : null}
          </li>
        ))}
      </ol>
      <p>
        There is no per-scapegoat page yet — <code>scapegoats/[slug]</code> arrives with the
        rendering-strategy pass in Module 18, together with the pagination this list does not
        need.
      </p>
    </main>
  );
}
```

This page takes no `params` at all, which is legal and worth noticing: a route only needs the props
it uses. It also has no `<Link>` on the term names, because the target route does not exist — a
link to a 404 is worse than no link.

### Step 5: Add `generateStaticParams` to the incident route

Steps 2 and 3 added it to `blog/[slug]` and `reviews/[slug]`. The incident route from Lesson 09.3
needs the same treatment — it is the one with forty slugs. Add three things to that file:

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx (fragment — add above the component)

// An eighth hand-written type, and note where it is: in a route file rather than in
// src/types/graphql-responses.ts, because IncidentsQueryResponse demands the whole node
// shape and this query wants one field. Declaring a narrower type locally is the honest
// move today and it is also how hand-written types spread through a repository.
interface IncidentSlugsResponse {
  readonly incidents: { readonly nodes: readonly { readonly slug: string }[] };
}

const INCIDENT_SLUGS = /* GraphQL */ `
  query IncidentSlugs($first: Int!) {
    incidents(first: $first, where: { status: PUBLISH }) {
      nodes {
        slug
      }
    }
  }
`;

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (!endpoint) throw new Error('WP_GRAPHQL_ENDPOINT is not set. Copy .env.example to .env.local.');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 40 seeded incidents (appendix 03 §9). `first: 100` leaves room for the ones
    // Module 16 lets visitors submit, without another edit here — but note that
    // Lesson 06.4 caps every connection at 50 nodes, so this is a CEILING and
    // not a page size. Lesson 18.1 adds the cursor loop that makes it reachable.
    body: JSON.stringify({ query: INCIDENT_SLUGS, variables: { first: 100 } }),
  });
  if (!res.ok) throw new Error(`WPGraphQL transport failure: HTTP ${res.status}`);

  const payload = (await res.json()) as GraphQLPayload<IncidentSlugsResponse>;
  if (!payload.data) throw new Error('WPGraphQL returned no data for IncidentSlugs');

  return payload.data.incidents.nodes.map((incident) => ({ locale: 'en', slug: incident.slug }));
}
```

`IncidentSlugs` is a new operation name, for the reason Step 2 gave: reusing `IncidentsList` for a
different selection set would give you two documents claiming to be the same query. Module 10
enforces that mechanically — codegen refuses duplicate operation names across the whole project.

**Verify §5:**

- [ ] `npm run build` completes with no errors and lists all three `[slug]` routes.
- [ ] WordPress must be running for that build to succeed. Stop it and build again if you want to
      see the failure — a build that queries your CMS is a real deployment constraint, and Module 24
      is where it gets designed around rather than discovered.

### Step 6: Add the navigation, with an active-state island

One new client component. It is the smallest useful Client Component in the course, and that is the
point.

```tsx
// next-app/src/components/layout/NavLink.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A <Link> that knows whether it points at the current page.
 *
 * This file exists because `usePathname` is a hook: the layout that renders the nav
 * stays a Server Component, and only this component crosses into the browser.
 * Module 11's Header takes this over — the hook call moves, the pattern does not.
 */
export function NavLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} aria-current={isActive ? 'page' : undefined}>
      {children}
    </Link>
  );
}
```

`aria-current="page"` rather than a CSS class: it is the accessible way to say "this is where you
are", it works before Module 11 adds any styling, and Module 22 audits it rather than adding it.

Now the nav itself, inline in the root layout:

```tsx
// next-app/src/app/[locale]/layout.tsx (fragment — add the import, and the <nav> inside <body>)
import { NavLink } from '@/components/layout/NavLink';

// ... inside the component, after `const { locale } = await params;`

  return (
    <html lang={locale}>
      <body>
        {/* HARD-CODED, deliberately. Lesson 11.3 replaces this with <Header /> reading
            WordPress menus via `menuItems(where: { location: PRIMARY })`. Five labels in
            a layout is the right amount of wrong for one module. */}
        <nav aria-label="Primary">
          <ul>
            <li>
              <NavLink href={`/${locale}`}>Home</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/incidents`}>Incidents</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/blog`}>Blog</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/reviews`}>Reviews</NavLink>
            </li>
            <li>
              <NavLink href={`/${locale}/scapegoats`}>Scapegoats</NavLink>
            </li>
          </ul>
        </nav>

        {children}
      </body>
    </html>
  );
```

**Verify §6:**

- [ ] Every page has the nav, and clicking through does **not** cause a full page reload — watch the
      browser's reload indicator, or the Network tab filtered to `Doc`.
- [ ] The current item carries `aria-current="page"` in the element inspector.
- [ ] `layout.tsx` contains no `'use client'` and no `usePathname`. If it does, the whole layout is
      in the client graph and Lesson 09.2 was wasted.

### Step 7: Watch what prefetching costs

Prefetch behaviour is a production behaviour, so build and start the production server:

```bash
npm run build
npm run start
```

In a second terminal, watch WordPress's access log:

```bash
cd ../wordpress-headless
docker compose logs -f --tail=0 wordpress
```

Now load `http://localhost:3000/en/blog` and hover the post links without clicking. To see the full
cost, temporarily set `prefetch={true}` on the blog list's `<Link>` — the default is deliberately
conservative for uncached routes, which is why the effect is easier to demonstrate explicitly than
to wait for:

```tsx
// next-app/src/app/[locale]/blog/page.tsx (fragment — TEMPORARY, remove after this step)
            <Link href={`/${locale}/blog/${post.slug}`} prefetch={true}>
              {post.title}
            </Link>
```

**Verify §7:**

- [ ] `POST /graphql` lines appear in the WordPress log for posts you never opened.
- [ ] Clicking one of those links is noticeably faster than clicking a link you did not hover.
- [ ] Remove the `prefetch={true}` before moving on, and write the number of prefetch requests you
      saw somewhere you will find it again — Module 18 asks you to compare it against the cached
      version.

Stop the production server and go back to `npm run dev`.

---

## Verification

```bash
cd next-app
# `npm run dev` running in a second terminal.

# 1. Capture one real slug per dynamic route
POST_SLUG=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ posts(first:1, where:{status:PUBLISH}) { nodes { slug } } }"}' \
  | jq -r '.data.posts.nodes[0].slug')
REVIEW_SLUG=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ techReviews(first:1, where:{status:PUBLISH}) { nodes { slug } } }"}' \
  | jq -r '.data.techReviews.nodes[0].slug')
INCIDENT_SLUG=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1, where:{status:PUBLISH}) { nodes { slug } } }"}' \
  | jq -r '.data.incidents.nodes[0].slug')
echo "$POST_SLUG / $REVIEW_SLUG / $INCIDENT_SLUG"
# Expected: three real slugs, none of them "null"

# 2. All eight page routes answer 200
curl -s -o /dev/null -w 'home       %{http_code}\n' http://localhost:3000/en
# Expected: home       200
curl -s -o /dev/null -w 'incidents  %{http_code}\n' http://localhost:3000/en/incidents
# Expected: incidents  200
curl -s -o /dev/null -w 'incident   %{http_code}\n' "http://localhost:3000/en/incidents/$INCIDENT_SLUG"
# Expected: incident   200
curl -s -o /dev/null -w 'blog       %{http_code}\n' http://localhost:3000/en/blog
# Expected: blog       200
curl -s -o /dev/null -w 'post       %{http_code}\n' "http://localhost:3000/en/blog/$POST_SLUG"
# Expected: post       200
curl -s -o /dev/null -w 'reviews    %{http_code}\n' http://localhost:3000/en/reviews
# Expected: reviews    200
curl -s -o /dev/null -w 'review     %{http_code}\n' "http://localhost:3000/en/reviews/$REVIEW_SLUG"
# Expected: review     200
curl -s -o /dev/null -w 'scapegoats %{http_code}\n' http://localhost:3000/en/scapegoats
# Expected: scapegoats 200

# 3. The seed counts match appendix 03 §9, which is what generateStaticParams enumerates
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ posts(first:100, where:{status:PUBLISH}){ nodes { slug } } techReviews(first:100, where:{status:PUBLISH}){ nodes { slug } } incidents(first:100, where:{status:PUBLISH}){ nodes { slug } } }"}' \
  | jq '{posts: (.data.posts.nodes|length), reviews: (.data.techReviews.nodes|length), incidents: (.data.incidents.nodes|length)}'
# Expected: {"posts":10,"reviews":8,"incidents":40}

# 4. The repeater proof — pros are objects with an `item` key, NOT strings
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg s "$REVIEW_SLUG" '{query:"query ReviewBySlug($slug: ID!){ techReview(id:$slug, idType:SLUG){ techReviewFields { pros { item } } } }", variables:{slug:$s}}')" \
  | jq '.data.techReview.techReviewFields.pros[0] | type, keys'
# Expected: "object" then ["item"]   — appendix 03 §4.3. If this said "string", the
#           content model changed and every generated type in Module 10 changes with it.

# 5. The build knows about all three dynamic routes
npm run build
# Expected: rows for /[locale]/blog/[slug], /[locale]/reviews/[slug] and
#           /[locale]/incidents/[slug]. They are marked `ƒ (Dynamic)`, not `○ (Static)`,
#           because no fetch in this module is cached — Key Concept 3's honest note.

# 6. NEGATIVE — a bad slug is a 404 on all three dynamic routes, not an empty page
curl -s -o /dev/null -w 'bad post     %{http_code}\n' http://localhost:3000/en/blog/no-such-post
# Expected: bad post     404
curl -s -o /dev/null -w 'bad review   %{http_code}\n' http://localhost:3000/en/reviews/no-such-review
# Expected: bad review   404
curl -s -o /dev/null -w 'bad incident %{http_code}\n' http://localhost:3000/en/incidents/no-such-incident
# Expected: bad incident 404

# 7. NEGATIVE — the layout is not a Client Component
grep -c 'usePathname' src/app/\[locale\]/layout.tsx
# Expected: 0
grep -c "'use client'" src/app/\[locale\]/layout.tsx
# Expected: 0

# 8. NEGATIVE — no internal navigation uses a bare anchor
grep -rn '<a href="/' src/app/ src/components/layout/
# Expected: no output. Internal URLs go through <Link>; <a> is for external links only.

# 9. The blob is in exactly the three detail routes the module admits to
grep -rl 'dangerouslySetInnerHTML' src/app/ | sort
# Expected, and nothing else:
#   src/app/[locale]/blog/[slug]/page.tsx
#   src/app/[locale]/incidents/[slug]/page.tsx
#   src/app/[locale]/reviews/[slug]/page.tsx

# 10. Gates stay green
npm run type-check && npm run lint
# Expected: no output from either
```

Check 9 is the one to keep. Module 14 opens by running exactly that grep and treating each hit as
work to remove; three files is the number it expects.

## Control Questions

1. `NavLink` is a Client Component and `layout.tsx` is not, yet the nav renders inside the layout.
   Explain which parts of that nav exist only on the server, which cross to the browser, and what
   would change if you moved `usePathname()` up into the layout.
2. `generateStaticParams` returns 40 incident slugs, and the build still marks the route
   `ƒ (Dynamic)`. Explain why, name the module README debt responsible, and say what Lesson 10.3
   changes to make the same function produce prerendered pages.
3. `dynamicParams` defaults to `true`. Describe what an editor publishing a new incident sees today,
   and what they would see if you set it to `false` — and say which behaviour you would want on a
   site whose content changes hourly.
4. `pros` arrives as `[{ item: "…" }]` rather than `["…"]`. Trace that shape back to a decision in
   appendix 03 §4.3, then name the three separate places a `null` can appear in that value and what
   each one means editorially.
5. This lesson wrote the same `fetch` helper four more times, in three different shapes. Name the
   specific bug class that duplication invites when the WordPress endpoint changes, and the second
   one it invites when a query starts returning `errors` in production.

## Learn More

- [`<Link>`](https://nextjs.org/docs/app/api-reference/components/link) — the `prefetch` prop and
  the scroll behaviour, both of which surprise people once
- [Linking and navigating](https://nextjs.org/docs/app/getting-started/linking-and-navigating) —
  Next's own account of what happens between the click and the paint
- [`generateStaticParams`](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)
  — including the multiple-dynamic-segment case in Key Concept 3
- [`dynamicParams`](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
  — the route segment config page; read `dynamic` and `revalidate` too, because Lesson 10.3 uses them
- [`usePathname`](https://nextjs.org/docs/app/api-reference/functions/use-pathname) — one hook, and
  the reason a nav is an island
- [`aria-current`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-current)
  — how to say "you are here" without relying on colour, which Module 22 audits
- [WPGraphQL: connections and where arguments](https://www.wpgraphql.com/docs/connections/) — the
  `orderby: COUNT` and `hideEmpty` arguments the leaderboard depends on
- [SCF repeater field](https://www.advancedcustomfields.com/resources/repeater/) — the field type
  behind Key Concept 7, and why its rows are objects
