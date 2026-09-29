import { IncidentCard } from '@/components/incidents/IncidentCard';
import { SEED_INCIDENTS } from '@/components/incidents/fixtures';

export default async function HomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <main>
      <h1>Blame The Tech</h1>
      <p>
        Six incidents, rendered from the fixtures you wrote in Lesson 08.2. Locale: {locale}. Lesson
        09.3 replaces this array with live WordPress data.
      </p>

      <ul>
        {SEED_INCIDENTS.map((incident) => (
          <li key={incident.id}>
            <IncidentCard incident={incident} />
          </li>
        ))}
      </ul>
    </main>
  );
}
