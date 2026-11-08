export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export interface AppConfig {
  rpcUrl: string;
  databaseUrl: string;
  confirmations: number;
  batchSize: number;
  pollIntervalMs: number;
  healthMaxExtraLagBlocks: number;
  deploymentFile: string;
}

export const DEFAULT_HEALTH_MAX_EXTRA_LAG_BLOCKS = 10;
export const DEFAULT_DEPLOYMENT_FILE = '/shared/deployment.json';

type Env = Record<string, string | undefined>;

/**
 * Reads and validates the environment. All problems are reported together,
 * and URL values are never echoed because DATABASE_URL carries a password.
 */
export function loadConfig(env: Env): AppConfig {
  const errors: string[] = [];

  const config: AppConfig = {
    rpcUrl: url(env, 'RPC_URL', ['http:', 'https:'], errors),
    databaseUrl: url(env, 'DATABASE_URL', ['postgres:', 'postgresql:'], errors),
    confirmations: integer(env, 'CONFIRMATIONS', 0, undefined, errors),
    batchSize: integer(env, 'BATCH_SIZE', 1, undefined, errors),
    pollIntervalMs: integer(env, 'POLL_INTERVAL_MS', 1, undefined, errors),
    healthMaxExtraLagBlocks: integer(
      env,
      'HEALTH_MAX_EXTRA_LAG_BLOCKS',
      0,
      DEFAULT_HEALTH_MAX_EXTRA_LAG_BLOCKS,
      errors,
    ),
    deploymentFile: env.DEPLOYMENT_FILE?.trim() || DEFAULT_DEPLOYMENT_FILE,
  };

  if (errors.length > 0) {
    throw new ConfigError(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }
  return config;
}

function integer(
  env: Env,
  name: string,
  min: number,
  fallback: number | undefined,
  errors: string[],
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    errors.push(`${name} is required`);
    return 0;
  }
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min) {
    errors.push(`${name} must be an integer >= ${min}, got "${raw}"`);
    return 0;
  }
  return value;
}

function url(
  env: Env,
  name: string,
  protocols: string[],
  errors: string[],
): string {
  const raw = env[name]?.trim();
  if (!raw) {
    errors.push(`${name} is required`);
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    errors.push(`${name} must be a valid URL`);
    return '';
  }
  if (!protocols.includes(parsed.protocol)) {
    const allowed = protocols.map((p) => p.slice(0, -1)).join(' or ');
    errors.push(`${name} must use ${allowed}`);
    return '';
  }
  return raw;
}
