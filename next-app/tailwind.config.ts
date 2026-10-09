// This file exists for ONE reason: @tailwindcss/typography reads its configuration
// from the `typography` theme key, and that key is a nested CSS-in-JS object with no
// CSS at-rule equivalent. Everything else in this project's design system lives in
// src/app/[locale]/globals.css. Loaded from there with `@config`.
//
// Deliberately NOT typed with `satisfies Config`: Tailwind's exported Config type
// still requires the v3 `content` key, and adding `content: []` here to satisfy a
// type would be a lie about how source files are detected. A plain object is what
// `@config` needs.
export default {
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            // Drive prose colours from the same tokens as the rest of the app,
            // so a dark-mode switch does not need a second palette.
            '--tw-prose-body': 'var(--foreground)',
            '--tw-prose-headings': 'var(--foreground)',
            '--tw-prose-links': 'var(--primary)',
            '--tw-prose-bold': 'var(--foreground)',
            '--tw-prose-quotes': 'var(--muted-foreground)',
            '--tw-prose-quote-borders': 'var(--border)',
            '--tw-prose-code': 'var(--foreground)',
            '--tw-prose-hr': 'var(--border)',
            maxWidth: '68ch',
            // The plugin wraps inline <code> in typographic quotes by default.
            // WordPress content is full of inline code and it looks wrong.
            'code::before': { content: '""' },
            'code::after': { content: '""' },
          },
        },
      },
    },
  },
};
