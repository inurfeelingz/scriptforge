// frontend/src/lib/storyboardSVG.js
// Vector storyboard frame library.
// All frames are 320×180 (16:9). Dark background, warm lines.
// One clean SVG per shot type per gender — no environments, just figure + frame.
//
// Figures:
//   male   — square jaw, broader shoulders, shorter neck, simple crop
//   female — softer jaw, narrower shoulders, longer neck, simple crop

const W = 320
const H = 180
const BG    = '#0a0a0f'
const LINE  = '#c8b89a'
const FILL  = '#1a1a2a'
const DIM   = '#2a2a3a'
const FRAME = '#c8b89a'
const LABEL_BG = '#0d0d16'

// ─── FIGURE PRIMITIVES ────────────────────────────────────────────────────────
// All coordinates are in a 100×200 unit space, scaled/translated by caller

function maleFigure(x, y, scale = 1, color = LINE) {
  const s = scale
  const parts = []

  // Head — slightly square
  parts.push(`<ellipse cx="${x}" cy="${y - 95*s}" rx="${16*s}" ry="${18*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}"/>`)
  // Neck
  parts.push(`<rect x="${x - 6*s}" y="${y - 77*s}" width="${12*s}" height="${12*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}"/>`)
  // Shoulders — broad trapezoid
  parts.push(`<path d="M${x - 30*s} ${y - 65*s} L${x - 20*s} ${y - 77*s} L${x + 20*s} ${y - 77*s} L${x + 30*s} ${y - 65*s} Z" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)
  // Torso
  parts.push(`<path d="M${x - 24*s} ${y - 65*s} L${x - 18*s} ${y - 10*s} L${x + 18*s} ${y - 10*s} L${x + 24*s} ${y - 65*s} Z" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)
  // Left arm
  parts.push(`<path d="M${x - 24*s} ${y - 65*s} L${x - 36*s} ${y - 30*s} L${x - 32*s} ${y - 10*s}" fill="none" stroke="${color}" stroke-width="${1.2}" stroke-linecap="round" stroke-linejoin="round"/>`)
  // Right arm
  parts.push(`<path d="M${x + 24*s} ${y - 65*s} L${x + 36*s} ${y - 30*s} L${x + 32*s} ${y - 10*s}" fill="none" stroke="${color}" stroke-width="${1.2}" stroke-linecap="round" stroke-linejoin="round"/>`)
  // Legs
  parts.push(`<path d="M${x - 18*s} ${y - 10*s} L${x - 16*s} ${y + 55*s} L${x - 6*s} ${y + 55*s} L${x} ${y - 10*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)
  parts.push(`<path d="M${x + 18*s} ${y - 10*s} L${x + 16*s} ${y + 55*s} L${x + 6*s} ${y + 55*s} L${x} ${y - 10*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)

  return parts.join('\n')
}

function femaleFigure(x, y, scale = 1, color = LINE) {
  const s = scale
  const parts = []

  // Head — softer, taller
  parts.push(`<ellipse cx="${x}" cy="${y - 98*s}" rx="${14*s}" ry="${19*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}"/>`)
  // Neck — longer, narrower
  parts.push(`<rect x="${x - 5*s}" y="${y - 79*s}" width="${10*s}" height="${14*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}"/>`)
  // Shoulders — narrower
  parts.push(`<path d="M${x - 22*s} ${y - 65*s} L${x - 14*s} ${y - 77*s} L${x + 14*s} ${y - 77*s} L${x + 22*s} ${y - 65*s} Z" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)
  // Torso — hourglass
  parts.push(`<path d="M${x - 18*s} ${y - 65*s} L${x - 14*s} ${y - 35*s} L${x - 18*s} ${y - 10*s} L${x + 18*s} ${y - 10*s} L${x + 14*s} ${y - 35*s} L${x + 18*s} ${y - 65*s} Z" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)
  // Left arm
  parts.push(`<path d="M${x - 18*s} ${y - 65*s} L${x - 28*s} ${y - 30*s} L${x - 25*s} ${y - 10*s}" fill="none" stroke="${color}" stroke-width="${1.2}" stroke-linecap="round" stroke-linejoin="round"/>`)
  // Right arm
  parts.push(`<path d="M${x + 18*s} ${y - 65*s} L${x + 28*s} ${y - 30*s} L${x + 25*s} ${y - 10*s}" fill="none" stroke="${color}" stroke-width="${1.2}" stroke-linecap="round" stroke-linejoin="round"/>`)
  // Legs — slightly wider hips
  parts.push(`<path d="M${x - 18*s} ${y - 10*s} L${x - 18*s} ${y + 55*s} L${x - 7*s} ${y + 55*s} L${x} ${y - 10*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)
  parts.push(`<path d="M${x + 18*s} ${y - 10*s} L${x + 18*s} ${y + 55*s} L${x + 7*s} ${y + 55*s} L${x} ${y - 10*s}" fill="${FILL}" stroke="${color}" stroke-width="${1.2}" stroke-linejoin="round"/>`)

  return parts.join('\n')
}

// ─── FRAME CHROME ──────────────────────────────────────────────────────────────
function frameBase(label) {
  return `
<rect width="${W}" height="${H}" fill="${BG}"/>
<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${FRAME}" stroke-width="1.5"/>
<rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="${FRAME}" stroke-width="0.5" stroke-dasharray="4 3" opacity="0.4"/>
<rect x="0" y="${H - 22}" width="${W}" height="22" fill="${LABEL_BG}" opacity="0.95"/>
<text x="10" y="${H - 8}" font-family="monospace" font-size="9" fill="${LINE}" opacity="0.8">${label}</text>
`
}

// Crop mask — clip to frame
function clipRect(id) {
  return `<defs><clipPath id="${id}"><rect width="${W}" height="${H - 22}"/></clipPath></defs>`
}

// ─── SHOT GENERATORS ──────────────────────────────────────────────────────────

// Extreme Close-Up — just the face region
function ecu(gender, instanceId) {
  instanceId = instanceId || `ecu-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  // Position figure so only face shows
  // Figure head is at y - 95*s, we want face to fill frame
  // Head radius ~18, we want it to fill H=158px → scale = 158/(18*2) * 0.7 ≈ 3.0
  const s = 3.2
  const cy = H * 0.6  // push figure down so head is centered
  return svg('ecu', gender, `
    ${frameBase('ECU — Extreme Close-Up')}
    ${clipRect('clip-ecu-' + instanceId)}
    <g clip-path="url(#clip-ecu-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
    <!-- Rule of thirds guides -->
    <line x1="${W/3}" y1="0" x2="${W/3}" y2="${H-22}" stroke="${LINE}" stroke-width="0.3" opacity="0.2"/>
    <line x1="${W*2/3}" y1="0" x2="${W*2/3}" y2="${H-22}" stroke="${LINE}" stroke-width="0.3" opacity="0.2"/>
  `)
}

// Close-Up — head and shoulders
function cu(gender, instanceId) {
  instanceId = instanceId || `cu-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 1.8
  const cy = H + 10
  return svg('cu', gender, `
    ${frameBase('CU — Close-Up')}
    ${clipRect('clip-cu-' + instanceId)}
    <g clip-path="url(#clip-cu-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
  `)
}

// Medium Close-Up — chest up
function mcu(gender, instanceId) {
  instanceId = instanceId || `mcu-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 1.2
  const cy = H * 1.1
  return svg('mcu', gender, `
    ${frameBase('MCU — Medium Close-Up')}
    ${clipRect('clip-mcu-' + instanceId)}
    <g clip-path="url(#clip-mcu-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
  `)
}

// Medium Shot — waist up
function ms(gender, instanceId) {
  instanceId = instanceId || `ms-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 0.9
  const cy = H * 1.05
  return svg('ms', gender, `
    ${frameBase('MS — Medium Shot')}
    ${clipRect('clip-ms-' + instanceId)}
    <g clip-path="url(#clip-ms-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
  `)
}

// Medium Wide — knees up
function mws(gender, instanceId) {
  instanceId = instanceId || `mws-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 0.72
  const cy = H * 1.12
  return svg('mws', gender, `
    ${frameBase('MWS — Medium Wide Shot')}
    ${clipRect('clip-mws-' + instanceId)}
    <g clip-path="url(#clip-mws-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
  `)
}

// Wide Shot — full body
function ws(gender, instanceId) {
  instanceId = instanceId || `ws-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 0.55
  const cy = H * 0.88
  return svg('ws', gender, `
    ${frameBase('WS — Wide Shot')}
    ${clipRect('clip-ws-' + instanceId)}
    <g clip-path="url(#clip-ws-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
    <!-- Ground line -->
    <line x1="0" y1="${H * 0.89}" x2="${W}" y2="${H * 0.89}" stroke="${LINE}" stroke-width="0.5" opacity="0.25"/>
  `)
}

// Extreme Wide — tiny figure
function ews(gender, instanceId) {
  instanceId = instanceId || `ews-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 0.28
  const cy = H * 0.80
  return svg('ews', gender, `
    ${frameBase('EWS — Extreme Wide Shot')}
    ${clipRect('clip-ews-' + instanceId)}
    <g clip-path="url(#clip-ews-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
    <!-- Horizon line -->
    <line x1="0" y1="${H * 0.72}" x2="${W}" y2="${H * 0.72}" stroke="${LINE}" stroke-width="0.5" opacity="0.2"/>
    <!-- Perspective lines -->
    <line x1="0" y1="${H * 0.6}" x2="${W}" y2="${H * 0.6}" stroke="${LINE}" stroke-width="0.3" opacity="0.1"/>
  `)
}

// Over The Shoulder — back figure (OTS) toward subject
function ots(gender, instanceId) {
  instanceId = instanceId || `ots-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const opposite = gender === 'male' ? femaleFigure : maleFigure
  const s = 0.9
  // Back figure — just shoulders/head visible at left edge
  const backX = W * 0.18
  const backY = H * 1.1
  // Subject facing camera on right
  const subjectX = W * 0.62
  const subjectY = H * 0.95
  return svg('ots', gender, `
    ${frameBase('OTS — Over The Shoulder')}
    ${clipRect('clip-ots-' + instanceId)}
    <g clip-path="url(#clip-ots-${instanceId})">
      <!-- Back figure (dark/silhouette) -->
      ${fig(backX, backY, s * 1.1, DIM)}
      <!-- Subject figure -->
      ${opposite(subjectX, subjectY, s * 0.8)}
    </g>
    <!-- OTS guide line -->
    <line x1="${backX}" y1="${backY - 90*s}" x2="${subjectX}" y2="${subjectY - 80*s*0.8}" stroke="${LINE}" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.3"/>
  `)
}

// Two Shot
function two(gender, instanceId) {
  instanceId = instanceId || `two-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const opposite = gender === 'male' ? femaleFigure : maleFigure
  const s = 0.65
  const cy = H * 0.96
  return svg('two', gender, `
    ${frameBase('TWO — Two Shot')}
    ${clipRect('clip-two-' + instanceId)}
    <g clip-path="url(#clip-two-${instanceId})">
      ${fig(W * 0.33, cy, s)}
      ${opposite(W * 0.67, cy, s)}
    </g>
    <!-- Center divider suggestion -->
    <line x1="${W/2}" y1="0" x2="${W/2}" y2="${H-22}" stroke="${LINE}" stroke-width="0.3" opacity="0.15"/>
  `)
}

// Low Angle — camera looks up (figure tilted perspective)
function low(gender, instanceId) {
  instanceId = instanceId || `low-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 0.75
  const cy = H * 0.75
  return svg('low', gender, `
    ${frameBase('LOW — Low Angle')}
    ${clipRect('clip-low-' + instanceId)}
    <g clip-path="url(#clip-low-${instanceId})">
      <!-- Perspective: figure appears larger at bottom, smaller at top -->
      <g transform="scale(1, 0.88) translate(0, ${H * 0.08})">
        ${fig(cx, cy, s * 1.15)}
      </g>
    </g>
    <!-- Low angle indicator — converging lines from bottom -->
    <line x1="${W*0.1}" y1="${H-22}" x2="${W*0.45}" y2="${H*0.3}" stroke="${LINE}" stroke-width="0.4" opacity="0.2"/>
    <line x1="${W*0.9}" y1="${H-22}" x2="${W*0.55}" y2="${H*0.3}" stroke="${LINE}" stroke-width="0.4" opacity="0.2"/>
    <text x="${W - 10}" y="18" font-family="monospace" font-size="7" fill="${LINE}" opacity="0.5" text-anchor="end">↑ cam</text>
  `)
}

// High Angle — camera looks down
function high(gender, instanceId) {
  instanceId = instanceId || `high-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 0.65
  const cy = H * 0.72
  return svg('high', gender, `
    ${frameBase('HIGH — High Angle')}
    ${clipRect('clip-high-' + instanceId)}
    <g clip-path="url(#clip-high-${instanceId})">
      <!-- Perspective: squash vertically, head appears bigger -->
      <g transform="scale(1, 0.82) translate(0, ${H * 0.1})">
        ${fig(cx, cy, s)}
      </g>
    </g>
    <!-- High angle indicator — converging lines from top -->
    <line x1="${W*0.1}" y1="0" x2="${W*0.45}" y2="${H*0.55}" stroke="${LINE}" stroke-width="0.4" opacity="0.2"/>
    <line x1="${W*0.9}" y1="0" x2="${W*0.55}" y2="${H*0.55}" stroke="${LINE}" stroke-width="0.4" opacity="0.2"/>
    <text x="${W - 10}" y="18" font-family="monospace" font-size="7" fill="${LINE}" opacity="0.5" text-anchor="end">↓ cam</text>
  `)
}

// Dutch Angle — tilted frame
function dutch(gender, instanceId) {
  instanceId = instanceId || `dutch-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  const cx = W / 2
  const s = 0.85
  const cy = H * 0.95
  return svg('dutch', gender, `
    ${frameBase('DUTCH — Dutch Angle')}
    ${clipRect('clip-dutch-' + instanceId)}
    <g clip-path="url(#clip-dutch-${instanceId})">
      <!-- Rotate the figure slightly to suggest tilt -->
      <g transform="rotate(-12, ${cx}, ${cy - 50*s})">
        ${fig(cx, cy, s)}
      </g>
    </g>
    <!-- Diagonal frame lines to show tilt -->
    <line x1="0" y1="${H*0.15}" x2="${W}" y2="${H*0.35}" stroke="${LINE}" stroke-width="0.5" opacity="0.2"/>
    <text x="${W - 10}" y="18" font-family="monospace" font-size="7" fill="${LINE}" opacity="0.5" text-anchor="end">⟳ tilt</text>
  `)
}

// POV — first person, no figure, just framing hands/perspective
function pov(gender, instanceId) {
  instanceId = instanceId || `pov-${gender}`
  // POV has no subject — shows what the character sees
  // Gender affects whose hands are shown at bottom
  const handColor = LINE
  const s = gender === 'male' ? 1 : 0.88
  return svg('pov', gender, `
    ${frameBase('POV — Point of View')}
    <!-- Perspective vanishing point -->
    <line x1="${W/2}" y1="${H*0.4}" x2="0" y2="${H-22}" stroke="${LINE}" stroke-width="0.4" opacity="0.15"/>
    <line x1="${W/2}" y1="${H*0.4}" x2="${W}" y2="${H-22}" stroke="${LINE}" stroke-width="0.4" opacity="0.15"/>
    <line x1="${W/2}" y1="${H*0.4}" x2="0" y2="0" stroke="${LINE}" stroke-width="0.3" opacity="0.1"/>
    <line x1="${W/2}" y1="${H*0.4}" x2="${W}" y2="0" stroke="${LINE}" stroke-width="0.3" opacity="0.1"/>
    <!-- Vanishing point dot -->
    <circle cx="${W/2}" cy="${H*0.4}" r="2" fill="${LINE}" opacity="0.4"/>
    <!-- Hands at bottom suggesting first-person -->
    <ellipse cx="${W*0.32}" cy="${H*0.92}" rx="${16*s}" ry="${10*s}" fill="${FILL}" stroke="${handColor}" stroke-width="1.2"/>
    <ellipse cx="${W*0.68}" cy="${H*0.92}" rx="${16*s}" ry="${10*s}" fill="${FILL}" stroke="${handColor}" stroke-width="1.2"/>
    <!-- Crosshair/center point -->
    <circle cx="${W/2}" cy="${H*0.45}" r="4" fill="none" stroke="${LINE}" stroke-width="0.6" opacity="0.4"/>
    <line x1="${W/2 - 8}" y1="${H*0.45}" x2="${W/2 + 8}" y2="${H*0.45}" stroke="${LINE}" stroke-width="0.5" opacity="0.4"/>
    <line x1="${W/2}" y1="${H*0.45 - 8}" x2="${W/2}" y2="${H*0.45 + 8}" stroke="${LINE}" stroke-width="0.5" opacity="0.4"/>
  `)
}

// Talking Head — classic YouTube/presenter 16:9 with subject on rule-of-thirds
function th(gender, instanceId) {
  instanceId = instanceId || `th-${gender}`
  const fig = gender === 'male' ? maleFigure : femaleFigure
  // Position on left third, head at upper third intersection
  const cx = W * 0.38
  const s = 1.1
  const cy = H * 1.05
  return svg('th', gender, `
    ${frameBase('TH — Talking Head')}
    ${clipRect('clip-th-' + instanceId)}
    <g clip-path="url(#clip-th-${instanceId})">
      ${fig(cx, cy, s)}
    </g>
    <!-- Rule of thirds grid (subtle) -->
    <line x1="${W/3}" y1="0" x2="${W/3}" y2="${H-22}" stroke="${LINE}" stroke-width="0.3" opacity="0.15"/>
    <line x1="${W*2/3}" y1="0" x2="${W*2/3}" y2="${H-22}" stroke="${LINE}" stroke-width="0.3" opacity="0.15"/>
    <line x1="0" y1="${H/3}" x2="${W}" y2="${H/3}" stroke="${LINE}" stroke-width="0.3" opacity="0.15"/>
    <!-- Eye line indicator -->
    <line x1="${W*0.05}" y1="${cy - 95*s}" x2="${W*0.95}" y2="${cy - 95*s}" stroke="${LINE}" stroke-width="0.4" stroke-dasharray="3 3" opacity="0.3"/>
    <text x="${W - 10}" y="${cy - 95*s - 3}" font-family="monospace" font-size="7" fill="${LINE}" opacity="0.5" text-anchor="end">eye line</text>
    <!-- Headroom indicator -->
    <text x="${W*0.72}" y="18" font-family="monospace" font-size="7" fill="${LINE}" opacity="0.4" text-anchor="middle">headroom</text>
  `)
}

// ─── SVG WRAPPER ─────────────────────────────────────────────────────────────
function svg(shotId, gender, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${content}</svg>`
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export const SHOT_TYPES = [
  { id: 'ecu',   label: 'Extreme Close-Up',  desc: 'Face only — eyes to chin. Maximum intimacy.' },
  { id: 'cu',    label: 'Close-Up',           desc: 'Head and shoulders. Emotion and reaction.' },
  { id: 'mcu',   label: 'Medium Close-Up',    desc: 'Chest up. Standard interview/talking head.' },
  { id: 'ms',    label: 'Medium Shot',        desc: 'Waist up. Natural conversational distance.' },
  { id: 'mws',   label: 'Medium Wide',        desc: 'Knees up. Shows body language and gesture.' },
  { id: 'ws',    label: 'Wide Shot',          desc: 'Full body. Subject in context of space.' },
  { id: 'ews',   label: 'Extreme Wide',       desc: 'Tiny subject. Environment dominates.' },
  { id: 'ots',   label: 'Over The Shoulder',  desc: 'Depth and relationship between subjects.' },
  { id: 'two',   label: 'Two Shot',           desc: 'Two subjects. Conversation or comparison.' },
  { id: 'low',   label: 'Low Angle',          desc: 'Camera below subject. Power and authority.' },
  { id: 'high',  label: 'High Angle',         desc: 'Camera above subject. Vulnerability.' },
  { id: 'dutch', label: 'Dutch Angle',        desc: 'Tilted frame. Tension or unease.' },
  { id: 'pov',   label: 'Point of View',      desc: 'First person. Immersive perspective.' },
  { id: 'th',    label: 'Talking Head',       desc: 'Rule-of-thirds presenter. YouTube standard.' },
]

const GENERATORS = { ecu, cu, mcu, ms, mws, ws, ews, ots, two, low, high, dutch, pov, th }

export function getShotSVG(shotId, gender = 'male', instanceId = '') {
  const gen = GENERATORS[shotId]
  if (!gen) return null
  return gen(gender, instanceId || `${shotId}-${gender}`)
}

export function getAllShots(gender = 'male') {
  return SHOT_TYPES.map(shot => ({
    ...shot,
    svg: getShotSVG(shot.id, gender),
  }))
}