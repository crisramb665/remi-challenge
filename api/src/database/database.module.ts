import {
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { appConfig } from '../config/app.config';
import { AppConfig } from '../config/config';
import { applySchema } from './schema';

export const PG_POOL = Symbol('PG_POOL');

/** Owns the Postgres pool and makes sure the schema exists before the app serves anything. */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig): Pool =>
        new Pool({ connectionString: config.databaseUrl }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    await applySchema(this.pool);
  }

  /** Runs after every `onModuleDestroy`, so the indexer has stopped before the pool closes. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
