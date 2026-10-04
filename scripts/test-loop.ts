import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.DOMParser = dom.window.DOMParser
globalThis.document = dom.window.document

import { buildBeatEvents, buildLoopTimeline } from '../src/audio/metronome'
import { findStepIndex, resolveLoopPreset } from '../src/score/loop'
import { buildPerformancePath, parseMusicXml } from '../src/score/parser'
import { fullSampleXml, unclosedJumpXml } from '../src/score/samples'
import type { LoopPreset } from '../src/score/types'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const score = parseMusicXml(fullSampleXml())
const path = buildPerformancePath(score)
// 样例路径：0 1 2 3 4 5 | 2 3 4 | 6 7 8（反复 + 跳房 1/2）
assert(path.closed, '样例路径应闭合')

// 验收：第二次到达的起点不会误用第一次
const firstArrival = findStepIndex(path, 3, 1)
const secondArrival = findStepIndex(path, 3, 2)
assert(firstArrival === 3, `小节 3 第一次到达应在路径第 4 步，实际 ${firstArrival}`)
assert(secondArrival === 7, `小节 3 第二次到达应在路径第 8 步，实际 ${secondArrival}`)
assert(secondArrival !== firstArrival, '第二次到达不能解析到第一次到达的位置')

function preset(partial: Partial<LoopPreset>): LoopPreset {
  return {
    id: 'test',
    name: 'test',
    startMeasureIndex: 3,
    startOccurrence: 2,
    endMeasureIndex: 6,
    endOccurrence: 1,
    loops: 3,
    createdAt: new Date().toISOString(),
    ...partial,
  }
}

// 验收：跨反复/跳房的段落按所选路径顺序循环（第二次到达的小节 3 → 跳房后的第 6 小节）
const across = resolveLoopPreset(path, preset({}))
assert(across.ok, `跨跳房选段应可解析：${across.error ?? ''}`)
const segmentNumbers = across.stepIndices.map((index) => path.steps[index].measureNumber)
assert(
  JSON.stringify(segmentNumbers) === JSON.stringify(['3', '4', '6']),
  `选段应按路径顺序为 3/4/6，实际 ${segmentNumbers.join(', ')}`,
)
assert(
  across.segmentSeconds === path.steps[9].endSeconds - path.steps[7].startSeconds,
  '选段时长应来自路径步的起止时间',
)

// 验收：端点逆序不给播放
const reversed = resolveLoopPreset(path, preset({ startMeasureIndex: 6, startOccurrence: 1, endMeasureIndex: 3, endOccurrence: 1 }))
assert(!reversed.ok && reversed.error?.includes('逆序'), '端点逆序应被拒绝并说明原因')

// 不存在的到达次数不给播放
assert(!resolveLoopPreset(path, preset({ startOccurrence: 3 })).ok, '起点到达不存在应被拒绝')
assert(!resolveLoopPreset(path, preset({ endOccurrence: 2 })).ok, '终点到达不存在应被拒绝')

// 循环次数非法不给播放
assert(!resolveLoopPreset(path, preset({ loops: 0 })).ok, '循环次数 0 应被拒绝')

// 验收：路径不闭合时不给播放
const badPath = buildPerformancePath(parseMusicXml(unclosedJumpXml()))
assert(!badPath.closed, '缺少 Segno/Fine 的路径不应闭合')
const unclosed = resolveLoopPreset(badPath, preset({ startMeasureIndex: 0, startOccurrence: 1, endMeasureIndex: 1, endOccurrence: 1 }))
assert(!unclosed.ok && unclosed.error?.includes('未闭合'), '未闭合路径应被拒绝并说明原因')

// 播放展开：只调度选段已有的节拍事件，每轮按当前路径的速度/拍号展开
const beatEvents = buildBeatEvents(path.steps, score.measures)
const stepSet = new Set(across.stepIndices)
const segmentEvents = beatEvents.filter((event) => stepSet.has(event.stepIndex))
assert(segmentEvents.length > 0, '选段应有节拍事件')
assert(
  segmentEvents.every((event) => event.stepIndex >= 7 && event.stepIndex <= 9),
  '选段事件应只来自选中的路径步',
)
assert(path.steps[7].bpm === 120, '第二次到达的小节 3 应使用路径中的 120 速度')

const timeline = buildLoopTimeline(segmentEvents, path.steps[7].startSeconds, across.segmentSeconds, 3)
assert(timeline.length === segmentEvents.length * 3, '时间线应展开为 3 轮')
assert(Math.abs(timeline[0].time) < 1e-9, '循环时间线应从 0 开始')
for (let i = 1; i < timeline.length; i += 1) {
  assert(timeline[i].time >= timeline[i - 1].time, '循环时间线必须单调不减')
}
const round0 = timeline.slice(0, segmentEvents.length)
const round2 = timeline.slice(segmentEvents.length * 2)
for (let i = 0; i < round0.length; i += 1) {
  assert(Math.abs(round2[i].time - round0[i].time - 2 * across.segmentSeconds) < 1e-9, '第 3 轮应整体平移两轮时长')
  assert(round2[i].stepIndex === round0[i].stepIndex, '每一轮应保持相同的路径步顺序')
}

// 弱起选段：弱起小节按实际时长只给 1 拍，而不是完整小节的 3 拍
const pickupLoop = resolveLoopPreset(path, preset({ startMeasureIndex: 0, startOccurrence: 1, endMeasureIndex: 1, endOccurrence: 1 }))
assert(pickupLoop.ok, '含弱起的选段应可解析')
const pickupEvents = beatEvents.filter((event) => event.stepIndex === 0)
assert(pickupEvents.length === 1 && pickupEvents[0].totalBeats === 1, '弱起小节应只有 1 拍')

console.log(JSON.stringify({
  ok: true,
  segment: segmentNumbers,
  secondArrivalStep: secondArrival,
  segmentSeconds: across.segmentSeconds,
  timelineEvents: timeline.length,
}, null, 2))
