// The last-resort template — Faust's index.php. It exists so the fallback chain
// terminates, and Lesson 17.3 uses it to prove the chain works.
export default function IndexTemplate(props) {
  return (
    <main>
      <p>Faust fell back to the index template.</p>
      <p>Node type: {props?.data?.nodeByUri?.__typename ?? "unknown"}</p>
    </main>
  );
}
