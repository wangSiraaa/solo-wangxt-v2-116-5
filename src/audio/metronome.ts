import type { PathStep, WrittenMeasure } from '../score/types'

export interface BeatEvent {
  id: string
  stepIndex: number
  measureIndex: number
  occurrence: number
  beat: number
  totalBeats: number
  time: number
  accent: boolean
}

export interface BeatPosition {
  stepIndex: number
  event: BeatEvent
  progress: number
}

export interface LoopOptions {
  durationSeconds: number
  loops: number
}

export interface BeatBuildOptions {
  /** 重新从 0 计时（用于只调度某个路径子段），默认使用路径绝对时间。 */
  rebaseToZero?: boolean
  /** rebaseToZero 时，只保留该范围内（含两端）的路径步骤。 */
  firstStepIndex?: number
  lastStepIndex?: number
}

function beatDurationSeconds(measure: WrittenMeasure, bpm: number): number {
  const denominator = measure.timeSignature?.denominator ?? 4
  return (60 / bpm) * (4 / denominator)
}

export function buildBeatEvents(
  steps: PathStep[],
  measures: WrittenMeasure[],
  options: BeatBuildOptions = {},
): BeatEvent[] {
  const events: BeatEvent[] = []
  const first = options.firstStepIndex ?? 0
  const last = Math.min(options.lastStepIndex ?? steps.length - 1, steps.length - 1)
  let localTime = 0
  let baseTime: number | null = null
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex]
    const measure = measures[step.measureIndex]
    const beatUnit = beatDurationSeconds(measure, step.bpm)
    const denominator = measure.timeSignature?.denominator ?? 4
    const totalBeats = Math.max(1, Math.round(measure.durationQuarters / (4 / denominator)))
    const inSegment = !options.rebaseToZero || (stepIndex >= first && stepIndex <= last)
    for (let beat = 0; beat < totalBeats; beat += 1) {
      if (inSegment) {
        if (baseTime === null) baseTime = localTime
        events.push({
          id: `${stepIndex}-${beat}`,
          stepIndex,
          measureIndex: step.measureIndex,
          occurrence: step.occurrence,
          beat,
          totalBeats,
          time: options.rebaseToZero ? localTime - baseTime : step.startSeconds + beat * beatUnit,
          accent: beat === 0,
        })
      }
      localTime += beatUnit
    }
  }
  return events
}

export class Metronome {
  private context: AudioContext | null = null
  private timer: number | null = null
  private finishTimer: number | null = null
  private startedAtContextTime = 0
  private startedAtScoreTime = 0
  private nextBeatIndex = 0
  private currentLoop = 0
  private events: BeatEvent[] = []
  private loopDuration: number | null = null
  private loopCount = 1
  private running = false
  private readonly lookaheadSeconds = 0.08
  private readonly scheduleAheadSeconds = 0.28
  private readonly onBeat?: (event: BeatEvent) => void
  private readonly onFinish?: () => void

  constructor(onBeat?: (event: BeatEvent) => void, onFinish?: () => void) {
    this.onBeat = onBeat
    this.onFinish = onFinish
  }

  get isRunning(): boolean {
    return this.running
  }

  async start(events: BeatEvent[], scoreTime = 0, loop: LoopOptions | null = null): Promise<void> {
    this.stopSoundOnly()
    this.events = events
    const context = new AudioContext()
    this.context = context
    await context.resume()

    this.loopDuration = loop && loop.durationSeconds > 0 ? loop.durationSeconds : null
    this.loopCount = Math.max(1, loop?.loops ?? 1)

    if (this.loopDuration !== null) {
      this.currentLoop = Math.min(this.loopCount - 1, Math.floor(scoreTime / this.loopDuration))
      const withinLoop = scoreTime - this.currentLoop * this.loopDuration
      const firstIndex = events.findIndex((event) => event.time >= withinLoop - 0.001)
      this.nextBeatIndex = firstIndex < 0 ? events.length : firstIndex
    } else {
      this.currentLoop = 0
      const firstIndex = events.findIndex((event) => event.time >= scoreTime - 0.001)
      this.nextBeatIndex = firstIndex < 0 ? events.length : firstIndex
    }
    this.startedAtScoreTime = scoreTime
    this.startedAtContextTime = context.currentTime + 0.1
    this.running = true
    this.pump()
  }

  stop(): void {
    this.stopSoundOnly()
  }

  get currentTime(): number {
    if (!this.context || !this.running) return this.startedAtScoreTime
    return this.startedAtScoreTime + (this.context.currentTime - this.startedAtContextTime)
  }

  positionAt(scoreTime: number): BeatPosition | null {
    if (!this.events.length) return null
    const localTime = this.loopDuration !== null ? scoreTime % this.loopDuration : scoreTime
    let current = this.events[0]
    let index = 0
    for (let i = 0; i < this.events.length; i += 1) {
      if (this.events[i].time <= localTime + 0.001) {
        current = this.events[i]
        index = i
      } else {
        break
      }
    }
    const next = this.events[index + 1]
    const duration = next ? next.time - current.time : 0.5
    const progress = duration > 0 ? Math.min(1, Math.max(0, (localTime - current.time) / duration)) : 0
    return { stepIndex: current.stepIndex, event: current, progress }
  }

  private pump = (): void => {
    if (!this.running || !this.context) return
    const perLoop = this.loopDuration
    const totalLoopTime = perLoop !== null ? perLoop * this.loopCount : Number.POSITIVE_INFINITY
    while (this.nextBeatIndex < this.events.length) {
      const event = this.events[this.nextBeatIndex]
      const beatAbsolute = (perLoop ?? 0) * this.currentLoop + event.time
      // 段落末边界上的那一拍属于“这段已有节拍事件”；只在最后一轮结束后停止，避免多打一下。
      if (beatAbsolute > totalLoopTime + 0.001) {
        this.nextBeatIndex = this.events.length
        break
      }
      if (this.scoreTimeToContextTime(beatAbsolute) >= this.context.currentTime + this.scheduleAheadSeconds) break
      const when = Math.max(this.context.currentTime + 0.01, this.scoreTimeToContextTime(beatAbsolute))
      this.scheduleClick(when, event.accent)
      const delay = Math.max(0, (when - this.context.currentTime) * 1000)
      window.setTimeout(() => this.onBeat?.(event), delay)
      this.nextBeatIndex += 1
    }

    if (this.nextBeatIndex >= this.events.length) {
      this.currentLoop += 1
      if (perLoop !== null && this.currentLoop < this.loopCount) {
        this.nextBeatIndex = 0
      } else {
        this.running = false
        const finishAt = this.scoreTimeToContextTime(totalLoopTime)
        const remainingMs = Math.max(0, (finishAt - this.context.currentTime) * 1000)
        this.finishTimer = window.setTimeout(() => {
          this.finishTimer = null
          this.onFinish?.()
        }, remainingMs)
        return
      }
    }
    this.timer = window.setTimeout(this.pump, this.lookaheadSeconds * 1000)
  }

  private scoreTimeToContextTime(scoreTime: number): number {
    return this.startedAtContextTime + (scoreTime - this.startedAtScoreTime)
  }

  private scheduleClick(when: number, accent: boolean): void {
    if (!this.context) return
    const context = this.context
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = accent ? 'sine' : 'triangle'
    oscillator.frequency.value = accent ? 1320 : 880
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, when + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.07)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(when)
    oscillator.stop(when + 0.08)
  }

  private stopSoundOnly(): void {
    this.running = false
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    if (this.finishTimer !== null) {
      window.clearTimeout(this.finishTimer)
      this.finishTimer = null
    }
    if (this.context) {
      void this.context.close()
      this.context = null
    }
  }
}
