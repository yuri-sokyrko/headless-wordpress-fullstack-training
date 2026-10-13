// Next wraps this segment's page in <Suspense fallback={<Loading />}>. That is all it is.
// No aria-busy: with no live region it announces nothing. Skeletons are hidden from AT.
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Six cards, matching the grid from Lesson 11.1 Step 7. A skeleton that
          does not match the real layout causes the layout shift it was meant to
          prevent — Module 21 measures exactly that. */}

        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="border-border rounded-lg border p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-3 h-6 w-full" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
