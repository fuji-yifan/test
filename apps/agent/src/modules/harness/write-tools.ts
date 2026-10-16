/**
 * 写工具集合（阶段 6 / S3.3；S4.2 起为**单一权威**）。
 *
 * 幂等门应作用于**所有有副作用的工具**，而不能只按 `risk !== 'low'` ——
 * 写工具一旦被评成 low（历史遗留）就完全不幂等。同时，写工具执行成功后要失效本工作空间
 * 的只读缓存（`tool-cache.service.ts`），两处必须用同一份名单，否则会各自漂移
 * （此前 gateway 有 `flow_bind_form`、cache 没有）。
 *
 * 放在独立叶子模块（无任何 import），既让 harness 的网关与 cache 模块共用，
 * 又不引入循环依赖。
 */
export const WRITE_TOOLS = new Set<string>([
  'form_save',
  'form_rollback',
  'form_delete',
  'form_version_delete',
  'flow_save',
  'flow_bind_form',
  'flow_publish',
  'template_instantiate',
])
