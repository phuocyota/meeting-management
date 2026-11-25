import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  username: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}

export class CreateUserDto {
  @ApiProperty({ description: 'Tên hiển thị', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description:
      'Tên đăng nhập 3-50 ký tự: chữ thường, số, dấu chấm, gạch dưới, gạch ngang (không phân biệt hoa thường)',
    example: 'nguyen.van.a',
  })
  @Transform(lowerTrim)
  @IsString()
  @Matches(/^[a-z0-9._-]{3,50}$/, {
    message:
      'Tên đăng nhập 3-50 ký tự, chỉ gồm chữ, số, dấu chấm, gạch dưới, gạch ngang',
  })
  username: string;

  @ApiProperty({ writeOnly: true, minLength: 8, maxLength: 200 })
  @IsString()
  @MinLength(8, { message: 'Mật khẩu tối thiểu 8 ký tự' })
  @MaxLength(200)
  password: string;
}

export class UpdateMeDto {
  @ApiPropertyOptional({ description: 'Tên hiển thị mới', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Mật khẩu hiện tại (bắt buộc khi đổi mật khẩu)',
    writeOnly: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;

  @ApiPropertyOptional({ writeOnly: true, minLength: 8, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Mật khẩu tối thiểu 8 ký tự' })
  @MaxLength(200)
  password?: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc tên đăng nhập' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}
