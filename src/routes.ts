import { defineApp, group, route } from "@pracht/core";

export const app = defineApp({
  shells: {
    public: "./shells/public.tsx",
  },
  middleware: {
    "no-js": "./middleware/no-js.ts",
  },

  routes: [
    group(
      {
        middleware: ["no-js"],
        shell: "public",
        render: "ssr",
      },
      [
        route("/", "./routes/home.tsx", { id: "home" }),
        route("/basic", "./routes/basic.tsx", { id: "basic" }),
        route("/parallel", "./routes/parallel.tsx", { id: "parallel" }),
        route("/nested", "./routes/nested.tsx", { id: "nested" }),
        route("/out-of-order", "./routes/out-of-order.tsx", {
          id: "out-of-order",
        }),
        route("/grid", "./routes/grid.tsx", { id: "grid" }),
      ],
    ),
  ],
  // Rendered with a 404 status when nothing matches. Not a route: it never
  // matches a URL, so it cannot shadow static assets or later pages.
  notFound: {
    component: "./routes/not-found.tsx",
    shell: "public",
  },
});
