import { Module } from '@nestjs/common';
import { AuthController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [AuthController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
