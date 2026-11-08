import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { appConfig } from '../config/app.config';
import type { AppConfig } from '../config/config';
import { DEPLOYMENT } from '../config/config.module';
import type { Deployment } from '../config/deployment';
import { PG_POOL } from '../database/database.module';
import { CHAIN_READER, type ChainReader } from '../indexer/chain-reader';
import { readCheckpoint } from '../indexer/projection';
import { buildHealth, HealthBody } from './health';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
    @Inject(DEPLOYMENT) private readonly deployment: Deployment,
    @Inject(CHAIN_READER) private readonly chain: ChainReader,
  ) {}

  async check(): Promise<HealthBody> {
    const [checkpoint, node] = await Promise.all([
      readCheckpoint(this.pool),
      this.readNode(),
    ]);

    return buildHealth({
      checkpoint,
      startBlock: BigInt(this.deployment.startBlock),
      node,
      confirmations: this.config.confirmations,
      maxExtraLagBlocks: this.config.healthMaxExtraLagBlocks,
    });
  }

  /** A node that cannot be reached is a degraded report, not an error of the endpoint. */
  private async readNode() {
    try {
      const [head, chainId] = await Promise.all([
        this.chain.getBlockNumber(),
        this.chain.getChainId(),
      ]);
      return { head, chainId };
    } catch (error) {
      this.logger.warn(
        `Cannot reach the chain node: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
