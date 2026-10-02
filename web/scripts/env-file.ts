type Env = Record<string, string | undefined>;

/**
 * Which env file scripts load: .env.local (dev) unless ENV_FILE names another, e.g.
 * ENV_FILE=.env.production.local for the prod account and catalog scripts.
 */
export function resolveEnvFile(env: Env, exists: (path: string) => boolean): string {
  const chosen = env.ENV_FILE;
  if (!chosen) return '.env.local';
  if (!exists(chosen)) throw new Error(`ENV_FILE=${chosen} was not found in ${process.cwd()}. Check the file name.`);
  return chosen;
}
