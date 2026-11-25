import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Context } from 'koishi'
import type {} from 'koishi-plugin-puppeteer'
import type { Config } from '../config'
import { PosterData, renderPoster } from '../templates/poster'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** 背景图/头像最大 8MB，避免 data URI 把页面撑爆 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export class RenderService {
  constructor(private readonly ctx: Context) {}

  /** 本地路径或 http(s) 地址 → data URI；失败返回 undefined，由模板回退 */
  async loadImage(source?: string): Promise<string | undefined> {
    if (!source) return undefined

    try {
      let buffer: Buffer
      let mime: string

      if (/^https?:\/\//i.test(source)) {
        const result = await this.ctx.http.get(source, {
          responseType: 'arraybuffer',
          timeout: 15000,
        })
        buffer = Buffer.from(result as ArrayBuffer)
        const matched = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.exec(source)
        mime = matched ? MIME[`.${matched[1].toLowerCase().replace('jpg', 'jpeg')}`] ?? 'image/jpeg' : 'image/jpeg'
      } else {
        buffer = await readFile(source)
        mime = MIME[extname(source).toLowerCase()] ?? 'image/png'
      }

      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        this.ctx.logger.warn('chatluna-wordcloud: 图片超过 8MB，已忽略 %s', source)
        return undefined
      }

      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch (error) {
      this.ctx.logger.warn('chatluna-wordcloud: 读取图片失败 %s — %s', source, error)
      return undefined
    }
  }

  async render(data: PosterData, config: Config): Promise<Buffer> {
    const html = renderPoster(data)

    if (config.keepHtml) {
      try {
        const dir = join(this.ctx.baseDir, 'data', 'chatluna-wordcloud')
        await mkdir(dir, { recursive: true })
        const file = join(dir, `${Date.now()}.html`)
        await writeFile(file, html, 'utf8')
        this.ctx.logger.info('chatluna-wordcloud: HTML 已保存 %s', file)
      } catch (error) {
        this.ctx.logger.warn('chatluna-wordcloud: 保存 HTML 失败 %s', error)
      }
    }

    const page = await this.ctx.puppeteer.page()
    try {
      await page.setViewport({
        width: config.width,
        height: config.height,
        deviceScaleFactor: config.deviceScaleFactor,
      })
      await page.setContent(html, { waitUntil: 'networkidle0' })
      await page.evaluate(() => (document as any).fonts?.ready ?? true)
      // 词云是异步逐词排布的，等 wordcloudstop
      await page.waitForFunction('window.__ready === true', { timeout: 8000 }).catch(() => null)
      const shot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: config.width, height: config.height },
      })
      return Buffer.from(shot as Uint8Array)
    } finally {
      await page.close()
    }
  }
}
