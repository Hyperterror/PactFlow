import { Card, Skeleton, SkeletonList } from "@/components/ui";

/**
 * Requirement 4.7/8.6 — every dashboard route renders inside this boundary while
 * its data loads, so a slow query shows structure instead of a blank frame.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Card key={index} className="px-4 py-3">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-12" />
            </div>
          </Card>
        ))}
      </div>

      <SkeletonList items={3} />
      <p className="sr-only">Loading</p>
    </div>
  );
}
