import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The alias tsconfig.json declares in `paths`. `paths` is a TYPE-CHECKER
    // instruction — it tells tsc where to look and changes no runtime. Next reads
    // it for the app; Vitest has to be told separately. Key Concept 5.
    //
    // Declared by hand rather than with vite-tsconfig-paths: one fewer dependency,
    // and the same choice Lesson 08.1 made in scratch/vite.config.ts.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  esbuild: {
    // tsconfig.json says `jsx: "preserve"` (Lesson 09.1) because NEXT compiles JSX.
    // There is no Next compiler in a Vitest run, so the test transform needs the
    // automatic runtime — otherwise importing IncidentList.tsx in Step 6 fails with a
    // syntax error on the first `<`. Same principle as the alias above: one truth,
    // stated once per tool.
    jsx: 'automatic',
  },

  test: {
    // No DOM. Every function tested here is pure, and jsdom is a lie about a
    // browser — Key Concept 6. Component tests arrive in Lesson 23.2.
    environment: 'node',

    // COLOCATED and narrow. The default include is
    // `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which would collect Lesson 12.3's
    // e2e/smoke.spec.ts and blow up on Playwright's `test` import. Key Concept 4.
    include: ['src/**/*.test.ts'],

    // Overriding `exclude` REPLACES Vitest's defaults rather than extending them,
    // so node_modules has to be restated. e2e/ is the one that matters.
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],

    coverage: {
      provider: 'v8',

      // `text` for the terminal, `html` for coverage/index.html — the clickable
      // report where you read which BRANCH was never taken.
      reporter: ['text', 'html'],

      // Explicit, because tests are colocated: without an `include`, coverage
      // reports on src/gql/ (generated, 12k lines, 0%) and drowns the signal.
      // Lesson 23.2 widens this when component tests exist.
      include: [
        'src/lib/**/*.ts',
        'src/types/**/*.ts',
        'src/components/layout/nav.ts',
        'src/components/incidents/*.ts',
      ],
      exclude: ['**/*.test.ts'],

      // NO thresholds. Deliberate, and argued in Step 8: a number attached
      // before anyone has read the report is a number
      // people learn to game. Lesson 23.1 sets the policy; Lesson 24.5 gates it,
      // on the patch rather than the total.
    },
  },
});
