// Serves the digest subscription pages on the publication's own domain. The Review Worker renders them
// behind a private service binding (SUBSCRIPTIONS, set in the Pages project settings). Only /subscriptions
// paths are forwarded, so the Worker's review and admin routes stay unreachable from the site.
type Env = { SUBSCRIPTIONS?: { fetch(request: Request): Promise<Response> } };

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  const { pathname } = new URL(request.url);
  if (pathname !== "/subscriptions" && !pathname.startsWith("/subscriptions/")) return new Response("Not found", { status: 404 });
  if (!env.SUBSCRIPTIONS) return new Response("Subscriptions are unavailable", { status: 503 });
  return env.SUBSCRIPTIONS.fetch(request);
}
