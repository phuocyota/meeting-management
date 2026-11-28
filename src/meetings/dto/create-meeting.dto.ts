import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinDate,
} from 'class-validator';

/** Lên lịch xa nhất 1 năm. */
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export class CreateMeetingDto {
  @ApiProperty({ description: 'Tiêu đề cuộc họp', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    description:
      'Bật phòng chờ: người không phải admin phải được duyệt mới vào được (mặc định bật)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  waitingRoom?: boolean;

  @ApiPropertyOptional({
    description:
      'Số người tối đa; mặc định LIVEKIT_ROOM_MAX_PARTICIPANTS hoặc 100',
    minimum: 2,
    maximum: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(500)
  maxParticipants?: number;

  @ApiPropertyOptional({
    description:
      'id tài khoản (bảng users) được chỉ định làm đồng chủ trì ngay khi tạo',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  coHostIds?: string[];
}

/**
 * Lên lịch họp: không có phòng chờ, tới giờ hẹn mọi người (tài khoản hoặc khách) vào thẳng.
 * Admin vẫn bật lại phòng chờ hoặc khóa phòng được qua `PATCH /meetings/:id/settings`.
 */
export class ScheduleMeetingDto extends OmitType(CreateMeetingDto, [
  'waitingRoom',
] as const) {
  @ApiProperty({
    description:
      'Giờ bắt đầu (ISO 8601, nên kèm múi giờ, ví dụ 2026-12-01T09:00:00+07:00); phải ở tương lai, tối đa 1 năm',
    type: String,
    format: 'date-time',
  })
  @Type(() => Date)
  @IsDate({ message: 'scheduledAt phải là thời điểm hợp lệ (ISO 8601)' })
  @MinDate(() => new Date(), { message: 'Giờ bắt đầu phải ở tương lai' })
  @MaxDate(() => new Date(Date.now() + MAX_SCHEDULE_AHEAD_MS), {
    message: 'Chỉ lên lịch trước tối đa 1 năm',
  })
  scheduledAt: Date;
}

export class GuestJoinDto {
  @ApiProperty({ description: 'Tên hiển thị của khách', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
