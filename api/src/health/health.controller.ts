import { Controller, Get } from '@nestjs/common';
import { HealthBody } from './health';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): Promise<HealthBody> {
    return this.health.check();
  }
}
