import { registerAs } from '@nestjs/config';
import { loadConfig } from './config';

/**
 * The validated settings, injected with `@Inject(appConfig.KEY)`. The factory runs when the app starts,
 * so a missing or malformed setting stops the boot with a clear message.
 */
export const appConfig = registerAs('app', () => loadConfig(process.env));
