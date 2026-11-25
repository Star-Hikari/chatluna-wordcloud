import { Schema } from 'koishi'
import type { CloudShape } from './templates/poster'
import { AutoTarget } from './types'

/** 动态 schema 名称，供控制台下拉框使用 */
export const PRESET_SCHEMA = 'chatluna-wordcloud/preset'
export const MODEL_SCHEMA = 'chatluna-wordcloud/model'

export const DEFAULT_SUMMARY_PROMPT = [
  '今日群聊数据：共 {total} 条消息（群友 {human} 条 / 你 {ai} 条），{users} 位群友参与，最活跃时段 {peakHour} 点。',
  '高频词：{topWords}。',
  '',
  '请用「{botName}」的口吻写一句今日总结，不超过 {maxLen} 字，只输出这一句话，不要引号、不要 markdown、不要解释。',
].join('\n')

export interface Config {
  // 数据范围
  days: number
  maxDays: number
  minMessages: number
  maxMessages: number
  includeHuman: boolean
  includeBot: boolean
  // 分词与过滤
  stripWrapper: boolean
  stripParentheses: boolean
  minWordLength: number
  topN: number
  filterWords: string
  excludeLatin: boolean
  excludeNumbers: boolean
  excludePunctuation: boolean
  excludePatterns: string[]
  botNames: string[]
  // 人设总结
  enableSummary: boolean
  preset: string
  model: string
  summaryPrompt: string
  summaryMaxLength: number
  summaryTimeout: number
  // 海报视觉
  width: number
  height: number
  deviceScaleFactor: number
  cloudShape: CloudShape
  palette: string[]
  avatarUrl: string
  backgroundImage: string
  backgroundDim: number
  backgroundBlur: number
  footerText: string
  allTitle: string
  // 定时投递
  autoEnabled: boolean
  autoTime: string
  autoTargets: AutoTarget[]
  // 调试
  keepHtml: boolean
}

export const Config = Schema.intersect([
  Schema.object({
    days: Schema.number().default(1).min(1).max(7)
      .description('默认统计天数（1 = 今天）'),
    maxDays: Schema.number().default(7).min(1).max(30)
      .description('-d 允许的最大天数'),
    minMessages: Schema.number().default(30)
      .description('少于该条数时提示数据不足'),
    maxMessages: Schema.number().default(5000)
      .description('单次读取上限'),
    includeHuman: Schema.boolean().default(true)
      .description('统计群友消息'),
    includeBot: Schema.boolean().default(true)
      .description('统计 bot 消息'),
  }).description('数据范围'),

  Schema.object({
    stripWrapper: Schema.boolean().default(true)
      .description('按预设模板剥离消息壳'),
    stripParentheses: Schema.boolean().default(true)
      .description('过滤 bot 的动作描写（…）'),
    minWordLength: Schema.number().default(2).min(1).max(8)
      .description('词的最小长度'),
    topN: Schema.number().default(120).min(10).max(1000)
      .description('词表最多保留的词数'),
    filterWords: Schema.string().role('textarea').default('')
      .description('过滤词，逗号或换行分隔'),
    excludeLatin: Schema.boolean().default(true)
      .description('不统计英文单词'),
    excludeNumbers: Schema.boolean().default(true)
      .description('不统计数字 token'),
    excludePunctuation: Schema.boolean().default(true)
      .description('不统计纯标点'),
    excludePatterns: Schema.array(String).role('table').default([])
      .description('排除正则（逐条匹配）'),
    botNames: Schema.array(String).role('table').default([])
      .description('bot 的名字，避免上榜'),
  }).description('分词与过滤'),

  Schema.object({
    enableSummary: Schema.boolean().default(true)
      .description('用会话人设写一句总结'),
  }).description('人设总结'),

  Schema.union([
    Schema.object({
      enableSummary: Schema.const(true),
      preset: Schema.dynamic(PRESET_SCHEMA).default('')
        .description('预设，留空跟随会话'),
      model: Schema.dynamic(MODEL_SCHEMA).default('')
        .description('模型，留空跟随会话'),
      summaryPrompt: Schema.string().role('textarea').default(DEFAULT_SUMMARY_PROMPT)
        .description('总结提示词，支持 {变量}'),
      summaryMaxLength: Schema.number().default(40).min(10).max(120)
        .description('总结最大字数'),
      summaryTimeout: Schema.number().default(20000).min(3000).max(120000)
        .description('模型超时（毫秒）'),
    }).description('总结生成'),
    Schema.object({}),
  ]),

  Schema.object({
    width: Schema.number().default(1080).min(480).max(2160)
      .description('海报宽度'),
    height: Schema.number().default(1920).min(480).max(3840)
      .description('海报高度'),
    deviceScaleFactor: Schema.number().default(1).min(1).max(3)
      .description('截图倍率（2 更清晰）'),
    cloudShape: Schema.union(['blob', 'flower', 'circle', 'square'] as const)
      .default('blob').description('词云轮廓'),
    palette: Schema.array(String).default([
      '#ff9fb2', '#f2a6c0', '#c9a0dc', '#9aa8d0',
      '#8fb8ff', '#7fc8c0', '#e0b08a',
    ]).description('词云配色'),
    avatarUrl: Schema.string().default('')
      .description('头像地址，留空自动获取'),
    backgroundImage: Schema.string().default('')
      .description('背景图路径或 URL'),
    backgroundDim: Schema.number().default(0.2).min(0).max(0.95).step(0.05)
      .description('背景遮罩透明度'),
    backgroundBlur: Schema.number().default(5).min(0).max(60)
      .description('背景模糊半径（px）'),
    footerText: Schema.string().default('chatluna-wordcloud · {time}')
      .description('页脚文本，支持 {time} {date}'),
    allTitle: Schema.string().default('全部会话')
      .description('-a 模式的标题'),
  }).description('海报视觉'),

  Schema.object({
    autoEnabled: Schema.boolean().default(false)
      .description('每天定时推送日报'),
  }).description('定时投递'),

  Schema.union([
    Schema.object({
      autoEnabled: Schema.const(true).required(),
      autoTime: Schema.string().default('23:55')
        .description('发送时间 HH:mm'),
      autoTargets: Schema.array(Schema.object({
        type: Schema.union(['group', 'private'] as const).default('group')
          .description('group=群聊，private=私聊'),
        platform: Schema.string().default('onebot')
          .description('平台名'),
        selfId: Schema.string().required()
          .description('bot 的 selfId'),
        channelId: Schema.string().required()
          .description('群号或 QQ 号'),
      })).role('table').default([])
        .description('投递目标'),
    }).description('定时设置'),
    Schema.object({}),
  ]),

  Schema.object({
    keepHtml: Schema.boolean().default(false)
      .description('保留渲染 HTML（调试）'),
  }).description('调试'),
]) as Schema<Config>
