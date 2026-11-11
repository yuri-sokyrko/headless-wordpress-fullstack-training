// FaustProvider mounts Apollo, the auth context and Faust's own toolbar.
// There is no App Router version of this file — a provider at the root of the
// tree is exactly the pattern Server Components exist to avoid.
import { FaustProvider } from "@faustwp/core";
import "@faustwp/core/dist/css/toolbar.css";

import "../faust.config";

export default function MyApp({ Component, pageProps }) {
  return (
    <FaustProvider pageProps={pageProps}>
      <Component {...pageProps} />
    </FaustProvider>
  );
}
