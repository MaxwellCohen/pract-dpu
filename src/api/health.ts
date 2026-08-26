export function GET() {
  return Response.json({
    adapter: "vercel",
    ok: true,
    service: "pracht",
  });
}
