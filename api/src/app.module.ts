import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { IndexerModule } from './indexer/indexer.module';

@Module({
  imports: [AppConfigModule, DatabaseModule, IndexerModule],
})
export class AppModule {}
