import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'
import { ContextService } from '../../../context/context.service'

/** 每个分类字段最多保留的取值分布项（去重后的取值数） */
const MAX_DISTINCT = 20
/** 每个数值字段最多回传的序列长度（供 data_analyze 做中位数/趋势/异常检测） */
const MAX_SERIES = 500
/** 分组最多保留的组数 */
const MAX_GROUPS = 50

interface FieldMeta { key: string; label: string; type: string }

@Injectable()
@Tool({
  name: 'data_query',
  description: '聚合查询表单提交数据。按时间范围/分组维度返回汇总统计（count/sum/avg/min/max/dist），不返回原始数据行；数值字段另附序列供 data_analyze 使用。',
  inputSchema: z.object({
    formId: z.string().describe('表单 ID'),
    startDate: z.string().optional().describe('开始日期 YYYY-MM-DD'),
    endDate: z.string().optional().describe('结束日期 YYYY-MM-DD'),
    groupBy: z.string().optional().describe('分组字段（field key）'),
  }),
  riskLevel: 'low',
})
export class DataQueryTool {
  constructor(private contextService: ContextService) {}

  async execute(args: {
    formId: string; startDate?: string; endDate?: string; groupBy?: string
    token?: string
  }): Promise<any> {
    const token = args.token || ''
    try {
      const result = await this.contextService.getSubmissions(token, args.formId, {
        startDate: args.startDate, endDate: args.endDate, pageSize: 1000,
      })
      const rawList = result?.list || result || []
      const rows: any[] = Array.isArray(rawList) ? rawList : []

      // 服务端 list 不认 startDate/endDate，这里按 createdAt 兜底过滤
      const filtered = this.filterByDate(rows, args.startDate, args.endDate)

      // 字段元信息：优先用表单 schema 的 label/类型，取不到就退回 data 里的 key
      const meta = await this.loadFieldMeta(token, args.formId)

      const agg = this.aggregate(filtered, meta, args.groupBy)

      return {
        summary: `Aggregated ${filtered.length} submissions for form "${args.formId}" (count/sum/avg/min/max/dist; no raw rows)`,
        total: filtered.length,
        ...agg,
      }
    } catch (err: any) {
      // 不要把失败一律说成「服务端不可用」——原样抛出真实原因（404/401/超时等），便于定位
      return { summary: `查询提交数据失败：${err?.message || String(err)}`, total: 0, error: true }
    }
  }

  // ==================== 内部 ====================

  private filterByDate(rows: any[], startDate?: string, endDate?: string): any[] {
    if (!startDate && !endDate) return rows
    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null
    const end = endDate ? new Date(`${endDate}T23:59:59`).getTime() : null
    return rows.filter((r) => {
      const t = r?.createdAt ? new Date(r.createdAt).getTime() : NaN
      if (Number.isNaN(t)) return false
      if (start !== null && t < start) return false
      if (end !== null && t > end) return false
      return true
    })
  }

  private async loadFieldMeta(token: string, formId: string): Promise<Map<string, FieldMeta>> {
    const map = new Map<string, FieldMeta>()
    try {
      const form = await this.contextService.getForm(token, formId)
      const schema = form?.schema || form
      const fields: any[] = Array.isArray(schema?.fields) ? schema.fields : []
      for (const f of fields) {
        if (f?.key) map.set(f.key, { key: f.key, label: f.label || f.name || f.key, type: f.type || 'text' })
      }
    } catch { /* schema 取不到就用原始 key 作 label */ }
    return map
  }

  private aggregate(rows: any[], meta: Map<string, FieldMeta>, groupBy?: string) {
    // 按字段收集取值
    const valuesByKey = new Map<string, any[]>()
    for (const r of rows) {
      const data = r?.data && typeof r.data === 'object' ? r.data : {}
      for (const [k, v] of Object.entries(data)) {
        if (v === null || v === undefined || v === '') continue
        const arr = valuesByKey.get(k)
        if (arr) arr.push(v)
        else valuesByKey.set(k, [v])
      }
    }

    const fields: any[] = []
    const series: Record<string, { values: number[]; labels: string[] }> = {}

    for (const [key, values] of valuesByKey) {
      const numeric = values.map(toNumber)
      const numericValues = numeric.filter((n): n is number => n !== null)
      const isNumeric = numericValues.length > 0 && numericValues.length === values.length

      const field: any = { key, label: meta.get(key)?.label || key, count: values.length }

      if (isNumeric) {
        const sum = numericValues.reduce((a, b) => a + b, 0)
        field.type = 'number'
        field.sum = round(sum)
        field.avg = round(sum / numericValues.length)
        field.min = Math.min(...numericValues)
        field.max = Math.max(...numericValues)
        field.dist = histogram(numericValues)
        // 与行对齐的序列：供 data_analyze 计算中位数/趋势/Z-Score
        const sVals: number[] = []
        const sLabels: string[] = []
        for (const r of rows) {
          const n = toNumber(r?.data?.[key])
          if (n === null) continue
          sVals.push(n)
          sLabels.push(r?.createdAt ? String(r.createdAt).slice(0, 10) : '')
        }
        series[key] = { values: sVals.slice(0, MAX_SERIES), labels: sLabels.slice(0, MAX_SERIES) }
      } else {
        field.type = meta.get(key)?.type || 'text'
        field.dist = topDistribution(values)
      }
      fields.push(field)
    }

    const out: any = { fields }
    if (Object.keys(series).length) out.series = series

    if (groupBy) {
      const buckets = new Map<string, any[]>()
      for (const r of rows) {
        const v = r?.data?.[groupBy]
        const key = v === null || v === undefined || v === '' ? '(空)' : String(v)
        const arr = buckets.get(key)
        if (arr) arr.push(r)
        else buckets.set(key, [r])
      }
      const groups = [...buckets.entries()]
        .map(([value, grp]) => ({ value, count: grp.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_GROUPS)
      out.groupBy = { field: groupBy, label: meta.get(groupBy)?.label || groupBy, groups }
    }

    return out
  }
}

// ==================== 工具函数 ====================

function toNumber(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** 数值字段的分布：等宽分箱（最多 8 个区间） */
function histogram(values: number[], bins = 8): Array<{ range: string; count: number }> {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return [{ range: String(min), count: values.length }]
  const width = (max - min) / bins
  const counts = new Array(bins).fill(0)
  for (const v of values) {
    let i = Math.floor((v - min) / width)
    if (i >= bins) i = bins - 1
    if (i < 0) i = 0
    counts[i]++
  }
  return counts.map((count, i) => ({ range: `${round(min + i * width)}~${round(min + (i + 1) * width)}`, count }))
}

/** 分类字段的分布：取值 → 计数，按出现次数降序，最多 MAX_DISTINCT 项 */
function topDistribution(values: any[]): Array<{ value: any; count: number }> {
  const counts = new Map<string, { value: any; count: number }>()
  for (const v of values) {
    const k = typeof v === 'object' ? JSON.stringify(v) : String(v)
    const cur = counts.get(k)
    if (cur) cur.count++
    else counts.set(k, { value: v, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, MAX_DISTINCT)
}
