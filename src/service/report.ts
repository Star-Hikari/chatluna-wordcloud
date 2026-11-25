import { Context } from 'koishi'
import type { Config } from '../config'
import { PosterData } from '../templates/poster'
import { AnalyseResult, analyse } from './analyse'
import { BotIdentity } from './identity'
import { MessageService, resolveRange } from './message'
import { RenderService } from './render'
import { SummaryService } from './summary'
import { LoadResult, ConversationRef, Target } from '../types'

export interface PreparedReport {
  ok: true
  result: LoadResult
  analysis: AnalyseResult
  start: Date
  end: Date
  dateLabel: string
}

export interface PrepareFailure {
  ok: false
  reason: string
}

export type PrepareOutcome = PreparedReport | PrepareFailure

export type ReportOutcome =
  | (PreparedReport & { buffer?: Buffer; summary: string })
  | PrepareFailure

export function buildDateLabel(start: Date, end: Date, days: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = (date: Date) => `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (days <= 1) return `${day(start)} · 今日`
  return `${day(start)} ~ ${day(end)} · 近 ${days} 天`
}

function compilePatterns(ctx: Context, sources: string[]): RegExp[] {
  return sources
    .map((source) => {
      try {
        return new RegExp(source)
      } catch {
        ctx.logger.warn('chatluna-wordcloud: 无效的排除正则 %s', source)
        return null
      }
    })
    .filter((item): item is RegExp => !!item)
}

export class ReportService {
  private readonly messages: MessageService
  private readonly renderer: RenderService
  private readonly summary: SummaryService

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {
    this.messages = new MessageService(ctx)
    this.renderer = new RenderService(ctx)
    this.summary = new SummaryService(ctx, config)
  }

  /** 收集会话所用预设的 format_user_prompt，用于模板化剥离消息壳 */
  private resolveWrapperTemplates(conversations: ConversationRef[]): string[] {
    const chatluna = (this.ctx as any).chatluna
    if (!chatluna?.preset?.getPreset) return []

    const names = new Set<string>()
    for (const conversation of conversations) {
      if (conversation.preset) names.add(conversation.preset)
    }

    const templates: string[] = []
    for (const name of [...names].slice(0, 8)) {
      try {
        const template = chatluna.preset.getPreset(name)?.value?.formatUserPromptString
        if (template && !templates.includes(template)) templates.push(template)
      } catch (error) {
        this.ctx.logger.debug(
          'chatluna-wordcloud: 读取预设 %s 的 format_user_prompt 失败 %s',
          name,
          error,
        )
      }
    }
    return templates
  }

  /** 取数 + 统计，不调模型、不渲染，供 `--raw` 复用 */
  async prepare(target: Target, days: number, botName = ''): Promise<PrepareOutcome> {
    const { start, end } = resolveRange(days)

    const conversations = await this.messages.resolveConversations(target)
    const result = await this.messages.loadWith(conversations, {
      start,
      end,
      limit: this.config.maxMessages,
      includeHuman: this.config.includeHuman,
      includeBot: this.config.includeBot,
      stripParentheses: this.config.stripParentheses,
      stripWrapper: this.config.stripWrapper,
      wrapperTemplates: this.resolveWrapperTemplates(conversations),
    })

    if (!result.conversations.length) {
      return {
        ok: false,
        reason: target.type === 'group'
          ? '本群还没有和 bot 聊过天喵~'
          : '我们还没有聊过天喵~',
      }
    }

    if (result.messages.length < this.config.minMessages) {
      return {
        ok: false,
        reason: this.buildInsufficientReason(target, result.messages.length, days),
      }
    }

    const analysis = analyse(result.messages, {
      minWordLength: this.config.minWordLength,
      topN: this.config.topN,
      filterWords: this.config.filterWords,
      excludePatterns: compilePatterns(this.ctx, this.config.excludePatterns),
      excludeLatin: this.config.excludeLatin,
      excludeNumbers: this.config.excludeNumbers,
      excludePunctuation: this.config.excludePunctuation,
      blacklist: [...this.config.botNames, botName].filter(Boolean),
    })

    return {
      ok: true,
      result,
      analysis,
      start,
      end,
      dateLabel: buildDateLabel(start, end, days),
    }
  }

  /** 数据不足时按当前消息密度推算还需要几天 */
  private suggestDays(count: number, days: number): number | null {
    const perDay = count / Math.max(days, 1)
    const needed = Math.ceil(this.config.minMessages / Math.max(perDay, 1))
    const suggested = Math.max(days + 1, needed)
    return suggested <= this.config.maxDays ? suggested : null
  }

  private buildInsufficientReason(target: Target, count: number, days: number): string {
    const min = this.config.minMessages
    const range = days <= 1 ? '今天' : `最近 ${days} 天`
    const suggested = this.suggestDays(count, days)

    if (suggested) {
      const command = target.mode === 'all' ? '今日词云 -a -d' : '今日词云 -d'
      return `只攒到 ${count} 条聊天记录（至少要 ${min} 条），不够画词云喵~ 试试「${command} ${suggested}」汇总最近 ${suggested} 天？`
    }

    return `${range}只攒到 ${count} 条聊天记录（至少要 ${min} 条才够），再聊几天再来吧~`
  }

  /** 完整日报：数据 + 人设总结 + 海报 */
  async build(target: Target, days: number, identity: BotIdentity): Promise<ReportOutcome> {
    const botName = identity.name
    const prepared = await this.prepare(target, days, botName)
    if (prepared.ok === false) return { ok: false, reason: prepared.reason }

    const { result, analysis, start, dateLabel } = prepared
    const latest = [...result.conversations].sort((a, b) => {
      return (b.lastChatAt?.getTime() ?? 0) - (a.lastChatAt?.getTime() ?? 0)
    })[0]

    const summary = this.config.enableSummary
      ? await this.summary.generate({
        channelId: target.channelId || `all:${target.platform}:${target.selfId}`,
        dateKey: `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`,
        botName,
        guildName: target.guildName,
        dateLabel,
        analysis,
        // 全会话模式用配置里的默认预设/模型，单会话模式跟随当前会话
        preset: target.mode === 'all' ? undefined : latest?.preset,
        model: target.mode === 'all' ? undefined : latest?.model,
      })
      : fallbackSummary(analysis)

    const base = { ...prepared, summary }
    if (!this.ctx.puppeteer) return base

    const avatarSource = this.config.avatarUrl || identity.avatarUrl
    const [background, avatar] = await Promise.all([
      this.renderer.loadImage(this.config.backgroundImage),
      this.renderer.loadImage(avatarSource),
    ])

    const generatedAt = new Date()
    const poster: PosterData = {
      guildName: target.guildName,
      dateLabel,
      botName,
      avatar: avatar || '',
      words: analysis.cloud,
      stats: analysis.stats,
      hourly: analysis.hourly,
      summary,
      palette: this.config.palette,
      cloudShape: this.config.cloudShape,
      background,
      backgroundDim: this.config.backgroundDim,
      backgroundBlur: this.config.backgroundBlur,
      footerText: formatFooter(this.config.footerText, generatedAt),
      generatedAt,
    }

    const buffer = await this.renderer.render(poster, this.config)
    return { ...base, buffer }
  }
}

export function fallbackSummary(analysis: AnalyseResult): string {
  const top = analysis.words.slice(0, 2).map((item) => item.word).join('、')
  if (!top) return `今天共聊了 ${analysis.stats.total} 句，群里安安静静的~`
  return `今天共聊了 ${analysis.stats.total} 句，聊得最多的是 ${top}`
}

/** 页脚模板：{time} → HH:mm，{date} → YYYY-MM-DD */
export function formatFooter(template: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return template
    .replace(/\{time\}/g, time)
    .replace(/\{date\}/g, date)
}
