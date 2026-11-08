import { readFileSync } from 'node:fs';
import { ConfigError } from './config';

/** What the `deploy` service writes to the shared volume. */
export interface Deployment {
  /** Lowercase contract address. */
  address: string;
  /** Block to start indexing from. */
  startBlock: number;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function loadDeployment(path: string): Deployment {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new ConfigError(`Cannot read the deployment file at ${path}`, {
      cause,
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(`The deployment file at ${path} is not valid JSON`, {
      cause,
    });
  }

  const { address, startBlock } = (data ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof address !== 'string' || !ADDRESS.test(address)) {
    errors.push('address must be a 0x-prefixed 20 byte hex string');
  }
  if (
    typeof startBlock !== 'number' ||
    !Number.isSafeInteger(startBlock) ||
    startBlock < 0
  ) {
    errors.push('startBlock must be a non-negative integer');
  }
  if (errors.length > 0) {
    throw new ConfigError(
      `Invalid deployment file at ${path}:\n- ${errors.join('\n- ')}`,
    );
  }

  return {
    address: (address as string).toLowerCase(),
    startBlock: startBlock as number,
  };
}
