/**
 * JSON 深度归一：把「被序列化成字符串的 JSON 对象/数组」递归还原成真对象。
 *
 * 出现场景：模型（LLM）在工具入参里常把嵌套结构吐成字符串 —— 条件节点写成
 * `config.branches = "[{\"name\":…}]"`，整份 config 写成 `"{}"`。这类值原样落库后：
 * 设计器按数组/对象读写会抛 TypeError（打开即「加载失败」），服务端取
 * `start.config.formId` 拿到 undefined（绑了表单也不发起）；而 MySQL 的 Json 列
 * 完全接受「字符串值」，所以一路上没有任何一层报错，脏数据静默沉淀。
 *
 * 归一规则：只还原**解析结果仍是对象或数组**的字符串。解析成数字/布尔/null 的
 * 字符串（如 "1000"、"true"）保持原样 —— 它们可能是模板串或有意的字符串比较值，
 * 转成原始类型会改变语义。约束见 json-coerce.test.ts。
 */

/** 递归还原字符串化的 JSON 对象/数组；其余值原样返回 */
export function coerceJsonDeep<T>(value: T): T {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object') return coerceJsonDeep(parsed as T)
      } catch {
        /* 不是合法 JSON，原样保留 */
      }
    }
    return value
  }
  if (Array.isArray(value)) return value.map((v) => coerceJsonDeep(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = coerceJsonDeep(v)
    return out as T
  }
  return value
}

/**
 * 节点 config 的归一入口：保证结果一定是普通对象。
 * （config 被写成字符串/数组/null 时退化成 `{}`，调用方可直接 `node.config.xxx` 读写。）
 */
export function coerceNodeConfig(raw: unknown): Record<string, unknown> {
  const value = coerceJsonDeep(raw)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
