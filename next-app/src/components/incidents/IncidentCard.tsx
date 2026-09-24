// One incident, hard-coded, so this lesson is about JSX and nothing else.
// Lesson 08.2 gives it a typed `incident` prop and narrows its field set to
// match one GraphQL fragment, at which point the <pre> below moves out.
//
// Content: incident-01 from `wp blame seed` — see appendix 03 §9.
export function IncidentCard() {
  return (
    <article className="incident-card">
      <h2>Deployed on a Friday (#1)</h2>

      {/* A machine-readable timestamp plus a human one. dateTime, not datetime:
          the compiler emits an object literal, so the property is camelCase. */}
      <p>
        Reported <time dateTime="2024-09-02T11:00:00">2 September 2024</time>
      </p>

      <p className="incident-card__severity">S1 — Catastrophic</p>

      <dl>
        <dt>Blamed on</dt>
        <dd>The Intern</dd>

        <dt>Downtime</dt>
        <dd>5 min</dd>

        <dt>Estimated cost</dt>
        <dd>$0</dd>

        <dt>Environment</dt>
        <dd>PRODUCTION</dd>
      </dl>

      {/* Escaped, per appendix 03 §4.1. A stack trace is attacker-supplied text
          from Module 16 onward, and there is no escaper to remember here: the
          braces make it text. Never dangerouslySetInnerHTML on this field. */}
      <pre>
        {`Traceback (most recent call last):
  File "app/handler.php", line 40
  RuntimeException: Deployed on a Friday`}
      </pre>
    </article>
  );
}
