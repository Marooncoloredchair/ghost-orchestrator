import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export type EnvLoadResult = {
  loadedFiles: string[];
};

/**
 * Load env files in precedence order:
 * 1) .env
 * 2) .env.local (overrides .env)
 */
export function loadEnvFiles(cwd = process.cwd()): EnvLoadResult {
  const loadedFiles: string[] = [];

  const envPath = path.resolve(cwd, ".env");
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
    loadedFiles.push(".env");
  }

  const envLocalPath = path.resolve(cwd, ".env.local");
  if (existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath, override: true });
    loadedFiles.push(".env.local");
  }

  return { loadedFiles };
}
