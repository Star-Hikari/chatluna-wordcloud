import { CleanMessage, HourlyBucket, Stats, WordCount } from '../types'
import { DEFAULT_STOPWORDS } from '../utils/stopwords'

const SegmenterCtor = (Intl as any)?.Segmenter
const SEGMENTER = SegmenterCtor
  ? new SegmenterCtor('zh', { granularity: 'word' })
  : null

const CJK_OR_WORD = /[\u4e00-\u9fa5]+|[a-zA-Z][a-zA-Z0-9']*/g
const PURE_SYMBOL = /^[\p{P}\p{S}\s]+$/u

/** 兜底：没有 Intl.Segmenter 时按中文 2-gram + 英文单词切 */
function fallbackSegment(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(CJK_OR_WORD)) {
    const piece = match[0]
    if (/^[a-zA-Z]/.test(piece)) {
      out.push(piece.toLowerCase())
      continue
    }
    if (piece.length <= 2) {
      out.push(piece)
      continue
    }
    for (let i = 0; i < piece.length - 1; i++) out.push(piece.slice(i, i + 2))
  }
  return out
}

export function segment(text: string): string[] {
  if (!text) return []
  if (!SEGMENTER) return fallbackSegment(text)

  const out: string[] = []
  for (const piece of SEGMENTER.segment(text)) {
    if (piece.isWordLike) out.push(piece.segment)
  }
  return out
}

export interface WordOptions {
  minWordLength: number
  topN: number
  /** 过滤词，逗号/换行/空格分隔，会和内置停用词合并 */
  filterWords?: string | string[]
  excludePatterns?: RegExp[]
  /** 昵称、bot 名等不该上榜的词 */
  blacklist?: Iterable<string>
  /** 不统计英文单词，默认 true */
  excludeLatin?: boolean
  /** 不统计纯数字，默认 true */
  excludeNumbers?: boolean
  /** 不统计纯标点，默认 true */
  excludePunctuation?: boolean
}

const LATIN_WORD = /^[a-z][a-z0-9'’._-]*$/i

function parseFilterWords(input?: string | string[]): string[] {
  if (!input) return []
  const list = Array.isArray(input) ? input : [input]
  return list
    .flatMap((item) => String(item).split(/[,，、;；\s]+/))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function buildStopwords(extra?: string | string[]): Set<string> {
  const set = new Set(DEFAULT_STOPWORDS)
  for (const word of parseFilterWords(extra)) set.add(word)
  return set
}

function charLength(text: string) {
  return Array.from(text).length
}

/**
 * 统计词频，返回按次数降序的词表。
 * 采用 document frequency：一条消息里同一个词只算一次。
 * 聊天场景里 bot 单条回复很长，用词频会被「主人×20」这种刷分，去重后词表更均衡。
 */
export function countWords(messages: CleanMessage[], options: WordOptions): WordCount[] {
  const stopwords = buildStopwords(options.filterWords)
  const blacklist = new Set<string>()
  for (const word of options.blacklist ?? []) {
    if (word) blacklist.add(word.toLowerCase())
  }
  const patterns = options.excludePatterns ?? []
  const excludeLatin = options.excludeLatin !== false
  const excludeNumbers = options.excludeNumbers !== false
  const excludePunctuation = options.excludePunctuation !== false
  const counter = new Map<string, number>()

  for (const message of messages) {
    const seen = new Set<string>()
    for (const raw of segment(message.text)) {
      const word = raw.trim().toLowerCase()
      if (!word || seen.has(word)) continue
      if (charLength(word) < options.minWordLength) continue
      if (charLength(word) > 16) continue
      if (excludePunctuation && PURE_SYMBOL.test(word)) continue
      // 含数字的 token 基本都是哈希、QQ 号、时间片段，直接丢
      if (excludeNumbers && /\d/.test(word)) continue
      if (excludeLatin && LATIN_WORD.test(word)) continue
      if (stopwords.has(word) || blacklist.has(word)) continue
      if (patterns.some((pattern) => pattern.test(word))) continue
      seen.add(word)
      counter.set(word, (counter.get(word) ?? 0) + 1)
    }
  }

  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.topN)
    .map(([word, count]) => ({ word, count }))
}

/** 词频 → wordcloud2 的字号列表，按 max 归一化，指数 0.5 让字号层次更明显 */
export function toCloudList(words: WordCount[]): Array<[string, number]> {
  if (!words.length) return []
  const max = words[0].count || 1

  return words.map(({ word, count }) => {
    const ratio = Math.min(1, count / max)
    const size = Math.round(16 + 82 * Math.pow(ratio, 0.5))
    return [word, size] as [string, number]
  })
}

/** 24 小时发言分桶（本地时区） */
export function bucketHourly(messages: CleanMessage[]): HourlyBucket[] {
  const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    human: 0,
    bot: 0,
  }))

  for (const message of messages) {
    const bucket = buckets[message.at.getHours()]
    if (!bucket) continue
    if (message.role === 'human') bucket.human++
    else bucket.bot++
  }

  return buckets
}

export function computeStats(messages: CleanMessage[]): Stats {
  const human = messages.filter((item) => item.role === 'human')
  const bot = messages.filter((item) => item.role === 'ai')

  const speakerCounter = new Map<string, number>()
  for (const message of human) {
    const name = message.name || '神秘群友'
    speakerCounter.set(name, (speakerCounter.get(name) ?? 0) + 1)
  }
  const topSpeaker = Array.from(speakerCounter.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0]

  const average = (list: CleanMessage[]) => {
    if (!list.length) return 0
    const total = list.reduce((sum, item) => sum + charLength(item.text), 0)
    return Math.round(total / list.length)
  }

  let longest: Stats['longest']
  for (const message of messages) {
    const length = charLength(message.text)
    if (!longest || length > longest.length) {
      longest = { role: message.role, text: message.text, length }
    }
  }

  // 说明：不做「响应间隔」统计。实测 ChatLuna 会把一轮 human+ai 一起落库，
  // 两者的 createdAt 只差几毫秒，无法代表真实回复延迟。

  const hourly = bucketHourly(messages)
  let peakHour = 0
  for (const bucket of hourly) {
    const current = hourly[peakHour]
    if (bucket.human + bucket.bot > current.human + current.bot) peakHour = bucket.hour
  }

  const firstAt = messages[0]?.at
  const lastAt = messages[messages.length - 1]?.at
  const activeMinutes = firstAt && lastAt
    ? Math.max(1, Math.round((lastAt.getTime() - firstAt.getTime()) / 60000))
    : 0

  return {
    total: messages.length,
    human: human.length,
    bot: bot.length,
    users: speakerCounter.size,
    topSpeaker,
    avgHuman: average(human),
    avgBot: average(bot),
    longest,
    peakHour,
    activeMinutes,
    firstAt,
    lastAt,
    index: activeMinutes
      ? Math.round((messages.length / (activeMinutes / 60)) * 10)
      : messages.length * 10,
  }
}

export interface AnalyseResult {
  words: WordCount[]
  cloud: Array<[string, number]>
  hourly: HourlyBucket[]
  stats: Stats
}

/** 一次性产出词表、词云字号、分桶、统计 */
export function analyse(messages: CleanMessage[], options: WordOptions): AnalyseResult {
  const blacklist = new Set(options.blacklist ?? [])
  for (const message of messages) {
    if (message.role === 'human' && message.name) blacklist.add(message.name)
  }

  const words = countWords(messages, { ...options, blacklist })
  return {
    words,
    cloud: toCloudList(words),
    hourly: bucketHourly(messages),
    stats: computeStats(messages),
  }
}
