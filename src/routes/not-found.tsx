export function head() {
  return {
    title: "Page not found",
    meta: [{ content: "noindex", name: "robots" }],
  };
}

export function Component() {
  return (
    <section class="w-full max-w-3xl">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        404
      </p>
      <h1 class="mt-2 text-3xl font-bold tracking-tight">Page not found</h1>
      <p class="mt-2 text-zinc-600">
        The page you asked for does not exist. It may have moved, or the link
        may be wrong.
      </p>
      <p class="mt-6">
        <a class="underline underline-offset-4" href="/">
          Back to home
        </a>
      </p>
    </section>
  );
}
