import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from './app.config';
import { AppConfig } from './config';
import { Deployment, loadDeployment } from './deployment';

export const DEPLOYMENT = Symbol('DEPLOYMENT');

/**
 * `@nestjs/config` loads the `.env` file and provides the validated settings. On top of that, the
 * deployment file written by the `deploy` service is read when the app starts, for the same reason:
 * a bad file stops the boot.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [appConfig] })],
  providers: [
    {
      provide: DEPLOYMENT,
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig): Deployment =>
        loadDeployment(config.deploymentFile),
    },
  ],
  exports: [DEPLOYMENT],
})
export class AppConfigModule {}
