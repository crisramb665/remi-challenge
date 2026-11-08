import { Module } from '@nestjs/common';
import { IndexerModule } from '../indexer/indexer.module';
import { EscrowsController } from './escrows.controller';
import { EscrowsRepository } from './escrows.repository';
import { EscrowsService } from './escrows.service';

@Module({
  imports: [IndexerModule],
  controllers: [EscrowsController],
  providers: [EscrowsService, EscrowsRepository],
})
export class EscrowsModule {}
