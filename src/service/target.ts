import { Session } from 'koishi'
import { Target } from '../types'

/** 从当前会话解析统计目标；私聊时 guildId 为空串 */
export function resolveSessionTarget(session: Session): Target | null {
  const platform = session.platform
  const selfId = session.selfId
  if (!platform || !selfId) return null

  if (session.isDirect) {
    const userId = session.userId
    if (!userId) return null
    return {
      type: 'private',
      platform,
      selfId,
      guildId: '',
      channelId: session.channelId || userId,
      guildName: '私聊',
      userId,
    }
  }

  const guildId = session.guildId ?? session.channelId
  if (!guildId) return null

  const guildName = (session as any).guildName
    || (session.event as any)?.guild?.name
    || `群 ${guildId}`

  return {
    type: 'group',
    platform,
    selfId,
    guildId,
    channelId: session.channelId || guildId,
    guildName,
    userId: session.userId,
  }
}

/** -a 模式：该 bot 名下全部会话，标题用通用文本 */
export function resolveAllTarget(session: Session, title: string): Target | null {
  const platform = session.platform
  const selfId = session.selfId
  if (!platform || !selfId) return null

  return {
    type: session.isDirect ? 'private' : 'group',
    mode: 'all',
    platform,
    selfId,
    guildId: '',
    channelId: '',
    guildName: title,
    userId: session.userId,
  }
}
