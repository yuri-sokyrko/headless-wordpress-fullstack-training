// A Server Component. 404 is traffic, not an error — nothing is logged here.
import Link from 'next/link';

const LOCALE = process.env.NEXT_PUBLIC_LOCALE ?? 'en';

export default function NotFound() {
  return (
    <main>
      <h1>No such incident.</h1>
      <p>Nobody has been blamed for this URL yer. You could be the first.</p>
      <Link href={`/${LOCALE}/incidents`}>Back to the incident log</Link>
    </main>
  );
}
