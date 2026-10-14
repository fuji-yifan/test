import { Module } from '@nestjs/common'
import { UserMemoryStore } from './user-memory.store'
import { UserMemoryExtractor } from './user-memory.extractor'
import { UserMemoryService } from './user-memory.service'

/**
 * 用户长期记忆模块（阶段 8 §3.7）。
 *
 * 无 MySQL / 未配置 AGENT_DATABASE_URL 时 store 自动降级 no-op，等于本阶段未启用，
 * 不阻断请求（与阶段 3/4 的降级风格一致）。
 */
@Module({
  providers: [UserMemoryStore, UserMemoryExtractor, UserMemoryService],
  exports: [UserMemoryStore, UserMemoryService],
})
export class MemoryModule {}
