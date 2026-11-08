import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CHAIN_READER, type ChainReader } from '../indexer/chain-reader';
import { EscrowView, toEscrowView } from './escrow-view';
import { EscrowsRepository } from './escrows.repository';
import type { ListQuery } from './query';

export interface EscrowList {
  items: EscrowView[];
  /** Id to pass as `cursor` for the next page, or null on the last page. */
  nextCursor: string | null;
}

@Injectable()
export class EscrowsService {
  private readonly logger = new Logger(EscrowsService.name);

  constructor(
    private readonly repository: EscrowsRepository,
    @Inject(CHAIN_READER) private readonly chain: ChainReader,
  ) {}

  async get(id: string): Promise<EscrowView> {
    const row = await this.repository.findById(id);
    if (row === null) throw new NotFoundException(`Escrow ${id} not found`);
    return toEscrowView(row, await this.now());
  }

  async list(query: ListQuery): Promise<EscrowList> {
    // One `now` for the filter and for every item, so a response agrees with itself.
    const now = await this.now();
    const page = await this.repository.list({ ...query, now });
    return {
      items: page.rows.map((row) => toEscrowView(row, now)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * `now` is the timestamp of the latest block (SPEC 4.1), never the server clock. Without the
   * node there is no `now`, so the request fails instead of guessing.
   */
  private async now(): Promise<bigint> {
    try {
      return (await this.chain.getLatestBlock()).timestamp;
    } catch (error) {
      this.logger.warn(
        `Cannot read the latest block: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('The chain node is unreachable');
    }
  }
}
