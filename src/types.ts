export interface Target {
  /** 群聊 or 私聊 */
  type: 'group' | 'private'
  /** channel=单个会话，all=该 bot 的全部会话（-a） */
  mode?: 'channel' | 'all'
  platform: string
  selfId: string
  /** 群聊为群号，私聊为空串 */
  guildId: string
  /** 群聊为频道号，私聊为用户号；all 模式为空串 */
  channelId: string
  /** 群名，取不到时用占位；all 模式为通用标题 */
  guildName: string
  userId?: string
}

export interface ConversationRef {
  id: string
  bindingKey: string
  preset?: string
  model?: string
  lastChatAt?: Date | null
}

/** chatluna_message 的原始行（只取用到的列） */
export interface MessageRow {
  id: string
  conversationId: string
  role: string
  name?: string | null
  content?: ArrayBuffer | Uint8Array | null
  createdAt?: number | Date | null
}

export interface CleanMessage {
  role: 'human' | 'ai'
  name?: string
  text: string
  at: Date
}

export interface LoadOptions {
  start: Date
  end: Date
  limit: number
  includeHuman: boolean
  includeBot: boolean
  stripParentheses: boolean
  /** 是否剥离消息壳，默认 true */
  stripWrapper?: boolean
  /** 会话预设的 format_user_prompt，模板剥离优先于内置正则 */
  wrapperTemplates?: string[]
}

/** 定时投递目标 */
export interface AutoTarget {
  type: 'group' | 'private'
  platform: string
  selfId: string
  /** 群聊填群号，私聊填 QQ 号 */
  channelId: string
}

export interface LoadResult {
  messages: CleanMessage[]
  conversations: ConversationRef[]
  /** 时间窗内命中的原始行数 */
  rawCount: number
  /** 解码/清洗后被丢弃的行数 */
  skipped: number
  /** 是否因为超过上限被截断 */
  truncated: boolean
}

export interface WordCount {
  word: string
  count: number
}

export interface HourlyBucket {
  hour: number
  human: number
  bot: number
}

export interface Stats {
  total: number
  human: number
  bot: number
  users: number
  topSpeaker?: string
  avgHuman: number
  avgBot: number
  longest?: { role: 'human' | 'ai'; text: string; length: number }
  peakHour: number
  /** 首末消息跨度，单位分钟，最小 1 */
  activeMinutes: number
  firstAt?: Date
  lastAt?: Date
  /** 互动指数：每小时消息量 ×10 */
  index: number
}
