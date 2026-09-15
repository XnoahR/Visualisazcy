// Builds one standalone mockup page from the .dc.html artboards.
// The artboards stay the single source: this strips the design-canvas wrapper
// (<x-dc>, <helmet>, the support.js line) and lays the bodies out on a plain
// page that opens straight off disk with no server, no login, no network.

import { readFileSync, writeFileSync } from 'node:fs'

const BOARDS = [
  ['Main.dc.html',      'Board — editing',   'Palette, canvas, collapsed inspector. The everyday view.'],
  ['Inspector.dc.html', 'Object selected',   'A node selected: properties, wiring rule, hit rate, connections.'],
  ['Story.dc.html',     'Story mode',        'Composed frame, step inspector, timeline strip.'],
  ['Export.dc.html',    'Export framing',    'Crop overlay per aspect, output and resolution.'],
]

function bodyOf(file) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  const inner = src.slice(src.indexOf('<x-dc>') + 6, src.lastIndexOf('</x-dc>'))
  return inner.replace(/<helmet>[\s\S]*?<\/helmet>/, '').trim()
}

const sections = BOARDS.map(([file, title, note], i) => `
  <section id="b${i + 1}">
    <div class="cap">
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <span class="ttl">${title}</span>
      <span class="note">${note}</span>
    </div>
    <div class="board">${bodyOf(file)}</div>
  </section>`).join('\n')

const nav = BOARDS.map(([, title], i) =>
  `<a href="#b${i + 1}">${String(i + 1).padStart(2, '0')} ${title}</a>`).join('\n      ')

writeFileSync(new URL('mockup.html', import.meta.url), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visualisazcy — app mockup</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#08090d; --edge:rgba(255,255,255,.055); --dim:#9498ab; --mute:#5a5f74; --accent:#6ea0ff; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #050609; color: #f5f6fa;
    font-family: "Space Grotesk", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
  header {
    position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 20px;
    padding: 13px 26px; background: rgba(5,6,9,.94); border-bottom: 1px solid var(--edge);
    backdrop-filter: blur(8px); flex-wrap: wrap;
  }
  h1 { font-size: 13.5px; font-weight: 700; margin: 0; }
  nav { display: flex; gap: 4px; flex-wrap: wrap; }
  nav a {
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10.5px;
    color: var(--dim); text-decoration: none; padding: 5px 10px; border-radius: 7px;
    border: 1px solid transparent;
  }
  nav a:hover { color: #f5f6fa; background: rgba(255,255,255,.05); border-color: var(--edge); }
  .zoom { margin-left: auto; display: flex; align-items: center; gap: 9px; }
  .zoom span { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10.5px; color: var(--mute); }
  input[type=range] { width: 150px; accent-color: var(--accent); }
  main { padding: 30px 26px 90px; display: flex; flex-direction: column; gap: 46px; }
  section { scroll-margin-top: 74px; }
  .cap { display: flex; align-items: baseline; gap: 12px; margin-bottom: 13px; flex-wrap: wrap; }
  .num { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10.5px; color: var(--accent); letter-spacing: .1em; }
  .ttl { font-size: 14px; font-weight: 600; }
  .note { font-size: 12px; color: var(--mute); }
  .board {
    width: 1440px; height: 900px; flex: none; overflow: hidden;
    border: 1px solid rgba(255,255,255,.13); border-radius: 10px;
    box-shadow: 0 22px 60px rgba(0,0,0,.55);
    transform-origin: top left;
  }
  .wrapscale { overflow: hidden; }
</style>
</head>
<body>
<header>
  <h1>Visualisazcy — app mockup</h1>
  <nav>
      ${nav}
  </nav>
  <div class="zoom">
    <span>zoom</span>
    <input id="z" type="range" min="30" max="100" value="70">
    <span id="zv">70%</span>
  </div>
</header>
<main>
${sections}
</main>
<script>
  // Boards are authored at 1440x900; scale them to fit whatever window this is
  // opened in, and let the slider override.
  const z = document.getElementById('z'), zv = document.getElementById('zv');
  function apply(pct) {
    const s = pct / 100;
    zv.textContent = pct + '%';
    for (const b of document.querySelectorAll('.board')) {
      b.style.transform = 'scale(' + s + ')';
      b.parentElement.style.height = (900 * s) + 'px';
      b.parentElement.style.width = (1440 * s) + 'px';
    }
  }
  for (const b of document.querySelectorAll('.board')) {
    const w = document.createElement('div');
    w.className = 'wrapscale';
    b.parentElement.insertBefore(w, b);
    w.appendChild(b);
  }
  const fit = Math.max(30, Math.min(100, Math.round((window.innerWidth - 60) / 1440 * 100)));
  z.value = fit;
  apply(fit);
  z.addEventListener('input', () => apply(+z.value));
</script>
</body>
</html>
`)

console.log('wrote mockup.html —', BOARDS.length, 'artboards')
