/**
 * The first focusable element in the document. Must be the first child of
 * <body>, and its href must target a real, focusable element — see Step 4.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      // `focus:`, NOT `focus-visible:`. A skip link must appear for ANY focus,
      // including focus moved programmatically by JavaScript, and
      // :focus-visible does not reliably match a .focus() call. Key Concept 4.
      className="focus:border-border focus:bg-background focus:text-foreground focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:border focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:outline-none"
    >
      Skip to main content
    </a>
  );
}
