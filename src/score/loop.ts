import type { BuiltPath, LoopPreset, PathStep } from './types'

export interface LoopSegment {
  startStepIndex: number
  endStepIndex: number
  steps: PathStep[]
  durationSeconds: number
}

export type LoopValidationCode =
  | 'no-path'
  | 'path-not-closed'
  | 'start-not-found'
  | 'end-not-found'
  | 'endpoints-reversed'

export interface LoopValidationResult {
  valid: boolean
  code?: LoopValidationCode
  message?: string
  segment: LoopSegment | null
}

export function findStepIndex(path: BuiltPath, measureIndex: number, occurrence: number): number {
  return path.steps.findIndex((step) => step.measureIndex === measureIndex && step.occurrence === occurrence)
}

/**
 * 按“实际到达”（书面小节 + 第几次到达）解析循环段落。
 * 同一个书面小节的第二次到达不会与第一次混淆：匹配的是路径中的具体节点。
 * 路径不闭合或端点逆序时返回显式原因，调用方不得播放。
 */
export function resolveLoopSegment(path: BuiltPath | null, preset: LoopPreset): LoopValidationResult {
  if (!path) {
    return { valid: false, code: 'no-path', message: '还没有可演奏的路径。', segment: null }
  }
  if (!path.closed) {
    return { valid: false, code: 'path-not-closed', message: '演奏路径存在错误且无法闭合，循环练习不会启动。', segment: null }
  }

  const startStepIndex = findStepIndex(path, preset.startMeasureIndex, preset.startOccurrence)
  if (startStepIndex < 0) {
    return { valid: false, code: 'start-not-found', message: `起点（书面小节 ${preset.startMeasureIndex + 1} · 第 ${preset.startOccurrence} 次到达）不在当前路径中。`, segment: null }
  }
  const endStepIndex = findStepIndex(path, preset.endMeasureIndex, preset.endOccurrence)
  if (endStepIndex < 0) {
    return { valid: false, code: 'end-not-found', message: `终点（书面小节 ${preset.endMeasureIndex + 1} · 第 ${preset.endOccurrence} 次到达）不在当前路径中。`, segment: null }
  }
  if (endStepIndex < startStepIndex) {
    return {
      valid: false,
      code: 'endpoints-reversed',
      message: `终点在实际路径中早于起点（起点第 ${startStepIndex + 1} 个节点，终点第 ${endStepIndex + 1} 个节点），端点逆序不能播放。`,
      segment: null,
    }
  }

  const steps = path.steps.slice(startStepIndex, endStepIndex + 1)
  return {
    valid: true,
    segment: {
      startStepIndex,
      endStepIndex,
      steps,
      durationSeconds: steps.reduce((sum, step) => sum + step.durationSeconds, 0),
    },
  }
}

/** 循环本地时间（从 0 开始）换算当前轮次：循环 n 次时轮次范围 1..n。 */
export function roundAt(localTime: number, durationSeconds: number, loops: number): number {
  if (durationSeconds <= 0) return 1
  return Math.min(loops, Math.floor(localTime / durationSeconds) + 1)
}
