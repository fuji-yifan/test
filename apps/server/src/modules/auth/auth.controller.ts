import { Controller, Post, Get, Patch, Body, Query, UseGuards, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { LoginDto, RegisterDto } from './dto/login.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return this.authService.getUserById(user.userId)
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('me')
  updateProfile(@CurrentUser() user: any, @Body() body: { nickname?: string; avatarUrl?: string }) {
    return this.authService.updateUser(user.userId, body)
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('me/password')
  async changePassword(
    @CurrentUser() user: any,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    if (!body.newPassword || body.newPassword.length < 6) {
      throw new BadRequestException('新密码至少6位')
    }
    await this.authService.changePassword(user.userId, body.oldPassword, body.newPassword)
    return { message: '密码已修改' }
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('users')
  searchUsers(@Query('search') search: string) {
    return this.authService.searchUsers(search || '')
  }
}
