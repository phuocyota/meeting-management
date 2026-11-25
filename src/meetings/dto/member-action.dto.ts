import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import type { MemberStatus } from '../../database/entities/meeting-member.entity';

const MEMBER_STATUSES: MemberStatus[] = [
  'pending',
  'admitted',
  'denied',
  'kicked',
];

export class ListMembersQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái; `pending` là danh sách phòng chờ',
    enum: MEMBER_STATUSES,
  })
  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: MemberStatus;
}

export class MuteMemberDto {
  @ApiPropertyOptional({ description: 'Tắt mic', default: true })
  @IsOptional()
  @IsBoolean()
  audio?: boolean;

  @ApiPropertyOptional({
    description: 'Tắt camera và chia sẻ màn hình',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  video?: boolean;
}

export class SetPublishDto {
  @ApiProperty({
    description:
      'false: khóa quyền phát mic/camera/màn hình (giữ cả khi vào lại); true: mở lại',
  })
  @IsBoolean()
  allowed: boolean;
}
