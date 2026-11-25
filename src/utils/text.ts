import { gunzipSync } from 'node:zlib'

/**
 * 真人消息的壳来自预设的 format_user_prompt，常见形式（示例均为占位数据）：
 *   群友 小明 于 2026-01-01 12:00:00 说: xxx
 *   群友 小明(QQ:10000) 于 2026-01-01 12:00:00 在群聊中说: xxx
 *   小明 于 2026-01-01 12:00:00 对你私聊说: xxx
 * 判定靠「名字 + 于 + 日期 + 时间 + 说:」，不依赖“群友”前缀；引用消息会嵌套，故全局替换。
 */
const HUMAN_PREFIX =
  /(?:群友\s+)?[^\s:：]{1,24}(?:[(（][^)）]{0,24}[)）])?\s*于\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+[\d:.]+\s*[^:：\n]{0,12}说\s*[:：]\s*/g

/** ChatLuna 的引用块：The Referenced message is <时间> <昵称> 说 said ... */
const REFERENCED = /The Referenced message is\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+[\d:.]+\s+[^\s]{1,24}\s+说\s+said\s*/gi

/** 元素占位符：[image:xxx] / [forward:xxx] / [file:xxx] */
const ELEMENT = /\[[a-z_]{2,20}:[^\]\n]{0,300}\]/gi

const QQ_SUFFIX = /\s*[(（]QQ[:：]\s*\d+[)）]/gi

const AT_TAG = /<at\s+id="[^"]*"\s*\/?>/gi
const HTML_TAG = /<[^>]{1,200}>/g
const CQ_CODE = /\[(图片|表情|语音|视频|文件|转发消息|动画表情|戳一戳)\]/g
const URL = /https?:\/\/\S+/g
const PARENTHESES = /（[^（）]*）|\([^()]*\)/g
const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff]/g
const SPACES = /[ \t\u3000]+/g

/**
 * 壳来自预设的 `format_user_prompt`，不同预设写法完全不同，例如：
 *   群友 {sender}(QQ:{sender_id}) 于 {date} {is_group ? "在群聊中" : "对你私聊"}说: {prompt}
 *   用户[{sender},{sender_id}]说: {prompt}
 * 因此按模板里 `{prompt}` 的位置拆出前后缀，把占位符当通配，而不是猜固定格式。
 */
const WRAPPER_CACHE = new Map<string, { prefix?: RegExp; suffix?: RegExp } | null>()

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function compileWrapperTemplate(template: string) {
  if (!template) return null
  const cached = WRAPPER_CACHE.get(template)
  if (cached !== undefined) return cached

  const marker = '{prompt}'
  const index = template.indexOf(marker)
  if (index < 0) {
    WRAPPER_CACHE.set(template, null)
    return null
  }

  const build = (part: string, side: 'start' | 'end') => {
    if (!part.trim()) return undefined
    const pattern = escapeRegExp(part)
      .replace(/\\\{[^{}]*\\\}/g, '.*?')
      .replace(/ /g, '\\s*')
    try {
      return new RegExp(side === 'start' ? `^${pattern}` : `${pattern}$`, 's')
    } catch {
      return undefined
    }
  }

  const matcher = {
    prefix: build(template.slice(0, index), 'start'),
    suffix: build(template.slice(index + marker.length), 'end'),
  }
  WRAPPER_CACHE.set(template, matcher)
  return matcher
}

/** 依次尝试多个预设模板，命中即返回剥好的文本 */
export function stripByTemplate(text: string, templates?: string[]): string {
  if (!templates?.length) return text

  for (const template of templates) {
    const matcher = compileWrapperTemplate(template)
    if (!matcher) continue

    let next = text
    if (matcher.prefix) next = next.replace(matcher.prefix, '')
    if (matcher.suffix) next = next.replace(matcher.suffix, '')
    if (next !== text) return next
  }

  return text
}

/** chatluna_message.content 是 gzip(JSON)，JSON 可能是字符串或 content blocks */
export function decodeContent(content: ArrayBuffer | Uint8Array | null | undefined): string {
  if (!content) return ''

  const buffer = content instanceof Uint8Array
    ? Buffer.from(content)
    : Buffer.from(new Uint8Array(content))

  let json: string
  try {
    json = gunzipSync(buffer).toString('utf8')
  } catch {
    // 兜底：极老版本可能直接存明文 JSON
    json = buffer.toString('utf8')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return json
  }

  if (typeof parsed === 'string') return parsed
  if (Array.isArray(parsed)) {
    return parsed
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text as string)
      .join('')
  }
  return ''
}

export interface CleanOptions {
  stripParentheses?: boolean
  /** 默认 true；关闭后保留消息壳，交给过滤词处理 */
  stripWrapper?: boolean
  /** 当前会话预设的 format_user_prompt，模板优先于内置兜底正则 */
  wrapperTemplates?: string[]
}

/** 去掉壳、标签、链接、CQ 码，压缩空白 */
export function cleanText(raw: string, role: 'human' | 'ai', options: CleanOptions = {}): string {
  if (!raw) return ''

  let text = raw
  if (role === 'human') {
    if (options.stripWrapper !== false) {
      text = stripByTemplate(text, options.wrapperTemplates)
      text = text
        .replace(REFERENCED, ' ')
        .replace(HUMAN_PREFIX, ' ')
    }
    text = text.replace(QQ_SUFFIX, ' ')
  }
  if (options.stripParentheses && role === 'ai') text = text.replace(PARENTHESES, ' ')

  text = text
    .replace(AT_TAG, ' ')
    .replace(HTML_TAG, ' ')
    .replace(ELEMENT, ' ')
    .replace(CQ_CODE, ' ')
    .replace(URL, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(SPACES, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()

  return text
}

/**
 * 长英文段落基本是 ChatLuna 的压缩摘要 / 引用残留，不是群友发言。
 * 中文占不到 15% 且长度超过 160 的，直接当噪声丢掉。
 */
export function isNoiseText(text: string): boolean {
  if (text.length < 160) return false
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  return cjk / text.length < 0.15
}

/** createdAt 可能是 Date（minato timestamp）或毫秒数（裸 SQL 行） */
export function normalizeDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function truncate(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

export function formatTime(date: Date, withDate = false): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (!withDate) return time
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${time}`
}
