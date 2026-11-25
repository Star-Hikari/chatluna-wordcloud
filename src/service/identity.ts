import { Bot, Context } from 'koishi'

export interface BotIdentity {
  name: string
  /** 平台头像地址，取不到则 undefined，由模板用首字占位 */
  avatarUrl?: string
}

/** OneBot 系直接用 QQ 官方头像接口，其它平台退回 login.user.avatar */
function qqAvatar(selfId: string): string | undefined {
  return /^\d{5,12}$/.test(selfId)
    ? `https://q1.qlogo.cn/g?b=qq&nk=${selfId}&s=640`
    : undefined
}

export async function resolveBotIdentity(ctx: Context, bot: Bot): Promise<BotIdentity> {
  let name = ''
  let avatarUrl: string | undefined

  try {
    const login = await bot.getLogin?.()
    name = login?.user?.name || ''
    avatarUrl = login?.user?.avatar
  } catch (error) {
    ctx.logger.debug('chatluna-wordcloud: getLogin 失败 %s', error)
  }

  const anyBot = bot as any
  name = name || anyBot.user?.name || anyBot.username || bot.selfId
  avatarUrl = avatarUrl || anyBot.user?.avatar || qqAvatar(bot.selfId)

  return { name, avatarUrl }
}
