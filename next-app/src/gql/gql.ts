/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "fragment IncidentCardFields on Incident {\n  id\n  title\n  slug\n  date\n  severities(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  scapegoats(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  incidentDetails {\n    downtimeMinutes\n    environment\n  }\n}": typeof types.IncidentCardFieldsFragmentDoc,
    "fragment IncidentDetailFields on Incident {\n  ...IncidentCardFields\n  content\n  incidentDetails {\n    occurredAt\n    estimatedCostUsd\n    resolutionStatus\n    blameConfidence\n    stackTrace\n    reporterDisplayName\n    isVerified\n  }\n}": typeof types.IncidentDetailFieldsFragmentDoc,
    "fragment MediaFields on MediaItem {\n  id\n  altText\n  sourceUrl\n  mediaDetails {\n    width\n    height\n  }\n}": typeof types.MediaFieldsFragmentDoc,
    "fragment PostCardFields on Post {\n  id\n  title\n  slug\n  date\n  excerpt\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n}": typeof types.PostCardFieldsFragmentDoc,
    "fragment TechReviewCardFields on TechReview {\n  id\n  title\n  slug\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n  techReviewFields {\n    companyName\n    ratingOverall\n    verdict\n  }\n}": typeof types.TechReviewCardFieldsFragmentDoc,
    "query IncidentsList($first: Int!, $after: String, $search: String) {\n  incidents(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, search: $search, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}\n\nquery IncidentBySlug($slug: ID!) {\n  incident(id: $slug, idType: SLUG) {\n    ...IncidentDetailFields\n  }\n}\n\nquery IncidentSlugs($first: Int!) {\n  incidents(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}\n\nquery HomepageFeeds($featuredCount: Int!, $recentCount: Int!) {\n  catastrophic: incidents(\n    first: $featuredCount\n    where: {status: PUBLISH, severityIn: [\"s1-catastrophic\"]}\n  ) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n  recent: incidents(first: $recentCount, where: {status: PUBLISH}) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}": typeof types.IncidentsListDocument,
    "query PostsList($first: Int!, $after: String) {\n  posts(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...PostCardFields\n    }\n  }\n}\n\nquery PostBySlug($slug: ID!) {\n  post(id: $slug, idType: SLUG) {\n    ...PostCardFields\n    content\n  }\n}\n\nquery PostsSlug($first: Int!) {\n  posts(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}": typeof types.PostsListDocument,
    "query ReviewsList($first: Int!, $after: String) {\n  techReviews(first: $first, after: $after, where: {status: PUBLISH}) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...TechReviewCardFields\n    }\n  }\n}\n\nquery ReviewBySlug($slug: ID!) {\n  techReview(id: $slug, idType: SLUG) {\n    ...TechReviewCardFields\n    content\n    techReviewFields {\n      ratingDx\n      ratingDocs\n      ratingIncidentResponse\n      reviewedAt\n      pros {\n        item\n      }\n      cons {\n        item\n      }\n    }\n  }\n}\n\nquery ReviewSlugs($first: Int!) {\n  techReviews(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}": typeof types.ReviewsListDocument,
    "query ScapegoatLeaderboard($first: Int!) {\n  scapegoats(\n    first: $first\n    where: {orderby: COUNT, order: DESC, hideEmpty: false}\n  ) {\n    nodes {\n      id\n      name\n      slug\n      count\n      scapegoatProfile {\n        tagline\n        defensiveness\n      }\n    }\n  }\n}": typeof types.ScapegoatLeaderboardDocument,
    "query SiteChrome {\n  generalSettings {\n    title\n    description\n  }\n  siteSettings {\n    siteChrome {\n      siteTagline\n      primaryCtaLabel\n      primaryCtaUrl\n      incidentSubmissionOpen\n      footerBlurb\n      socialLinks {\n        network\n        url\n      }\n    }\n  }\n}": typeof types.SiteChromeDocument,
};
const documents: Documents = {
    "fragment IncidentCardFields on Incident {\n  id\n  title\n  slug\n  date\n  severities(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  scapegoats(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  incidentDetails {\n    downtimeMinutes\n    environment\n  }\n}": types.IncidentCardFieldsFragmentDoc,
    "fragment IncidentDetailFields on Incident {\n  ...IncidentCardFields\n  content\n  incidentDetails {\n    occurredAt\n    estimatedCostUsd\n    resolutionStatus\n    blameConfidence\n    stackTrace\n    reporterDisplayName\n    isVerified\n  }\n}": types.IncidentDetailFieldsFragmentDoc,
    "fragment MediaFields on MediaItem {\n  id\n  altText\n  sourceUrl\n  mediaDetails {\n    width\n    height\n  }\n}": types.MediaFieldsFragmentDoc,
    "fragment PostCardFields on Post {\n  id\n  title\n  slug\n  date\n  excerpt\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n}": types.PostCardFieldsFragmentDoc,
    "fragment TechReviewCardFields on TechReview {\n  id\n  title\n  slug\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n  techReviewFields {\n    companyName\n    ratingOverall\n    verdict\n  }\n}": types.TechReviewCardFieldsFragmentDoc,
    "query IncidentsList($first: Int!, $after: String, $search: String) {\n  incidents(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, search: $search, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}\n\nquery IncidentBySlug($slug: ID!) {\n  incident(id: $slug, idType: SLUG) {\n    ...IncidentDetailFields\n  }\n}\n\nquery IncidentSlugs($first: Int!) {\n  incidents(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}\n\nquery HomepageFeeds($featuredCount: Int!, $recentCount: Int!) {\n  catastrophic: incidents(\n    first: $featuredCount\n    where: {status: PUBLISH, severityIn: [\"s1-catastrophic\"]}\n  ) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n  recent: incidents(first: $recentCount, where: {status: PUBLISH}) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}": types.IncidentsListDocument,
    "query PostsList($first: Int!, $after: String) {\n  posts(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...PostCardFields\n    }\n  }\n}\n\nquery PostBySlug($slug: ID!) {\n  post(id: $slug, idType: SLUG) {\n    ...PostCardFields\n    content\n  }\n}\n\nquery PostsSlug($first: Int!) {\n  posts(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}": types.PostsListDocument,
    "query ReviewsList($first: Int!, $after: String) {\n  techReviews(first: $first, after: $after, where: {status: PUBLISH}) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...TechReviewCardFields\n    }\n  }\n}\n\nquery ReviewBySlug($slug: ID!) {\n  techReview(id: $slug, idType: SLUG) {\n    ...TechReviewCardFields\n    content\n    techReviewFields {\n      ratingDx\n      ratingDocs\n      ratingIncidentResponse\n      reviewedAt\n      pros {\n        item\n      }\n      cons {\n        item\n      }\n    }\n  }\n}\n\nquery ReviewSlugs($first: Int!) {\n  techReviews(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}": types.ReviewsListDocument,
    "query ScapegoatLeaderboard($first: Int!) {\n  scapegoats(\n    first: $first\n    where: {orderby: COUNT, order: DESC, hideEmpty: false}\n  ) {\n    nodes {\n      id\n      name\n      slug\n      count\n      scapegoatProfile {\n        tagline\n        defensiveness\n      }\n    }\n  }\n}": types.ScapegoatLeaderboardDocument,
    "query SiteChrome {\n  generalSettings {\n    title\n    description\n  }\n  siteSettings {\n    siteChrome {\n      siteTagline\n      primaryCtaLabel\n      primaryCtaUrl\n      incidentSubmissionOpen\n      footerBlurb\n      socialLinks {\n        network\n        url\n      }\n    }\n  }\n}": types.SiteChromeDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment IncidentCardFields on Incident {\n  id\n  title\n  slug\n  date\n  severities(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  scapegoats(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  incidentDetails {\n    downtimeMinutes\n    environment\n  }\n}"): (typeof documents)["fragment IncidentCardFields on Incident {\n  id\n  title\n  slug\n  date\n  severities(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  scapegoats(first: 1) {\n    nodes {\n      name\n      slug\n    }\n  }\n  incidentDetails {\n    downtimeMinutes\n    environment\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment IncidentDetailFields on Incident {\n  ...IncidentCardFields\n  content\n  incidentDetails {\n    occurredAt\n    estimatedCostUsd\n    resolutionStatus\n    blameConfidence\n    stackTrace\n    reporterDisplayName\n    isVerified\n  }\n}"): (typeof documents)["fragment IncidentDetailFields on Incident {\n  ...IncidentCardFields\n  content\n  incidentDetails {\n    occurredAt\n    estimatedCostUsd\n    resolutionStatus\n    blameConfidence\n    stackTrace\n    reporterDisplayName\n    isVerified\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment MediaFields on MediaItem {\n  id\n  altText\n  sourceUrl\n  mediaDetails {\n    width\n    height\n  }\n}"): (typeof documents)["fragment MediaFields on MediaItem {\n  id\n  altText\n  sourceUrl\n  mediaDetails {\n    width\n    height\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment PostCardFields on Post {\n  id\n  title\n  slug\n  date\n  excerpt\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n}"): (typeof documents)["fragment PostCardFields on Post {\n  id\n  title\n  slug\n  date\n  excerpt\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment TechReviewCardFields on TechReview {\n  id\n  title\n  slug\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n  techReviewFields {\n    companyName\n    ratingOverall\n    verdict\n  }\n}"): (typeof documents)["fragment TechReviewCardFields on TechReview {\n  id\n  title\n  slug\n  featuredImage {\n    node {\n      ...MediaFields\n    }\n  }\n  techReviewFields {\n    companyName\n    ratingOverall\n    verdict\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query IncidentsList($first: Int!, $after: String, $search: String) {\n  incidents(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, search: $search, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}\n\nquery IncidentBySlug($slug: ID!) {\n  incident(id: $slug, idType: SLUG) {\n    ...IncidentDetailFields\n  }\n}\n\nquery IncidentSlugs($first: Int!) {\n  incidents(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}\n\nquery HomepageFeeds($featuredCount: Int!, $recentCount: Int!) {\n  catastrophic: incidents(\n    first: $featuredCount\n    where: {status: PUBLISH, severityIn: [\"s1-catastrophic\"]}\n  ) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n  recent: incidents(first: $recentCount, where: {status: PUBLISH}) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}"): (typeof documents)["query IncidentsList($first: Int!, $after: String, $search: String) {\n  incidents(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, search: $search, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}\n\nquery IncidentBySlug($slug: ID!) {\n  incident(id: $slug, idType: SLUG) {\n    ...IncidentDetailFields\n  }\n}\n\nquery IncidentSlugs($first: Int!) {\n  incidents(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}\n\nquery HomepageFeeds($featuredCount: Int!, $recentCount: Int!) {\n  catastrophic: incidents(\n    first: $featuredCount\n    where: {status: PUBLISH, severityIn: [\"s1-catastrophic\"]}\n  ) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n  recent: incidents(first: $recentCount, where: {status: PUBLISH}) {\n    nodes {\n      ...IncidentCardFields\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query PostsList($first: Int!, $after: String) {\n  posts(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...PostCardFields\n    }\n  }\n}\n\nquery PostBySlug($slug: ID!) {\n  post(id: $slug, idType: SLUG) {\n    ...PostCardFields\n    content\n  }\n}\n\nquery PostsSlug($first: Int!) {\n  posts(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}"): (typeof documents)["query PostsList($first: Int!, $after: String) {\n  posts(\n    first: $first\n    after: $after\n    where: {status: PUBLISH, orderby: {field: DATE, order: DESC}}\n  ) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...PostCardFields\n    }\n  }\n}\n\nquery PostBySlug($slug: ID!) {\n  post(id: $slug, idType: SLUG) {\n    ...PostCardFields\n    content\n  }\n}\n\nquery PostsSlug($first: Int!) {\n  posts(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ReviewsList($first: Int!, $after: String) {\n  techReviews(first: $first, after: $after, where: {status: PUBLISH}) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...TechReviewCardFields\n    }\n  }\n}\n\nquery ReviewBySlug($slug: ID!) {\n  techReview(id: $slug, idType: SLUG) {\n    ...TechReviewCardFields\n    content\n    techReviewFields {\n      ratingDx\n      ratingDocs\n      ratingIncidentResponse\n      reviewedAt\n      pros {\n        item\n      }\n      cons {\n        item\n      }\n    }\n  }\n}\n\nquery ReviewSlugs($first: Int!) {\n  techReviews(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}"): (typeof documents)["query ReviewsList($first: Int!, $after: String) {\n  techReviews(first: $first, after: $after, where: {status: PUBLISH}) {\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n    nodes {\n      ...TechReviewCardFields\n    }\n  }\n}\n\nquery ReviewBySlug($slug: ID!) {\n  techReview(id: $slug, idType: SLUG) {\n    ...TechReviewCardFields\n    content\n    techReviewFields {\n      ratingDx\n      ratingDocs\n      ratingIncidentResponse\n      reviewedAt\n      pros {\n        item\n      }\n      cons {\n        item\n      }\n    }\n  }\n}\n\nquery ReviewSlugs($first: Int!) {\n  techReviews(first: $first, where: {status: PUBLISH}) {\n    nodes {\n      slug\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ScapegoatLeaderboard($first: Int!) {\n  scapegoats(\n    first: $first\n    where: {orderby: COUNT, order: DESC, hideEmpty: false}\n  ) {\n    nodes {\n      id\n      name\n      slug\n      count\n      scapegoatProfile {\n        tagline\n        defensiveness\n      }\n    }\n  }\n}"): (typeof documents)["query ScapegoatLeaderboard($first: Int!) {\n  scapegoats(\n    first: $first\n    where: {orderby: COUNT, order: DESC, hideEmpty: false}\n  ) {\n    nodes {\n      id\n      name\n      slug\n      count\n      scapegoatProfile {\n        tagline\n        defensiveness\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query SiteChrome {\n  generalSettings {\n    title\n    description\n  }\n  siteSettings {\n    siteChrome {\n      siteTagline\n      primaryCtaLabel\n      primaryCtaUrl\n      incidentSubmissionOpen\n      footerBlurb\n      socialLinks {\n        network\n        url\n      }\n    }\n  }\n}"): (typeof documents)["query SiteChrome {\n  generalSettings {\n    title\n    description\n  }\n  siteSettings {\n    siteChrome {\n      siteTagline\n      primaryCtaLabel\n      primaryCtaUrl\n      incidentSubmissionOpen\n      footerBlurb\n      socialLinks {\n        network\n        url\n      }\n    }\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;