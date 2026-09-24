// The typed blame board. Same behaviour as blame.mjs, judged before it runs.
//   export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql && npm run blame
import type { BlameBoardData, Block, Incident } from '../src/types/content.ts';

const TIMEOUT_MS = 8_000;

const QUERY = /* GraphQL */ `
  query BlameBoard($first: Int!) {
    incidents(first: $first, where: { orderby: { field: DATE, order: DESC } }) {
      nodes {
        id
        databaseId
        slug
        title
        date
        blameScore
        severities(first: 1) {
          nodes {
            id
            name
            slug
            count
          }
        }
        scapegoats(first: 1) {
          nodes {
            id
            name
            slug
            count
          }
        }
        techStacks(first: 5) {
          nodes {
            id
            name
            slug
            count
          }
        }
        incidentDetails {
          occurredAt
          downtimeMinutes
          estimatedCostUsd
          environment
          resolutionStatus
          blameConfidence
          stackTrace
          reporterDisplayName
          isVerified
        }
      }
    }
  }
`;

/* ── The GraphQL envelope, and a guard for it ────────────────────────── */
type GraphQLBody<TData> = {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
};

// A type predicate: a `true` return tells the compiler what the value is. A claim about
// shape, not validation — Key Concept 3.
function isGraphQLBody<TData>(value: unknown): value is GraphQLBody<TData> {
  return typeof value === 'object' && value !== null && ('data' in value || 'errors' in value);
}

export async function fetchGraphQL<TResult, TVariables extends Record<string, unknown>>(
  query: string,
  variables: TVariables
): Promise<TResult> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;

  if (endpoint === undefined || endpoint === '') {
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Export it, then re-run.');
  }

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(`cannot reach ${endpoint} within ${TIMEOUT_MS} ms`, { cause });
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${endpoint}`);
  }

  // json() is typed `any`. Park it in `unknown` immediately — Key Concept 4.
  const body: unknown = await response.json();

  if (!isGraphQLBody<TResult>(body)) {
    throw new Error('the response was not a GraphQL envelope');
  }

  if (body.errors !== undefined && body.errors.length > 0) {
    throw new Error(`GraphQL reported: ${body.errors.map((e) => e.message).join('; ')}`);
  }

  const data = body.data;

  if (data === undefined || data === null) {
    throw new Error('the response contained neither data nor errors');
  }

  return data;
}

/* ── Two discriminated unions, two exhaustive switches ───────────────── */
type ReportLine =
  | { readonly kind: 'header'; readonly label: string }
  | { readonly kind: 'incident'; readonly incident: Incident }
  | { readonly kind: 'block'; readonly block: Block }
  | { readonly kind: 'total'; readonly count: number; readonly minutes: number }
  | { readonly kind: 'empty'; readonly reason: string };

function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

function renderIncident(incident: Incident): string {
  // noUncheckedIndexedAccess: [0] is possibly undefined, so it has to be guarded.
  const severity = incident.severities.nodes[0]?.slug ?? 'unclassified';
  const scapegoat = incident.scapegoats.nodes[0]?.name ?? 'nobody yet';
  const blame = String(Math.round(incident.blameScore ?? 0)).padStart(5);
  const minutes = String(incident.incidentDetails?.downtimeMinutes ?? 0).padStart(5);

  return `${blame} ${severity.padEnd(17)} ${minutes} ${scapegoat.padEnd(22)} ${incident.title}`;
}

// The Module 14 rehearsal: switch on __typename and let the compiler prove coverage.
function blockSummary(block: Block): string {
  switch (block.__typename) {
    case 'CoreParagraph':
      return `paragraph — ${block.attributes?.content ?? '(empty)'}`;
    case 'BttIncidentCallout':
      return `callout — ${block.attributes?.severity ?? 'unclassified'}`;
    case 'BttBlameQuote':
      return `quote — ${block.attributes?.attribution ?? 'anonymous'}`;
    case 'BttScapegoatPicker':
      return `picker — term #${block.attributes?.termId ?? 0}`;
    case 'BttIncidentTicker':
      return `ticker — ${block.attributes?.count ?? 0} incidents`;
    case 'BttHobtCta':
      return `CTA — ${block.attributes?.label ?? 'Get demo'}`;
    case 'BttTechVerdictCard':
      return `verdict — review ${block.attributes?.reviewSlug ?? '(none)'}`;
    default:
      return assertNever(block);
  }
}

function renderLine(line: ReportLine): string {
  switch (line.kind) {
    case 'header':
      return `\n${line.label}\n${'─'.repeat(72)}`;
    case 'incident':
      return renderIncident(line.incident);
    case 'block':
      return ` ${blockSummary(line.block)}`;
    case 'total':
      return `\n${line.count} incidents · ${line.minutes} minutes of downtime`;
    case 'empty':
      return `No incidents. ${line.reason}`;
    default:
      return assertNever(line);
  }
}

const REHEARSAL: readonly Block[] = [
  { __typename: 'CoreParagraph', clientId: 'a', parentClientId: null, attributes: null },
  { __typename: 'BttHobtCta', clientId: 'b', parentClientId: 'a', attributes: { label: 'Demo' } },
];

async function main(): Promise<void> {
  const limit = Number(process.env.BLAME_LIMIT ?? 10);
  const data = await fetchGraphQL<BlameBoardData, { first: number }>(QUERY, { first: limit });

  // `readonly` forbids sorting in place, so copy first. The compiler insisted.
  const incidents = [...(data.incidents?.nodes ?? [])].sort(
    (a, b) => (b.blameScore ?? 0) - (a.blameScore ?? 0)
  );
  const minutes = incidents.reduce(
    (sum, incident) => sum + (incident.incidentDetails?.downtimeMinutes ?? 0),
    0
  );

  const lines: ReportLine[] =
    incidents.length === 0
      ? [{ kind: 'empty', reason: 'Seed the site with the wpcli service, then re-run.' }]
      : [
          { kind: 'header', label: `Blame board — ${incidents.length} most recent incidents` },
          ...incidents.map((incident): ReportLine => ({ kind: 'incident', incident })),
          { kind: 'total', count: incidents.length, minutes },
        ];

  if (process.argv.includes('--blocks')) {
    lines.push({ kind: 'header', label: 'Block renderer rehearsal (Module 14)' });
    lines.push(...REHEARSAL.map((block): ReportLine => ({ kind: 'block', block })));
  }

  console.log(lines.map(renderLine).join('\n'));
}

try {
  await main();
} catch (error) {
  // `catch` gives you `unknown` — useUnknownInCatchVariables. Anything can be thrown.
  console.error(`\nblame: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
