// Generated output lands in src/gql/ and is NEVER hand-edited.
// Regenerate with `npm run codegen`. Verify with `npm run codegen:check`.
// Refresh the schema itself with `npm run schema:pull` — a deliberate, reviewed action.
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,

  // A FILE, not an endpoint. WordPress owns the schema, so the snapshot lives with
  // WordPress; this reaches across the repository. There is no schema.graphql under
  // next-app/, and CI therefore needs no WordPress, no database and no credential.
  schema: '../wordpress-headless/schema.graphql',

  // Both document styles are scanned: .graphql files (this course's choice) and
  // graphql() calls inside TS/TSX. The negation stops codegen reading its own output.
  documents: ['src/**/*.graphql', 'src/**/*.{ts,tsx}', '!src/gql/**/*'],

  // The first run happens before any document exists. Without this it exits non-zero.
  ignoreNoDocuments: true,

  generates: {
    './src/gql/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
    },
  },

  config: {
    // `verbatimModuleSyntax` has been on since Lesson 07.3: a type-only import must
    // say so, or it survives into the emitted JavaScript.
    useTypeImports: true,
  },
};

export default config;
