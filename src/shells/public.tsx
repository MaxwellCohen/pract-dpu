import type { ShellProps } from "@pracht/core";
import { DpuSupportBanner } from "../components/dpu-support";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { NoJsToggle } from "../components/no-js-toggle";
import "../styles/global.css";

export function Shell({ children }: ShellProps) {
  return (
    <div class="min-h-svh bg-zinc-50 font-['Nunito'] text-zinc-900">
      <Header />
      <div class="mx-auto flex max-w-5xl flex-col gap-4 px-6 pt-6">
        <NoJsToggle />
        <DpuSupportBanner />
      </div>
      <main class="mx-auto max-w-5xl px-6 py-10">{children}</main>
      <Footer />
    </div>
  );
}

export function head() {
  return {
    title: "Preact · streaming / DPU",
    meta: [
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      {
        name: "description",
        content:
          "Preact Suspense HTML streaming playground for Declarative Partial Updates experiments",
      },
    ],
    link: [
      { rel: "icon", type: "image/png", href: "/images/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,400;0,700;1,400;1,700&display=swap",
      },
    ],
  };
}
