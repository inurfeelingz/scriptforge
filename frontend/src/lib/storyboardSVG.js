// frontend/src/lib/storyboardSVG.js
// SA musician storyboard system — hand-drawn figures, studio environments
// 14 shot types × 2 genders × 3 scenes (daw, piano, wide)
// Each shot is self-contained at 320×180. No clip paths.

const W = 320
const H = 180

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const SK  = '#3D1F0D'   // skin base
const SK2 = '#5a3018'   // skin shadow
const HR  = '#100a06'   // hair
const MJ  = '#1e2840'   // male jacket
const MJ2 = '#283458'   // male jacket highlight
const MSH = '#d8dce8'   // male shirt
const MP  = '#141628'   // male pants
const MSN = '#0c0d18'   // shoes
const FT  = '#8B3A52'   // female top
const FT2 = '#a84865'   // female top highlight
// scene
const WAL = '#242838'   // wall
const WAL2= '#1e2130'   // wall dark
const FLR = '#181a28'   // floor
const DSK = '#1c1e30'   // desk
const MON = '#08090e'   // monitor body
const MSC = '#090c14'   // monitor screen
const SPK = '#0e1020'   // speaker
const PNO = '#0b0c16'   // piano body
const PNO2= '#141628'   // piano lid
const ACR = '#1e2038'   // acoustic panel
const ACR2= '#242648'   // acoustic panel alt

// ─── CHROME ───────────────────────────────────────────────────────────────────
function chrome(label) {
  return `<rect x="0" y="${H-18}" width="${W}" height="18" fill="#0a0c14" opacity="0.97"/>
<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#c8b89a" stroke-width="1.4"/>
<rect x="5" y="5" width="${W-10}" height="${H-28}" fill="none" stroke="#c8b89a" stroke-width="0.35" stroke-dasharray="3 3" opacity="0.2"/>
<text x="7" y="${H-6}" font-family="monospace" font-size="8" fill="#c8b89a" opacity="0.88">${label}</text>`
}
function rof() {
  const ih = H-18
  return `<line x1="${W/3}" y1="0" x2="${W/3}" y2="${ih}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="${W*2/3}" y1="0" x2="${W*2/3}" y2="${ih}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="0" y1="${ih/3}" x2="${W}" y2="${ih/3}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>
<line x1="0" y1="${ih*2/3}" x2="${W}" y2="${ih*2/3}" stroke="#c8b89a" stroke-width="0.25" opacity="0.13"/>`
}
function eyeLine(y) {
  return `<line x1="6" y1="${y}" x2="${W-6}" y2="${y}" stroke="#c8b89a" stroke-width="0.38" stroke-dasharray="4 4" opacity="0.3"/>
<text x="${W-8}" y="${y-3}" font-family="monospace" font-size="6" fill="#c8b89a" opacity="0.36" text-anchor="end">eye line</text>`
}
function wrap(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${content}</svg>`
}
function hv(id) {
  let h=5381; const s=String(id||'x')
  for(let i=0;i<s.length;i++) h=((h<<5)+h)^s.charCodeAt(i)
  return Math.abs(h)&0x7fffffff
}

// ─── STUDIO ENVIRONMENTS ─────────────────────────────────────────────────────
// Each returns SVG string for the background layer

function sceneDAW() {
  // Camera faces creator. DAW monitors visible behind head. Desk+keyboard in frame.
  const kw=13, kh=16 // key dimensions
  const keys=(x,y,n)=>{
    let s=''
    const bpat=[0,1,0,1,0,0,1,0,1,0,1,0] // black key pattern per 12
    for(let i=0;i<n;i++){
      s+=`<rect x="${x+i*kw}" y="${y}" width="${kw-1}" height="${kh}" rx="0.5" fill="#ccc8b4" opacity="0.88"/>`
    }
    for(let i=0;i<n-1;i++){
      if(bpat[i%12]) s+=`<rect x="${x+i*kw+9}" y="${y}" width="8" height="10" rx="0.5" fill="#0a0b14"/>`
    }
    return s
  }
  return `
<rect width="${W}" height="${H}" fill="${WAL}"/>
<rect x="0" y="0" width="${W}" height="142" fill="#242838"/>
<rect x="0" y="142" width="${W}" height="${H-142}" fill="${FLR}"/>
<line x1="0" y1="142" x2="${W}" y2="142" stroke="#c8b89a" stroke-width="0.5" opacity="0.25"/>
<rect x="0"   y="4" width="22" height="128" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.35" opacity="0.3"/>
<rect x="24"  y="4" width="22" height="128" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.35" opacity="0.24"/>
<rect x="274" y="4" width="22" height="128" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.35" opacity="0.24"/>
<rect x="296" y="4" width="22" height="128" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.35" opacity="0.3"/>
<rect x="58" y="18" width="78" height="52" rx="2" fill="${MON}" stroke="#c8b89a" stroke-width="0.6" opacity="0.55"/>
<rect x="61" y="21" width="72" height="46" fill="${MSC}"/>
<rect x="61" y="21" width="72" height="7" fill="#111e2c" opacity="0.9"/>
<line x1="64" y1="34" x2="96" y2="34" stroke="#4a7ab8" stroke-width="4" opacity="0.55"/>
<line x1="64" y1="42" x2="84" y2="42" stroke="#6a48b8" stroke-width="3" opacity="0.45"/>
<line x1="64" y1="50" x2="92" y2="50" stroke="#4a8a68" stroke-width="4" opacity="0.5"/>
<line x1="64" y1="58" x2="78" y2="58" stroke="#8a6838" stroke-width="3" opacity="0.42"/>
<rect x="100" y="28" width="3" height="14" rx="1" fill="#4a7ab8" opacity="0.6"/>
<rect x="105" y="32" width="3" height="10" rx="1" fill="#4a7ab8" opacity="0.5"/>
<rect x="110" y="26" width="3" height="18" rx="1" fill="#4a7ab8" opacity="0.65"/>
<rect x="115" y="30" width="3" height="12" rx="1" fill="#4a7ab8" opacity="0.55"/>
<rect x="120" y="27" width="3" height="16" rx="1" fill="#4a7ab8" opacity="0.6"/>
<line x1="97"  y1="70" x2="97"  y2="80" stroke="#c8b89a" stroke-width="1.1" opacity="0.2"/>
<line x1="86"  y1="80" x2="108" y2="80" stroke="#c8b89a" stroke-width="0.9" opacity="0.16"/>
<rect x="184" y="18" width="78" height="52" rx="2" fill="${MON}" stroke="#c8b89a" stroke-width="0.6" opacity="0.55"/>
<rect x="187" y="21" width="72" height="46" fill="${MSC}"/>
<rect x="187" y="21" width="72" height="7" fill="#111e2c" opacity="0.9"/>
<line x1="190" y1="34" x2="256" y2="34" stroke="#c8b89a" stroke-width="0.7" opacity="0.18"/>
<line x1="190" y1="42" x2="256" y2="42" stroke="#c8b89a" stroke-width="0.7" opacity="0.14"/>
<line x1="190" y1="50" x2="256" y2="50" stroke="#c8b89a" stroke-width="0.7" opacity="0.18"/>
<line x1="190" y1="58" x2="256" y2="58" stroke="#c8b89a" stroke-width="0.7" opacity="0.14"/>
<line x1="223" y1="70" x2="223" y2="80" stroke="#c8b89a" stroke-width="1.1" opacity="0.2"/>
<line x1="212" y1="80" x2="234" y2="80" stroke="#c8b89a" stroke-width="0.9" opacity="0.16"/>
<rect x="10"  y="80" width="26" height="32" rx="2" fill="${SPK}" stroke="#c8b89a" stroke-width="0.5" opacity="0.5"/>
<ellipse cx="23" cy="90" rx="8" ry="8" fill="#0c0e18" stroke="#c8b89a" stroke-width="0.5" opacity="0.55"/>
<ellipse cx="23" cy="90" rx="3.5" ry="3.5" fill="#0a0b14"/>
<ellipse cx="23" cy="104" rx="4" ry="2.8" fill="#0c0e18" stroke="#c8b89a" stroke-width="0.3" opacity="0.4"/>
<rect x="284" y="80" width="26" height="32" rx="2" fill="${SPK}" stroke="#c8b89a" stroke-width="0.5" opacity="0.5"/>
<ellipse cx="297" cy="90" rx="8" ry="8" fill="#0c0e18" stroke="#c8b89a" stroke-width="0.5" opacity="0.55"/>
<ellipse cx="297" cy="90" rx="3.5" ry="3.5" fill="#0a0b14"/>
<ellipse cx="297" cy="104" rx="4" ry="2.8" fill="#0c0e18" stroke="#c8b89a" stroke-width="0.3" opacity="0.4"/>
<rect x="8"  y="114" width="304" height="11" rx="1" fill="${DSK}" stroke="#c8b89a" stroke-width="0.5" opacity="0.5"/>
${keys(52,116,16)}
<rect x="40"  y="114" width="42" height="18" rx="2" fill="#111220" stroke="#c8b89a" stroke-width="0.45" opacity="0.42"/>
<circle cx="50" cy="123" r="4.5" fill="none" stroke="#c8b89a" stroke-width="0.6" opacity="0.38"/>
<circle cx="62" cy="123" r="4.5" fill="none" stroke="#c8b89a" stroke-width="0.6" opacity="0.38"/>
<circle cx="73" cy="123" r="3.5" fill="none" stroke="#c8b89a" stroke-width="0.5" opacity="0.32"/>`
}

function scenePiano() {
  // Camera faces pianist. Piano keyboard in FOREGROUND (bottom of frame). Pianist visible above/behind.
  const bpat=[0,1,0,1,0,0,1,0,1,0,1,0]
  let whites='', blacks=''
  for(let i=0;i<15;i++){
    whites+=`<rect x="${18+i*19}" y="108" width="18" height="30" rx="0.5" fill="#ccc8b4" opacity="0.92"/>`
  }
  for(let i=0;i<14;i++){
    if(bpat[i%12]) blacks+=`<rect x="${28+i*19}" y="108" width="13" height="19" rx="0.5" fill="#0a0b14"/>`
  }
  return `
<rect width="${W}" height="${H}" fill="${WAL}"/>
<rect x="0" y="0" width="${W}" height="138" fill="#242838"/>
<rect x="0" y="138" width="${W}" height="${H-138}" fill="${FLR}"/>
<line x1="0" y1="138" x2="${W}" y2="138" stroke="#c8b89a" stroke-width="0.5" opacity="0.25"/>
<rect x="0"   y="4" width="20" height="122" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.35" opacity="0.28"/>
<rect x="22"  y="4" width="20" height="122" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.35" opacity="0.22"/>
<rect x="278" y="4" width="20" height="122" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.35" opacity="0.22"/>
<rect x="300" y="4" width="20" height="122" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.35" opacity="0.28"/>
<rect x="128" y="16" width="64" height="50" rx="1" fill="#1a1c2e" stroke="#c8b89a" stroke-width="0.5" opacity="0.45"/>
<line x1="136" y1="26" x2="184" y2="26" stroke="#c8b89a" stroke-width="0.5" opacity="0.28"/>
<line x1="136" y1="32" x2="184" y2="32" stroke="#c8b89a" stroke-width="0.5" opacity="0.22"/>
<line x1="136" y1="38" x2="178" y2="38" stroke="#c8b89a" stroke-width="0.5" opacity="0.26"/>
<line x1="136" y1="44" x2="184" y2="44" stroke="#c8b89a" stroke-width="0.5" opacity="0.2"/>
<line x1="136" y1="50" x2="172" y2="50" stroke="#c8b89a" stroke-width="0.5" opacity="0.24"/>
<line x1="160" y1="66" x2="160" y2="76" stroke="#c8b89a" stroke-width="1.4" opacity="0.28"/>
<path d="M0 138 L18 106 L${W-18} 106 L${W} 138 Z" fill="${PNO}" stroke="#c8b89a" stroke-width="0.7" opacity="0.58"/>
<rect x="16" y="102" width="${W-32}" height="7" rx="0.5" fill="#0e0f1c" stroke="#c8b89a" stroke-width="0.5" opacity="0.6"/>
<rect x="14" y="108" width="${W-28}" height="32" rx="1" fill="#181a2c" stroke="#c8b89a" stroke-width="0.55" opacity="0.55"/>
${whites}${blacks}
<path d="M0 138 L18 106 L18 ${H} L0 ${H} Z" fill="#090a14" opacity="0.9"/>`
}

function sceneWide() {
  // Wide shot — full studio. DAW left, piano right, mic centre, figure small centre.
  const bpat=[0,1,0,1,0,0,1,0,1,0,1,0]
  let wk='', bk=''
  for(let i=0;i<9;i++) wk+=`<rect x="${216+i*9}" y="76" width="8" height="13" rx="0.3" fill="#ccc8b4" opacity="0.88"/>`
  for(let i=0;i<8;i++){
    if(bpat[i%12]) bk+=`<rect x="${220+i*9}" y="76" width="6" height="8" rx="0.2" fill="#0a0b14"/>`
  }
  return `
<rect width="${W}" height="${H}" fill="${WAL}"/>
<rect x="0" y="0" width="${W}" height="124" fill="#242838"/>
<rect x="0" y="124" width="${W}" height="${H-124}" fill="${FLR}"/>
<line x1="0" y1="124" x2="${W}" y2="124" stroke="#c8b89a" stroke-width="0.5" opacity="0.25"/>
<line x1="160" y1="124" x2="0"   y2="${H}"   stroke="#c8b89a" stroke-width="0.4" opacity="0.12"/>
<line x1="160" y1="124" x2="${W}" y2="${H}"   stroke="#c8b89a" stroke-width="0.4" opacity="0.12"/>
<rect x="0"   y="4" width="16" height="112" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.3" opacity="0.28"/>
<rect x="18"  y="4" width="16" height="112" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.3" opacity="0.22"/>
<rect x="36"  y="4" width="16" height="112" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.3" opacity="0.25"/>
<rect x="54"  y="4" width="16" height="112" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.3" opacity="0.2"/>
<rect x="234" y="4" width="16" height="112" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.3" opacity="0.2"/>
<rect x="252" y="4" width="16" height="112" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.3" opacity="0.25"/>
<rect x="270" y="4" width="16" height="112" rx="2" fill="${ACR2}" stroke="#c8b89a" stroke-width="0.3" opacity="0.22"/>
<rect x="288" y="4" width="16" height="112" rx="2" fill="${ACR}"  stroke="#c8b89a" stroke-width="0.3" opacity="0.28"/>
<rect x="4"   y="88" width="76" height="8" rx="1" fill="${DSK}" stroke="#c8b89a" stroke-width="0.45" opacity="0.45"/>
<rect x="8"   y="52" width="44" height="38" rx="1" fill="${MON}" stroke="#c8b89a" stroke-width="0.45" opacity="0.48"/>
<rect x="10"  y="54" width="40" height="34" fill="${MSC}"/>
<line x1="13" y1="60" x2="48" y2="60" stroke="#4a7ab8" stroke-width="2" opacity="0.4"/>
<line x1="13" y1="66" x2="42" y2="66" stroke="#6a48b8" stroke-width="1.5" opacity="0.35"/>
<line x1="13" y1="72" x2="46" y2="72" stroke="#4a8a68" stroke-width="2" opacity="0.38"/>
<rect x="6"   y="62" width="7" height="18" rx="1" fill="${SPK}" stroke="#c8b89a" stroke-width="0.28" opacity="0.4"/>
<ellipse cx="9.5" cy="69" rx="2.5" ry="2.5" fill="#0c0e18" stroke="#c8b89a" stroke-width="0.28" opacity="0.5"/>
<rect x="8"   y="90" width="66" height="9" rx="0.5" fill="#1c1e30" stroke="#c8b89a" stroke-width="0.35" opacity="0.4"/>
<rect x="10"  y="91" width="5" height="6" rx="0.3" fill="#ccc8b4" opacity="0.85"/>
<rect x="17"  y="91" width="5" height="6" rx="0.3" fill="#ccc8b4" opacity="0.85"/>
<rect x="24"  y="91" width="5" height="6" rx="0.3" fill="#ccc8b4" opacity="0.85"/>
<rect x="31"  y="91" width="5" height="6" rx="0.3" fill="#ccc8b4" opacity="0.85"/>
<rect x="38"  y="91" width="5" height="6" rx="0.3" fill="#ccc8b4" opacity="0.85"/>
<rect x="13"  y="91" width="3.5" height="4" rx="0.2" fill="#0a0b14"/>
<rect x="27"  y="91" width="3.5" height="4" rx="0.2" fill="#0a0b14"/>
<rect x="41"  y="91" width="3.5" height="4" rx="0.2" fill="#0a0b14"/>
<rect x="210" y="62" width="100" height="62" rx="1" fill="${PNO}" stroke="#c8b89a" stroke-width="0.55" opacity="0.58"/>
<path d="M210 62 L234 34 L310 34 L310 62 Z" fill="${PNO2}" stroke="#c8b89a" stroke-width="0.45" opacity="0.45"/>
<line x1="286" y1="34" x2="298" y2="62" stroke="#c8b89a" stroke-width="0.55" opacity="0.28"/>
<rect x="214" y="74" width="94" height="20" rx="0.5" fill="#181a2c" stroke="#c8b89a" stroke-width="0.38" opacity="0.5"/>
${wk}${bk}
<rect x="214" y="124" width="5" height="14" rx="1" fill="#090a14" opacity="0.8"/>
<rect x="303" y="124" width="5" height="14" rx="1" fill="#090a14" opacity="0.8"/>
<rect x="246" y="128" width="9" height="4" rx="1" fill="#1a1c2e" stroke="#c8b89a" stroke-width="0.28" opacity="0.42"/>
<rect x="259" y="128" width="9" height="4" rx="1" fill="#1a1c2e" stroke="#c8b89a" stroke-width="0.28" opacity="0.42"/>
<line x1="160" y1="124" x2="160" y2="52" stroke="#c8b89a" stroke-width="1.1" opacity="0.28"/>
<line x1="150" y1="82" x2="170" y2="82" stroke="#c8b89a" stroke-width="0.7" opacity="0.18"/>
<ellipse cx="160" cy="50" rx="5.5" ry="8" fill="#0e1020" stroke="#c8b89a" stroke-width="0.65" opacity="0.52"/>`
}

// ─── MALE FIGURE PRIMITIVES ───────────────────────────────────────────────────
// cx=centre, chinY=chin level, s=scale (1=full reference size ~130px tall)

function mHead(cx, chinY, s) {
  const c=cx, y=chinY
  return `
<ellipse cx="${c}" cy="${y-s*24}" rx="${s*20}" ry="${s*26}" fill="${SK}"/>
<path d="M${c-s*20} ${y-s*30} Q${c-s*22} ${y-s*50} ${c-s*14} ${y-s*58} Q${c} ${y-s*64} ${c+s*14} ${y-s*58} Q${c+s*22} ${y-s*50} ${c+s*20} ${y-s*30} Q${c+s*12} ${y-s*46} ${c} ${y-s*44} Q${c-s*12} ${y-s*46} ${c-s*20} ${y-s*30} Z" fill="${HR}"/>
<path d="M${c-s*20} ${y-s*30} Q${c-s*28} ${y-s*40} ${c-s*28} ${y-s*52} Q${c-s*28} ${y-s*60} ${c-s*20} ${y-s*62} Q${c-s*25} ${y-s*54} ${c-s*24} ${y-s*44} Z" fill="${HR}"/>
<path d="M${c+s*20} ${y-s*30} Q${c+s*28} ${y-s*40} ${c+s*28} ${y-s*52} Q${c+s*28} ${y-s*60} ${c+s*20} ${y-s*62} Q${c+s*25} ${y-s*54} ${c+s*24} ${y-s*44} Z" fill="${HR}"/>
<path d="M${c-s*20} ${y-s*22} Q${c-s*26} ${y-s*18} ${c-s*26} ${y-s*10} Q${c-s*26} ${y-s*4} ${c-s*20} ${y-s*1} Q${c-s*24} ${y-s*6} ${c-s*23} ${y-s*14} Z" fill="${SK2}"/>
<path d="M${c+s*20} ${y-s*22} Q${c+s*26} ${y-s*18} ${c+s*26} ${y-s*10} Q${c+s*26} ${y-s*4} ${c+s*20} ${y-s*1} Q${c+s*24} ${y-s*6} ${c+s*23} ${y-s*14} Z" fill="${SK2}"/>
<path d="M${c-s*13} ${y-s*28} Q${c-s*8} ${y-s*34} ${c-s*1} ${y-s*31} Q${c} ${y-s*25} ${c-s*4} ${y-s*21} Q${c-s*8} ${y-s*19} ${c-s*13} ${y-s*23} Z" fill="#0c0e18" opacity="0.92"/>
<path d="M${c+s*1} ${y-s*31} Q${c+s*8} ${y-s*34} ${c+s*13} ${y-s*28} Q${c+s*14} ${y-s*22} ${c+s*10} ${y-s*19} Q${c+s*6} ${y-s*17} ${c+s*1} ${y-s*22} Z" fill="#0c0e18" opacity="0.92"/>
<ellipse cx="${c-s*7}" cy="${y-s*26}" rx="${s*4.5}" ry="${s*4}" fill="#1a0d05"/>
<ellipse cx="${c+s*7}" cy="${y-s*26}" rx="${s*4.5}" ry="${s*4}" fill="#1a0d05"/>
<ellipse cx="${c-s*5}" cy="${y-s*28}" rx="${s*1.8}" ry="${s*1.8}" fill="#e0d8c8" opacity="0.7"/>
<ellipse cx="${c+s*9}" cy="${y-s*28}" rx="${s*1.8}" ry="${s*1.8}" fill="#e0d8c8" opacity="0.7"/>
<path d="M${c-s*17} ${y-s*35} Q${c-s*8} ${y-s*41} ${c-s*1} ${y-s*38}" fill="none" stroke="${HR}" stroke-width="${s*2.8}" stroke-linecap="round"/>
<path d="M${c+s*1} ${y-s*38} Q${c+s*8} ${y-s*41} ${c+s*17} ${y-s*35}" fill="none" stroke="${HR}" stroke-width="${s*2.8}" stroke-linecap="round"/>
<path d="M${c} ${y-s*25} L${c-s*2} ${y-s*14}" fill="none" stroke="${SK2}" stroke-width="${s*1.4}"/>
<path d="M${c-s*7} ${y-s*10} Q${c-s*4} ${y-s*7} ${c} ${y-s*6} Q${c+s*4} ${y-s*7} ${c+s*7} ${y-s*10}" fill="none" stroke="${SK2}" stroke-width="${s*1.3}"/>
<ellipse cx="${c-s*6}" cy="${y-s*11}" rx="${s*4.5}" ry="${s*3}" fill="${SK2}" opacity="0.24"/>
<ellipse cx="${c+s*6}" cy="${y-s*11}" rx="${s*4.5}" ry="${s*3}" fill="${SK2}" opacity="0.24"/>
<path d="M${c-s*9} ${y-s*3} Q${c} ${y+s*2} ${c+s*9} ${y-s*3}" fill="#2a1005" opacity="0.58"/>
<path d="M${c-s*8} ${y-s*3} Q${c} ${y+s*1} ${c+s*8} ${y-s*3}" fill="none" stroke="#1a0804" stroke-width="${s*1.5}"/>`
}

function mNeck(cx, chinY, s) {
  const c=cx, y=chinY
  return `<rect x="${c-s*5}" y="${y}" width="${s*10}" height="${s*14}" rx="${s*4}" fill="${SK2}"/>`
}

function mBody(cx, chinY, s) {
  const c=cx, y=chinY
  return `
<path d="M${c-s*24} ${y+s*70} L${c-s*22} ${y+s*14} L${c+s*22} ${y+s*14} L${c+s*24} ${y+s*70} L${c+s*16} ${y+s*78} L${c} ${y+s*82} L${c-s*16} ${y+s*78} Z" fill="${MJ}"/>
<path d="M${c-s*14} ${y+s*14} L${c-s*12} ${y+s*44} L${c-s*11} ${y+s*70} L${c} ${y+s*70} L${c+s*11} ${y+s*70} L${c+s*12} ${y+s*44} L${c+s*14} ${y+s*14} L${c+s*8} ${y+s*22} L${c} ${y+s*26} L${c-s*8} ${y+s*22} Z" fill="${MJ2}"/>
<path d="M${c-s*4} ${y+s*14} L${c-s*6} ${y+s*44} L${c-s*6} ${y+s*70} L${c+s*6} ${y+s*70} L${c+s*6} ${y+s*44} L${c+s*4} ${y+s*14} Z" fill="${MSH}"/>
<path d="M${c-s*14} ${y+s*14} L${c-s*4} ${y+s*14} L${c-s*8} ${y+s*34} L${c-s*22} ${y+s*26} Z" fill="${MJ}"/>
<path d="M${c+s*14} ${y+s*14} L${c+s*4} ${y+s*14} L${c+s*8} ${y+s*34} L${c+s*22} ${y+s*26} Z" fill="${MJ}"/>
<path d="M${c-s*24} ${y+s*70} L${c-s*32} ${y+s*110} L${c-s*26} ${y+s*116} L${c-s*20} ${y+s*112} L${c-s*16} ${y+s*74} Z" fill="${MJ}"/>
<path d="M${c+s*24} ${y+s*70} L${c+s*32} ${y+s*110} L${c+s*26} ${y+s*116} L${c+s*20} ${y+s*112} L${c+s*16} ${y+s*74} Z" fill="${MJ}"/>
<path d="M${c-s*32} ${y+s*108} Q${c-s*36} ${y+s*114} ${c-s*34} ${y+s*122} Q${c-s*30} ${y+s*128} ${c-s*23} ${y+s*126} Q${c-s*17} ${y+s*120} ${c-s*17} ${y+s*112} Z" fill="${SK}"/>
<path d="M${c+s*32} ${y+s*108} Q${c+s*36} ${y+s*114} ${c+s*34} ${y+s*122} Q${c+s*30} ${y+s*128} ${c+s*23} ${y+s*126} Q${c+s*17} ${y+s*120} ${c+s*17} ${y+s*112} Z" fill="${SK}"/>
<path d="M${c-s*14} ${y+s*82} L${c-s*14} ${y+s*160} L${c-s*8} ${y+s*160} L${c} ${y+s*126} L${c+s*8} ${y+s*160} L${c+s*14} ${y+s*160} L${c+s*14} ${y+s*82} Z" fill="${MP}"/>
<path d="M${c-s*16} ${y+s*158} Q${c-s*22} ${y+s*158} ${c-s*24} ${y+s*162} L${c-s*10} ${y+s*162} Z" fill="${MSN}"/>
<path d="M${c+s*16} ${y+s*158} Q${c+s*22} ${y+s*158} ${c+s*24} ${y+s*162} L${c+s*10} ${y+s*162} Z" fill="${MSN}"/>`
}

// Female figure
function fHead(cx, chinY, s) {
  const c=cx, y=chinY
  return `
<ellipse cx="${c}" cy="${y-s*24}" rx="${s*19}" ry="${s*25}" fill="${SK}"/>
<path d="M${c-s*19} ${y-s*30} Q${c-s*21} ${y-s*50} ${c-s*13} ${y-s*58} Q${c} ${y-s*63} ${c+s*13} ${y-s*58} Q${c+s*21} ${y-s*50} ${c+s*19} ${y-s*30} Q${c+s*11} ${y-s*45} ${c} ${y-s*43} Q${c-s*11} ${y-s*45} ${c-s*19} ${y-s*30} Z" fill="${HR}"/>
<path d="M${c-s*19} ${y-s*30} Q${c-s*27} ${y-s*40} ${c-s*27} ${y-s*52} Q${c-s*27} ${y-s*60} ${c-s*19} ${y-s*62} Q${c-s*23} ${y-s*53} ${c-s*22} ${y-s*43} Z" fill="${HR}"/>
<path d="M${c+s*19} ${y-s*30} Q${c+s*27} ${y-s*40} ${c+s*27} ${y-s*52} Q${c+s*27} ${y-s*60} ${c+s*19} ${y-s*62} Q${c+s*23} ${y-s*53} ${c+s*22} ${y-s*43} Z" fill="${HR}"/>
<path d="M${c-s*19} ${y-s*22} Q${c-s*27} ${y-s*32} ${c-s*25} ${y-s*52}" fill="none" stroke="${HR}" stroke-width="${s*5}" stroke-linecap="round"/>
<path d="M${c-s*16} ${y-s*18} Q${c-s*24} ${y-s*28} ${c-s*22} ${y-s*48}" fill="none" stroke="${HR}" stroke-width="${s*3.5}" stroke-linecap="round"/>
<path d="M${c-s*12} ${y-s*14} Q${c-s*20} ${y-s*22} ${c-s*18} ${y-s*42}" fill="none" stroke="${HR}" stroke-width="${s*2.5}" stroke-linecap="round"/>
<path d="M${c+s*19} ${y-s*22} Q${c+s*27} ${y-s*32} ${c+s*25} ${y-s*52}" fill="none" stroke="${HR}" stroke-width="${s*5}" stroke-linecap="round"/>
<path d="M${c+s*16} ${y-s*18} Q${c+s*24} ${y-s*28} ${c+s*22} ${y-s*48}" fill="none" stroke="${HR}" stroke-width="${s*3.5}" stroke-linecap="round"/>
<path d="M${c+s*12} ${y-s*14} Q${c+s*20} ${y-s*22} ${c+s*18} ${y-s*42}" fill="none" stroke="${HR}" stroke-width="${s*2.5}" stroke-linecap="round"/>
<path d="M${c-s*19} ${y-s*22} Q${c-s*25} ${y-s*18} ${c-s*25} ${y-s*10} Q${c-s*25} ${y-s*4} ${c-s*19} ${y-s*1} Q${c-s*22} ${y-s*6} ${c-s*22} ${y-s*13} Z" fill="${SK2}"/>
<path d="M${c+s*19} ${y-s*22} Q${c+s*25} ${y-s*18} ${c+s*25} ${y-s*10} Q${c+s*25} ${y-s*4} ${c+s*19} ${y-s*1} Q${c+s*22} ${y-s*6} ${c+s*22} ${y-s*13} Z" fill="${SK2}"/>
<circle cx="${c-s*24}" cy="${y-s*9}" r="${s*3.5}" fill="#c8a840" opacity="0.88"/>
<circle cx="${c+s*24}" cy="${y-s*9}" r="${s*3.5}" fill="#c8a840" opacity="0.88"/>
<path d="M${c-s*13} ${y-s*28} Q${c-s*8} ${y-s*34} ${c-s*1} ${y-s*31} Q${c} ${y-s*25} ${c-s*4} ${y-s*21} Q${c-s*8} ${y-s*19} ${c-s*13} ${y-s*23} Z" fill="#0c0e18" opacity="0.92"/>
<path d="M${c+s*1} ${y-s*31} Q${c+s*8} ${y-s*34} ${c+s*13} ${y-s*28} Q${c+s*14} ${y-s*22} ${c+s*10} ${y-s*19} Q${c+s*6} ${y-s*17} ${c+s*1} ${y-s*22} Z" fill="#0c0e18" opacity="0.92"/>
<ellipse cx="${c-s*7}" cy="${y-s*26}" rx="${s*4.5}" ry="${s*4}" fill="#1a0d05"/>
<ellipse cx="${c+s*7}" cy="${y-s*26}" rx="${s*4.5}" ry="${s*4}" fill="#1a0d05"/>
<ellipse cx="${c-s*5}" cy="${y-s*28}" rx="${s*1.8}" ry="${s*1.8}" fill="#e0d8c8" opacity="0.7"/>
<ellipse cx="${c+s*9}" cy="${y-s*28}" rx="${s*1.8}" ry="${s*1.8}" fill="#e0d8c8" opacity="0.7"/>
<path d="M${c-s*17} ${y-s*36} Q${c-s*7} ${y-s*43} ${c+s*1} ${y-s*39}" fill="none" stroke="${HR}" stroke-width="${s*3.2}" stroke-linecap="round"/>
<path d="M${c-s*1} ${y-s*39} Q${c+s*7} ${y-s*43} ${c+s*17} ${y-s*36}" fill="none" stroke="${HR}" stroke-width="${s*3.2}" stroke-linecap="round"/>
<path d="M${c} ${y-s*25} L${c-s*2} ${y-s*14}" fill="none" stroke="${SK2}" stroke-width="${s*1.4}"/>
<path d="M${c-s*7} ${y-s*10} Q${c-s*4} ${y-s*7} ${c} ${y-s*6} Q${c+s*4} ${y-s*7} ${c+s*7} ${y-s*10}" fill="none" stroke="${SK2}" stroke-width="${s*1.3}"/>
<ellipse cx="${c-s*6}" cy="${y-s*11}" rx="${s*4.5}" ry="${s*3}" fill="${SK2}" opacity="0.24"/>
<ellipse cx="${c+s*6}" cy="${y-s*11}" rx="${s*4.5}" ry="${s*3}" fill="${SK2}" opacity="0.24"/>
<path d="M${c-s*9} ${y-s*3} Q${c} ${y+s*3} ${c+s*9} ${y-s*3}" fill="#8B3A52" opacity="0.7"/>
<path d="M${c-s*8} ${y-s*3} Q${c} ${y+s*1} ${c+s*8} ${y-s*3}" fill="none" stroke="#6a2438" stroke-width="${s*1.7}"/>`
}

function fBody(cx, chinY, s) {
  const c=cx, y=chinY
  return `
<rect x="${c-s*5}" y="${y}" width="${s*10}" height="${s*14}" rx="${s*4}" fill="${SK2}"/>
<path d="M${c-s*24} ${y+s*70} L${c-s*22} ${y+s*14} L${c+s*22} ${y+s*14} L${c+s*24} ${y+s*70} L${c+s*16} ${y+s*78} L${c} ${y+s*82} L${c-s*16} ${y+s*78} Z" fill="${FT}"/>
<path d="M${c-s*14} ${y+s*14} L${c-s*12} ${y+s*44} L${c-s*11} ${y+s*70} L${c} ${y+s*70} L${c+s*11} ${y+s*70} L${c+s*12} ${y+s*44} L${c+s*14} ${y+s*14} L${c+s*8} ${y+s*22} L${c} ${y+s*26} L${c-s*8} ${y+s*22} Z" fill="${FT2}"/>
<path d="M${c-s*14} ${y+s*14} L${c-s*4} ${y+s*14} L${c-s*8} ${y+s*34} L${c-s*22} ${y+s*26} Z" fill="${FT}"/>
<path d="M${c+s*14} ${y+s*14} L${c+s*4} ${y+s*14} L${c+s*8} ${y+s*34} L${c+s*22} ${y+s*26} Z" fill="${FT}"/>
<path d="M${c-s*24} ${y+s*70} L${c-s*32} ${y+s*110} L${c-s*26} ${y+s*116} L${c-s*20} ${y+s*112} L${c-s*16} ${y+s*74} Z" fill="${FT}"/>
<path d="M${c+s*24} ${y+s*70} L${c+s*32} ${y+s*110} L${c+s*26} ${y+s*116} L${c+s*20} ${y+s*112} L${c+s*16} ${y+s*74} Z" fill="${FT}"/>
<path d="M${c-s*32} ${y+s*108} Q${c-s*36} ${y+s*114} ${c-s*34} ${y+s*122} Q${c-s*30} ${y+s*128} ${c-s*23} ${y+s*126} Q${c-s*17} ${y+s*120} ${c-s*17} ${y+s*112} Z" fill="${SK}"/>
<path d="M${c+s*32} ${y+s*108} Q${c+s*36} ${y+s*114} ${c+s*34} ${y+s*122} Q${c+s*30} ${y+s*128} ${c+s*23} ${y+s*126} Q${c+s*17} ${y+s*120} ${c+s*17} ${y+s*112} Z" fill="${SK}"/>
<path d="M${c-s*14} ${y+s*80} L${c-s*20} ${y+s*162} L${c-s*10} ${y+s*162} L${c} ${y+s*128} L${c+s*10} ${y+s*162} L${c+s*20} ${y+s*162} L${c+s*14} ${y+s*80} Z" fill="${FT}"/>
<path d="M${c-s*18} ${y+s*158} Q${c-s*24} ${y+s*158} ${c-s*26} ${y+s*162} L${c-s*8} ${y+s*162} Z" fill="#3a2418" opacity="0.8"/>
<path d="M${c+s*18} ${y+s*158} Q${c+s*24} ${y+s*158} ${c+s*26} ${y+s*162} L${c+s*8} ${y+s*162} Z" fill="#3a2418" opacity="0.8"/>`
}

// ─── SHOT GENERATORS ─────────────────────────────────────────────────────────
// scene: 'daw'|'piano'|'wide' — picked by hv hash from instanceId

function pickScene(id) {
  const n = hv(id) % 3
  return ['daw','piano','wide'][n]
}

function getScene(scene) {
  if(scene==='piano') return scenePiano()
  if(scene==='wide')  return sceneWide()
  return sceneDAW()
}

function figure(gender, cx, chinY, s) {
  if(gender==='female') return fHead(cx,chinY,s)+fBody(cx,chinY,s)
  return mHead(cx,chinY,s)+mNeck(cx,chinY,s)+mBody(cx,chinY,s)
}

// ECU — face only, no environment needed
function ecu(gender, id) {
  const cx=W/2, cy=90
  const head = gender==='female'
    ? fHead(cx,cy+26*1.8,1.8)
    : mHead(cx,cy+26*1.8,1.8)+mNeck(cx,cy+26*1.8,1.8)
  return wrap(`
<rect width="${W}" height="${H}" fill="#1a1c28"/>
<rect x="0" y="0" width="60" height="${H-18}" fill="#0e0f18" opacity="0.55"/>
<rect x="${W-60}" y="0" width="60" height="${H-18}" fill="#0e0f18" opacity="0.55"/>
${head}
${chrome('ECU — Extreme Close-Up')}${rof()}`)
}

// CU — head + shoulders, DAW scene
function cu(gender, id) {
  const scene = pickScene(id)
  const chinY = H-18
  const s = 0.72
  return wrap(`
${getScene(scene)}
${figure(gender, W/2, chinY, s)}
${eyeLine(chinY - s*50)}
${chrome('CU — Close-Up')}`)
}

// MCU — chest up
function mcu(gender, id) {
  const scene = pickScene(id)
  const chinY = H+10
  const s = 0.62
  return wrap(`
${getScene(scene)}
${figure(gender, W/2, chinY, s)}
${eyeLine(chinY - s*50)}
${chrome('MCU — Medium Close-Up')}${rof()}`)
}

// MS — waist up
function ms(gender, id) {
  const scene = pickScene(id)
  const chinY = H+40
  const s = 0.46
  return wrap(`
${getScene(scene)}
${figure(gender, W/2, chinY, s)}
${eyeLine(chinY - s*50)}
${chrome('MS — Medium Shot')}`)
}

// MWS — knees up
function mws(gender, id) {
  const scene = pickScene(id)
  const chinY = H+80
  const s = 0.36
  return wrap(`
${getScene(scene)}
${figure(gender, W/2, chinY, s)}
${chrome('MWS — Medium Wide')}`)
}

// WS — full body
function ws(gender, id) {
  const chinY = H-18+162*0.36
  const s = 0.26
  return wrap(`
${sceneWide()}
${figure(gender, W/2, chinY, s)}
${chrome('WS — Wide Shot')}`)
}

// EWS — tiny figure, vast space
function ews(gender, id) {
  const chinY = H-18+162*0.22
  const s = 0.14
  return wrap(`
${sceneWide()}
${figure(gender, W/2, chinY, s)}
${chrome('EWS — Extreme Wide')}`)
}

// OTS
function ots(gender, id) {
  const scene = pickScene(id)
  const opp = gender==='female'?'male':'female'
  const subjChinY = H+30, sS=0.5
  const backChinY = H-18+162*0.55, bS=0.55
  return wrap(`
${getScene(scene)}
${figure(opp, W*0.65, subjChinY, sS)}
<g opacity="0.9">
<path d="M${W*0.04} ${H-18} L${W*0.06} ${H*0.22} Q${W*0.14} ${H*0.04} ${W*0.28} ${H*0.02} Q${W*0.4} ${H*0.0} ${W*0.46} ${H*0.08} L${W*0.48} ${H-18} Z" fill="#1a1828" opacity="0.95"/>
<path d="M${W*0.12} ${H*0.08} Q${W*0.1} ${H*0.02} ${W*0.22} ${H*0} Q${W*0.32} ${H*0} ${W*0.42} ${H*0.06} Q${W*0.46} ${H*0.1} ${W*0.46} ${H*0.16} Q${W*0.38} ${H*0.06} ${W*0.26} ${H*0.06} Q${W*0.16} ${H*0.06} ${W*0.12} ${H*0.1} Z" fill="#0e0c1e"/>
</g>
<line x1="${W*0.4}" y1="${H*0.18}" x2="${W*0.58}" y2="${H*0.16}" stroke="#c8b89a" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.36"/>
${chrome('OTS — Over The Shoulder')}`)
}

// TWO
function two(gender, id) {
  const scene = pickScene(id)
  const opp = gender==='female'?'male':'female'
  const chinY = H+30, s=0.44
  return wrap(`
${getScene(scene)}
${figure(gender, W*0.28, chinY, s)}
${figure(opp, W*0.72, chinY, s)}
<line x1="${W/2}" y1="0" x2="${W/2}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.4" opacity="0.18"/>
${chrome('TWO — Two Shot')}`)
}

// LOW
function low(gender, id) {
  const scene = pickScene(id)
  const chinY = H+20, s=0.52
  return wrap(`
<rect width="${W}" height="${H}" fill="#1e2030"/>
<rect x="0" y="0" width="${W}" height="22" fill="#252840"/>
<line x1="0" y1="22" x2="${W}" y2="22" stroke="#c8b89a" stroke-width="0.5" opacity="0.25"/>
<rect x="0" y="22" width="${W}" height="${H-22}" fill="${WAL}"/>
<line x1="0" y1="${H-18}" x2="${W/2}" y2="22" stroke="#c8b89a" stroke-width="0.4" opacity="0.13"/>
<line x1="${W}" y1="${H-18}" x2="${W/2}" y2="22" stroke="#c8b89a" stroke-width="0.4" opacity="0.13"/>
<text x="${W-10}" y="18" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.5" text-anchor="end">↑ cam</text>
<g transform="scale(1.1,0.94) translate(${-(W*0.05)},6)">
${figure(gender, W/2, chinY, s)}
</g>
${chrome('LOW — Low Angle')}`)
}

// HIGH
function high(gender, id) {
  const scene = pickScene(id)
  const chinY = H+10, s=0.42
  return wrap(`
${getScene(scene)}
<line x1="${W*0.18}" y1="102" x2="${W*0.08}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W*0.5}"  y1="102" x2="${W*0.5}"  y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<line x1="${W*0.82}" y1="102" x2="${W*0.92}" y2="${H-18}" stroke="#c8b89a" stroke-width="0.3" opacity="0.1"/>
<text x="${W-10}" y="14" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.5" text-anchor="end">↓ cam</text>
<g transform="scale(1,0.8) translate(0,16)">
${figure(gender, W/2, chinY, s)}
</g>
${chrome('HIGH — High Angle')}`)
}

// DUTCH
function dutch(gender, id) {
  const scene = pickScene(id)
  const chinY = H+20, s=0.48, cx=W/2, cy=(H-18)/2
  return wrap(`
<rect width="${W}" height="${H}" fill="#1e2030"/>
<g transform="rotate(-14,${cx},${cy})">
${getScene(scene)}
${figure(gender, W/2, chinY, s)}
</g>
<line x1="0" y1="${H*0.2}" x2="${W}" y2="${H*0.44}" stroke="#c8b89a" stroke-width="0.4" opacity="0.14"/>
<text x="${W-10}" y="14" font-family="monospace" font-size="7" fill="#c8b89a" opacity="0.5" text-anchor="end">⟳ dutch</text>
${chrome('DUTCH — Dutch Angle')}`)
}

// POV — what the creator sees at their desk
function pov(gender, id) {
  return wrap(`
${sceneDAW()}
<circle cx="${W/2}" cy="56" r="6" fill="none" stroke="#c8b89a" stroke-width="0.65" opacity="0.44"/>
<line x1="${W/2-12}" y1="56" x2="${W/2+12}" y2="56" stroke="#c8b89a" stroke-width="0.5" opacity="0.44"/>
<line x1="${W/2}" y1="44" x2="${W/2}" y2="68" stroke="#c8b89a" stroke-width="0.5" opacity="0.44"/>
${chrome('POV — Point of View')}`)
}

// TH — talking head, figure offset left, screen right
function th(gender, id) {
  const scene = pickScene(id)
  const chinY = H+10, s=0.62
  return wrap(`
${getScene(scene)}
${figure(gender, W*0.34, chinY, s)}
${eyeLine(chinY - s*50)}${rof()}
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

export function getShotSVG(shotId, gender='male', instanceId='') {
  const gen = GENERATORS[shotId]
  if (!gen) return null
  return gen(gender, instanceId || `${shotId}-${gender}`)
}

export function getAllShots(gender='male') {
  return SHOT_TYPES.map(shot => ({ ...shot, svg: getShotSVG(shot.id, gender) }))
}