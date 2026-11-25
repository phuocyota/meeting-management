import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Chỉ gửi các trường muốn đổi. Cài đặt chỉ áp dụng cho người tham gia thường, không áp cho admin. */
export class UpdateSettingsDto {
  @ApiPropertyOptional({
    description:
      'Khóa phòng: người chưa từng xin vào nhận status locked; người đang chờ vẫn duyệt được, thành viên cũ vẫn vào lại được',
  })
  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @ApiPropertyOptional({
    description:
      'Bật/tắt phòng chờ. Tắt phòng chờ thì mọi người đang chờ được duyệt luôn',
  })
  @IsOptional()
  @IsBoolean()
  waitingRoom?: boolean;

  @ApiPropertyOptional({
    description: 'Người tham gia được tự bật mic (tắt thì mic đang bật bị tắt)',
  })
  @IsOptional()
  @IsBoolean()
  allowMicrophone?: boolean;

  @ApiPropertyOptional({ description: 'Người tham gia được bật camera' })
  @IsOptional()
  @IsBoolean()
  allowCamera?: boolean;

  @ApiPropertyOptional({ description: 'Người tham gia được chia sẻ màn hình' })
  @IsOptional()
  @IsBoolean()
  allowScreenShare?: boolean;

  @ApiPropertyOptional({
    description: 'Người tham gia được gửi chat (data message của LiveKit)',
  })
  @IsOptional()
  @IsBoolean()
  allowChat?: boolean;
}

export const SETTING_KEYS = [
  'locked',
  'waitingRoom',
  'allowMicrophone',
  'allowCamera',
  'allowScreenShare',
  'allowChat',
] as const satisfies ReadonlyArray<keyof UpdateSettingsDto>;
