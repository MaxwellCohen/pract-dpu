type SkeletonProps = {
  label: string;
  class?: string;
};

export function Skeleton({ label, class: className = "" }: SkeletonProps) {
  return (
    <div
      class={`animate-pulse rounded-md border border-dashed border-zinc-300 bg-zinc-100 px-4 py-6 text-sm text-zinc-500 ${className}`}
    >
      Loading {label}…
    </div>
  );
}
