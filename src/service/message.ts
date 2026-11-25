import { Context } from 'koishi'
import {
  CleanMessage,
  ConversationRef,
  LoadOptions,
  LoadResult,
  MessageRow,
  Target,
} from '../types'
import { cleanText, decodeContent, isNoiseText, normalizeDate } from '../utils/text'

interface RawConversation {
  id: string
  bindingKey: string
  preset?: string
  model?: string
  lastChatAt?: Date | null
  status?: string
}

/**
 * ChatLuna 会把部分合成消息也写成 human 角色，例如无限上下文压缩产生的摘要：
 *   name = 'infinite_context'，additional_kwargs = {"source":"infinite-context"}
 * 这类内容不能进词频。
 */
const SYNTHETIC_NAMES = new Set(['infinite_context'])

function toRef(row: RawConversation): ConversationRef {
  return {
    id: row.id,
    bindingKey: row.bindingKey,
    preset: row.preset,
    model: row.model,
    lastChatAt: row.lastChatAt ?? null,
  }
}

/** 计算统计时间窗：默认今天 00:00 → 现在；days>1 时向前补自然日 */
export function resolveRange(days: number, now = new Date(), date?: string) {
  if (date) {
    const start = new Date(`${date}T00:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }

  const end = new Date(now)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (Math.max(1, days) - 1))
  return { start, end }
}

export class MessageService {
  constructor(private readonly ctx: Context) {}

  private get db() {
    return this.ctx.database as any
  }

  /** 找出该群（或该私聊）对应的全部 ChatLuna 会话 */
  async resolveConversations(target: Target): Promise<ConversationRef[]> {
    const rows: RawConversation[] = await this.db.get('chatluna_conversation', {})

    // -a：该 bot 名下所有会话（群 + 私聊）
    if (target.mode === 'all') {
      const sharedRoot = `shared:${target.platform}:${target.selfId}:`
      const personalRoot = `personal:${target.platform}:${target.selfId}:`
      return rows
        .filter((row) => row.status !== 'deleted')
        .filter((row) => row.bindingKey.startsWith(sharedRoot) ||
          row.bindingKey.startsWith(personalRoot))
        .map(toRef)
    }

    const shared = `shared:${target.platform}:${target.selfId}:${target.guildId}`
    const personalGroup = `personal:${target.platform}:${target.selfId}:${target.guildId}:`
    const personalDirect = `personal:${target.platform}:${target.selfId}:direct:${target.userId}`

    return rows
      .filter((row) => row.status !== 'deleted')
      .filter((row) => {
        if (target.type === 'private') {
          return row.bindingKey === personalDirect ||
            row.bindingKey.startsWith(personalDirect + ':preset:')
        }
        return row.bindingKey === shared ||
          row.bindingKey.startsWith(shared + ':preset:') ||
          row.bindingKey.startsWith(personalGroup)
      })
      .map(toRef)
  }

  /** 按时间窗拉取并清洗消息，按时间升序返回 */
  async load(target: Target, options: LoadOptions): Promise<LoadResult> {
    const conversations = await this.resolveConversations(target)
    return this.loadWith(conversations, options)
  }

  /** 已拿到会话列表时直接取数（调用方可以先据此收集预设模板） */
  async loadWith(conversations: ConversationRef[], options: LoadOptions): Promise<LoadResult> {
    const empty: LoadResult = {
      messages: [],
      conversations,
      rawCount: 0,
      skipped: 0,
      truncated: false,
    }
    if (!conversations.length) return empty

    const roles: string[] = []
    if (options.includeHuman) roles.push('human')
    if (options.includeBot) roles.push('ai')
    if (!roles.length) return empty

    let rows: MessageRow[] = await this.db.get('chatluna_message', {
      conversationId: { $in: conversations.map((item) => item.id) },
      createdAt: { $gte: options.start, $lt: options.end },
      role: { $in: roles },
    }, {
      limit: options.limit + 1,
      sort: { createdAt: 'desc' },
    })

    const truncated = rows.length > options.limit
    if (truncated) rows = rows.slice(0, options.limit)
    rows.reverse() // 恢复升序

    const messages: CleanMessage[] = []
    let skipped = 0

    for (const row of rows) {
      const at = normalizeDate(row.createdAt)
      if (!at || (row.role !== 'human' && row.role !== 'ai')) {
        skipped++
        continue
      }

      if (row.name && SYNTHETIC_NAMES.has(row.name)) {
        skipped++
        continue
      }

      const raw = decodeContent(row.content)
      const text = cleanText(raw, row.role, {
        stripParentheses: options.stripParentheses,
        stripWrapper: options.stripWrapper !== false,
        wrapperTemplates: options.wrapperTemplates,
      })
      if (!text || isNoiseText(text)) {
        skipped++
        continue
      }

      messages.push({
        role: row.role,
        name: row.name || undefined,
        text,
        at,
      })
    }

    return {
      messages,
      conversations,
      rawCount: rows.length,
      skipped,
      truncated,
    }
  }
}
