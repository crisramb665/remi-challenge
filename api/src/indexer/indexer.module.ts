import { Module } from '@nestjs/common';
import { appConfig } from '../config/app.config';
import { AppConfig } from '../config/config';
import { DEPLOYMENT } from '../config/config.module';
import { Deployment } from '../config/deployment';
import { Address } from 'viem';
import { CHAIN_READER, createViemChainReader } from './chain-reader';
import { IndexerService } from './indexer.service';

@Module({
  providers: [
    {
      provide: CHAIN_READER,
      inject: [appConfig.KEY, DEPLOYMENT],
      useFactory: (config: AppConfig, deployment: Deployment) =>
        createViemChainReader(config.rpcUrl, deployment.address as Address),
    },
    IndexerService,
  ],
  exports: [CHAIN_READER],
})
export class IndexerModule {}
