import {
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { createPool, type Pool } from 'mysql2/promise'
import { MysqlCheckpointSaver } from './mysql-checkpoint-saver'
import { MysqlExecutor } from './sql-executor'

/**
 * LangGraph checkpoint 持久化。
 *
 * 懒初始化：连接池在第一次取 `saver` 时才建。引擎开关已随 legacy 退场移除，
 * 这个模块现在总是启用 —— 没配 `AGENT_DATABASE_URL` 会在建图时直接报错，而不是静默降级。
 */
@Injectable()
export class CheckpointService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CheckpointService.name)
  private pool?: Pool
  private instance?: MysqlCheckpointSaver

  constructor(private readonly config: ConfigService) {}

  get saver(): MysqlCheckpointSaver {
    if (!this.instance) {
      const url = this.config.get<string>('checkpoint.databaseUrl')
      if (!url) {
        throw new Error('AGENT_DATABASE_URL 未配置，无法启用 LangGraph checkpoint')
      }
      this.pool = createPool({
        uri: url,
        connectionLimit: this.config.get<number>('checkpoint.poolSize') ?? 5,
        waitForConnections: true,
      })
      this.instance = new MysqlCheckpointSaver(new MysqlExecutor(this.pool))
    }
    return this.instance
  }

  async onApplicationBootstrap(): Promise<void> {
    const saver = this.saver
    if (this.config.get<boolean>('checkpoint.autoSetup')) {
      await saver.setup()
    }
    this.logger.log('LangGraph checkpoint 已就绪（MySQL）')
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end()
  }
}

@Module({
  imports: [ConfigModule],
  providers: [CheckpointService],
  exports: [CheckpointService],
})
export class CheckpointModule {}
