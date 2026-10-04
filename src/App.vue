<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <h1>本地乐谱排练台</h1>
        <p>明确记号构造演奏路径 · Web Audio 节拍参考 · IndexedDB 本地工程 · 纯前端</p>
      </div>
      <div class="top-actions">
        <label class="button secondary">
          打开 MusicXML
          <input type="file" accept=".xml,.musicxml,application/xml,text/xml" @change="onFileSelected" />
        </label>
        <label class="button secondary">
          导入工程
          <input type="file" accept=".json,application/json" @change="onProjectImport" />
        </label>
        <button class="button primary" :disabled="!project" @click="saveCurrentProject">保存到本机</button>
        <button class="button secondary" :disabled="!project" @click="downloadOriginalXml">导出原 XML</button>
        <button class="button secondary" :disabled="!project" @click="downloadProjectBundle">导出工程包</button>
      </div>
    </header>

    <main class="workspace">
      <aside class="sidebar">
        <section class="panel">
          <h2>样例</h2>
          <div class="sample-list">
            <button v-for="sample in sampleLibrary" :key="sample.name" class="button sample" @click="loadSample(sample)">
              {{ sample.name }}
            </button>
          </div>
        </section>

        <section class="panel">
          <h2>本机工程</h2>
          <div v-if="projects.length === 0" class="muted">IndexedDB 中还没有工程。</div>
          <div v-for="item in projects" :key="item.id" class="project-row">
            <button class="link-button" @click="loadStoredProject(item)">{{ item.name }}</button>
            <small>{{ formatDate(item.updatedAt) }} · {{ item.marks.length }} 标记</small>
            <button class="danger" @click="removeStoredProject(item.id)">删除</button>
          </div>
        </section>

        <section class="panel status-panel">
          <h2>路径状态</h2>
          <div :class="['status-badge', path?.closed ? 'ok' : 'bad']">
            {{ path?.closed ? '路径可闭合' : '路径存在错误' }}
          </div>
          <div v-if="path" class="stat-grid">
            <span>实际小节</span><strong>{{ path.steps.length }}</strong>
            <span>书面小节</span><strong>{{ score?.measures.length ?? 0 }}</strong>
            <span>总时长</span><strong>{{ formatTime(path.totalSeconds) }}</strong>
          </div>
        </section>
      </aside>

      <section class="score-column">
        <div class="transport panel">
          <button class="button primary" :disabled="!path" @click="togglePlayback">{{ playing ? '暂停' : '播放/节拍' }}</button>
          <button class="button secondary" :disabled="!path" @click="stopPlayback">停止</button>
          <label>
            起始书面小节
            <select v-model.number="selectedMeasureIndex" :disabled="!score">
              <option v-for="measure in score?.measures ?? []" :key="measure.index" :value="measure.index">
                {{ measure.number }} {{ measure.isPickup ? '（弱起）' : '' }}
              </option>
            </select>
          </label>
          <label>
            到达次数
            <select v-model.number="selectedOccurrence" :disabled="!selectedOccurrences.length">
              <option v-for="occurrence in selectedOccurrences" :key="occurrence" :value="occurrence">
                第 {{ occurrence }} 次到达
              </option>
            </select>
          </label>
          <div class="timeline">
            <div class="timeline-bar"><div :style="{ width: `${playProgress * 100}%` }" /></div>
            <span>{{ formatTime(activeMode === 'loop' ? loopTime : currentScoreTime) }} / {{ activeMode === 'loop' ? formatTime(activeLoopDuration) : path ? formatTime(path.totalSeconds) : '0:00.0' }}</span>
          </div>
        </div>

        <div class="score-wrap">
          <ScoreView
            v-if="project && score && path"
            :xml="project.originalXml"
            :measures="score.measures"
            :path="path"
            :active-step-index="activeStepIndex"
            interactable
            @select-measure="chooseMeasure"
          />
          <div v-else class="empty-state">
            <strong>请打开一个 MusicXML 或加载样例。</strong>
            <p>所有数据只保存在当前浏览器；原始 XML 不会被重写。</p>
          </div>
        </div>
      </section>

      <aside class="sidebar right">
        <section class="panel">
          <h2>选定书面小节的实际到达</h2>
          <div v-if="selectedMeasure" class="measure-detail">
            <div class="detail-title">
              书面小节 {{ selectedMeasure.number }}
              <span v-if="selectedMeasure.isPickup" class="tag">弱起</span>
              <span v-if="selectedMeasure.hasMultipleVoices" class="tag">多声部</span>
              <span v-if="selectedMeasure.endings.length" class="tag">跳房</span>
            </div>
            <p v-if="!selectedOccurrences.length" class="muted">这个书面小节在当前演奏路径中不会被演奏。</p>
            <button
              v-for="occurrence in selectedOccurrences"
              :key="occurrence"
              :class="['arrival-button', { selected: occurrence === selectedOccurrence }]"
              @click="selectedOccurrence = occurrence"
            >
              第 {{ occurrence }} 次到达 · {{ arrivalDescription(occurrence) }}
            </button>
            <div v-if="selectedOccurrences.length" class="arrival-loop-actions">
              <button class="button secondary" @click="setLoopEndpoint('start')">设为循环起点</button>
              <button class="button secondary" @click="setLoopEndpoint('end')">设为循环终点</button>
            </div>
          </div>
        </section>

        <section class="panel loop-panel">
          <h2>循环练习预设</h2>
          <div class="loop-form">
            <input v-model="loopName" placeholder="预设名，如 第二遍第3小节→跳房2第6小节" />
            <div class="loop-endpoints">
              <label>
                起点
                <select v-model.number="loopStartStepIndex" :disabled="!path">
                  <option v-for="option in pathStepOptions" :key="`s-${option.value}`" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label>
                终点
                <select v-model.number="loopEndStepIndex" :disabled="!path">
                  <option v-for="option in pathStepOptions" :key="`e-${option.value}`" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="loop-count">
                循环次数
                <input v-model.number="loopLoops" type="number" min="1" max="99" step="1" :disabled="!path" />
              </label>
            </div>
            <p class="loop-preview">{{ draftLoopSummary }}</p>
            <p v-if="draftLoopIssue" class="loop-issue">{{ draftLoopIssue }}</p>
            <div class="loop-actions">
              <button class="button primary" :disabled="!project || Boolean(draftLoopIssue)" @click="saveLoopPreset">保存预设到本工程</button>
              <button class="button secondary" :disabled="!project || Boolean(draftLoopIssue)" @click="startDraftLoop">立即练习此段</button>
            </div>
          </div>

          <div class="preset-list">
            <p v-if="!project?.loopPresets.length" class="muted">还没有循环预设。端点按“实际路径节点”选择，第二次到达与第一次明确分开。</p>
            <article v-for="preset in project?.loopPresets ?? []" :key="preset.id" :class="{ active: activeLoopId === preset.id }">
              <strong>{{ preset.name }}</strong>
              <p>{{ presetSummary(preset) }}</p>
              <p v-if="presetIssue(preset)" class="loop-issue">{{ presetIssue(preset) }}</p>
              <div class="preset-actions">
                <button class="button primary" :disabled="Boolean(presetIssue(preset))" @click="startPresetLoop(preset)">
                  {{ activeLoopId === preset.id && playing ? '循环进行中…' : '启动循环' }}
                </button>
                <button v-if="activeLoopId === preset.id" class="button secondary" @click="stopPlayback">停止</button>
                <button class="danger" @click="removeLoopPreset(preset.id)">删除预设</button>
              </div>
            </article>
          </div>

          <div v-if="activeMode === 'loop'" class="loop-status">
            <span :class="['loop-state', playing ? 'playing' : 'paused']">{{ playing ? '循环播放中' : '已暂停' }}</span>
            <strong>第 {{ currentLoopRound }} / {{ activeLoopPreset?.loops ?? '-' }} 轮</strong>
          </div>
        </section>

        <section class="panel path-panel">
          <h2>实际演奏路径</h2>
          <div class="path-list">
            <button
              v-for="(step, index) in path?.steps ?? []"
              :key="`${step.measureIndex}-${step.occurrence}`"
              :class="['path-step', { active: index === activeStepIndex }]"
              @click="seekToStep(index)"
            >
              <span class="step-order">{{ index + 1 }}</span>
              <span class="step-main">
                小节 {{ step.measureNumber }} <em>#{{ step.occurrence }}</em>
                <small>{{ step.event }} · ♩={{ Math.round(step.bpm) }}</small>
              </span>
              <span class="step-time">{{ formatTime(step.startSeconds) }}</span>
            </button>
          </div>
        </section>

        <section class="panel">
          <h2>排练标记（独立保存）</h2>
          <div class="mark-form">
            <input v-model="markLabel" placeholder="标记名，如 A2" />
            <textarea v-model="markComment" placeholder="排练说明，不写回 XML" />
            <button class="button primary" :disabled="!project" @click="addMark">给当前到达位置加标记</button>
          </div>
          <div class="mark-list">
            <article v-for="mark in project?.marks ?? []" :key="mark.id">
              <strong>{{ mark.label }}</strong>
              <p>{{ mark.comment }}</p>
              <small>书面小节 {{ score?.measures[mark.measureIndex]?.number }} · 第 {{ mark.occurrence }} 次</small>
              <button @click="removeMark(mark.id)">移除</button>
            </article>
          </div>
        </section>

        <section class="panel warnings-panel">
          <h2>记号诊断（不静默忽略）</h2>
          <p v-if="!path?.warnings.length" class="muted">没有诊断信息。</p>
          <div v-for="(warning, index) in path?.warnings ?? []" :key="index" :class="['warning', warning.level]">
            <strong>{{ warning.level === 'error' ? '错误' : warning.level === 'warning' ? '警告' : '信息' }}</strong>
            <span>{{ warning.message }}</span>
          </div>
        </section>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ScoreView from './components/ScoreView.vue'
import { buildBeatEvents, Metronome, type BeatEvent } from './audio/metronome'
import {
  createProject,
  deleteProject,
  downloadText,
  exportProject,
  importProjectFile,
  listProjects,
  saveProject,
} from './storage/projects'
import { arrivalsFor, buildPerformancePath, formatTime, parseMusicXml, type ParsedScore } from './score/parser'
import { resolveLoopSegment, roundAt } from './score/loop'
import { sampleLibrary } from './score/samples'
import type { LoopPreset, PathStep, RehearsalMark, StoredProject } from './score/types'

const projects = ref<StoredProject[]>([])
const project = ref<StoredProject | null>(null)
const score = ref<ParsedScore | null>(null)
const path = ref<ReturnType<typeof buildPerformancePath> | null>(null)
const selectedMeasureIndex = ref(0)
const selectedOccurrence = ref(1)
const activeStepIndex = ref<number | null>(null)
const currentScoreTime = ref(0)
const playing = ref(false)
const markLabel = ref('')
const markComment = ref('')
const beatEvents = ref<BeatEvent[]>([])
const loopName = ref('')
const loopStartStepIndex = ref(0)
const loopEndStepIndex = ref(0)
const loopLoops = ref(4)
const activeLoopId = ref<string | null>(null)
const loopBeatEvents = ref<BeatEvent[]>([])
const loopSegmentDuration = ref(0)
const loopTime = ref(0)
const currentLoopRound = ref(1)
let metronome: Metronome | null = null
let rafHandle = 0
type PlayMode = 'full' | 'loop'
const activeMode = ref<PlayMode>('full')

const selectedMeasure = computed(() => score.value?.measures[selectedMeasureIndex.value] ?? null)
const selectedOccurrences = computed(() => path.value ? arrivalsFor(path.value, selectedMeasureIndex.value) : [])
const playProgress = computed(() => {
  if (activeMode.value === 'loop') {
    return loopSegmentDuration.value > 0 ? Math.min(1, (loopTime.value % loopSegmentDuration.value) / loopSegmentDuration.value) : 0
  }
  return path.value && path.value.totalSeconds > 0 ? currentScoreTime.value / path.value.totalSeconds : 0
})
const activeLoopPreset = computed(() => project.value?.loopPresets.find((preset) => preset.id === activeLoopId.value) ?? null)
const activeLoopDuration = computed(() => loopSegmentDuration.value * (activeLoopPreset.value?.loops ?? 1))

const pathStepOptions = computed(() => {
  if (!path.value) return []
  return path.value.steps.map((step, index) => ({
    value: index,
    label: describeStep(step, index),
  }))
})

function describeStep(step: PathStep, index: number): string {
  const pickup = step.isPickup ? '（弱起）' : ''
  const ending = step.activeEndingNumbers.length ? ` · 跳房 ${step.activeEndingNumbers.join('/')}` : ''
  return `#${index + 1} 小节 ${step.measureNumber}${pickup} 第 ${step.occurrence} 次到达 · ${step.event} · ♩=${Math.round(step.bpm)}${ending}`
}

function stepAsPresetEndpoint(stepIndex: number): { measureIndex: number; occurrence: number } | null {
  const step = path.value?.steps[stepIndex]
  return step ? { measureIndex: step.measureIndex, occurrence: step.occurrence } : null
}

function draftPreset(): LoopPreset | null {
  const start = stepAsPresetEndpoint(loopStartStepIndex.value)
  const end = stepAsPresetEndpoint(loopEndStepIndex.value)
  if (!start || !end || !path.value) return null
  return {
    id: 'draft',
    name: loopName.value.trim() || '未命名循环',
    startMeasureIndex: start.measureIndex,
    startOccurrence: start.occurrence,
    endMeasureIndex: end.measureIndex,
    endOccurrence: end.occurrence,
    loops: Math.max(1, Math.floor(loopLoops.value) || 1),
    createdAt: new Date().toISOString(),
  }
}

const draftLoopSummary = computed(() => {
  const preset = draftPreset()
  if (!preset) return '请在实际路径中选择起止节点。'
  const result = resolveLoopSegment(path.value, preset)
  if (!result.valid || !result.segment) return result.message ?? ''
  return `${describeStep(path.value!.steps[result.segment.startStepIndex], result.segment.startStepIndex)} → ${describeStep(path.value!.steps[result.segment.endStepIndex], result.segment.endStepIndex)}，每轮 ${formatTime(result.segment.durationSeconds)}。`
})

const draftLoopIssue = computed(() => {
  const preset = draftPreset()
  if (!preset) return '请在实际路径中选择起止节点。'
  const result = resolveLoopSegment(path.value, preset)
  return result.valid ? '' : result.message ?? '所选段落不可用。'
})

function presetSummary(preset: LoopPreset): string {
  const result = resolveLoopSegment(path.value, preset)
  if (!result.valid || !result.segment || !path.value) {
    return `小节 ${preset.startMeasureIndex + 1} 第 ${preset.startOccurrence} 次 → 小节 ${preset.endMeasureIndex + 1} 第 ${preset.endOccurrence} 次 · ${preset.loops} 轮`
  }
  return `${describeStep(path.value.steps[result.segment.startStepIndex], result.segment.startStepIndex)} → ${describeStep(path.value.steps[result.segment.endStepIndex], result.segment.endStepIndex)} · ${preset.loops} 轮 · 每轮 ${formatTime(result.segment.durationSeconds)}`
}

function presetIssue(preset: LoopPreset): string {
  return resolveLoopSegment(path.value, preset).message ?? ''
}

async function refreshProjectList(): Promise<void> {
  projects.value = await listProjects()
}

function analyze(xml: string): void {
  const parsed = parseMusicXml(xml)
  score.value = parsed
  path.value = buildPerformancePath(parsed)
  beatEvents.value = buildBeatEvents(path.value.steps, parsed.measures)
  selectedMeasureIndex.value = 0
  selectedOccurrence.value = path.value.arrivals[0]?.occurrences[0] ?? 1
  loopStartStepIndex.value = 0
  loopEndStepIndex.value = Math.max(0, path.value.steps.length - 1)
  activeLoopId.value = null
  activeMode.value = 'full'
  stopPlayback()
}

function loadXml(name: string, xml: string): void {
  project.value = createProject(name, xml)
  analyze(xml)
  void refreshProjectList()
}

function loadSample(sample: { name: string; getXml: () => string }): void {
  loadXml(sample.name, sample.getXml())
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.name.toLowerCase().endsWith('.mxl')) {
    window.alert('压缩 .mxl 尚未列入明确支持范围。请解压为 .musicxml/.xml 后打开。')
    return
  }
  loadXml(file.name.replace(/\.(musicxml|xml)$/i, ''), await file.text())
  input.value = ''
}

function loadStoredProject(item: StoredProject): void {
  project.value = JSON.parse(JSON.stringify(item)) as StoredProject
  analyze(project.value.originalXml)
}

async function saveCurrentProject(): Promise<void> {
  if (!project.value) return
  project.value.updatedAt = new Date().toISOString()
  await saveProject(project.value)
  await refreshProjectList()
}

async function removeStoredProject(id: string): Promise<void> {
  await deleteProject(id)
  await refreshProjectList()
}

async function onProjectImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const imported = await importProjectFile(file)
    await saveProject(imported)
    await refreshProjectList()
    loadStoredProject(imported)
  } catch (error) {
    window.alert(error instanceof Error ? error.message : '工程导入失败')
  } finally {
    input.value = ''
  }
}

function downloadOriginalXml(): void {
  if (!project.value) return
  downloadText(`${project.value.name}.musicxml`, project.value.originalXml, 'application/vnd.recordare.musicxml+xml')
}

function downloadProjectBundle(): void {
  if (!project.value) return
  const bundle = exportProject(project.value)
  downloadText(`${project.value.name}.rehearsal.json`, JSON.stringify(bundle, null, 2), 'application/json')
}

function seekToStep(index: number): void {
  activeStepIndex.value = index
  const step = path.value?.steps[index]
  if (step) {
    currentScoreTime.value = step.startSeconds
    selectedMeasureIndex.value = step.measureIndex
    selectedOccurrence.value = step.occurrence
    if (activeMode.value === 'loop' && !playing.value) {
      activeMode.value = 'full'
      activeLoopId.value = null
    }
  }
}

function setLoopEndpoint(which: 'start' | 'end'): void {
  const index = findSelectedStepIndex()
  if (index < 0) return
  if (which === 'start') loopStartStepIndex.value = index
  else loopEndStepIndex.value = index
}

function chooseMeasure(measureIndex: number): void {
  selectedMeasureIndex.value = measureIndex
  const occurrences = path.value ? arrivalsFor(path.value, measureIndex) : []
  selectedOccurrence.value = occurrences[0] ?? 1
  const stepIndex = path.value?.steps.findIndex((step) => step.measureIndex === measureIndex && step.occurrence === selectedOccurrence.value) ?? -1
  if (stepIndex >= 0) seekToStep(stepIndex)
}

function findSelectedStepIndex(): number {
  return path.value?.steps.findIndex(
    (step) => step.measureIndex === selectedMeasureIndex.value && step.occurrence === selectedOccurrence.value,
  ) ?? -1
}

function ensureMetronome(): Metronome {
  metronome ??= new Metronome(
    (event) => {
      activeStepIndex.value = event.stepIndex
    },
    () => {
      finishPlayback()
    },
  )
  return metronome
}

async function startPlayback(): Promise<void> {
  if (!path.value) return
  if (activeMode.value === 'loop' && activeLoopId.value) {
    await resumeLoopPlayback()
    return
  }
  let stepIndex = findSelectedStepIndex()
  if (stepIndex < 0) stepIndex = 0
  const startTime = path.value.steps[stepIndex]?.startSeconds ?? 0
  await ensureMetronome().start(
    beatEvents.value,
    currentScoreTime.value >= startTime ? currentScoreTime.value : startTime,
  )
  playing.value = true
  tick()
}

async function startPresetLoop(preset: LoopPreset): Promise<void> {
  if (!path.value || !score.value) return
  if (activeLoopId.value !== preset.id) stopPlayback()
  const result = resolveLoopSegment(path.value, preset)
  if (!result.valid || !result.segment) {
    window.alert(result.message ?? '循环段落不可用，不会播放。')
    return
  }
  const { startStepIndex, endStepIndex, durationSeconds } = result.segment
  loopBeatEvents.value = buildBeatEvents(path.value.steps, score.value.measures, {
    rebaseToZero: true,
    firstStepIndex: startStepIndex,
    lastStepIndex: endStepIndex,
  })
  loopSegmentDuration.value = durationSeconds
  activeLoopId.value = preset.id
  activeMode.value = 'loop'
  activeStepIndex.value = startStepIndex
  loopTime.value = 0
  currentLoopRound.value = 1
  await ensureMetronome().start(loopBeatEvents.value, 0, { durationSeconds, loops: preset.loops })
  playing.value = true
  tick()
}

async function resumeLoopPlayback(): Promise<void> {
  const preset = activeLoopPreset.value
  if (!preset || !path.value || !score.value) return
  if (loopTime.value >= loopSegmentDuration.value * preset.loops - 0.001) loopTime.value = 0
  await ensureMetronome().start(
    loopBeatEvents.value,
    loopTime.value,
    { durationSeconds: loopSegmentDuration.value, loops: preset.loops },
  )
  playing.value = true
  tick()
}

async function startDraftLoop(): Promise<void> {
  if (draftLoopIssue.value || !project.value) return
  const preset = draftPreset()
  if (!preset) return
  preset.id = crypto.randomUUID()
  project.value.loopPresets.push(preset)
  activeLoopId.value = preset.id
  await startPresetLoop(preset)
}

function saveLoopPreset(): void {
  if (!project.value || draftLoopIssue.value) return
  const preset = draftPreset()
  if (!preset) return
  preset.id = crypto.randomUUID()
  project.value.loopPresets.push(preset)
  loopName.value = ''
  void saveCurrentProject()
}

function removeLoopPreset(id: string): void {
  if (!project.value) return
  if (activeLoopId.value === id) stopPlayback()
  project.value.loopPresets = project.value.loopPresets.filter((preset) => preset.id !== id)
  void saveCurrentProject()
}

function tick(): void {
  if (!metronome || !playing.value) return
  if (activeMode.value === 'loop') {
    loopTime.value = metronome.currentTime
    const preset = activeLoopPreset.value
    if (preset) currentLoopRound.value = roundAt(loopTime.value, loopSegmentDuration.value, preset.loops)
    const position = metronome.positionAt(loopTime.value)
    if (position) activeStepIndex.value = position.stepIndex
    rafHandle = window.requestAnimationFrame(tick)
    return
  }
  currentScoreTime.value = metronome.currentTime
  const position = metronome.positionAt(currentScoreTime.value)
  if (position) activeStepIndex.value = position.stepIndex
  if (path.value && currentScoreTime.value >= path.value.totalSeconds) {
    stopPlayback()
    return
  }
  rafHandle = window.requestAnimationFrame(tick)
}

/** 全部轮次自然结束：停止节拍器但保留最后位置，界面显示停止状态。 */
function finishPlayback(): void {
  playing.value = false
  cancelAnimationFrame(rafHandle)
}

function pausePlayback(): void {
  if (metronome) {
    if (activeMode.value === 'loop') loopTime.value = metronome.currentTime
    else currentScoreTime.value = metronome.currentTime
  }
  metronome?.stop()
  playing.value = false
  cancelAnimationFrame(rafHandle)
}

function stopPlayback(): void {
  metronome?.stop()
  playing.value = false
  cancelAnimationFrame(rafHandle)
  if (activeMode.value === 'loop') {
    const preset = activeLoopPreset.value
    const start = preset && path.value ? resolveLoopSegment(path.value, preset).segment?.startStepIndex ?? null : null
    activeStepIndex.value = start
    loopTime.value = 0
    currentLoopRound.value = 1
  } else {
    const firstIndex = findSelectedStepIndex()
    activeStepIndex.value = firstIndex >= 0 ? firstIndex : null
    currentScoreTime.value = firstIndex >= 0 ? path.value?.steps[firstIndex].startSeconds ?? 0 : 0
  }
}

async function togglePlayback(): Promise<void> {
  if (playing.value) pausePlayback()
  else await startPlayback()
}

function arrivalDescription(occurrence: number): string {
  const step = path.value?.steps.find((item) => item.measureIndex === selectedMeasureIndex.value && item.occurrence === occurrence)
  if (!step) return '未到达'
  return `${step.event}，${formatTime(step.startSeconds)}`
}

function addMark(): void {
  if (!project.value) return
  const mark: RehearsalMark = {
    id: crypto.randomUUID(),
    measureIndex: selectedMeasureIndex.value,
    occurrence: selectedOccurrence.value,
    label: markLabel.value || `小节 ${selectedMeasure.value?.number}`,
    comment: markComment.value,
    color: '#f4b942',
    createdAt: new Date().toISOString(),
  }
  project.value.marks.push(mark)
  markLabel.value = ''
  markComment.value = ''
  void saveCurrentProject()
}

function removeMark(id: string): void {
  if (!project.value) return
  project.value.marks = project.value.marks.filter((mark) => mark.id !== id)
  void saveCurrentProject()
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

watch(selectedMeasureIndex, () => {
  const occurrences = path.value ? arrivalsFor(path.value, selectedMeasureIndex.value) : []
  if (!occurrences.includes(selectedOccurrence.value)) selectedOccurrence.value = occurrences[0] ?? 1
})

watch(selectedOccurrence, () => {
  const index = findSelectedStepIndex()
  if (index >= 0 && activeStepIndex.value !== index) seekToStep(index)
})

watch(project, () => {
  if (project.value) void saveProject(project.value).then(refreshProjectList)
}, { deep: true })

onBeforeUnmount(() => {
  stopPlayback()
})

void refreshProjectList()
loadSample(sampleLibrary[0])
</script>
