import { Context } from 'koishi'
import type { Config } from '../config'
import { AnalyseResult } from './analyse'

/** LangChain 消息 content 可能是字符串或 content blocks */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text as string)
      .join('')
  }
  return content == null ? '' : String(content)
}

export interface SummaryInput {
  channelId: string
  /** YYYY-MM-DD，用于缓存 */
  dateKey: string
  botName: string
  guildName: string
  dateLabel: string
  analysis: AnalyseResult
  preset?: string
  model?: string
}

interface CacheEntry {
  text: string
  expire: number
}

const CACHE_TTL = 6 * 60 * 60 * 1000

export class SummaryService {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  async generate(input: SummaryInput): Promise<string> {
    const key = `${input.channelId}:${input.dateKey}:${input.model ?? ''}:${this.config.preset}`
    const hit = this.cache.get(key)
    if (hit && hit.expire > Date.now()) return hit.text

    try {
      const text = await this.callModel(input)
      if (text) {
        this.cache.set(key, { text, expire: Date.now() + CACHE_TTL })
        return text
      }
    } catch (error) {
      this.ctx.logger.warn('chatluna-wordcloud: 人设总结生成失败 %s', error)
    }

    return this.fallback(input.analysis)
  }

  private fallback(analysis: AnalyseResult): string {
    const top = analysis.words.slice(0, 2).map((item) => item.word).join('、')
    if (!top) return `今天共聊了 ${analysis.stats.total} 句，群里安安静静的~`
    return `今天共聊了 ${analysis.stats.total} 句，聊得最多的是 ${top}`
  }

  private buildPrompt(input: SummaryInput): string {
    const top = input.analysis.words
      .slice(0, 10)
      .map((item) => item.word)
      .join('、')

    const vars: Record<string, string> = {
      botName: input.botName,
      guildName: input.guildName,
      dateLabel: input.dateLabel,
      total: String(input.analysis.stats.total),
      human: String(input.analysis.stats.human),
      ai: String(input.analysis.stats.bot),
      users: String(input.analysis.stats.users),
      peakHour: String(input.analysis.stats.peakHour),
      topWords: top || '（无）',
      maxLen: String(this.config.summaryMaxLength),
    }

    return this.config.summaryPrompt.replace(/\{(\w+)\}/g, (raw, name: string) => {
      return vars[name] ?? raw
    })
  }

  /** 取 ChatLuna 预设里的 system prompt 作为人设摘录 */
  private resolvePersona(presetName?: string): string {
    const chatluna = (this.ctx as any).chatluna
    if (!chatluna?.preset || !presetName) return ''

    try {
      const preset = chatluna.preset.getPreset(presetName)?.value
      const messages: any[] = preset?.messages ?? []
      return messages
        .filter((message) => message?.getType?.() === 'system')
        .map((message) => (typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content)))
        .join('\n')
        .replace(/\{[^{}]{1,40}\}/g, '')
        .trim()
        .slice(0, 1200)
    } catch (error) {
      this.ctx.logger.debug('chatluna-wordcloud: 读取预设 %s 失败 %s', presetName, error)
      return ''
    }
  }

  private async callModel(input: SummaryInput): Promise<string> {
    const chatluna = (this.ctx as any).chatluna
    if (!chatluna) throw new Error('chatluna service unavailable')

    const modelName = this.config.model || input.model || chatluna.config?.defaultModel
    if (!modelName) throw new Error('no model available')

    const presetName = this.config.preset || input.preset || chatluna.config?.defaultPreset
    const persona = this.resolvePersona(presetName)

    const prompt = this.buildPrompt(input)
    const full = persona
      ? `你在扮演「${input.botName}」。角色设定（节选）：\n${persona}\n\n${prompt}`
      : prompt

    const ref = await chatluna.createChatModel(modelName)
    const model = ref?.value
    if (!model) throw new Error(`model ${modelName} unavailable`)

    const response = await model.invoke(full, { timeout: this.config.summaryTimeout })
    const raw = contentToText(response?.content)
    return this.clean(raw, this.config.summaryMaxLength)
  }

  /** 去掉引号/代码块/markdown，只留第一句 */
  private clean(raw: string, maxLength: number): string {
    let text = String(raw ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s*[-*>#]+\s*/gm, '')
      .replace(/["'“”‘’「」]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    const firstLine = text.split(/[\n。！？!?]/)[0]?.trim() || text
    text = firstLine

    if (text.length > maxLength) text = text.slice(0, maxLength)
    return text
  }
}
