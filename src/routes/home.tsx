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
  {
    route: "edge-cases",
    title: "Edge cases",
    body: "Popcorning plus HTML, SVG, MathML, and streamed styles — live stream beside the expected result.",
  },
] as const;

export function head() {
  return { title: "Preact · streaming / DPU" };
}

export function Component() {
  return (
    <div class="w-full max-w-3xl">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Preact · Pracht
      </p>
      <h1 class="mt-2 text-4xl font-bold tracking-tight">
        Streaming playground for DPU
      </h1>
      <p class="mt-3 max-w-2xl text-zinc-600">
        Pages use plain <code class="text-sm">&lt;Suspense&gt;</code> + thrown
        promises so the HTML stream flushes fallbacks, then patches in resolved
        UI. Today that patch is stock{" "}
        <code class="text-sm">&lt;preact-island&gt;</code>; this app exists to
        swap that path for{" "}
        <a
          class="underline underline-offset-2"
          href="https://developer.chrome.com/blog/declarative-partial-updates"
        >
          Declarative Partial Updates
        </a>
        .
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
