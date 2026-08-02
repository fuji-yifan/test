import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as Minio from 'minio'

@Global()
@Module({
  providers: [
    {
      provide: 'MINIO_CLIENT',
      useFactory: (config: ConfigService) => {
        return new Minio.Client({
          endPoint: config.get('MINIO_ENDPOINT', 'localhost'),
          port: config.get<number>('MINIO_PORT', 9000),
          useSSL: config.get('MINIO_USE_SSL', 'false') === 'true',
          accessKey: config.get('MINIO_ACCESS_KEY', 'minioadmin'),
          secretKey: config.get('MINIO_SECRET_KEY', 'minioadmin'),
        })
      },
      inject: [ConfigService],
    },
    {
      provide: 'MINIO_BUCKET',
      useFactory: (config: ConfigService) => {
        return config.get('MINIO_BUCKET', 'furm')
      },
      inject: [ConfigService],
    },
  ],
  exports: ['MINIO_CLIENT', 'MINIO_BUCKET'],
})
export class MinioModule {}
