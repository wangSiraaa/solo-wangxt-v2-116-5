import type { BuiltPath, LoopPreset } from './types'

export interface ResolvedLoop {
  ok: boolean
  error: string | null
  startStepIndex: number
  endStepIndex: number
  stepIndices: number[]
  segmentSeconds: number
  loops: number
}

function failure(error: string): ResolvedLoop {
  return { ok: false, error, startStepIndex: -1, endStepIndex: -1, stepIndices: [], segmentSeconds: 0, loops: 0 }
}

export function findStepIndex(path: BuiltPath, measureIndex: number, occurrence: number): number {
  return path.steps.findIndex((step) => step.measureIndex === measureIndex && step.occurrence === occurrence)
}

function measureLabel(path: BuiltPath, measureIndex: number): string {
  return path.steps.find((step) => step.measureIndex === measureIndex)?.measureNumber ?? `#${measureIndex + 1}`
}

export function resolveLoopPreset(path: BuiltPath | null, preset: LoopPreset): ResolvedLoop {
  if (!path || !path.steps.length) return failure('还没有可用的演奏路径。')
  if (!path.closed) return failure('演奏路径未闭合，不能启动循环练习。')
  if (!Number.isFinite(preset.loops) || preset.loops < 1) return failure('循环次数至少为 1。')

  const startStepIndex = findStepIndex(path, preset.startMeasureIndex, preset.startOccurrence)
  if (startStepIndex < 0) {
    return failure(`起点不存在：小节 ${measureLabel(path, preset.startMeasureIndex)} 在路径中没有第 ${preset.startOccurrence} 次到达。`)
  }
  const endStepIndex = findStepIndex(path, preset.endMeasureIndex, preset.endOccurrence)
  if (endStepIndex < 0) {
    return failure(`终点不存在：小节 ${measureLabel(path, preset.endMeasureIndex)} 在路径中没有第 ${preset.endOccurrence} 次到达。`)
  }
  if (endStepIndex < startStepIndex) return failure('终点在路径上位于起点之前（端点逆序），不能循环。')

  const stepIndices: number[] = []
  for (let index = startStepIndex; index <= endStepIndex; index += 1) stepIndices.push(index)
  const segmentSeconds = path.steps[endStepIndex].endSeconds - path.steps[startStepIndex].startSeconds
  if (!(segmentSeconds > 0)) return failure('选段时长为零，无法循环。')

  return {
    ok: true,
    error: null,
    startStepIndex,
    endStepIndex,
    stepIndices,
    segmentSeconds,
    loops: Math.floor(preset.loops),
  }
}
