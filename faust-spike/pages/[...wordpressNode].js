// THE WHOLE ROUTER. One catch-all file replaces every route file in next-app's
// src/app/[locale]/. WordPress decides which template renders; this file only
// forwards the props the seed query produced. Key Concepts 3 and 4.
import { getWordPressProps, WordPressTemplate } from "@faustwp/core";

export default function Page(props) {
  return <WordPressTemplate {...props} />;
}

// getStaticProps, not an async Server Component. The seed query runs HERE, at
// build time or on the ISR revalidate — and its result is what picks the
// template. There is no place in this signature to attach a cache TAG.
export function getStaticProps(ctx) {
  return getWordPressProps({ ctx, revalidate: 60 });
}

export function getStaticPaths() {
  return { paths: [], fallback: "blocking" };
}
