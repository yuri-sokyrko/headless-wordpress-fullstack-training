// A page that renders only for an authenticated WordPress user — Faust's layer
// three. Compare with next-app/src/app/[locale]/account/, which is guarded by
// proxy AND by requireSession() on the server.
//
// NOTE what is missing: getStaticProps, getServerSideProps, and any server-side
// check at all. The gate is `useAuth`, and useAuth runs in a browser. That is
// the measurement in Step 4, not an accident of how this page was written —
// there is no server-side hook to use.
import { useAuth } from "@faustwp/core";

export default function ProtectedPage() {
  const { isAuthenticated, isReady, loginUrl } = useAuth();

  if (!isReady) {
    // Every visitor — authenticated, anonymous, and curl — receives THIS.
    return <p>Loading faust auth state...</p>;
  }

  if (isAuthenticated !== true) {
    return (
      <p>
        Not signed in. <a href={loginUrl}>Sign in through WordPress</a>
      </p>
    );
  }

  return (
    <main>
      <h1>Faust protected page</h1>
      <p>You are signed in to WordPress. Faust resolved this in the browser.</p>
    </main>
  );
}
