import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

export function PropertyCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(className)} data-testid="listing-card-skeleton">
      <Skeleton className="aspect-[4/3] w-full rounded-xl" />
      <div className="space-y-2 px-0.5 pt-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="flex justify-between pt-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
    </div>
  );
}
