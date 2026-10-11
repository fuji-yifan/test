/**
 * 流程图分层布局（纯函数，无第三方依赖）
 *
 * 输入是 agent 产出的流程 artifact：节点只有 id/type/label，边只有 source/target，
 * 都不带坐标。这里用「最长路径分层 + 一趟重心排序」算出坐标，是**唯一**的布局口径 ——
 * web 的预览卡片（FlowPreviewGraph）与 agent 落库（saveProcessDraft）都调用它，
 * 从而「预览 = 流程设计器 = 流程进度查看」三处一致。
 *
 * 尺寸表与类型别名是照抄流程设计器 / 流程进度查看画布得出的（圆 60、网关 150×80、
 * 矩形 180×58），边的取点方式也照抄设计器 ProcessDesigner 的 edgePaths。
 */

/** 节点盒子尺寸（画布口径；未知类型按普通矩形兜底） */
const FLOW_NODE_SIZES: Record<string, { w: number; h: number }> = {
  start: { w: 60, h: 60 },
  end: { w: 60, h: 60 },
  approval: { w: 180, h: 58 },
  cc: { w: 180, h: 58 },
  'auto-task': { w: 180, h: 58 },
  condition: { w: 150, h: 80 },
  parallel: { w: 150, h: 80 },
  join: { w: 150, h: 80 },
}

const FALLBACK_SIZE = { w: 180, h: 58 }

/**
 * 落点网格（px）。与流程设计器 ProcessDesigner 的 `GRID_SIZE` 同值 —— 设计器在
 * 拖动抬手时会把节点吸附到该网格上；布局若不对齐网格，agent 建的流程一被单击/拖动
 * 就会「微调」几像素。这里提前对齐，预览 = 设计器 = 后续拖动三者稳定。
 */
export const FLOW_LAYOUT_GRID = 15

function snapFlowGrid(v: number): number {
  return Math.round(v / FLOW_LAYOUT_GRID) * FLOW_LAYOUT_GRID
}

/**
 * agent 的节点词汇和设计器/进度查看不完全同名，映射到语义最接近的节点：
 * notify（通知）→ cc（抄送）、service（服务）→ auto-task（自动处理）。
 * SDK 的 NodeType 联合里不新增这两个词，改在落库/布局边界归一。
 */
const FLOW_TYPE_ALIAS: Record<string, string> = {
  notify: 'cc',
  service: 'auto-task',
}

/** 把 agent 词汇归一成画布认得的节点类型 */
export function normalizeFlowType(type: string | undefined): string {
  return (type && FLOW_TYPE_ALIAS[type]) || type || ''
}

/** 取节点盒子尺寸（内部先做类型别名归一） */
export function flowNodeSize(type: string | undefined): { w: number; h: number } {
  return FLOW_NODE_SIZES[normalizeFlowType(type)] || FALLBACK_SIZE
}

export interface LaidNode {
  id: string
  type: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface LaidEdge {
  id: string
  d: string
  label: string
  labelX: number
  labelY: number
  labelW: number
  /** 指回更上层（或有环）的边，从右侧绕行 */
  back: boolean
}

export interface FlowLayout {
  nodes: LaidNode[]
  edges: LaidEdge[]
  width: number
  height: number
}

const H_GAP = 24
/** 留出连线标签块（18px 高，落在中点）的空间 */
const V_GAP = 56
const PAD = 24
/** 回边从右侧绕行时预留的余量 */
const BACK_GUTTER = 56

interface PlainNode {
  id: string
  type: string
  label: string
}

interface PlainEdge {
  id: string
  source: string
  target: string
  label: string
}

/** artifact 是 SSE 传来的 JSON，边界处做一次归一 */
function asRecords(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return []
  return v.filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function normalizeNodes(raw: unknown): PlainNode[] {
  const seen = new Set<string>()
  const out: PlainNode[] = []
  for (const n of asRecords(raw)) {
    const id = str(n.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, type: str(n.type), label: str(n.label) || id })
  }
  return out
}

function normalizeEdges(raw: unknown, ids: Set<string>): PlainEdge[] {
  const seen = new Set<string>()
  const out: PlainEdge[] = []
  for (const e of asRecords(raw)) {
    const source = str(e.source)
    const target = str(e.target)
    // 悬空边、自环都不画
    if (!source || !target || source === target) continue
    if (!ids.has(source) || !ids.has(target)) continue
    const key = `${source}\u0000${target}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: str(e.id) || `e${out.length}`,
      source,
      target,
      // 标签优先取人话 label，其次才是表达式 condition —— 与设计器（edgePaths 用 e.label）
      // 和 agent 落库（label = e.label || e.condition）同一口径，避免预览显示源码式表达式
      label: str(e.label) || str(e.condition),
    })
  }
  return out
}

export function layoutFlow(rawNodes: unknown, rawEdges: unknown): FlowLayout {
  const nodes = normalizeNodes(rawNodes)
  const ids = nodes.map((n) => n.id)
  const idSet = new Set(ids)
  const edges = normalizeEdges(rawEdges, idSet)

  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  // ---- 分层：Kahn 拓扑排序求最长路径层号 ----
  const indeg = new Map<string, number>()
  const succ = new Map<string, string[]>()
  for (const id of ids) {
    indeg.set(id, 0)
    succ.set(id, [])
  }
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1)
    succ.get(e.source)?.push(e.target)
  }

  const layer = new Map<string, number>()
  const settled = new Set<string>()
  for (const id of ids) layer.set(id, 0)

  const queue = ids.filter((id) => indeg.get(id) === 0)
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]
    settled.add(id)
    for (const nx of succ.get(id) || []) {
      layer.set(nx, Math.max(layer.get(nx) || 0, (layer.get(id) || 0) + 1))
      const left = (indeg.get(nx) || 0) - 1
      indeg.set(nx, left)
      if (left === 0) queue.push(nx)
    }
  }

  // 成环的节点进不了队列，兜底压到最后一行，保证每个节点都能画出来
  let maxLayer = 0
  for (const id of ids) if (settled.has(id)) maxLayer = Math.max(maxLayer, layer.get(id) || 0)
  for (const id of ids) if (!settled.has(id)) layer.set(id, maxLayer + 1)

  // ---- 分层 + 层内一趟重心排序 ----
  const rows: string[][] = []
  for (const id of ids) {
    const L = layer.get(id) || 0
    if (!rows[L]) rows[L] = []
    rows[L].push(id)
  }

  const idxInRow = new Map<string, number>()
  for (let L = 0; L < rows.length; L++) {
    const row = rows[L] || []
    if (L > 0) {
      const bary = new Map<string, number>()
      for (const id of row) {
        const parents: number[] = []
        for (const e of edges) {
          if (e.target !== id) continue
          const p = idxInRow.get(e.source)
          if (p !== undefined) parents.push(p)
        }
        // 没有已落位父节点的（含起点、孤立点）排到最后
        bary.set(
          id,
          parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Number.MAX_SAFE_INTEGER,
        )
      }
      row.sort((a, b) => (bary.get(a) || 0) - (bary.get(b) || 0))
    }
    row.forEach((id, i) => idxInRow.set(id, i))
  }

  // ---- 坐标：行高取该行最大节点高，节点在行带内垂直居中 ----
  const sizeOf = new Map<string, { w: number; h: number }>()
  const byId = new Map<string, PlainNode>()
  for (const n of nodes) {
    byId.set(n.id, n)
    sizeOf.set(n.id, flowNodeSize(n.type))
  }

  const rowW = rows.map((row) =>
    row.reduce((acc, id, i) => acc + (sizeOf.get(id)?.w || 0) + (i > 0 ? H_GAP : 0), 0),
  )
  const rowH = rows.map((row) => row.reduce((mx, id) => Math.max(mx, sizeOf.get(id)?.h || 0), 0))

  let contentW = 0
  for (const w of rowW) if (w > contentW) contentW = w

  const hasBack = edges.some((e) => (layer.get(e.target) || 0) <= (layer.get(e.source) || 0))
  const width = PAD * 2 + contentW + (hasBack ? BACK_GUTTER : 0)

  const bandTop: number[] = []
  let yCursor = PAD
  for (let L = 0; L < rows.length; L++) {
    bandTop[L] = yCursor
    yCursor += (rowH[L] || 0) + V_GAP
  }
  const height = yCursor - V_GAP + PAD

  const laidNodes: LaidNode[] = []
  for (let L = 0; L < rows.length; L++) {
    const row = rows[L] || []
    let x = PAD + (contentW - (rowW[L] || 0)) / 2
    for (const id of row) {
      const n = byId.get(id)
      const s = sizeOf.get(id)
      if (!n || !s) continue
      laidNodes.push({
        id,
        type: n.type,
        label: n.label,
        // 落点对齐网格：行内各节点宽都是 15 的倍数，逐点吸附后仍共享同一竖直中线
        x: snapFlowGrid(x),
        y: snapFlowGrid(bandTop[L] + ((rowH[L] || 0) - s.h) / 2),
        w: s.w,
        h: s.h,
      })
      x += s.w + H_GAP
    }
  }

  const laidById = new Map<string, LaidNode>()
  for (const n of laidNodes) laidById.set(n.id, n)

  // ---- 连线：取点方式照抄设计器的 edgePaths ----
  const laidEdges: LaidEdge[] = []
  for (const e of edges) {
    const s = laidById.get(e.source)
    const t = laidById.get(e.target)
    if (!s || !t) continue
    // 设计器按中文长度估算标签宽度，这里保持同样的口径
    const labelW = e.label.length * 12

    if (t.y <= s.y) {
      // 回边：从右侧绕出去，避免穿过中间各层节点
      const sx = s.x + s.w
      const sy = s.y + s.h / 2
      const tx = t.x + t.w
      const ty = t.y + t.h / 2
      const mx = width - PAD - BACK_GUTTER / 2
      laidEdges.push({
        id: e.id,
        d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`,
        label: e.label,
        labelX: mx,
        labelY: (sy + ty) / 2 - 6,
        labelW,
        back: true,
      })
    } else {
      const x1 = s.x + s.w / 2
      const y1 = s.y + s.h
      const x2 = t.x + t.w / 2
      const midY = (y1 + t.y) / 2
      laidEdges.push({
        id: e.id,
        d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${t.y}`,
        label: e.label,
        labelX: (x1 + x2) / 2,
        labelY: midY - 6,
        labelW,
        back: false,
      })
    }
  }

  return { nodes: laidNodes, edges: laidEdges, width, height }
}
