import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MeetingUser } from '../auth/auth.types';
import { AllowGuest, CurrentUser, Public } from '../auth/decorators';
import {
  CreateMeetingDto,
  GuestJoinDto,
  ScheduleMeetingDto,
} from './dto/create-meeting.dto';
import {
  ListMembersQueryDto,
  MuteMemberDto,
  SetPublishDto,
} from './dto/member-action.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { MeetingsService } from './meetings.service';

/** userId (tài khoản hoặc khách) là uuid chữ thường, cũng là identity trong LiveKit. */ const lower =
  (value: string) => value.toLowerCase();

// Route admin có @AllowGuest vì khách làm được đồng chủ trì; service vẫn kiểm vai trò theo DB (assertAdmin).
// Riêng chuyển chủ trì không mở cho khách: khách không bao giờ là chủ trì.
@ApiTags('Cuộc họp')
@ApiBearerAuth('access-token')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  @ApiOperation({
    summary: 'Tạo cuộc họp (người tạo là chủ trì) và nhận token LiveKit',
  })
  create(@CurrentUser() user: MeetingUser, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(user, dto);
  }

  @Post('schedule')
  @ApiOperation({
    summary:
      'Lên lịch cuộc họp (người tạo là chủ trì). Không có phòng chờ: tới giờ hẹn ai có link cũng vào thẳng; trước giờ chỉ chủ trì/đồng chủ trì vào được',
  })
  schedule(@CurrentUser() user: MeetingUser, @Body() dto: ScheduleMeetingDto) {
    return this.meetings.schedule(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'Các cuộc họp đang diễn ra hoặc đã lên lịch mà tôi tham gia (có scheduledAt nếu đã lên lịch)',
  })
  listMine(@CurrentUser() user: MeetingUser) {
    return this.meetings.listMine(user);
  }

  @AllowGuest()
  @Get(':id')
  @ApiOperation({ summary: 'Xem cuộc họp và vai trò của tôi' })
  findOne(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.findOne(user, lower(id));
  }

  @AllowGuest()
  @Post(':id/join')
  @ApiOperation({
    summary:
      'Xin vào cuộc họp: trả token khi được vào, hoặc trạng thái pending/denied/kicked',
  })
  join(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.join(user, lower(id));
  }

  @Public()
  @Post(':id/guest')
  @ApiOperation({
    summary:
      'Khách vào bằng tên (không cần đăng nhập): trả token khách (guest.accessToken) và kết quả xin vào',
  })
  guestJoin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GuestJoinDto) {
    return this.meetings.guestJoin(lower(id), dto.name);
  }

  @AllowGuest()
  @Delete(':id')
  @ApiOperation({ summary: 'Admin kết thúc cuộc họp cho tất cả' })
  end(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.end(user, lower(id));
  }

  @AllowGuest()
  @Get(':id/room')
  @ApiOperation({
    summary:
      'Trạng thái phòng: cài đặt, người đang có mặt (vai trò, mic/camera/màn hình, giơ tay), số người chờ (admin)',
  })
  getRoom(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.getRoom(user, lower(id));
  }

  @AllowGuest()
  @Patch(':id/settings')
  @ApiOperation({
    summary:
      'Admin đổi cài đặt phòng: khóa phòng, phòng chờ, cho phép mic/camera/chia sẻ màn hình/chat',
  })
  updateSettings(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.meetings.updateSettings(user, lower(id), dto);
  }

  @AllowGuest()
  @Post(':id/lobby/admit-all')
  @ApiOperation({ summary: 'Admin duyệt tất cả người trong phòng chờ' })
  admitAll(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.admitAll(user, lower(id));
  }

  @AllowGuest()
  @Post(':id/mute-all')
  @ApiOperation({
    summary:
      'Admin tắt mic (và camera nếu video=true) của mọi người tham gia thường',
  })
  muteAll(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MuteMemberDto,
  ) {
    return this.meetings.muteAll(user, lower(id), dto);
  }

  @AllowGuest()
  @Post(':id/hand')
  @ApiOperation({ summary: 'Giơ tay (phải đang ở trong phòng)' })
  raiseHand(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.raiseHand(user, lower(id));
  }

  @AllowGuest()
  @Delete(':id/hand')
  @ApiOperation({ summary: 'Hạ tay của mình' })
  lowerOwnHand(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.lowerHand(user, lower(id), user.userId);
  }

  @AllowGuest()
  @Delete(':id/hands')
  @ApiOperation({ summary: 'Admin hạ tay tất cả' })
  lowerAllHands(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.lowerAllHands(user, lower(id));
  }

  @AllowGuest()
  @Delete(':id/members/:userId/hand')
  @ApiOperation({ summary: 'Admin hạ tay giúp một người' })
  lowerHand(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.lowerHand(user, lower(id), lower(userId));
  }

  @Put(':id/host/:userId')
  @ApiOperation({
    summary:
      'Chủ trì chuyển quyền chủ trì cho thành viên đã được vào; chủ trì cũ thành đồng chủ trì',
  })
  transferHost(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.transferHost(user, lower(id), lower(userId));
  }

  @AllowGuest()
  @Get(':id/members')
  @ApiOperation({
    summary: 'Admin xem thành viên; status=pending là phòng chờ',
  })
  listMembers(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.meetings.listMembers(user, lower(id), query.status);
  }

  @AllowGuest()
  @Post(':id/members/:userId/admit')
  @ApiOperation({
    summary: 'Admin duyệt người vào (kể cả người đã bị từ chối/mời ra)',
  })
  admit(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.admit(user, lower(id), lower(userId));
  }

  @AllowGuest()
  @Post(':id/members/:userId/deny')
  @ApiOperation({ summary: 'Admin từ chối người trong phòng chờ' })
  deny(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.deny(user, lower(id), lower(userId));
  }

  @AllowGuest()
  @Post(':id/members/:userId/kick')
  @ApiOperation({ summary: 'Admin mời người tham gia ra khỏi cuộc họp' })
  kick(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.kick(user, lower(id), lower(userId));
  }

  @AllowGuest()
  @Post(':id/members/:userId/mute')
  @ApiOperation({ summary: 'Admin tắt mic/camera đang phát của một người' })
  mute(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: MuteMemberDto,
  ) {
    return this.meetings.mute(user, lower(id), lower(userId), dto);
  }

  @AllowGuest()
  @Put(':id/members/:userId/publish')
  @ApiOperation({
    summary: 'Admin khóa hoặc mở quyền phát mic/camera/màn hình',
  })
  setPublish(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetPublishDto,
  ) {
    return this.meetings.setPublish(
      user,
      lower(id),
      lower(userId),
      dto.allowed,
    );
  }

  @AllowGuest()
  @Put(':id/cohosts/:userId')
  @ApiOperation({
    summary:
      'Admin chỉ định đồng chủ trì (tài khoản hoặc khách đã có trong cuộc họp)',
  })
  grantCohost(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.grantCohost(user, lower(id), lower(userId));
  }

  @AllowGuest()
  @Delete(':id/cohosts/:userId')
  @ApiOperation({ summary: 'Admin thu hồi quyền đồng chủ trì' })
  revokeCohost(
    @CurrentUser() user: MeetingUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.revokeCohost(user, lower(id), lower(userId));
  }
}
