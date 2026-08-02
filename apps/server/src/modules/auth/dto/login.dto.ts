import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6, { message: '密码至少6位' })
  password: string
}

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6, { message: '密码至少6位' })
  password: string

  @ApiProperty({ example: '张三' })
  @IsString()
  @MinLength(1, { message: '昵称不能为空' })
  @MaxLength(100)
  nickname: string
}
