import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
