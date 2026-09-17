import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

const requiredKeys = ["REVIEW_API_URL", "REVIEW_ACCESS_CLIENT_ID", "REVIEW_ACCESS_CLIENT_SECRET", "REVIEW_SERVICE_KEY"] as const;

// Parse data, never source shell code. Do not allow this file to override PATH or CLI settings.
export async function loadScheduledEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const path = environment.PROTERRA_REVIEW_ENV_FILE ?? join(homedir(), ".config/proterra-intelligence/review.env");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600) {
      throw new Error("The scheduled review environment file must be a regular file owned by this user with mode 0600.");
    }
    const values = parseEnv(await file.readFile("utf8"));
    for (const key of requiredKeys) {
      if (!values[key]?.trim() || values[key] === "...") throw new Error(`The scheduled review environment file is missing ${key}.`);
    }
    for (const key of requiredKeys) environment[key] = values[key];
  } finally {
    await file.close();
  }
}
