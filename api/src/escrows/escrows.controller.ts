import { Controller, Get, Param, Query } from '@nestjs/common';
import { EscrowView } from './escrow-view';
import { EscrowList, EscrowsService } from './escrows.service';
import { parseEscrowId, parseListQuery } from './query';

@Controller('escrows')
export class EscrowsController {
  constructor(private readonly escrows: EscrowsService) {}

  @Get(':id')
  get(@Param('id') id: string): Promise<EscrowView> {
    return this.escrows.get(parseEscrowId(id));
  }

  @Get()
  list(@Query() query: Record<string, unknown>): Promise<EscrowList> {
    return this.escrows.list(parseListQuery(query));
  }
}
