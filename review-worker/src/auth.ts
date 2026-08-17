import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CSRF_SECRET: string;
  REVIEW_ORIGIN: string;
  REVIEW_SERVICE_KEY: string;
}

export async function authenticatedEmail(request: Request, env: AuthEnv) {
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) throw new Response("Authentication required", { status: 401 });
  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(assertion, jwks, { issuer, audience: env.ACCESS_AUD });
  if (typeof payload.email !== "string") throw new Response("User identity required", { status: 403 });
  return payload.email.toLowerCase();
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function assertSameOrigin(request: Request, env: AuthEnv) {
  const origin = request.headers.get("origin");
  if (origin !== env.REVIEW_ORIGIN.replace(/\/$/, "")) throw new Response("Invalid origin", { status: 403 });
}

export async function csrfToken(email: string, env: AuthEnv) {
  return hmac(`proterra-review:${email}`, env.CSRF_SECRET);
}

export async function assertCsrf(request: Request, email: string, env: AuthEnv) {
  assertSameOrigin(request, env);
  const supplied = request.headers.get("x-review-csrf") ?? "";
  const expected = await csrfToken(email, env);
  if (supplied.length !== expected.length) throw new Response("Invalid CSRF token", { status: 403 });
  let different = 0;
  for (let index = 0; index < supplied.length; index += 1) different |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  if (different !== 0) throw new Response("Invalid CSRF token", { status: 403 });
}

export function assertService(request: Request, env: AuthEnv) {
  const supplied = request.headers.get("x-review-service-key") ?? "";
  const expected = env.REVIEW_SERVICE_KEY;
  if (!expected || supplied.length !== expected.length) throw new Response("Service authentication required", { status: 401 });
  let different = 0;
  for (let index = 0; index < supplied.length; index += 1) different |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  if (different !== 0) throw new Response("Service authentication required", { status: 401 });
}

