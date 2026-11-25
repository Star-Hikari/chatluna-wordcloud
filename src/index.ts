import { Context, h, Schema, Session } from 'koishi'
import { Config, MODEL_SCHEMA, PRESET_SCHEMA } from './config'
import { AutoTarget, Target } from './types'
import { ReportService, PreparedReport } from './service/report'
import { resolveBotIdentity } from './service/identity'
import { resolveAllTarget, resolveSessionTarget } from './service/target'
import { scheduleDaily } from './utils/schedule'
import { formatTime, truncate } from './utils/text'

export const name = 'chatluna-wordcloud'

export const inject = {
  required: ['database', 'chatluna'],
  optional: ['puppeteer'],
}

export { Config }

export const usage = `<style>
.markdown .chatword-usage{font-size:14px;line-height:1.7}
.markdown .chatword-usage h3{margin:20px 0 8px;padding-left:10px;border-left:3px solid var(--k-color-primary);font-size:15px;font-weight:600}
.markdown .chatword-usage h3:first-child{margin-top:0}
.markdown .chatword-usage p{margin:6px 0}
.markdown .chatword-usage ul{margin:6px 0;padding-left:18px}
.markdown .chatword-usage li{margin:3px 0}
.markdown .chatword-usage blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--k-color-primary);background:var(--k-hover-bg);border-radius:6px;color:var(--fg2)}
.markdown .chatword-usage table{width:100%;margin:8px 0;border-collapse:collapse;font-size:13px}
.markdown .chatword-usage th,.markdown .chatword-usage td{padding:6px 10px;border-bottom:1px solid var(--k-color-divider);text-align:left;vertical-align:top}
.markdown .chatword-usage th{color:var(--fg2);font-weight:500;background:var(--k-hover-bg)}
.markdown .chatword-usage code{padding:1px 5px;border-radius:4px;background:var(--k-hover-bg);color:var(--k-color-primary);font-size:12px}
</style>

<div class="chatword-usage">

### 今日词云

> 读取 ChatLuna 聊天记录，统计关键词与互动数据，生成一张 1080×1920 的群聊日报海报。

### 指令

| 指令 | 说明 |
| --- | --- |
| <code>今日词云</code> / <code>chatword</code> | 统计今天 |
| <code>今日词云 -d 7</code> | 统计最近 7 天（上限见配置） |
| <code>今日词云 -a</code> | 汇总该 bot 的全部会话（群聊 + 私聊） |
| <code>今日词云 -a -d 7</code> | 全部会话 + 最近 7 天 |
| <code>今日词云 --raw</code> | 只输出统计数据，不渲染图片 |

### 数据来源

- 只读 ChatLuna 的 <code>chatluna_message</code>，不额外存库
- 消息不足时会提示建议天数
- <code>-a</code> 使用配置里的预设和模型，普通模式跟随当前会话

### 配置分组

| 分组 | 用途 |
| --- | --- |
| 数据范围 | 天数、条数阈值、真人 / bot 开关 |
| 分词与过滤 | 消息壳、动作描写、停用词、英文 / 数字 / 标点 |
| 人设总结 | 是否让模型写一句话（预设、模型、提示词） |
| 海报视觉 | 尺寸、词云轮廓与配色、背景图、页脚 |
| 定时投递 | 每日推送的时间与目标 |
| 调试 | 保留渲染 HTML，方便改样式 |

### 定时推送

打开「定时投递」开关，设置 <code>autoTime</code> 和 <code>autoTargets</code>；群聊填群号，私聊填 QQ 号。

</div>`

export function apply(ctx: Context, config: Config) {
  const report = new ReportService(ctx, config)

  ctx.command('chatword', '生成群聊词云')
    .alias('今日词云')
    .option('days', '-d <days:number> 统计天数')
    .option('all', '-a, --all 汇总该 bot 的全部会话')
    .option('raw', '--raw 输出统计数据 JSON，不渲染图片')
    .action(async ({ session, options }) => {
      if (!session) return '请在会话中使用该指令'

      const target = options.all
        ? resolveAllTarget(session, config.allTitle)
        : resolveSessionTarget(session)
      if (!target) return '无法识别当前会话'

      const days = Math.min(Math.max(options.days ?? config.days, 1), config.maxDays)
      const identity = await resolveBotIdentity(ctx, session.bot)
      const botName = identity.name

      if (options.raw) {
        const prepared = await report.prepare(target, days, botName)
        if (prepared.ok === false) return prepared.reason
        return '```json\n' + JSON.stringify(buildRawPayload(target, days, prepared), null, 2) + '\n```'
      }

      let outcome
      try {
        outcome = await report.build(target, days, identity)
      } catch (error) {
        ctx.logger.error('chatluna-wordcloud: 生成失败', error)
        return '生成失败了喵……稍后再试试？'
      }

      if (outcome.ok === false) return outcome.reason
      if (outcome.buffer) return h.image(outcome.buffer, 'image/png')

      return buildTextSummary(session, target, days, outcome, config)
    })

  const autoTargets = config.autoTargets ?? []
  if (config.autoEnabled && autoTargets.length) {
    scheduleDaily(ctx, config.autoTime ?? '23:55', async () => {
      for (const item of autoTargets) {
        try {
          await deliver(ctx, report, config, item)
        } catch (error) {
          ctx.logger.warn(
            'chatluna-wordcloud: 推送到 %s 失败 %s',
            item.channelId,
            error,
          )
        }
      }
    })
  }

  registerChoices(ctx)
}

/**
 * 预设 / 模型下拉框：运行时拉取，不只在启动时取一次。
 * 就绪、模型增删事件、每分钟兜底都会刷新，列表没变化时跳过 set。
 */
function registerChoices(ctx: Context) {
  const seen = { preset: '', model: '' }

  const refresh = () => {
    const chatluna = (ctx as any).chatluna
    if (!chatluna) return

    try {
      const presets: string[] = chatluna.preset?.getAllPreset?.()?.value ?? []
      const models: any[] = chatluna.platform?.listAllModels?.(1)?.value ?? []
      const modelNames = models.map((item) => {
        try {
          return item.toModelName?.() ?? `${item.platform}/${item.name}`
        } catch {
          return `${item.platform}/${item.name}`
        }
      })

      const presetKey = presets.join('\u0001')
      if (presetKey !== seen.preset) {
        seen.preset = presetKey
        ctx.schema.set(PRESET_SCHEMA, Schema.union([
          Schema.const('').description('跟随当前会话'),
          ...presets.map((name) => Schema.const(name)),
        ]) as any)
      }

      const modelKey = modelNames.join('\u0001')
      if (modelKey !== seen.model) {
        seen.model = modelKey
        ctx.schema.set(MODEL_SCHEMA, Schema.union([
          Schema.const('').description('跟随当前会话'),
          ...modelNames.map((name) => Schema.const(name)),
        ]) as any)
      }
    } catch (error) {
      ctx.logger.debug('chatluna-wordcloud: 刷新预设/模型列表失败 %s', error)
    }
  }

  // 先注册允许任意字符串的兜底 schema，避免动态列表还没就绪时配置校验失败
  ctx.schema.set(PRESET_SCHEMA, Schema.union([Schema.const(''), Schema.string()]) as any)
  ctx.schema.set(MODEL_SCHEMA, Schema.union([Schema.const(''), Schema.string()]) as any)

  refresh()
  ctx.on('ready', refresh)
  ctx.on('chatluna/model-added' as any, refresh)
  ctx.on('chatluna/model-removed' as any, refresh)
  ctx.setInterval(refresh, 60_000)
}

async function deliver(
  ctx: Context,
  report: ReportService,
  config: Config,
  item: AutoTarget,
) {
  const bot = ctx.bots.find((candidate) => {
    return candidate.selfId === item.selfId &&
      (!item.platform || candidate.platform === item.platform)
  })
  if (!bot) {
    ctx.logger.warn('chatluna-wordcloud: selfId=%s 的 bot 不在线，跳过', item.selfId)
    return
  }

  const target: Target = {
    type: item.type,
    platform: item.platform,
    selfId: item.selfId,
    guildId: item.type === 'group' ? item.channelId : '',
    channelId: item.channelId,
    guildName: item.type === 'group'
      ? await resolveGuildName(bot, item.channelId)
      : '私聊',
  }

  const identity = await resolveBotIdentity(ctx, bot)
  const outcome = await report.build(target, config.days, identity)

  if (outcome.ok === false) {
    ctx.logger.info('chatluna-wordcloud: %s 跳过推送（%s）', item.channelId, outcome.reason)
    return
  }

  const content = outcome.buffer
    ? h.image(outcome.buffer, 'image/png')
    : outcome.summary

  if (item.type === 'group') {
    await bot.sendMessage(item.channelId, content)
  } else {
    await bot.sendPrivateMessage(item.channelId, content)
  }
}

async function resolveGuildName(bot: any, channelId: string): Promise<string> {
  try {
    const guild = await bot.getGuild?.(channelId)
    if (guild?.name) return guild.name
  } catch {
    // 部分适配器不支持 getGuild，忽略
  }
  return `群 ${channelId}`
}

function buildRawPayload(target: Target, days: number, prepared: PreparedReport) {
  const { result, analysis, start, end, dateLabel } = prepared
  const human = result.messages.filter((item) => item.role === 'human')
  const bot = result.messages.filter((item) => item.role === 'ai')
  const sampleCount = result.messages.length > 40 ? 5 : 10

  return {
    target: {
      type: target.type,
      platform: target.platform,
      selfId: target.selfId,
      guildId: target.guildId,
      guildName: target.guildName,
    },
    days,
    dateLabel,
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    conversations: result.conversations.map((item) => item.bindingKey),
    rawCount: result.rawCount,
    kept: result.messages.length,
    skipped: result.skipped,
    truncated: result.truncated,
    roles: { human: human.length, ai: bot.length },
    users: new Set(human.map((item) => item.name || '未知')).size,
    time: {
      first: result.messages.length ? formatTime(result.messages[0].at, true) : null,
      last: result.messages.length
        ? formatTime(result.messages[result.messages.length - 1].at, true)
        : null,
    },
    stats: {
      ...analysis.stats,
      longest: analysis.stats.longest
        ? { ...analysis.stats.longest, text: truncate(analysis.stats.longest.text, 60) }
        : undefined,
    },
    hourly: analysis.hourly.map((bucket) => bucket.human + bucket.bot),
    topWords: analysis.words.slice(0, 20).map((item) => `${item.word}×${item.count}`),
    sample: result.messages.slice(-sampleCount).map((item) => ({
      role: item.role,
      name: item.name,
      at: formatTime(item.at, true),
      text: truncate(item.text, 60),
    })),
  }
}

function buildTextSummary(
  session: Session,
  target: Target,
  days: number,
  outcome: PreparedReport & { summary: string },
  config: Config,
) {
  const { stats } = outcome.analysis
  const botName = (session.bot as any)?.user?.name || 'bot'
  const notice = outcome.result.truncated ? `（仅统计最近 ${config.maxMessages} 条）` : ''
  const topWords = outcome.analysis.words.slice(0, 6).map((item) => item.word).join('、')

  return [
    `📊 ${target.guildName} · 最近 ${days} 天`,
    `共 ${stats.total} 条${notice}：群友 ${stats.human} / ${botName} ${stats.bot}，${stats.users} 人参与`,
    `平均 ${stats.avgHuman} 字 · 高峰 ${stats.peakHour} 点 · 互动指数 ${stats.index}`,
    topWords ? `高频词：${topWords}` : '还没有提取到有效关键词',
    `「${outcome.summary}」`,
    '（未启用 puppeteer，仅输出文字统计）',
  ].join('\n')
}
