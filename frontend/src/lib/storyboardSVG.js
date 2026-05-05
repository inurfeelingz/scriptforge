// frontend/src/lib/storyboardSVG.js
// South African musician storyboard figure system
// Front-facing + side-facing full-body vectors, 3 scene environments
// All frames 320×180 (16:9)

const W = 320
const H = 180

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const SK  = '#3D1F0D'   // primary skin
const SK2 = '#4a2810'   // skin shadow
const SK3 = '#5a3318'   // skin highlight
const HR  = '#0d0808'   // hair
const JK  = '#1a1f30'   // jacket
const JK2 = '#222840'   // jacket highlight
const SH  = '#dde0e8'   // shirt
const PT  = '#141520'   // pants
const PT2 = '#1c1e2c'   // pants highlight
const SN  = '#0a0b10'   // shoes

// ─── CHROME ───────────────────────────────────────────────────────────────────
function chrome(label) {
  return `<rect x="0" y="${H-18}" width="${W}" height="18" fill="#0a0c14" opacity="0.97"/>
<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#c8b89a" stroke-width="1.5"/>
<rect x="6" y="6" width="${W-12}" height="${H-30}" fill="none" stroke="#c8b89a" stroke-width="0.4" stroke-dasharray="3 3" opacity="0.22"/>
<text x="8" y="${H-6}" font-family="monospace" font-size="8.5" fill="#c8b89a" opacity="0.88">${label}</text>`
}

function rof() {
  const ih = H-18
  return `<line x1="${W/3}" y1="0" x2="${W/3}" y2="${ih}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="${W*2/3}" y1="0" x2="${W*2/3}" y2="${ih}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="0" y1="${ih/3}" x2="${W}" y2="${ih/3}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="0" y1="${ih*2/3}" x2="${W}" y2="${ih*2/3}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>`
}

function eyeLine(y) {
  return `<line x1="6" y1="${y}" x2="${W-6}" y2="${y}" stroke="#c8b89a" stroke-width="0.4" stroke-dasharray="4 4" opacity="0.3"/>
<text x="${W-8}" y="${y-3}" font-family="monospace" font-size="6" fill="#c8b89a" opacity="0.38" text-anchor="end">eye line</text>`
}

// ─── ENVIRONMENTS ─────────────────────────────────────────────────────────────
function envRoom(horizon=112) {
  return `<rect x="0" y="0" width="${W}" height="${H}" fill="#080a0e"/>
<rect x="0" y="0" width="${W}" height="${horizon}" fill="#0d0f1a"/>
<rect x="0" y="${horizon}" width="${W}" height="${H-horizon}" fill="#070810"/>
<line x1="0" y1="${horizon}" x2="${W}" y2="${horizon}" stroke="#c8b89a" stroke-width="0.6" opacity="0.32"/>
<line x1="0" y1="0" x2="${W/2}" y2="${horizon}" stroke="#c8b89a" stroke-width="0.3" opacity="0.08"/>
<line x1="${W}" y1="0" x2="${W/2}" y2="${horizon}" stroke="#c8b89a" stroke-width="0.3" opacity="0.08"/>
<line x1="0" y1="${horizon+4}" x2="${W}" y2="${horizon+4}" stroke="#c8b89a" stroke-width="0.25" opacity="0.1"/>`
}

function envScreen(x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#0d1020" stroke="#c8b89a" stroke-width="0.6" opacity="0.45"/>
<rect x="${x+3}" y="${y+3}" width="${w-6}" height="${h-6}" fill="#0f1a28"/>
<line x1="${x+6}" y1="${y+11}" x2="${x+w-6}" y2="${y+11}" stroke="#4a7ab8" stroke-width="1.8" opacity="0.45"/>
<line x1="${x+6}" y1="${y+17}" x2="${x+w*0.72}" y2="${y+17}" stroke="#6a48b8" stroke-width="1.5" opacity="0.38"/>
<line x1="${x+6}" y1="${y+23}" x2="${x+w-6}" y2="${y+23}" stroke="#4a8a68" stroke-width="1.8" opacity="0.4"/>
<line x1="${x+6}" y1="${y+29}" x2="${x+w*0.6}" y2="${y+29}" stroke="#4a7ab8" stroke-width="1.2" opacity="0.28"/>
<line x1="${x+w/2}" y1="${y+h}" x2="${x+w/2}" y2="${y+h+8}" stroke="#c8b89a" stroke-width="0.8" opacity="0.2"/>
<line x1="${x+w/2-9}" y1="${y+h+8}" x2="${x+w/2+9}" y2="${y+h+8}" stroke="#c8b89a" stroke-width="0.8" opacity="0.18"/>`
}

function envWindow(x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#080e1c" stroke="#c8b89a" stroke-width="0.6" opacity="0.38"/>
<line x1="${x+w/2}" y1="${y}" x2="${x+w/2}" y2="${y+h}" stroke="#c8b89a" stroke-width="0.4" opacity="0.28"/>
<line x1="${x}" y1="${y+h*0.45}" x2="${x+w}" y2="${y+h*0.45}" stroke="#c8b89a" stroke-width="0.4" opacity="0.28"/>`
}

// ─── SA FRONT FIGURE ──────────────────────────────────────────────────────────
// cx = centre x, ground = y of feet, s = scale
function figFront(cx, ground, s=1, variant=0) {
  const skins  = [SK,  '#2e1508','#5a3020','#3a1c08']
  const hairs  = [HR,  '#080404','#100808','#0a0606']
  const shirts = [SH,  '#d8dce4','#e4e8f0','#ccd0d8']
  const jackets= [JK,  '#1c2238','#202838','#181e30']
  const pants  = [PT,  '#121420','#181a28','#100e1c']
  const sk=skins[variant%4], sk2=skins[(variant+2)%4]
  const hr=hairs[variant%4], sh=shirts[variant%4]
  const jk=jackets[variant%4], pt=pants[variant%4]
  const c=cx, g=ground

  return `
<ellipse cx="${c}" cy="${g}" rx="${20*s}" ry="${5*s}" fill="#04050a" opacity="0.5"/>
<path d="M${c-9*s} ${g-3} Q${c-13*s} ${g-2} ${c-13*s} ${g} L${c-4*s} ${g} Z" fill="${SN}"/>
<rect x="${c+3*s}" y="${g-12*s}" width="${10*s}" height="${12*s}" rx="${2*s}" fill="${SN}"/>
<path d="M${c+3*s} ${g-4} Q${c+13*s} ${g-2} ${c+13*s} ${g} L${c+4*s} ${g} Z" fill="${SN}"/>
<path d="M${c-10*s} ${g-52*s} L${c-12*s} ${g-3} L${c-3*s} ${g-1} L${c-1*s} ${g-34*s} L${c+1*s} ${g-34*s} L${c+3*s} ${g-1} L${c+12*s} ${g-3} L${c+10*s} ${g-52*s} Z" fill="${pt}"/>
<path d="M${c-10*s} ${g-52*s} L${c-12*s} ${g-3} L${c-7*s} ${g-2} L${c-1*s} ${g-34*s} L${c+1*s} ${g-34*s} L${c-1*s} ${g-52*s} Z" fill="${PT2}"/>
<path d="M${c-18*s} ${g-104*s} L${c-16*s} ${g-52*s} L${c+16*s} ${g-52*s} L${c+18*s} ${g-104*s} L${c+14*s} ${g-112*s} L${c} ${g-116*s} L${c-14*s} ${g-112*s} Z" fill="${jk}"/>
<path d="M${c-4*s} ${g-112*s} L${c-6*s} ${g-84*s} L${c-6*s} ${g-52*s} L${c} ${g-52*s} L${c+6*s} ${g-52*s} L${c+6*s} ${g-84*s} L${c+4*s} ${g-112*s} Z" fill="${sh}"/>
<path d="M${c-4*s} ${g-112*s} L${c-6*s} ${g-88*s} L${c-8*s} ${g-104*s} L${c-14*s} ${g-112*s} Z" fill="${JK2}"/>
<path d="M${c+4*s} ${g-112*s} L${c+6*s} ${g-88*s} L${c+8*s} ${g-104*s} L${c+14*s} ${g-112*s} Z" fill="${JK2}"/>
<path d="M${c-18*s} ${g-104*s} L${c-25*s} ${g-74*s} L${c-23*s} ${g-60*s} L${c-18*s} ${g-63*s} L${c-16*s} ${g-90*s} Z" fill="${jk}"/>
<path d="M${c-25*s} ${g-73*s} Q${c-26*s} ${g-62*s} ${c-25*s} ${g-54*s} Q${c-22*s} ${g-48*s} ${c-18*s} ${g-49*s} Q${c-14*s} ${g-50*s} ${c-14*s} ${g-57*s} L${c-18*s} ${g-63*s} Z" fill="${sk}"/>
<line x1="${c-25*s}" y1="${g-56*s}" x2="${c-29*s}" y2="${g-50*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c-23*s}" y1="${g-54*s}" x2="${c-27*s}" y2="${g-48*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c-20*s}" y1="${g-53*s}" x2="${c-23*s}" y2="${g-47*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<path d="M${c+18*s} ${g-104*s} L${c+25*s} ${g-74*s} L${c+23*s} ${g-60*s} L${c+18*s} ${g-63*s} L${c+16*s} ${g-90*s} Z" fill="${jk}"/>
<path d="M${c+25*s} ${g-73*s} Q${c+26*s} ${g-62*s} ${c+25*s} ${g-54*s} Q${c+22*s} ${g-48*s} ${c+18*s} ${g-49*s} Q${c+14*s} ${g-50*s} ${c+14*s} ${g-57*s} L${c+18*s} ${g-63*s} Z" fill="${sk}"/>
<line x1="${c+25*s}" y1="${g-56*s}" x2="${c+29*s}" y2="${g-50*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c+23*s}" y1="${g-54*s}" x2="${c+27*s}" y2="${g-48*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c+20*s}" y1="${g-53*s}" x2="${c+23*s}" y2="${g-47*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<path d="M${c-5*s} ${g-115*s} L${c-5*s} ${g-126*s} Q${c} ${g-129*s} ${c+5*s} ${g-126*s} L${c+5*s} ${g-115*s} Q${c} ${g-118*s} ${c-5*s} ${g-115*s} Z" fill="${sk2}"/>
<path d="M${c-14*s} ${g-112*s} L${c-10*s} ${g-120*s} L${c} ${g-122*s} L${c+10*s} ${g-120*s} L${c+14*s} ${g-112*s} L${c+8*s} ${g-116*s} L${c} ${g-117*s} L${c-8*s} ${g-116*s} Z" fill="${jk}"/>
<path d="M${c-18*s} ${g-134*s} Q${c-21*s} ${g-152*s} ${c-14*s} ${g-160*s} Q${c-6*s} ${g-167*s} ${c} ${g-166*s} Q${c+6*s} ${g-167*s} ${c+14*s} ${g-160*s} Q${c+21*s} ${g-152*s} ${c+18*s} ${g-134*s} Q${c+15*s} ${g-124*s} ${c} ${g-122*s} Q${c-15*s} ${g-124*s} ${c-18*s} ${g-134*s} Z" fill="${sk}"/>
<path d="M${c-18*s} ${g-140*s} Q${c-22*s} ${g-156*s} ${c-15*s} ${g-165*s} Q${c-6*s} ${g-173*s} ${c} ${g-172*s} Q${c+6*s} ${g-173*s} ${c+15*s} ${g-165*s} Q${c+22*s} ${g-156*s} ${c+18*s} ${g-140*s} Q${c+10*s} ${g-157*s} ${c} ${g-156*s} Q${c-10*s} ${g-157*s} ${c-18*s} ${g-140*s} Z" fill="${hr}"/>
<path d="M${c-16*s} ${g-152*s} Q${c-18*s} ${g-165*s} ${c-10*s} ${g-172*s} Q${c-16*s} ${g-162*s} ${c-17*s} ${g-152*s} Z" fill="${hr}"/>
<path d="M${c+16*s} ${g-152*s} Q${c+18*s} ${g-165*s} ${c+10*s} ${g-172*s} Q${c+16*s} ${g-162*s} ${c+17*s} ${g-152*s} Z" fill="${hr}"/>
<path d="M${c-5*s} ${g-165*s} Q${c-7*s} ${g-170*s} ${c-7*s} ${g-175*s} Q${c-7*s} ${g-180*s} ${c-4*s} ${g-182*s} Q${c-6*s} ${g-178*s} ${c-7*s} ${g-174*s} Z" fill="${sk2}"/>
<path d="M${c+5*s} ${g-165*s} Q${c+7*s} ${g-170*s} ${c+7*s} ${g-175*s} Q${c+7*s} ${g-180*s} ${c+4*s} ${g-182*s} Q${c+6*s} ${g-178*s} ${c+7*s} ${g-174*s} Z" fill="${sk2}"/>
<path d="M${c-6*s} ${g-148*s} Q${c-8*s} ${g-152*s} ${c-8*s} ${g-157*s} Q${c-8*s} ${g-160*s} ${c-5*s} ${g-161*s} Q${c-6*s} ${g-157*s} ${c-7*s} ${g-152*s} Q${c-6*s} ${g-148*s} ${c-5*s} ${g-148*s} Z" fill="${sk2}"/>
<path d="M${c+6*s} ${g-148*s} Q${c+8*s} ${g-152*s} ${c+8*s} ${g-157*s} Q${c+8*s} ${g-160*s} ${c+5*s} ${g-161*s} Q${c+6*s} ${g-157*s} ${c+7*s} ${g-152*s} Q${c+6*s} ${g-148*s} ${c+5*s} ${g-148*s} Z" fill="${sk2}"/>
<path d="M${c-9*s} ${g-148*s} Q${c-12*s} ${g-152*s} ${c-12*s} ${g-158*s} Q${c-11*s} ${g-161*s} ${c-8*s} ${g-160*s}" fill="none" stroke="${sk2}" stroke-width="${1.4*s}"/>
<path d="M${c+9*s} ${g-148*s} Q${c+12*s} ${g-152*s} ${c+12*s} ${g-158*s} Q${c+11*s} ${g-161*s} ${c+8*s} ${g-160*s}" fill="none" stroke="${sk2}" stroke-width="${1.4*s}"/>
<path d="M${c-8*s} ${g-148*s} Q${c-6*s} ${g-152*s} ${c-2*s} ${g-150*s} Q${c+2*s} ${g-150*s} ${c+6*s} ${g-148*s}" fill="none" stroke="${sk2}" stroke-width="${1.4*s}"/>
<ellipse cx="${c-6*s}" cy="${g-147*s}" rx="${5*s}" ry="${3.5*s}" fill="#0e1018" opacity="0.85"/>
<ellipse cx="${c+6*s}" cy="${g-147*s}" rx="${5*s}" ry="${3.5*s}" fill="#0e1018" opacity="0.85"/>
<ellipse cx="${c-6*s}" cy="${g-147.5*s}" rx="${3*s}" ry="${2.5*s}" fill="#1a0d05"/>
<ellipse cx="${c+6*s}" cy="${g-147.5*s}" rx="${3*s}" ry="${2.5*s}" fill="#1a0d05"/>
<ellipse cx="${c-4.5*s}" cy="${g-149*s}" rx="${1.2*s}" ry="${1.2*s}" fill="#e8e0d0" opacity="0.6"/>
<ellipse cx="${c+7.5*s}" cy="${g-149*s}" rx="${1.2*s}" ry="${1.2*s}" fill="#e8e0d0" opacity="0.6"/>
<path d="M${c-11*s} ${g-153*s} Q${c-6*s} ${g-156*s} ${c-1*s} ${g-153*s}" fill="none" stroke="${hr}" stroke-width="${2.2*s}" stroke-linecap="round"/>
<path d="M${c+1*s} ${g-153*s} Q${c+6*s} ${g-156*s} ${c+11*s} ${g-153*s}" fill="none" stroke="${hr}" stroke-width="${2.2*s}" stroke-linecap="round"/>
<path d="M${c} ${g-148*s} L${c-2*s} ${g-139*s} Q${c} ${g-136*s} ${c+2*s} ${g-139*s}" fill="none" stroke="${sk2}" stroke-width="${1.2*s}" stroke-linecap="round"/>
<ellipse cx="${c-6*s}" cy="${g-136*s}" rx="${3.5*s}" ry="${2.5*s}" fill="#1a0d05" opacity="0.5"/>
<ellipse cx="${c+6*s}" cy="${g-136*s}" rx="${3.5*s}" ry="${2.5*s}" fill="#1a0d05" opacity="0.5"/>
<path d="M${c-8*s} ${g-131*s} Q${c} ${g-127*s} ${c+8*s} ${g-131*s}" fill="${sk}" opacity="0.6"/>
<path d="M${c-7*s} ${g-131*s} Q${c} ${g-129*s} ${c+7*s} ${g-131*s}" fill="none" stroke="${sk2}" stroke-width="${1.4*s}" stroke-linecap="round"/>`
}

// ─── SA SIDE FIGURE ───────────────────────────────────────────────────────────
function figSide(cx, ground, s=1, variant=0) {
  const skins  = [SK,  '#2e1508','#5a3020','#3a1c08']
  const hairs  = [HR,  '#080404','#100808','#0a0606']
  const shirts = [SH,  '#d8dce4','#e4e8f0','#ccd0d8']
  const jackets= [JK,  '#1c2238','#202838','#181e30']
  const pants  = [PT,  '#121420','#181a28','#100e1c']
  const sk=skins[variant%4], sk2=skins[(variant+2)%4]
  const hr=hairs[variant%4], sh=shirts[variant%4]
  const jk=jackets[variant%4], pt=pants[variant%4]
  const c=cx, g=ground

  return `
<ellipse cx="${c}" cy="${g}" rx="${18*s}" ry="${4*s}" fill="#04050a" opacity="0.45"/>
<path d="M${c-12*s} ${g-5} Q${c-18*s} ${g-3} ${c-18*s} ${g} L${c-5*s} ${g} L${c-4*s} ${g-10*s} Z" fill="${SN}"/>
<rect x="${c-4*s}" y="${g-14*s}" width="${8*s}" height="${14*s}" rx="${2*s}" fill="${SN}"/>
<path d="M${c-12*s} ${g-5} Q${c+8*s} ${g-3} ${c+8*s} ${g} L${c-5*s} ${g} Z" fill="${SN}" opacity="0.5"/>
<path d="M${c-10*s} ${g-52*s} L${c-10*s} ${g-4} L${c+4*s} ${g-4} L${c+4*s} ${g-52*s} Z" fill="${pt}"/>
<path d="M${c+2*s} ${g-52*s} L${c+4*s} ${g-3} L${c+10*s} ${g-3} L${c+12*s} ${g-52*s} Z" fill="${PT2}" opacity="0.7"/>
<path d="M${c-14*s} ${g-112*s} L${c-12*s} ${g-52*s} L${c+16*s} ${g-52*s} L${c+18*s} ${g-112*s} L${c+12*s} ${g-118*s} L${c} ${g-120*s} L${c-8*s} ${g-116*s} Z" fill="${jk}"/>
<path d="M${c-4*s} ${g-118*s} L${c-6*s} ${g-90*s} L${c-6*s} ${g-52*s} L${c+4*s} ${g-52*s} L${c+4*s} ${g-90*s} L${c+2*s} ${g-118*s} Z" fill="${sh}"/>
<path d="M${c-14*s} ${g-112*s} L${c-22*s} ${g-78*s} L${c-20*s} ${g-62*s} L${c-14*s} ${g-65*s} L${c-12*s} ${g-96*s} Z" fill="${jk}"/>
<path d="M${c-22*s} ${g-76*s} Q${c-24*s} ${g-64*s} ${c-23*s} ${g-56*s} Q${c-20*s} ${g-48*s} ${c-16*s} ${g-49*s} Q${c-12*s} ${g-50*s} ${c-12*s} ${g-58*s} L${c-14*s} ${g-65*s} Z" fill="${sk}"/>
<line x1="${c-22*s}" y1="${g-58*s}" x2="${c-26*s}" y2="${g-52*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c-19*s}" y1="${g-55*s}" x2="${c-23*s}" y2="${g-49*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c-16*s}" y1="${g-53*s}" x2="${c-19*s}" y2="${g-47*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<path d="M${c+18*s} ${g-112*s} L${c+26*s} ${g-80*s} L${c+22*s} ${g-62*s} L${c+16*s} ${g-64*s} L${c+16*s} ${g-96*s} Z" fill="${jk}"/>
<path d="M${c+24*s} ${g-78*s} Q${c+27*s} ${g-66*s} ${c+24*s} ${g-58*s} Q${c+20*s} ${g-50*s} ${c+16*s} ${g-52*s} Q${c+12*s} ${g-53*s} ${c+12*s} ${g-60*s} L${c+16*s} ${g-64*s} Z" fill="${sk}"/>
<line x1="${c+24*s}" y1="${g-60*s}" x2="${c+28*s}" y2="${g-54*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c+22*s}" y1="${g-57*s}" x2="${c+26*s}" y2="${g-51*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<line x1="${c+19*s}" y1="${g-55*s}" x2="${c+22*s}" y2="${g-49*s}" stroke="${SK}" stroke-width="${3*s}" stroke-linecap="round"/>
<path d="M${c-2*s} ${g-118*s} L${c-2*s} ${g-128*s} Q${c+3*s} ${g-130*s} ${c+6*s} ${g-127*s} L${c+6*s} ${g-118*s} Q${c+2*s} ${g-121*s} ${c-2*s} ${g-118*s} Z" fill="${sk2}"/>
<path d="M${c-16*s} ${g-134*s} Q${c-18*s} ${g-148*s} ${c-14*s} ${g-158*s} Q${c-6*s} ${g-166*s} ${c+2*s} ${g-165*s} Q${c+10*s} ${g-164*s} ${c+16*s} ${g-156*s} Q${c+20*s} ${g-144*s} ${c+18*s} ${g-130*s} Q${c+14*s} ${g-122*s} ${c} ${g-120*s} Q${c-12*s} ${g-122*s} ${c-16*s} ${g-134*s} Z" fill="${sk}"/>
<path d="M${c-16*s} ${g-140*s} Q${c-20*s} ${g-152*s} ${c-16*s} ${g-162*s} Q${c-8*s} ${g-172*s} ${c+2*s} ${g-171*s} Q${c+10*s} ${g-170*s} ${c+16*s} ${g-160*s} Q${c+20*s} ${g-148*s} ${c+18*s} ${g-136*s} Q${c+10*s} ${g-152*s} ${c} ${g-151*s} Q${c-10*s} ${g-152*s} ${c-16*s} ${g-140*s} Z" fill="${hr}"/>
<path d="M${c-14*s} ${g-154*s} Q${c-18*s} ${g-164*s} ${c-15*s} ${g-172*s} Q${c-17*s} ${g-164*s} ${c-16*s} ${g-154*s} Z" fill="${hr}"/>
<path d="M${c+14*s} ${g-148*s} Q${c+19*s} ${g-156*s} ${c+18*s} ${g-166*s} Q${c+18*s} ${g-156*s} ${c+16*s} ${g-148*s} Z" fill="${hr}"/>
<path d="M${c-4*s} ${g-128*s} Q${c-8*s} ${g-134*s} ${c-8*s} ${g-140*s} Q${c-8*s} ${g-145*s} ${c-4*s} ${g-147*s} Q${c-6*s} ${g-142*s} ${c-7*s} ${g-137*s} Q${c-6*s} ${g-131*s} ${c-4*s} ${g-128*s} Z" fill="${sk2}"/>
<path d="M${c+4*s} ${g-128*s} Q${c+8*s} ${g-134*s} ${c+8*s} ${g-140*s} Q${c+8*s} ${g-145*s} ${c+4*s} ${g-147*s} Q${c+6*s} ${g-142*s} ${c+7*s} ${g-137*s} Q${c+6*s} ${g-131*s} ${c+4*s} ${g-128*s} Z" fill="${sk2}"/>
<path d="M${c+16*s} ${g-136*s} Q${c+22*s} ${g-143*s} ${c+22*s} ${g-152*s} Q${c+22*s} ${g-160*s} ${c+16*s} ${g-163*s} Q${c+20*s} ${g-158*s} ${c+20*s} ${g-150*s} Q${c+20*s} ${g-142*s} ${c+16*s} ${g-136*s} Z" fill="${sk2}"/>
<path d="M${c+10*s} ${g-136*s} Q${c+8*s} ${g-140*s} ${c+6*s} ${g-148*s} Q${c+6*s} ${g-152*s} ${c+8*s} ${g-154*s} Q${c+8*s} ${g-150*s} ${c+9*s} ${g-145*s} Z" fill="#0e1018" opacity="0.75"/>
<ellipse cx="${c+11*s}" cy="${g-146*s}" rx="${4.5*s}" ry="${3*s}" fill="#1a0d05"/>
<ellipse cx="${c+13*s}" cy="${g-148*s}" rx="${1.5*s}" ry="${1.5*s}" fill="#e8e0d0" opacity="0.6"/>
<path d="M${c+9*s} ${g-150*s} Q${c+13*s} ${g-155*s} ${c+18*s} ${g-150*s}" fill="none" stroke="${hr}" stroke-width="${2.5*s}" stroke-linecap="round"/>
<path d="M${c+18*s} ${g-135*s} Q${c+26*s} ${g-143*s} ${c+24*s} ${g-155*s} Q${c+22*s} ${g-161*s} ${c+17*s} ${g-160*s}" fill="none" stroke="${sk2}" stroke-width="${2*s}" stroke-linecap="round"/>
<path d="M${c+12*s} ${g-128*s} Q${c+18*s} ${g-132*s} ${c+22*s} ${g-130*s}" fill="none" stroke="${sk2}" stroke-width="${1.5*s}" stroke-linecap="round"/>
<path d="M${c+4*s} ${g-126*s} Q${c+8*s} ${g-123*s} ${c+10*s} ${g-126*s}" fill="${sk}" opacity="0.5"/>
<path d="M${c+5*s} ${g-126*s} Q${c+8*s} ${g-124*s} ${c+10*s} ${g-126*s}" fill="none" stroke="${sk2}" stroke-width="${1.4*s}" stroke-linecap="round"/>`
}

// ─── HASH FOR VARIANT SELECTION ───────────────────────────────────────────────
function hv(id) {
  let h=5381; const s=String(id||'x')
  for(let i=0;i<s.length;i++) h=((h<<5)+h)^s.charCodeAt(i)
  return Math.abs(h)&0x7fffffff
}

function wrap(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${content}</svg>`
}

// ─── SHOT GENERATORS ─────────────────────────────────────────────────────────
function ecu(gender, id) {
  const v=hv(id), sk=SK, sk2=SK2, hr=HR
  const cx=W/2, ey=54
  return wrap(`<rect width="${W}" height="${H}" fill="#060709"/>
<rect x="0" y="0" width="70" height="${H-18}" fill="#03040a" opacity="0.55"/>
<rect x="${W-70}" y="0" width="70" height="${H-18}" fill="#03040a" opacity="0.55"/>
<path d="M${cx-58} ${ey+55} Q${cx-64} ${ey-30} ${cx-32} ${ey-58} Q${cx} ${ey-68} ${cx+32} ${ey-58} Q${cx+64} ${ey-30} ${cx+58} ${ey+55} Q${cx+44} ${ey+64} ${cx} ${ey+66} Q${cx-44} ${ey+64} ${cx-58} ${ey+55} Z" fill="${sk}"/>
<path d="M${cx-58} ${ey+18} Q${cx-66} ${ey-34} ${cx-30} ${ey-64} Q${cx} ${ey-74} ${cx+30} ${ey-64} Q${cx+66} ${ey-34} ${cx+58} ${ey+18} Q${cx+40} ${ey-8} ${cx} ${ey-6} Q${cx-40} ${ey-8} ${cx-58} ${ey+18} Z" fill="${hr}"/>
<path d="M${cx-58} ${ey+14} Q${cx-68} ${ey+2} ${cx-66} ${ey+22} Q${cx-64} ${ey+36} ${cx-56} ${ey+38} Q${cx-60} ${ey+30} ${cx-62} ${ey+18} Z" fill="${sk2}"/>
<path d="M${cx+58} ${ey+14} Q${cx+68} ${ey+2} ${cx+66} ${ey+22} Q${cx+64} ${ey+36} ${cx+56} ${ey+38} Q${cx+60} ${ey+30} ${cx+62} ${ey+18} Z" fill="${sk2}"/>
<path d="M${cx-22} ${ey} Q${cx-14} ${ey-10} ${cx-4} ${ey-4} Q${cx-3} ${ey+4} ${cx-8} ${ey+10} Q${cx-16} ${ey+14} ${cx-22} ${ey+8} Z" fill="#0e1018" opacity="0.9"/>
<path d="M${cx+4} ${ey-4} Q${cx+14} ${ey-10} ${cx+22} ${ey} Q${cx+23} ${ey+8} ${cx+17} ${ey+12} Q${cx+10} ${ey+14} ${cx+3} ${ey+10} Z" fill="#0e1018" opacity="0.9"/>
<ellipse cx="${cx-14}" cy="${ey+2}" rx="8" ry="6.5" fill="#1a0d05"/>
<ellipse cx="${cx+14}" cy="${ey+2}" rx="8" ry="6.5" fill="#1a0d05"/>
<ellipse cx="${cx-11}" cy="${ey}" rx="3" ry="3" fill="#e8e0d0" opacity="0.65"/>
<ellipse cx="${cx+17}" cy="${ey}" rx="3" ry="3" fill="#e8e0d0" opacity="0.65"/>
<path d="M${cx-22} ${ey-2} Q${cx-14} ${ey-11} ${cx-4} ${ey-5}" fill="none" stroke="${sk2}" stroke-width="1.5"/>
<path d="M${cx+4} ${ey-5} Q${cx+14} ${ey-11} ${cx+22} ${ey-2}" fill="none" stroke="${sk2}" stroke-width="1.5"/>
<path d="M${cx-22} ${ey+10} Q${cx-14} ${ey+15} ${cx-4} ${ey+10}" fill="none" stroke="${sk2}" stroke-width="1"/>
<path d="M${cx+3} ${ey+10} Q${cx+11} ${ey+15} ${cx+22} ${ey+10}" fill="none" stroke="${sk2}" stroke-width="1"/>
<path d="M${cx-26} ${ey-16} Q${cx-14} ${ey-24} ${cx-2} ${ey-17}" fill="none" stroke="${hr}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M${cx+2} ${ey-17} Q${cx+14} ${ey-24} ${cx+26} ${ey-16}" fill="none" stroke="${hr}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M${cx} ${ey+2} L${cx-5} ${ey+20} Q${cx} ${ey+25} ${cx+5} ${ey+20}" fill="none" stroke="${sk2}" stroke-width="1.8" stroke-linecap="round"/>
<ellipse cx="${cx-8}" cy="${ey+33}" rx="5" ry="3.5" fill="#1a0d05" opacity="0.5"/>
<ellipse cx="${cx+8}" cy="${ey+33}" rx="5" ry="3.5" fill="#1a0d05" opacity="0.5"/>
<path d="M${cx-16} ${ey+42} Q${cx} ${ey+50} ${cx+16} ${ey+42}" fill="${sk}" opacity="0.55"/>
<path d="M${cx-14} ${ey+42} Q${cx} ${ey+48} ${cx+14} ${ey+42}" fill="none" stroke="${sk2}" stroke-width="2" stroke-linecap="round"/>
${chrome('ECU — Extreme Close-Up')}${rof()}`)
}

function cu(gender, id) {
  const v=hv(id), cx=W/2, chinY=126
  return wrap(`${envRoom(122)}
${gender==='female'?figSide(cx,chinY+60,1.18,v):figFront(cx,chinY+60,1.18,v)}
${eyeLine(52)}
${chrome('CU — Close-Up')}`)
}

function mcu(gender, id) {
  const v=hv(id)
  return wrap(`${envRoom(128)}${envScreen(196,14,86,55)}
${figFront(W/2,220,1.32,v)}
${eyeLine(44)}
${chrome('MCU — Medium Close-Up')}${rof()}`)
}

function ms(gender, id) {
  const v=hv(id)
  return wrap(`${envRoom(130)}${envWindow(212,10,70,82)}
${figFront(W/2,186,0.82,v)}
${eyeLine(54)}
${chrome('MS — Medium Shot')}`)
}

function mws(gender, id) {
  const v=hv(id)
  return wrap(`${envRoom(134)}
${figFront(W/2,162,0.62,v)}
${chrome('MWS — Medium Wide')}`)
}

function ws(gender, id) {
  const v=hv(id)
  return wrap(`${envRoom(138)}${envScreen(194,14,86,56)}
${figFront(W/2,150,0.44,v)}
${chrome('WS — Wide Shot')}`)
}

function ews(gender, id) {
  const v=hv(id)
  return wrap(`<rect width="${W}" height="${H}" fill="#07080d"/>
<rect x="0" y="0" width="${W}" height="96" fill="#0b0d18"/>
<rect x="0" y="96" width="${W}" height="${H-96}" fill="#06070c"/>
<line x1="0" y1="96" x2="${W}" y2="96" stroke="#c8b89a" stroke-width="0.5" opacity="0.2"/>
<rect x="55" y="68" width="14" height="28" fill="#0f1224" opacity="0.55"/>
<rect x="76" y="58" width="20" height="38" fill="#0e1120" opacity="0.5"/>
<rect x="220" y="62" width="16" height="34" fill="#0f1224" opacity="0.55"/>
<rect x="244" y="54" width="12" height="42" fill="#0e1120" opacity="0.5"/>
${figFront(W/2,126,0.18,v)}
${chrome('EWS — Extreme Wide')}`)
}

function ots(gender, id) {
  const v=hv(id), v2=hv((id||'')+'opp')
  return wrap(`${envRoom(122)}
${figFront(W*0.64,185,0.78,v2)}
<g opacity="0.88">
  <path d="M${W*0.06} ${H-18} L${W*0.1} ${H*0.24} Q${W*0.18} ${H*0.08} ${W*0.28} ${H*0.06} Q${W*0.36} ${H*0.04} ${W*0.42} ${H*0.1} L${W*0.44} ${H-18} Z" fill="#1a1828"/>
  <path d="M${W*0.15} ${H*0.12} Q${W*0.12} ${H*0.05} ${W*0.22} ${H*0.02} Q${W*0.3} ${H*0} ${W*0.38} ${H*0.04} Q${W*0.42} ${H*0.08} ${W*0.42} ${H*0.14} Q${W*0.34} ${H*0.08} ${W*0.26} ${H*0.08} Q${W*0.18} ${H*0.08} ${W*0.15} ${H*0.12} Z" fill="#0d0b1a"/>
</g>
<line x1="${W*0.38}" y1="${H*0.2}" x2="${W*0.56}" y2="${H*0.18}" stroke="#c8b89a" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.35"/>
${chrome('OTS — Over The Shoulder')}`)
}

function two(gender, id) {
  const v=hv(id), v2=hv((id||'')+'two')
  return wrap(`${envRoom(134)}
${figFront(W*0.28,168,0.56,v)}
${figFront(W*0.72,168,0.56,v2)}
<line x1="${W/2}" y1="0" x2="${W/2}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.4" opacity="0.18"/>
${chrome('TWO — Two Shot')}`)
}

function low(gender, id) {
  const v=hv(id)
  return wrap(`<rect width="${W}" height="${H}" fill="#07080d"/>
<rect x="0" y="0" width="${W}" height="28" fill="#0c0e1a"/>
<line x1="0" y1="28" x2="${W}" y2="28" stroke="#c8b89a" stroke-width="0.6" opacity="0.28"/>
<rect x="0" y="28" width="${W}" height="${H-28}" fill="#0a0c16"/>
<line x1="0" y1="${H-18}" x2="${W/2}" y2="28" stroke="#c8b89a" stroke-width="0.4" opacity="0.14"/>
<line x1="${W}" y1="${H-18}" x2="${W/2}" y2="28" stroke="#c8b89a" stroke-width="0.4" opacity="0.14"/>
<g transform="scale(1.12,0.94) translate(${-(W*0.06)},9)">
${figFront(W/2,168,0.58,v)}
</g>
<text x="${W-10}" y="20" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.5" text-anchor="end">↑ cam low</text>
${chrome('LOW — Low Angle')}`)
}

function high(gender, id) {
  const v=hv(id)
  return wrap(`${envRoom(108)}
<line x1="${W*0.2}" y1="108" x2="${W*0.35}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W*0.5}" y1="108" x2="${W*0.5}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W*0.8}" y1="108" x2="${W*0.65}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<g transform="scale(1,0.8) translate(0,20)">
${figFront(W/2,156,0.46,v)}
</g>
<text x="${W-10}" y="14" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.5" text-anchor="end">↓ cam high</text>
${chrome('HIGH — High Angle')}`)
}

function dutch(gender, id) {
  const v=hv(id), cx=W/2, cy=(H-18)/2
  return wrap(`<rect width="${W}" height="${H}" fill="#07080d"/>
<g transform="rotate(-14,${cx},${cy})">
${envRoom(128)}
${figFront(W/2,155,0.50,v)}
</g>
<line x1="0" y1="${H*0.2}" x2="${W}" y2="${H*0.44}" stroke="#c8b89a" stroke-width="0.4" opacity="0.14"/>
<text x="${W-10}" y="14" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.5" text-anchor="end">⟳ dutch</text>
${chrome('DUTCH — Dutch Angle')}`)
}

function pov(gender, id) {
  return wrap(`<rect width="${W}" height="${H}" fill="#07080d"/>
${envRoom(104)}
<rect x="0" y="104" width="${W}" height="${H-104}" fill="#07080c"/>
<line x1="0" y1="104" x2="${W}" y2="104" stroke="#c8b89a" stroke-width="0.7" opacity="0.28"/>
${envScreen(88,22,144,74)}
<rect x="100" y="108" width="120" height="18" rx="3" fill="#111420" stroke="#c8b89a" stroke-width="0.5" opacity="0.32"/>
<line x1="0" y1="${H-18}" x2="88" y2="104" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W}" y1="${H-18}" x2="${W-88}" y2="104" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<circle cx="${W/2}" cy="59" r="7" fill="none" stroke="#c8b89a" stroke-width="0.7" opacity="0.42"/>
<line x1="${W/2-14}" y1="59" x2="${W/2+14}" y2="59" stroke="#c8b89a" stroke-width="0.5" opacity="0.42"/>
<line x1="${W/2}" y1="45" x2="${W/2}" y2="73" stroke="#c8b89a" stroke-width="0.5" opacity="0.42"/>
${chrome('POV — Point of View')}`)
}

function th(gender, id) {
  const v=hv(id)
  return wrap(`${envRoom(128)}${envScreen(188,12,102,64)}
${figFront(W*0.34,218,1.25,v)}
${eyeLine(42)}${rof()}
${chrome('TH — Talking Head')}`)
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
  return SHOT_TYPES.map(shot => ({ ...shot, svg: getShotSVG(shot.id, gender) }))
}