import { Link } from "@pracht/core";

const examples = [
  {
    route: "basic",
    title: "Basic boundary",
    body: "One Suspense boundary around a slow panel. Shell paints first; content streams in.",
  },
  {
    route: "parallel",
    title: "Parallel boundaries",
    body: "Sibling Suspense boundaries fetch independently and fill in as each promise resolves.",
  },
  {
    route: "nested",
    title: "Nested boundaries",
    body: "Outer shell streams, then inner content streams inside the already-revealed parent.",
  },
  {
    route: "out-of-order",
    title: "Out-of-order reveal",
    body: "Fast panel finishes after a slow one starts — HTML can stream completed sections as they ready.",
  },
] as const;

export function head() {
  return { title: "Preact · Suspense streaming" };
}

export function Component() {
  return (
    <div class="w-full max-w-3xl">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Preact · Pracht
      </p>
      <h1 class="mt-2 text-4xl font-bold tracking-tight">
        Suspense streaming examples
      </h1>
      <p class="mt-3 max-w-2xl text-zinc-600">
        Each page uses <code class="text-sm">render: &apos;ssr&apos;</code> and
        panels inside <code class="text-sm">&lt;Suspense&gt;</code> so the HTML
        stream can flush fallbacks, then patch in resolved UI via stock Preact
        streaming (<code class="text-sm">&lt;preact-island&gt;</code>).
      </p>

      <ul class="mt-10 divide-y divide-zinc-200 border-y border-zinc-200">
        {examples.map((example) => (
          <li key={example.route}>
            <Link
              route={example.route}
              class="block py-5 transition-colors hover:bg-white"
            >
              <span class="text-lg font-bold tracking-tight underline-offset-4">
                {example.title}
              </span>
              <span class="mt-1 block text-sm text-zinc-600">
                {example.body}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
