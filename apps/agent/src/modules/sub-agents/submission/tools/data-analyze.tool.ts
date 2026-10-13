import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'data_analyze',
  description: '本地统计分析：中位数、标准差、趋势方向、Z-Score 异常检测。在数据量不大的情况下纯本地计算。',
  inputSchema: z.object({
    values: z.array(z.number()).describe('数值数组'),
    labels: z.array(z.string()).optional().describe('对应标签（日期/分类）'),
  }),
  riskLevel: 'low',
  // 结果校验（阶段 6 / S7.3）：分析结果必须带 summary 文本（fail-closed）。
  outputSchema: z.object({ summary: z.string() }).passthrough(),
})
export class DataAnalyzeTool {
  async execute(args: { values: number[]; labels?: string[] }): Promise<any> {
    const vals = args.values
    if (!vals.length) return { summary: 'No data to analyze' }

    // 平均值
    const sum = vals.reduce((a, b) => a + b, 0)
    const mean = sum / vals.length

    // 中位数
    const sorted = [...vals].sort((a, b) => a - b)
    const median = vals.length % 2 === 0
      ? (sorted[vals.length / 2 - 1] + sorted[vals.length / 2]) / 2
      : sorted[Math.floor(vals.length / 2)]

    // 标准差
    const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length
    const stdDev = Math.sqrt(variance)

    // 趋势（简单线性回归斜率）
    const n = vals.length
    const xMean = (n - 1) / 2
    const yMean = mean
    let numerator = 0, denominator = 0
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (vals[i] - yMean)
      denominator += (i - xMean) ** 2
    }
    const slope = denominator !== 0 ? numerator / denominator : 0
    const direction = Math.abs(slope) < 0.05 ? 'stable' : slope > 0 ? 'up' : 'down'

    // Z-Score 异常检测（|Z| > 2.0 标记异常）
    const anomalies: Array<{ index: number; label?: string; value: number; zScore: number }> = []
    if (stdDev > 0) {
      for (let i = 0; i < vals.length; i++) {
        const zScore = (vals[i] - mean) / stdDev
        if (Math.abs(zScore) > 2.0) {
          anomalies.push({ index: i, label: args.labels?.[i], value: vals[i], zScore: Math.round(zScore * 100) / 100 })
        }
      }
    }

    return {
      summary: `Analysis: n=${n}, mean=${mean.toFixed(2)}, median=${median.toFixed(2)}, std=${stdDev.toFixed(2)}, trend=${direction}, anomalies=${anomalies.length}`,
      stats: { count: n, sum, mean, median, stdDev, slope, direction },
      anomalies,
    }
  }
}
