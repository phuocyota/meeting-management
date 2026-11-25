import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators';

@ApiTags('Hệ thống')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Kiểm tra service, DB và cấu hình dùng chung' })
  async health() {
    const database = await this.dataSource
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);
    // Chỉ báo biến nào đã có, không trả giá trị.
    return {
      status: database ? 'ok' : 'degraded',
      database,
      config: {
        livekit: Boolean(
          process.env.LIVEKIT_API_KEY &&
          process.env.LIVEKIT_API_SECRET &&
          process.env.LIVEKIT_PUBLIC_URL,
        ),
        jwtSecret: (process.env.MEETING_JWT_SECRET?.trim().length ?? 0) >= 32,
      },
    };
  }
}
