import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EscrowsModule } from './escrows/escrows.module';
import { HealthModule } from './health/health.module';
import { IndexerModule } from './indexer/indexer.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    IndexerModule,
    EscrowsModule,
    HealthModule,
  ],
})
export class AppModule {}
