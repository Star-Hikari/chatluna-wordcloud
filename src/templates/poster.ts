import { HourlyBucket, Stats } from '../types'
import { WORDCLOUD2_SOURCE } from './wordcloud2'

export type CloudShape = 'blob' | 'flower' | 'circle' | 'square'

export interface PosterData {
  guildName: string
  dateLabel: string
  botName: string
  /** data URI，空则用首字占位 */
  avatar: string
  words: Array<[string, number]>
  stats: Stats
  hourly: HourlyBucket[]
  summary: string
  palette: string[]
  cloudShape: CloudShape
  /** data URI，空则用渐变底 */
  background?: string
  backgroundDim: number
  backgroundBlur: number
  footerText: string
  generatedAt: Date
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 24 小时堆叠柱，左右留边，坐标在 TS 里算好再拼 SVG */
export function renderHourly(hourly: HourlyBucket[]): string {
  const W = 960
  const H = 300
  const TOP = 26
  const BASE = 252
  const PAD_X = 14
  const GAP = 9
  const plotW = W - PAD_X * 2
  const barW = (plotW - GAP * 23) / 24
  const max = Math.max(1, ...hourly.map((item) => item.human + item.bot))
  const scale = (BASE - TOP) / max

  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = BASE - (BASE - TOP) * ratio
      return `<line x1="${PAD_X}" y1="${y.toFixed(1)}" x2="${W - PAD_X}" y2="${y.toFixed(1)}" stroke="rgba(120,110,140,.12)" stroke-dasharray="6 8"/>`
    })
    .join('')

  const peak = hourly.reduce((best, item, index) => {
    const current = hourly[best]
    return item.human + item.bot > current.human + current.bot ? index : best
  }, 0)

  const bars = hourly
    .map((item, index) => {
      const x = PAD_X + index * (barW + GAP)
      const total = item.human + item.bot
      if (!total) {
        return `<rect x="${x.toFixed(1)}" y="${BASE - 2}" width="${barW.toFixed(1)}" height="2" rx="1" fill="rgba(150,140,170,.25)"/>`
      }

      const totalH = total * scale
      const botH = item.bot * scale
      const humanH = item.human * scale
      const y = BASE - totalH
      const isPeak = index === peak
      const stroke = isPeak ? 'stroke="#ff86a0" stroke-width="2.5"' : ''

      const humanRect = humanH > 0
        ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${humanH.toFixed(1)}" rx="5" fill="url(#gPink)" ${stroke}/>`
        : ''
      const botRect = botH > 0
        ? `<rect x="${x.toFixed(1)}" y="${(BASE - botH).toFixed(1)}" width="${barW.toFixed(1)}" height="${botH.toFixed(1)}" rx="5" fill="url(#gBlue)" ${humanH > 0 ? '' : stroke}/>`
        : ''

      return humanRect + botRect
    })
    .join('')

  const labels = [0, 6, 12, 18, 23]
    .map((hour) => {
      const x = PAD_X + hour * (barW + GAP) + barW / 2
      return `<text x="${x.toFixed(1)}" y="${BASE + 30}" text-anchor="middle" font-size="20" fill="#8a8496">${hour}</text>`
    })
    .join('')

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="300" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gPink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffb3c4"/><stop offset="100%" stop-color="#ff8fa8"/>
    </linearGradient>
    <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#a9c8ff"/><stop offset="100%" stop-color="#7fa9f5"/>
    </linearGradient>
  </defs>
  ${grid}
  ${bars}
  ${labels}
</svg>`
}

function statCard(value: string, label: string, accent: string): string {
  return `<div class="stat">
    <b style="background-image:${accent}">${escapeHtml(value)}</b>
    <span>${escapeHtml(label)}</span>
  </div>`
}

export function renderPoster(data: PosterData): string {
  const { stats } = data
  const avatar = data.avatar
    ? `<img class="avatar" src="${data.avatar}" alt="">`
    : `<div class="avatar avatar-fb">${escapeHtml(Array.from(data.botName)[0] || '喵')}</div>`

  const peak = Math.max(1, ...data.hourly.map((item) => item.human + item.bot))

  const bgLayer = data.background
    ? `<div class="bg" style="background-image:url('${data.background}')"></div>
       <div class="dim" style="--dim:${data.backgroundDim};--blur:${data.backgroundBlur}px"></div>`
    : ''

  const words = JSON.stringify(data.words)
  const palette = JSON.stringify(data.palette)
  const shape = JSON.stringify(data.cloudShape)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1920px;overflow:hidden}
  body{
    font-family:"Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif;
    color:#3f3a4a;
    background:linear-gradient(160deg,#fff6f8 0%,#eef5ff 55%,#f4f0ff 100%);
  }
  .bg{position:fixed;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat}
  .dim{position:fixed;inset:0;background:rgba(255,255,255,var(--dim));backdrop-filter:blur(var(--blur)) saturate(1.05)}
  .poster{position:relative;width:1080px;height:1920px;padding:44px 48px;display:flex;flex-direction:column;gap:20px}
  .card{
    background:rgba(255,255,255,.60);
    border:1px solid rgba(255,255,255,.85);
    border-radius:34px;
    backdrop-filter:blur(18px) saturate(1.15);
    box-shadow:0 14px 44px rgba(150,130,190,.14);
  }
  .blob{position:fixed;border-radius:50%;filter:blur(70px);opacity:.55;z-index:0}
  .b1{width:360px;height:360px;left:-120px;top:-80px;background:#ffd6e0}
  .b2{width:300px;height:300px;right:-90px;top:520px;background:#d6e4ff}
  .b3{width:280px;height:280px;left:120px;bottom:-60px;background:#e8dcff}

  .hdr{height:186px;padding:28px 36px;display:flex;align-items:center;justify-content:space-between}
  .chip{display:inline-block;font-size:20px;letter-spacing:.5px;color:#9b7fa8;background:rgba(255,255,255,.75);
        border:1px solid rgba(255,182,193,.6);padding:6px 16px;border-radius:999px;margin-bottom:10px}
  .hdr h1{font-size:46px;line-height:1.15;font-weight:800;
          background:linear-gradient(100deg,#ff86a0,#b48cf0 60%,#7fa9f5);-webkit-background-clip:text;background-clip:text;color:transparent}
  .hdr .sub{margin-top:8px;font-size:21px;color:#8a8496}
  .hdr-right{display:flex;flex-direction:column;align-items:center;gap:8px}
  .avatar{width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,.9);
          box-shadow:0 6px 18px rgba(160,140,190,.25)}
  .avatar-fb{display:flex;align-items:center;justify-content:center;font-size:38px;color:#fff;
             background:linear-gradient(135deg,#ffa8bd,#b79cf3)}
  .botname{font-size:20px;color:#8a8496;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .cloud-card{flex:1;position:relative;display:flex;align-items:center;justify-content:center;padding:24px;overflow:hidden}
  .cloud-card .glow{position:absolute;width:620px;height:620px;border-radius:50%;
    background:radial-gradient(circle,rgba(255,190,210,.40),rgba(255,190,210,0) 68%);filter:blur(6px)}
  .spark{position:absolute;color:rgba(255,154,176,.55);font-size:34px}
  .sp1{left:56px;top:52px}
  .sp2{right:64px;top:96px;font-size:24px;color:rgba(150,170,240,.55)}
  .sp3{right:120px;bottom:64px;font-size:28px;color:rgba(190,160,240,.5)}
  #cloud{
    position:relative;width:940px;height:600px;
    -webkit-mask-image:radial-gradient(ellipse 106% 104% at 50% 52%,#000 82%,transparent 100%);
    mask-image:radial-gradient(ellipse 106% 104% at 50% 52%,#000 82%,transparent 100%);
  }

  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;height:168px}
  .stat{border-radius:30px;background:rgba(255,255,255,.60);border:1px solid rgba(255,255,255,.85);
        backdrop-filter:blur(18px) saturate(1.15);box-shadow:0 12px 32px rgba(150,130,190,.12);
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
  .stat b{font-size:52px;font-weight:800;line-height:1;
           background:linear-gradient(120deg,#ff86a0,#b48cf0);-webkit-background-clip:text;background-clip:text;color:transparent}
  .stat span{font-size:20px;color:#8a8496}

  .chart-card{height:424px;padding:20px 28px 14px;display:flex;flex-direction:column}
  .chart-head{display:flex;align-items:baseline;justify-content:space-between}
  .card-title{font-size:22px;color:#6f6880;font-weight:600}
  .peak{font-size:18px;color:#a29ab0}
  .legend{display:flex;align-items:center;gap:10px;margin:8px 0 2px;font-size:18px;color:#8a8496}
  .dot{width:12px;height:12px;border-radius:50%;display:inline-block}
  .dot-pink{background:linear-gradient(180deg,#ffb3c4,#ff8fa8)}
  .dot-blue{background:linear-gradient(180deg,#a9c8ff,#7fa9f5)}
  .legend .sep{width:10px}

  .quote{height:196px;padding:26px 40px;position:relative;display:flex;flex-direction:column;justify-content:center}
  .quote .mark{position:absolute;left:24px;top:-6px;font-size:96px;color:rgba(255,154,176,.35);font-family:Georgia,serif}
  .quote p{font-size:32px;line-height:1.5;padding-left:34px}
  .quote cite{display:block;text-align:right;font-style:normal;font-size:21px;color:#9b93a8;margin-top:8px}

  .ftr{height:40px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#8f879f;letter-spacing:.6px;text-align:center}
  .ftr-glass{color:#5f586e}
  .ftr-glass span{padding:3px 16px;border-radius:999px;background:rgba(255,255,255,.82);
                  border:1px solid rgba(255,255,255,.95);backdrop-filter:blur(12px) saturate(1.1);
                  box-shadow:0 6px 18px rgba(150,130,190,.22);font-weight:500}
</style>
</head>
<body>
  ${bgLayer}
  <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
  <div class="poster">
    <header class="hdr card">
      <div>
        <div class="chip">${escapeHtml(data.dateLabel)}</div>
        <h1>${escapeHtml(data.guildName)}</h1>
        <div class="sub">共 ${stats.total} 条消息 · ${stats.users} 位群友</div>
      </div>
      <div class="hdr-right">
        ${avatar}
        <div class="botname">${escapeHtml(data.botName)}</div>
      </div>
    </header>

    <section class="cloud-card card">
      <div class="glow"></div>
      <span class="spark sp1">✦</span><span class="spark sp2">✧</span><span class="spark sp3">✦</span>
      <canvas id="cloud" width="940" height="600"></canvas>
    </section>

    <section class="stats">
      ${statCard(String(stats.total), '条消息', 'linear-gradient(120deg,#ff86a0,#b48cf0)')}
      ${statCard(String(stats.users), '位群友', 'linear-gradient(120deg,#7fa9f5,#b48cf0)')}
      ${statCard(String(stats.avgHuman), '平均字数', 'linear-gradient(120deg,#ffa8bd,#ff86a0)')}
      ${statCard(String(stats.index), '互动指数', 'linear-gradient(120deg,#8fd3c7,#7fa9f5)')}
    </section>

    <section class="chart-card card">
      <div class="chart-head">
        <span class="card-title">每小时发言</span>
        <span class="peak">峰值 ${peak} 条</span>
      </div>
      <div class="legend">
        <span class="dot dot-pink"></span><span>群友</span>
        <span class="sep"></span>
        <span class="dot dot-blue"></span><span>${escapeHtml(data.botName)}</span>
      </div>
      ${renderHourly(data.hourly)}
    </section>

    <section class="quote card">
      <div class="mark">“</div>
      <p>${escapeHtml(data.summary)}</p>
      <cite>—— ${escapeHtml(data.botName)}</cite>
    </section>

    <footer class="ftr${data.background ? ' ftr-glass' : ''}"><span>${escapeHtml(data.footerText)}</span></footer>
  </div>

  <script>${WORDCLOUD2_SOURCE}</script>
  <script>
    (function () {
      var WORDS = ${words};
      var PALETTE = ${palette};
      var SHAPE = ${shape};
      var canvas = document.getElementById('cloud');

      function rgba(hex, alpha) {
        var v = hex.replace('#', '');
        if (v.length === 3) v = v[0]+v[0]+v[1]+v[1]+v[2]+v[2];
        var r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      }

      // 极坐标轮廓，返回 0~1 的半径系数
      var SHAPES = {
        blob: function (t) { return 1 + 0.06 * Math.sin(3 * t) + 0.04 * Math.cos(5 * t) },
        flower: function (t) { return 0.84 + 0.16 * Math.cos(5 * t) },
        circle: 'circle',
        square: 'square'
      }

      canvas.addEventListener('wordcloudstop', function () { window.__ready = true });
      try {
        WordCloud(canvas, {
          list: WORDS,
          gridSize: 4,
          weightFactor: 1,
          fontFamily: '"Noto Sans SC","Microsoft YaHei",sans-serif',
          fontWeight: '600',
          color: function () {
            var hex = PALETTE[Math.floor(Math.random() * PALETTE.length)];
            return rgba(hex, 0.82 + Math.random() * 0.18);
          },
          backgroundColor: 'rgba(0,0,0,0)',
          rotateRatio: 0.5,
          minRotation: -Math.PI / 2,
          maxRotation: Math.PI / 2,
          rotationSteps: 2,
          shape: SHAPES[SHAPE] || SHAPES.blob,
          ellipticity: 0.92,
          shrinkToFit: true,
          drawOutOfBound: false
        });
      } catch (e) {
        window.__ready = true;
        window.__error = String(e);
      }
      setTimeout(function () { window.__ready = true; }, 5000);
    })();
  </script>
</body>
</html>`
}
