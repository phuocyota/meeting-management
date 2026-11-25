import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MeetingUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';
import {
  CreateUserDto,
  ListUsersQueryDto,
  LoginDto,
  UpdateMeDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Đăng nhập')
@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đăng nhập bằng tên đăng nhập và mật khẩu' })
  login(@Body() dto: LoginDto) {
    return this.users.login(dto.username, dto.password);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tài khoản đang đăng nhập' })
  me(@CurrentUser() user: MeetingUser) {
    return this.users.me(user);
  }

  @Patch('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Đổi tên hiển thị hoặc mật khẩu của tôi' })
  updateMe(@CurrentUser() user: MeetingUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user, dto);
  }
}

@ApiTags('Tài khoản')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Tạo tài khoản (người tạo được ghi vào created_by)',
  })
  create(@CurrentUser() user: MeetingUser, @Body() dto: CreateUserDto) {
    return this.users.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'Tìm tài khoản theo tên/tên đăng nhập (tối đa 50), dùng để chọn đồng chủ trì',
  })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query.q);
  }
}
