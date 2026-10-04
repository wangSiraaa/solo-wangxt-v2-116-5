import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.DOMParser = dom.window.DOMParser
globalThis.document = dom.window.document

import { buildBeatEvents } from '../src/audio/metronome'
import { resolveLoopSegment, roundAt } from '../src/score/loop'
import { buildPerformancePath, parseMusicXml } from '../src/score/parser'
import { fullSampleXml, unclosedJumpXml } from '../src/score/samples'
import type { LoopPreset } from '../src/score/types'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const score = parseMusicXml(fullSampleXml())
const path = buildPerformancePath(score)

// 样例实际路径：0 1 2 3 4 5 | 2 3 4 | 6 7 8（书面小节编号）
// 书面小节 3（measureIndex 3）到达两次：第一次在第 4 个节点，第二次在反复返回后（节点 8）。
const firstArrivalStep = path.steps.findIndex((step) => step.measureIndex === 3 && step.occurrence === 1)
const secondArrivalStep = path.steps.findIndex((step) => step.measureIndex === 3 && step.occurrence === 2)
assert(firstArrivalStep === 3, `第一次到达小节 3 应在节点 4，实际 ${firstArrivalStep + 1}`)
assert(secondArrivalStep === 7, `第二次到达小节 3 应在节点 8，实际 ${secondArrivalStep + 1}`)

// 第二次到达的小节 3 → 跳房 2 后的小节 6（measureIndex 6 只到达一次，在跳房 2 中）。
const preset: LoopPreset = {
  id: 'p1',
  name: '第二遍 3→6',
  startMeasureIndex: 3,
  startOccurrence: 2,
  endMeasureIndex: 6,
  endOccurrence: 1,
  loops: 3,
  createdAt: new Date().toISOString(),
}
const result = resolveLoopSegment(path, preset)
assert(result.valid, `合法段落应可解析：${result.message ?? ''}`)
const segment = result.segment!
assert(segment.startStepIndex === 7, '起点必须解析为第二次到达，不能误用第一次')
assert(segment.endStepIndex === 9, '终点应落在跳房 2 的小节 6')
const order = segment.steps.map((step) => step.measureNumber)
assert(JSON.stringify(order) === JSON.stringify(['3', '4', '6']), `跨反复/跳房段落顺序应为 3,4,6，实际 ${order.join(',')}`)
// 段落中的跳房 1（小节 5）与第一遍内容都不应出现。
assert(!segment.steps.some((step) => step.measureNumber === '5'), '循环段落不应包含跳房 1 的小节 5')
assert(!segment.steps.some((step) => step.measureNumber === '2'), '循环段落不应包含反复返回点之前的小节 2')

// 节拍事件：只调度该段已有事件，时间从 0 重新计；第一拍是起点小节的重拍。
const events = buildBeatEvents(path.steps, score.measures, {
  rebaseToZero: true,
  firstStepIndex: segment.startStepIndex,
  lastStepIndex: segment.endStepIndex,
})
assert(events.length > 0, '段落应产生节拍事件')
assert(events[0].time === 0, '段落第一拍应从本地时间 0 开始')
assert(events[0].stepIndex === 7, '第一拍必须属于第二次到达的小节 3')
assert(events[0].accent, '每轮第一拍应为重音')
assert(events.every((event) => event.stepIndex >= 7 && event.stepIndex <= 9), '节拍事件只能来自所选段落的路径节点')

// 速度按当前路径：第二遍小节 3 沿用第 3 小节改变后的速度。
assert(segment.steps[0].bpm === 120, `第二遍小节 3 应使用 ♩=120，实际 ${segment.steps[0].bpm}`)
// 轮次计算
assert(roundAt(0, segment.durationSeconds, 3) === 1, '起始应显示第 1 轮')
assert(roundAt(segment.durationSeconds + 0.01, segment.durationSeconds, 3) === 2, '跨过边界应进入第 2 轮')
assert(roundAt(segment.durationSeconds * 3, segment.durationSeconds, 3) === 3, '结束时应停在第 3 轮')

// 第二次到达误用第一次的反向验证：用 occurrence=1 会得到不同（更早）的节点。
const wrongStart = resolveLoopSegment(path, { ...preset, startOccurrence: 1 })
assert(wrongStart.valid && wrongStart.segment!.startStepIndex === 3, '第一次到达应解析到节点 4（用于对比，确保两次到达被区分）')
assert(wrongStart.segment!.startStepIndex !== segment.startStepIndex, '第一次与第二次到达必须解析为不同节点')

// 端点逆序：起点在第二次到达（节点 8），终点取只在第一遍出现的跳房 1 小节 5（节点 6）→ 拒绝播放。
const reversed = resolveLoopSegment(path, {
  ...preset,
  endMeasureIndex: 4,
  endOccurrence: 1,
})
assert(!reversed.valid && reversed.code === 'endpoints-reversed', '端点逆序必须被拒绝')

// 不存在的到达次数 → 拒绝播放。
const missing = resolveLoopSegment(path, { ...preset, startOccurrence: 9 })
assert(!missing.valid && missing.code === 'start-not-found', '不存在的到达必须被拒绝')

// 路径不闭合（D.S. 缺 Segno 的样例）→ 任何预设都不给播放。
const badScore = parseMusicXml(unclosedJumpXml())
const badPath = buildPerformancePath(badScore)
const badResult = resolveLoopSegment(badPath, {
  ...preset,
  startMeasureIndex: 0,
  startOccurrence: 1,
  endMeasureIndex: 1,
  endOccurrence: 1,
})
assert(!badResult.valid && badResult.code === 'path-not-closed', '路径不闭合时不允许循环播放')

console.log(JSON.stringify({
  segmentOrder: order,
  segmentDurationSeconds: Number(segment.durationSeconds.toFixed(3)),
  beatCount: events.length,
  rounds: [
    roundAt(0, segment.durationSeconds, 3),
    roundAt(segment.durationSeconds + 0.01, segment.durationSeconds, 3),
    roundAt(segment.durationSeconds * 3, segment.durationSeconds, 3),
  ],
  reversedRejected: reversed.code,
  missingRejected: missing.code,
  unclosedRejected: badResult.code,
}, null, 2))
console.log('循环练习预设：全部验收断言通过。')
