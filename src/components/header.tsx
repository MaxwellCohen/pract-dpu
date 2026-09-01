import { Link } from "@pracht/core";

const links = [
  { route: "home", label: "Home" },
  { route: "basic", label: "Basic" },
  { route: "parallel", label: "Parallel" },
  { route: "nested", label: "Nested" },
  { route: "out-of-order", label: "Out of order" },
  { route: "edge-cases", label: "Edge cases" },
] as const;

export function Header() {
  return (
    <header class="border-b border-zinc-200 bg-white/90 px-6 py-4 backdrop-blur lg:sticky lg:top-0 lg:z-10">
      <div class="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 class="text-lg font-bold tracking-tight">
          <Link route="home">Preact · streaming / DPU</Link>
        </h2>
        <nav class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.route}
              route={link.route}
              class="text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
