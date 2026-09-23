// The blame leaderboard, straight out of WPGraphQL. Plain ESM, zero dependencies.
//   export export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql && npm run blame
// The endpoint is never hard-coded: it differs per environment, and a URL frozen into a
// commited file is on habit away from a credential frozen into a committed file.

const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
const limit = Number(process.env.BLAME_LIMIT ?? 10);
const TIMEOUT_MS = 8_000;

const QUERY = /* GrahpQL */ `
  query BlameBoard($first: Int!) {
    incidents(first: $first, where: {orderby: {field: DATE, order: DESC}}) {
      nodes {
        id
        title
        slug
        blameScore
        severities(first: 1) {
          nodes {name slug}
        }
        scapegoats(first: 1) {
          nodes {name slug}
        }
        incidentDetails {
          downtimeMinutes
          environment
        }
      }
    }
  }
`;

// POST one GraphQL operation and return `data`, or throw something a human can act on.
async function fetchGraphQL(query, variables) {
  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      // fetch has NO default timeout. Without this, a wedged WordPress wedges the script.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    // LAYER 1 - getch rejects only for network-level failure: DNS, refused, aborted.
    throw new Error(`cannot reach ${endpoint} within ${TIMEOUT_MS}`, { cause });
  }

  // LAYER 2 — a 4xx/5xx is a RESOLVED promise. fetch does not throw on HTTP status.
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${endpoint}`);
  }

  const body = await response.json();

  // LAYER 3 - GraphQL answers 200 with an `errors` array. This is the check people forget.
  if (body.errors?.length) {
    const detail = body.errors.map((error) => error.message).join('\n - ');
    throw new Error(`GraphQL reported ${body.errors.length} error(s): \n - ${detail}`);
  }

  if (!body.data) {
    throw new Error('the response contained neither `data` nor `errors`');
  }

  return body.data;
}

// One GraphQL node into one flat row: destructuring, optional chaining and `??`.
function toRow(node) {
  const { title, slug, blameScore, incidentDetails } = node;

  return {
    title,
    slug,
    blame: Math.round(blameScore ?? 0),
    severity: node.severities?.nodes?.[0]?.slug ?? 'unclassified',
    scapegoat: node.scapegoats?.nodes?.[0]?.name ?? 'nobody yet',
    minutes: incidentDetails?.downtimeMinutes ?? 0,
    environment: incidentDetails?.environment ?? 'UNKNOWN',
  };
}

const COLUMNS = [
  { key: 'blame', label: 'BLAME', width: 6 },
  { key: 'severity', label: 'SEVERITY', width: 17 },
  { key: 'minutes', label: 'MIN', width: 5 },
  { key: 'scapegoat', label: 'SCAPEGOAT', width: 22 },
  { key: 'title', label: 'INCIDENT', width: 42 },
];

function cell(value, width) {
  const text = String(value);
  return text.length > width ? `${text.slice(0, width - 3)}...` : text.padEnd(width);
}

function renderTable(rows) {
  const header = COLUMNS.map(({ label, width }) => cell(label, width)).join(' ');
  const rule = COLUMNS.map(({ width }) => '─'.repeat(width)).join(' ');
  const body = rows.map((row) => COLUMNS.map(({ key, width }) => cell(row[key], width)).join(' '));

  return [header, rule, ...body].join('\n');
}

async function main() {
  if (!endpoint) {
    throw new Error(
      'WP_GRAPHQL_ENDPOINT is not set.\n' +
        '  export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql'
    );
  }

  const data = await fetchGraphQL(QUERY, { first: limit });
  const rows = (data.incidents?.nodes ?? []).map(toRow).sort((a, b) => b.blame - a.blame);

  // An empty array is TRUTHY — `if (!rows)` would never fire. Key Concept 8.
  if (rows.length === 0) {
    console.log('No incidents found. Seed the site, then try again:');
    console.log('  docker compose run --rm wpcli wp blame seed --fresh');

    return;
  }

  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
  const catastrophic = rows.filter((row) => row.severity === 's1-catastrophic');
  const [worst] = rows;

  console.log(`\nBlame board — the ${rows.length} most recent incidents\n`);
  console.log(renderTable(rows));
  console.log(
    `\n${rows.length} incidents · ${totalMinutes} minutes of downtime · ` +
      `${catastrophic.length} catastrophic · top scapegoat: ${worst.scapegoat}\n`
  );
}

try {
  await main();
} catch (error) {
  console.error(`\n blame: ${error.message}`);

  if (error.cause) {
    console.error(`  cause: ${error.cause.message}`);
  }
  // `exitCode`, not `exit(1)`: this lets buffered output flush before the process ends.
  process.exitCode = 1;
}
