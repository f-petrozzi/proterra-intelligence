const required = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_PAGES_PROJECT", "COMMIT_SHA"] as const;

export {};
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;
const token = process.env.CLOUDFLARE_API_TOKEN!;
const project = process.env.CLOUDFLARE_PAGES_PROJECT!;
const commitSha = process.env.COMMIT_SHA!;
const environment = process.env.DEPLOYMENT_ENVIRONMENT;
const attempts = Number(process.env.DEPLOYMENT_POLL_ATTEMPTS ?? 36);
const intervalMs = Number(process.env.DEPLOYMENT_POLL_INTERVAL_MS ?? 10_000);

type Deployment = {
  id: string;
  url: string;
  aliases?: string[];
  environment?: string;
  latest_stage?: { status?: string; ended_on?: string };
  deployment_trigger?: { metadata?: { commit_hash?: string } };
};

function setOutput(name: string, value: string) {
  if (!process.env.GITHUB_OUTPUT) return;
  return import("node:fs/promises").then(({ appendFile }) => appendFile(process.env.GITHUB_OUTPUT!, `${name}=${value}\n`));
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(project)}/deployments?per_page=25`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
  });
  if (!response.ok) throw new Error(`Cloudflare deployment lookup failed (${response.status}).`);
  const payload = await response.json() as { success: boolean; errors?: unknown[]; result: Deployment[] };
  if (!payload.success) throw new Error(`Cloudflare deployment lookup failed: ${JSON.stringify(payload.errors ?? [])}`);
  const deployment = payload.result.find((candidate) =>
    candidate.deployment_trigger?.metadata?.commit_hash === commitSha
    && (!environment || candidate.environment === environment)
  );
  if (deployment?.latest_stage?.status === "failure") throw new Error(`Cloudflare deployment ${deployment.id} failed.`);
  if (deployment?.latest_stage?.status === "success") {
    const immutableUrl = new URL(deployment.url).toString().replace(/\/$/, "");
    const alias = deployment.aliases?.find((value) => value.startsWith("https://"))
      ?? deployment.aliases?.[0]
      ?? immutableUrl;
    const aliasUrl = new URL(alias.startsWith("http") ? alias : `https://${alias}`).toString().replace(/\/$/, "");
    await Promise.all([
      setOutput("deployment_id", deployment.id),
      setOutput("immutable_url", immutableUrl),
      setOutput("alias_url", aliasUrl),
      setOutput("completed_at", deployment.latest_stage.ended_on ?? new Date().toISOString())
    ]);
    process.stdout.write(`Cloudflare deployment ${deployment.id} succeeded for ${commitSha}.\n`);
    process.exit(0);
  }
  process.stdout.write(`Waiting for Cloudflare deployment of ${commitSha} (${attempt}/${attempts}).\n`);
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

throw new Error(`Timed out waiting for Cloudflare deployment of ${commitSha}.`);
