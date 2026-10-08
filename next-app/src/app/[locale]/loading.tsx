// Next wraps this segment's page in <Suspense fallback={<Loading />}>. That is all it is.
// Lesson 11.2 replaces the placeholder with the shadcn `skeleton` component, and Module
// 22 reviews the aria attributes.
export default function Loading() {
  return (
    <main aria-busy="true">
      <p>Collating blame...</p>
    </main>
  );
}
