import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { appConfig } from '../config/app.config';
import type { AppConfig } from '../config/config';
import { DEPLOYMENT } from '../config/config.module';
import type { Deployment } from '../config/deployment';
import { PG_POOL } from '../database/database.module';
import { CHAIN_READER, type ChainReader } from './chain-reader';
import { toEscrowEvents } from './decode';
import { applyRange, readCheckpoint } from './projection';
import { computeRange } from './range';

/**
 * Polls the node, turns confirmed logs into the projection and keeps the checkpoint (SPEC 3.1).
 * Every failure is logged and retried on the next round: a range is only marked as done together
 * with its events, so retrying is always safe.
 */
@Injectable()
export class IndexerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private stopping = false;
  private loop: Promise<void> | null = null;
  private interruptSleep: (() => void) | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
    @Inject(DEPLOYMENT) private readonly deployment: Deployment,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
  ) {}

  onApplicationBootstrap(): void {
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.interruptSleep?.();
    await this.loop;
  }

  /** Indexes the next range if one is confirmed. Returns false when there is nothing to do. */
  async runOnce(): Promise<boolean> {
    const [head, lastProcessedBlock] = await Promise.all([
      this.reader.getBlockNumber(),
      readCheckpoint(this.pool),
    ]);
    const range = computeRange({
      head,
      confirmations: this.config.confirmations,
      batchSize: this.config.batchSize,
      lastProcessedBlock,
      startBlock: BigInt(this.deployment.startBlock),
    });
    if (range === null) return false;

    const events = toEscrowEvents(await this.reader.getLogs(range));
    await applyRange(this.pool, range, events);

    this.logger.log(
      `Indexed blocks ${range.from}-${range.to} (${events.length} events)`,
    );
    return true;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let progressed = false;
      try {
        progressed = await this.runOnce();
      } catch (error) {
        this.logger.error(
          `Indexing failed, will retry: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // After progress, go straight to the next range so a backlog is cleared without pauses.
      if (!progressed && !this.stopping) {
        await this.sleep(this.config.pollIntervalMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      this.interruptSleep = done;

      function done() {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}
