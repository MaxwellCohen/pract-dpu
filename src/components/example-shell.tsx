import type { ComponentChildren } from "preact";

type ExampleShellProps = {
  title: string;
  description: string;
  children: ComponentChildren;
};

export function ExampleShell({
  title,
  description,
  children,
}: ExampleShellProps) {
  return (
    <div class="w-full max-w-3xl">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Suspense streaming
      </p>
      <h1 class="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
      <p class="mt-2 max-w-2xl text-zinc-600">{description}</p>
      <div class="mt-8 space-y-4">{children}</div>
    </div>
  );
}
