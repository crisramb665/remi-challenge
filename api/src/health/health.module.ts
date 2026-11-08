import { Module } from '@nestjs/common';
import { IndexerModule } from '../indexer/indexer.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [IndexerModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
