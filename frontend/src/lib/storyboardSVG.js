// frontend/src/lib/storyboardSVG.js
// Hand-crafted cinematic storyboard frames — 14 shot types
// All frames 320×180 (16:9). Front-facing figures, proper environments.

const W = 320
const H = 180

// ─── FRAME CHROME ─────────────────────────────────────────────────────────────
function chrome(label) {
  return `
<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#c8b89a" stroke-width="1.5"/>
<rect x="6" y="6" width="${W-12}" height="${H-28}" fill="none" stroke="#c8b89a" stroke-width="0.4" stroke-dasharray="3 3" opacity="0.25"/>
<rect x="0" y="${H-18}" width="${W}" height="18" fill="#0a0c14" opacity="0.97"/>
<text x="8" y="${H-6}" font-family="monospace" font-size="8" fill="#c8b89a" opacity="0.85">${label}</text>`
}

// Rule of thirds
function rof() {
  const h = H-18
  return `
<line x1="${W/3}" y1="0" x2="${W/3}" y2="${h}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="${W*2/3}" y1="0" x2="${W*2/3}" y2="${h}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="0" y1="${h/3}" x2="${W}" y2="${h/3}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="0" y1="${h*2/3}" x2="${W}" y2="${h*2/3}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>`
}

// Eye line
function eyeLine(y) {
  return `<line x1="8" y1="${y}" x2="${W-8}" y2="${y}" stroke="#c8b89a" stroke-width="0.4" stroke-dasharray="4 4" opacity="0.3"/>
<text x="${W-10}" y="${y-3}" font-family="monospace" font-size="6" fill="#c8b89a" opacity="0.4" text-anchor="end">eye line</text>`
}

// ─── ENVIRONMENTS ─────────────────────────────────────────────────────────────
function envRoom(horizon=110) {
  return `
<rect x="0" y="0" width="${W}" height="${H}" fill="#0a0b10"/>
<rect x="0" y="0" width="${W}" height="${horizon}" fill="#0e1018"/>
<rect x="0" y="${horizon}" width="${W}" height="${H-horizon}" fill="#09090e"/>
<line x1="0" y1="${horizon}" x2="${W}" y2="${horizon}" stroke="#c8b89a" stroke-width="0.6" opacity="0.35"/>
<line x1="0" y1="0" x2="${W/2}" y2="${horizon}" stroke="#c8b89a" stroke-width="0.35" opacity="0.1"/>
<line x1="${W}" y1="0" x2="${W/2}" y2="${horizon}" stroke="#c8b89a" stroke-width="0.35" opacity="0.1"/>
<line x1="0" y1="${horizon+4}" x2="${W}" y2="${horizon+4}" stroke="#c8b89a" stroke-width="0.3" opacity="0.12"/>`
}

function envScreen(x, y, w, h) {
  return `
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#0d1020" stroke="#c8b89a" stroke-width="0.6" opacity="0.5"/>
<rect x="${x+3}" y="${y+3}" width="${w-6}" height="${h-6}" fill="#111828"/>
<line x1="${x+6}" y1="${y+12}" x2="${x+w-6}" y2="${y+12}" stroke="#c8b89a" stroke-width="0.4" opacity="0.2"/>
<line x1="${x+6}" y1="${y+18}" x2="${x+w*0.7}" y2="${y+18}" stroke="#c8b89a" stroke-width="0.4" opacity="0.15"/>
<line x1="${x+6}" y1="${y+24}" x2="${x+w-6}" y2="${y+24}" stroke="#c8b89a" stroke-width="0.4" opacity="0.18"/>
<line x1="${x+6}" y1="${y+30}" x2="${x+w*0.6}" y2="${y+30}" stroke="#c8b89a" stroke-width="0.4" opacity="0.1"/>
<line x1="${x+w/2}" y1="${y+h}" x2="${x+w/2}" y2="${y+h+8}" stroke="#c8b89a" stroke-width="0.8" opacity="0.25"/>
<line x1="${x+w/2-10}" y1="${y+h+8}" x2="${x+w/2+10}" y2="${y+h+8}" stroke="#c8b89a" stroke-width="0.8" opacity="0.2"/>`
}

function envWindow(x, y, w, h) {
  return `
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#0a0f1c" stroke="#c8b89a" stroke-width="0.6" opacity="0.4"/>
<line x1="${x+w/2}" y1="${y}" x2="${x+w/2}" y2="${y+h}" stroke="#c8b89a" stroke-width="0.4" opacity="0.3"/>
<line x1="${x}" y1="${y+h*0.45}" x2="${x+w}" y2="${y+h*0.45}" stroke="#c8b89a" stroke-width="0.4" opacity="0.3"/>`
}

// ─── FIGURE PRIMITIVES ────────────────────────────────────────────────────────
// cx = centre x, ground = y of floor contact, scale = 1 default
// Variant: 0=default, 1=alt skin/hair, 2=hijab

function figureBody(cx, ground, scale=1, variant=0) {
  const s = scale
  const skins  = ['#8B5E3C','#6B3A1F','#C8896A','#4A2E1A']
  const hairs  = ['#1a1030','#0d0a05','#3a2010','#111520']
  const shirts = ['#e8e4dc','#dce8e4','#e4dce8','#e8e8dc']
  const jackets= ['#1e2640','#1f2835','#25201e','#1a2825']
  const pants  = ['#2c3040','#2a2830','#302820','#282a30']
  const sk = skins[variant%4], nk = skins[(variant+3)%4]
  const hr = hairs[variant%4], sh = shirts[variant%4]
  const jk = jackets[variant%4], pt = pants[variant%4]

  // All coords relative to cx, ground
  const g = ground, c = cx
  return `
<!-- shadow -->
<ellipse cx="${c}" cy="${g}" rx="${14*s}" ry="${3*s}" fill="#04050a" opacity="0.5"/>
<!-- shoes -->
<path d="M${c-9*s} ${g-2} Q${c-12*s} ${g-2} ${c-12*s} ${g} L${c-5*s} ${g} Z" fill="#111520"/>
<path d="M${c+9*s} ${g-2} Q${c+12*s} ${g-2} ${c+12*s} ${g} L${c+5*s} ${g} Z" fill="#111520"/>
<!-- pants/legs -->
<path d="M${c-8*s} ${g-38*s} L${c-10*s} ${g-2} L${c-5*s} ${g-1} L${c-1*s} ${g-26*s} L${c+1*s} ${g-26*s} L${c+5*s} ${g-1} L${c+10*s} ${g-2} L${c+8*s} ${g-38*s} Z" fill="${pt}"/>
<!-- jacket body -->
<path d="M${c-14*s} ${g-75*s} L${c-12*s} ${g-38*s} L${c+12*s} ${g-38*s} L${c+14*s} ${g-75*s} L${c+10*s} ${g-80*s} L${c} ${g-82*s} L${c-10*s} ${g-80*s} Z" fill="${jk}"/>
<!-- shirt front -->
<path d="M${c-3*s} ${g-80*s} L${c-5*s} ${g-60*s} L${c-3*s} ${g-38*s} L${c+3*s} ${g-38*s} L${c+5*s} ${g-60*s} L${c+3*s} ${g-80*s} Z" fill="${sh}"/>
<!-- left arm -->
<path d="M${c-14*s} ${g-75*s} L${c-18*s} ${g-55*s} L${c-16*s} ${g-40*s} L${c-12*s} ${g-38*s} L${c-12*s} ${g-55*s} Z" fill="${jk}"/>
<!-- right arm -->
<path d="M${c+14*s} ${g-75*s} L${c+18*s} ${g-55*s} L${c+16*s} ${g-40*s} L${c+12*s} ${g-38*s} L${c+12*s} ${g-55*s} Z" fill="${jk}"/>
<!-- hands -->
<ellipse cx="${c-16*s}" cy="${g-39*s}" rx="${3*s}" ry="${4*s}" fill="${nk}"/>
<ellipse cx="${c+16*s}" cy="${g-39*s}" rx="${3*s}" ry="${4*s}" fill="${nk}"/>
<!-- neck -->
<rect x="${c-3.5*s}" y="${g-90*s}" width="${7*s}" height="${11*s}" rx="${2*s}" fill="${nk}"/>
<!-- head -->
<path d="M${c-12*s} ${g-103*s} Q${c-13*s} ${g-120*s} ${c-8*s} ${g-126*s} Q${c} ${g-130*s} ${c+8*s} ${g-126*s} Q${c+13*s} ${g-120*s} ${c+12*s} ${g-103*s} Q${c+10*s} ${g-90*s} ${c} ${g-88*s} Q${c-10*s} ${g-90*s} ${c-12*s} ${g-103*s} Z" fill="${sk}"/>
<!-- hair -->
<path d="M${c-12*s} ${g-108*s} Q${c-14*s} ${g-122*s} ${c-8*s} ${g-130*s} Q${c} ${g-135*s} ${c+8*s} ${g-130*s} Q${c+14*s} ${g-122*s} ${c+12*s} ${g-108*s} Q${c+8*s} ${g-120*s} ${c} ${g-118*s} Q${c-8*s} ${g-120*s} ${c-12*s} ${g-108*s} Z" fill="${hr}"/>
<!-- ear left -->
<path d="M${c-12*s} ${g-108*s} Q${c-15*s} ${g-105*s} ${c-14*s} ${g-100*s} Q${c-13*s} ${g-96*s} ${c-11*s} ${g-97*s}" fill="${nk}" stroke="none"/>
<!-- ear right -->
<path d="M${c+12*s} ${g-108*s} Q${c+15*s} ${g-105*s} ${c+14*s} ${g-100*s} Q${c+13*s} ${g-96*s} ${c+11*s} ${g-97*s}" fill="${nk}" stroke="none"/>
<!-- eyes -->
<ellipse cx="${c-5*s}" cy="${g-108*s}" rx="${3.5*s}" ry="${2.2*s}" fill="#0a0c10" opacity="0.75"/>
<ellipse cx="${c+5*s}" cy="${g-108*s}" rx="${3.5*s}" ry="${2.2*s}" fill="#0a0c10" opacity="0.75"/>
<ellipse cx="${c-5*s}" cy="${g-108.5*s}" rx="${1.8*s}" ry="${1.4*s}" fill="#3a2510"/>
<ellipse cx="${c+5*s}" cy="${g-108.5*s}" rx="${1.8*s}" ry="${1.4*s}" fill="#3a2510"/>
<ellipse cx="${c-4.5*s}" cy="${g-109*s}" rx="${0.7*s}" ry="${0.7*s}" fill="#f0e8d8" opacity="0.6"/>
<ellipse cx="${c+5.5*s}" cy="${g-109*s}" rx="${0.7*s}" ry="${0.7*s}" fill="#f0e8d8" opacity="0.6"/>
<!-- eyebrows -->
<path d="M${c-8*s} ${g-113*s} Q${c-5*s} ${g-115*s} ${c-2*s} ${g-113*s}" fill="none" stroke="${hr}" stroke-width="${1.2*s}" stroke-linecap="round"/>
<path d="M${c+2*s} ${g-113*s} Q${c+5*s} ${g-115*s} ${c+8*s} ${g-113*s}" fill="none" stroke="${hr}" stroke-width="${1.2*s}" stroke-linecap="round"/>
<!-- nose -->
<path d="M${c} ${g-112*s} L${c-2*s} ${g-101*s} Q${c} ${g-99*s} ${c+2*s} ${g-101*s}" fill="none" stroke="${nk}" stroke-width="${0.8*s}"/>
<!-- mouth -->
<path d="M${c-4*s} ${g-96*s} Q${c} ${g-93*s} ${c+4*s} ${g-96*s}" fill="none" stroke="${nk}" stroke-width="${0.9*s}" stroke-linecap="round"/>`
}

// Head-and-shoulders only (for CU/ECU crops)
function figureHead(cx, chinY, scale=1, variant=0) {
  const s = scale
  const skins  = ['#8B5E3C','#6B3A1F','#C8896A','#4A2E1A']
  const hairs  = ['#1a1030','#0d0a05','#3a2010','#111520']
  const jackets= ['#1e2640','#1f2835','#25201e','#1a2825']
  const shirts = ['#e8e4dc','#dce8e4','#e4dce8','#e8e8dc']
  const sk = skins[variant%4], nk = skins[(variant+3)%4]
  const hr = hairs[variant%4], sh = shirts[variant%4]
  const jk = jackets[variant%4]
  const c = cx, gy = chinY

  return `
<!-- shoulders -->
<path d="M${c-40*s} ${gy+50*s} L${c-28*s} ${gy+8*s} L${c-16*s} ${gy+2*s} L${c} ${gy} L${c+16*s} ${gy+2*s} L${c+28*s} ${gy+8*s} L${c+40*s} ${gy+50*s} Z" fill="${jk}"/>
<path d="M${c-8*s} ${gy} L${c-10*s} ${gy+20*s} L${c-5*s} ${gy+40*s} L${c} ${gy+42*s} L${c+5*s} ${gy+40*s} L${c+10*s} ${gy+20*s} L${c+8*s} ${gy} Z" fill="${sh}"/>
<!-- neck -->
<rect x="${c-5*s}" y="${gy-18*s}" width="${10*s}" height="${20*s}" rx="${3*s}" fill="${nk}"/>
<!-- head -->
<path d="M${c-16*s} ${gy-28*s} Q${c-18*s} ${gy-52*s} ${c-10*s} ${gy-60*s} Q${c} ${gy-66*s} ${c+10*s} ${gy-60*s} Q${c+18*s} ${gy-52*s} ${c+16*s} ${gy-28*s} Q${c+13*s} ${gy-18*s} ${c} ${gy-16*s} Q${c-13*s} ${gy-18*s} ${c-16*s} ${gy-28*s} Z" fill="${sk}"/>
<!-- hair -->
<path d="M${c-16*s} ${gy-34*s} Q${c-19*s} ${gy-55*s} ${c-10*s} ${gy-66*s} Q${c} ${gy-72*s} ${c+10*s} ${gy-66*s} Q${c+19*s} ${gy-55*s} ${c+16*s} ${gy-34*s} Q${c+10*s} ${gy-54*s} ${c} ${gy-52*s} Q${c-10*s} ${gy-54*s} ${c-16*s} ${gy-34*s} Z" fill="${hr}"/>
<!-- ears -->
<path d="M${c-16*s} ${gy-34*s} Q${c-21*s} ${gy-30*s} ${c-20*s} ${gy-24*s} Q${c-19*s} ${gy-19*s} ${c-15*s} ${gy-20*s}" fill="${nk}"/>
<path d="M${c+16*s} ${gy-34*s} Q${c+21*s} ${gy-30*s} ${c+20*s} ${gy-24*s} Q${c+19*s} ${gy-19*s} ${c+15*s} ${gy-20*s}" fill="${nk}"/>
<!-- eyes -->
<ellipse cx="${c-7*s}" cy="${gy-38*s}" rx="${5*s}" ry="${3.2*s}" fill="#0a0c10" opacity="0.75"/>
<ellipse cx="${c+7*s}" cy="${gy-38*s}" rx="${5*s}" ry="${3.2*s}" fill="#0a0c10" opacity="0.75"/>
<ellipse cx="${c-7*s}" cy="${gy-38.5*s}" rx="${2.6*s}" ry="${2*s}" fill="#3a2510"/>
<ellipse cx="${c+7*s}" cy="${gy-38.5*s}" rx="${2.6*s}" ry="${2*s}" fill="#3a2510"/>
<ellipse cx="${c-5.5*s}" cy="${gy-40*s}" rx="${1*s}" ry="${1*s}" fill="#f0e8d8" opacity="0.6"/>
<ellipse cx="${c+8.5*s}" cy="${gy-40*s}" rx="${1*s}" ry="${1*s}" fill="#f0e8d8" opacity="0.6"/>
<!-- eyebrows -->
<path d="M${c-12*s} ${gy-46*s} Q${c-7*s} ${gy-49*s} ${c-2*s} ${gy-46*s}" fill="none" stroke="${hr}" stroke-width="${1.5*s}" stroke-linecap="round"/>
<path d="M${c+2*s} ${gy-46*s} Q${c+7*s} ${gy-49*s} ${c+12*s} ${gy-46*s}" fill="none" stroke="${hr}" stroke-width="${1.5*s}" stroke-linecap="round"/>
<!-- nose -->
<path d="M${c} ${gy-42*s} L${c-3*s} ${gy-28*s} Q${c} ${gy-25*s} ${c+3*s} ${gy-28*s}" fill="none" stroke="${nk}" stroke-width="${1.1*s}"/>
<!-- mouth -->
<path d="M${c-6*s} ${gy-20*s} Q${c} ${gy-16*s} ${c+6*s} ${gy-20*s}" fill="none" stroke="${nk}" stroke-width="${1.2*s}" stroke-linecap="round"/>`
}

// Back-of-head silhouette for OTS
function backOfHead(cx, ground, scale=1) {
  const s = scale, c = cx, g = ground
  return `
<path d="M${c-20*s} ${g} L${c-22*s} ${g-55*s} L${c-18*s} ${g-75*s} L${c-10*s} ${g-82*s} L${c} ${g-84*s} L${c+10*s} ${g-82*s} L${c+18*s} ${g-75*s} L${c+22*s} ${g-55*s} L${c+20*s} ${g} Z" fill="#1a1828" opacity="0.92"/>
<path d="M${c-16*s} ${g-75*s} Q${c-18*s} ${g-90*s} ${c-10*s} ${g-96*s} Q${c} ${g-100*s} ${c+10*s} ${g-96*s} Q${c+18*s} ${g-90*s} ${c+16*s} ${g-75*s} Q${c+8*s} ${g-88*s} ${c} ${g-87*s} Q${c-8*s} ${g-88*s} ${c-16*s} ${g-75*s} Z" fill="#130f1e"/>`
}

// ─── SHOT GENERATORS ─────────────────────────────────────────────────────────

function ecu(gender, instanceId) {
  const v = hashVariant(instanceId)
  const skins = ['#8B5E3C','#6B3A1F','#C8896A','#4A2E1A']
  const hairs  = ['#1a1030','#0d0a05','#3a2010','#111520']
  const sk = skins[v%4], nk = skins[(v+3)%4], hr = hairs[v%4]
  const cx = W/2, ey = 55  // eye level
  return wrap(`
<rect width="${W}" height="${H}" fill="#080a0f"/>
<rect width="${W}" height="${H-18}" fill="#0b0c14"/>
<!-- Vignette corners -->
<rect x="0" y="0" width="80" height="${H-18}" fill="#030405" opacity="0.5"/>
<rect x="${W-80}" y="0" width="80" height="${H-18}" fill="#030405" opacity="0.5"/>
<!-- Face fills frame — ECU crop at face level -->
<!-- Head large -->
<path d="M${cx-52} ${ey+52} Q${cx-58} ${ey-30} ${cx-32} ${ey-52} Q${cx} ${ey-62} ${cx+32} ${ey-52} Q${cx+58} ${ey-30} ${cx+52} ${ey+52} Q${cx+40} ${ey+60} ${cx} ${ey+62} Q${cx-40} ${ey+60} ${cx-52} ${ey+52} Z" fill="${sk}"/>
<!-- Hair -->
<path d="M${cx-52} ${ey+20} Q${cx-60} ${ey-35} ${cx-30} ${ey-58} Q${cx} ${ey-68} ${cx+30} ${ey-58} Q${cx+60} ${ey-35} ${cx+52} ${ey+20} Q${cx+38} ${ey-12} ${cx} ${ey-10} Q${cx-38} ${ey-12} ${cx-52} ${ey+20} Z" fill="${hr}"/>
<!-- Ears -->
<path d="M${cx-52} ${ey+5} Q${cx-60} ${ey+12} ${cx-58} ${ey+24} Q${cx-56} ${ey+34} ${cx-50} ${ey+32}" fill="${nk}"/>
<path d="M${cx+52} ${ey+5} Q${cx+60} ${ey+12} ${cx+58} ${ey+24} Q${cx+56} ${ey+34} ${cx+50} ${ey+32}" fill="${nk}"/>
<!-- Eyes large, detailed -->
<ellipse cx="${cx-18}" cy="${ey+2}" rx="11" ry="7" fill="#0a0c10" opacity="0.8"/>
<ellipse cx="${cx+18}" cy="${ey+2}" rx="11" ry="7" fill="#0a0c10" opacity="0.8"/>
<ellipse cx="${cx-18}" cy="${ey+1}" rx="7" ry="5.5" fill="#3a2510"/>
<ellipse cx="${cx+18}" cy="${ey+1}" rx="7" ry="5.5" fill="#3a2510"/>
<ellipse cx="${cx-14}" cy="${ey-1}" rx="2.5" ry="2.5" fill="#f0e8d8" opacity="0.65"/>
<ellipse cx="${cx+22}" cy="${ey-1}" rx="2.5" ry="2.5" fill="#f0e8d8" opacity="0.65"/>
<!-- Eyelids -->
<path d="M${cx-29} ${ey-2} Q${cx-18} ${ey-10} ${cx-7} ${ey-2}" fill="none" stroke="${sk}" stroke-width="1"/>
<path d="M${cx+7} ${ey-2} Q${cx+18} ${ey-10} ${cx+29} ${ey-2}" fill="none" stroke="${sk}" stroke-width="1"/>
<!-- Eyebrows -->
<path d="M${cx-28} ${ey-14} Q${cx-18} ${ey-19} ${cx-7} ${ey-14}" fill="none" stroke="${hr}" stroke-width="2.2" stroke-linecap="round"/>
<path d="M${cx+7} ${ey-14} Q${cx+18} ${ey-19} ${cx+28} ${ey-14}" fill="none" stroke="${hr}" stroke-width="2.2" stroke-linecap="round"/>
<!-- Nose bridge -->
<path d="M${cx} ${ey-6} L${cx-6} ${ey+18} Q${cx} ${ey+22} ${cx+6} ${ey+18}" fill="none" stroke="${nk}" stroke-width="1.4"/>
<!-- Mouth -->
<path d="M${cx-14} ${ey+34} Q${cx} ${ey+40} ${cx+14} ${ey+34}" fill="none" stroke="${nk}" stroke-width="1.8" stroke-linecap="round"/>
${chrome('ECU — Extreme Close-Up')}
${rof()}`)
}

function cu(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
${envRoom(122)}
${figureHead(W/2, 126, 1.18, v)}
${eyeLine(52)}
${chrome('CU — Close-Up')}`)
}

function mcu(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
${envRoom(128)}
${envScreen(222, 18, 82, 54)}
${figureBody(W/2, 220, 1.32, v)}
${eyeLine(46)}
${chrome('MCU — Medium Close-Up')}
${rof()}`)
}

function ms(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
${envRoom(130)}
${envWindow(216, 10, 72, 82)}
${figureBody(W/2, 185, 0.82, v)}
${eyeLine(56)}
${chrome('MS — Medium Shot')}`)
}

function mws(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
${envRoom(134)}
${figureBody(W/2, 162, 0.62, v)}
${chrome('MWS — Medium Wide')}`)
}

function ws(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
${envRoom(138)}
${envScreen(198, 16, 84, 56)}
${figureBody(W/2, 150, 0.44, v)}
${chrome('WS — Wide Shot')}`)
}

function ews(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
<rect width="${W}" height="${H}" fill="#08090e"/>
<rect x="0" y="0" width="${W}" height="95" fill="#0c0e18"/>
<rect x="0" y="95" width="${W}" height="${H-95}" fill="#07080c"/>
<line x1="0" y1="95" x2="${W}" y2="95" stroke="#c8b89a" stroke-width="0.5" opacity="0.2"/>
<line x1="${W/2}" y1="95" x2="0" y2="${H}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W/2}" y1="95" x2="${W}" y2="${H}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<!-- Distant city/horizon suggestion -->
<rect x="60" y="70" width="12" height="25" fill="#0f1220" opacity="0.6"/>
<rect x="80" y="60" width="18" height="35" fill="#0f1220" opacity="0.5"/>
<rect x="220" y="65" width="14" height="30" fill="#0f1220" opacity="0.6"/>
<rect x="242" y="55" width="10" height="40" fill="#0f1220" opacity="0.5"/>
${figureBody(W/2, 126, 0.18, v)}
${chrome('EWS — Extreme Wide')}`)
}

function ots(gender, instanceId) {
  const v  = hashVariant(instanceId)
  const v2 = hashVariant((instanceId||'')+'opp')
  return wrap(`
${envRoom(122)}
${figureBody(W*0.64, 185, 0.78, v2)}
${backOfHead(W*0.18, H-18, 0.88)}
<line x1="${W*0.35}" y1="56" x2="${W*0.54}" y2="52" stroke="#c8b89a" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.35"/>
${chrome('OTS — Over The Shoulder')}`)
}

function two(gender, instanceId) {
  const v  = hashVariant(instanceId)
  const v2 = hashVariant((instanceId||'')+'two')
  return wrap(`
${envRoom(134)}
${figureBody(W*0.28, 168, 0.56, v)}
${figureBody(W*0.72, 168, 0.56, v2)}
<line x1="${W/2}" y1="0" x2="${W/2}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.4" opacity="0.18"/>
${chrome('TWO — Two Shot')}`)
}

function low(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
<rect width="${W}" height="${H}" fill="#08090e"/>
<!-- Ceiling -->
<rect x="0" y="0" width="${W}" height="30" fill="#0d0f18"/>
<line x1="0" y1="30" x2="${W}" y2="30" stroke="#c8b89a" stroke-width="0.6" opacity="0.3"/>
<!-- Floor/wall converging up -->
<rect x="0" y="30" width="${W}" height="${H-30}" fill="#0b0c14"/>
<line x1="0" y1="${H-18}" x2="${W/2}" y2="30" stroke="#c8b89a" stroke-width="0.4" opacity="0.15"/>
<line x1="${W}" y1="${H-18}" x2="${W/2}" y2="30" stroke="#c8b89a" stroke-width="0.4" opacity="0.15"/>
<!-- Figure scaled wide, pushed down — low angle feel -->
<g transform="scale(1.12,0.96) translate(${-(W*0.06)},8)">
${figureBody(W/2, 168, 0.58, v)}
</g>
<text x="${W-10}" y="22" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.55" text-anchor="end">↑ cam</text>
${chrome('LOW — Low Angle')}`)
}

function high(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
${envRoom(108)}
<!-- Extra floor lines for high angle -->
<line x1="${W*0.15}" y1="108" x2="${W*0.35}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W*0.5}" y1="108" x2="${W*0.5}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W*0.85}" y1="108" x2="${W*0.65}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<!-- Figure squashed — high angle foreshortening -->
<g transform="scale(1,0.82) translate(0,18)">
${figureBody(W/2, 156, 0.46, v)}
</g>
<text x="${W-10}" y="14" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.55" text-anchor="end">↓ cam</text>
${chrome('HIGH — High Angle')}`)
}

function dutch(gender, instanceId) {
  const v = hashVariant(instanceId)
  const cx = W/2, cy = (H-18)/2
  return wrap(`
<rect width="${W}" height="${H}" fill="#08090e"/>
<g transform="rotate(-14,${cx},${cy})">
${envRoom(128)}
${figureBody(W/2, 155, 0.50, v)}
</g>
<line x1="0" y1="${H*0.22}" x2="${W}" y2="${H*0.44}" stroke="#c8b89a" stroke-width="0.4" opacity="0.15"/>
<text x="${W-10}" y="14" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.55" text-anchor="end">⟳ dutch</text>
${chrome('DUTCH — Dutch Angle')}`)
}

function pov(gender, instanceId) {
  return wrap(`
<rect width="${W}" height="${H}" fill="#08090e"/>
${envRoom(104)}
<!-- Desk -->
<rect x="0" y="104" width="${W}" height="${H-104}" fill="#090a0f"/>
<line x1="0" y1="104" x2="${W}" y2="104" stroke="#c8b89a" stroke-width="0.7" opacity="0.3"/>
<!-- Monitor on desk -->
${envScreen(88, 22, 144, 76)}
<!-- Keyboard -->
<rect x="104" y="108" width="112" height="20" rx="3" fill="#111420" stroke="#c8b89a" stroke-width="0.5" opacity="0.35"/>
<rect x="108" y="112" width="104" height="8" rx="1" fill="#0d0f1a" opacity="0.6"/>
<!-- Vanishing lines from bottom -->
<line x1="0" y1="${H-18}" x2="88" y2="104" stroke="#c8b89a" stroke-width="0.35" opacity="0.1"/>
<line x1="${W}" y1="${H-18}" x2="${W-88}" y2="104" stroke="#c8b89a" stroke-width="0.35" opacity="0.1"/>
<!-- Reticle -->
<circle cx="${W/2}" cy="60" r="7" fill="none" stroke="#c8b89a" stroke-width="0.7" opacity="0.45"/>
<line x1="${W/2-14}" y1="60" x2="${W/2+14}" y2="60" stroke="#c8b89a" stroke-width="0.5" opacity="0.45"/>
<line x1="${W/2}" y1="46" x2="${W/2}" y2="74" stroke="#c8b89a" stroke-width="0.5" opacity="0.45"/>
${chrome('POV — Point of View')}`)
}

function th(gender, instanceId) {
  const v = hashVariant(instanceId)
  return wrap(`
${envRoom(128)}
${envScreen(192, 14, 100, 64)}
${figureBody(W*0.34, 218, 1.25, v)}
${eyeLine(44)}
${rof()}
${chrome('TH — Talking Head')}`)
}

// ─── UTIL ─────────────────────────────────────────────────────────────────────
function hashVariant(instanceId) {
  let h = 5381
  const s = String(instanceId || 'x')
  for (let i = 0; i < s.length; i++) h = ((h<<5)+h)^s.charCodeAt(i)
  return Math.abs(h) & 0x7fffffff
}

function wrap(content) {
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