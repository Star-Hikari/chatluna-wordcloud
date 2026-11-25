import { Context } from 'koishi'

/**
 * 每天 HH:mm 执行一次，执行完自动排下一次。
 * 不用 cron 语法，避免额外依赖；时间格式非法时直接不注册。
 */
export function scheduleDaily(
  ctx: Context,
  time: string,
  run: () => Promise<void>,
  loggerTag = 'chatluna-wordcloud',
): void {
  const [hour, minute] = time.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    ctx.logger.warn('%s: 定时时间格式错误 %s，应为 HH:mm', loggerTag, time)
    return
  }

  const arm = () => {
    const now = Date.now()
    const next = new Date(now)
    next.setHours(hour, minute, 0, 0)
    if (next.getTime() <= now) next.setDate(next.getDate() + 1)

    ctx.setTimeout(() => {
      Promise.resolve()
        .then(run)
        .catch((error) => ctx.logger.warn('%s: 定时任务失败 %s', loggerTag, error))
        .finally(arm)
    }, next.getTime() - now)
  }

  ctx.on('ready', arm)
}
