// frontend/src/components/companion/MascotOrb.jsx
// The companion entity — a fluid orb that breathes with your voice.
// Not a character with a face. Something more like a presence.
//
// Mood states:
//   idle        → slow breath, warm gold, minimal wobble
//   listening   → responsive to audio level, faster pulse
//   discovery   → bright amber, particle burst, high energy
//   marking     → ripple outward from centre
//   processing  → cool blue tint, scan-line texture
//   offline     → very dim, slow, barely alive
//
// Props:
//   mood        — 'idle' | 'listening' | 'discovery' | 'marking' | 'processing' | 'offline'
//   audioLevel  — 0.0–1.0 from AnalyserNode, drives real-time size/wobble

import { useEffect, useRef } from 'react'

// Read a CSS variable as [r,g,b] at runtime so the orb respects the active theme.
// Falls back to the dark-mode values if the variable isn't set.
function cssVarRgb(varName, fallback) {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(varName).trim()
    // Handle both "r g b" and "#rrggbb" formats
    if (raw.startsWith('#')) {
      const h = raw.slice(1)
      return [
        parseInt(h.slice(0,2), 16),
        parseInt(h.slice(2,4), 16),
        parseInt(h.slice(4,6), 16),
      ]
    }
    const parts = raw.split(/[\s,]+/).map(Number).filter(n => !isNaN(n))
    if (parts.length === 3) return parts
    return fallback
  } catch { return fallback }
}

// Theme-aware colour palettes.
// Dark mode: cool blue-grey tones. Light mode: the same hues but richer/warmer.
// Gold accent always stays gold (it's brand, not UI chrome).
function getMoods() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
  return {
    idle:       { r: 52,  speed: 0.0008, rgb: isDark ? [100, 115, 155] : [130, 140, 180], bloom: 0.20, wobble: 0.06, pulse: 0.010 },
    listening:  { r: 60,  speed: 0.022,  rgb: isDark ? [140, 170, 220] : [100, 130, 210], bloom: 1.20, wobble: 0.70, pulse: 0.16  },
    discovery:  { r: 68,  speed: 0.034,  rgb: [212, 168,  83],                             bloom: 2.00, wobble: 1.30, pulse: 0.28  },
    marking:    { r: 64,  speed: 0.026,  rgb: [212, 168,  83],                             bloom: 1.80, wobble: 0.55, pulse: 0.30  },
    processing: { r: 56,  speed: 0.018,  rgb: isDark ? [ 96, 165, 250] : [ 60, 120, 230], bloom: 1.40, wobble: 0.85, pulse: 0.10  },
    offline:    { r: 42,  speed: 0.0002, rgb: isDark ? [ 55,  58,  70] : [180, 182, 190], bloom: 0.04, wobble: 0.02, pulse: 0.003 },
  }
}

const MOODS = getMoods()

export default function MascotOrb({ mood = 'idle', audioLevel = 0, size = 280 }) {
  const canvasRef  = useRef(null)
  const stateRef   = useRef({
    t:            0,
    energy:       0,
    currentMood:  { ...getMoods().idle },
    targetMood:   { ...getMoods().idle },
    particles:    [],
    ripples:      [],
    scanLine:     0,
    prevMood:     'idle',
  })
  const rafRef     = useRef(null)
  const audioRef   = useRef(0)

  // Keep audio level in a ref for the animation loop (avoids stale closure)
  useEffect(() => { audioRef.current = audioLevel }, [audioLevel])

  // React to mood changes — re-read theme each time so colours stay in sync
  useEffect(() => {
    const s     = stateRef.current
    const moods = getMoods()
    if (mood === s.prevMood) {
      // Even if mood didn't change, refresh the target colours in case theme changed
      s.targetMood = { ...moods[mood] || moods.idle }
      return
    }
    s.prevMood   = mood
    s.targetMood = { ...moods[mood] || moods.idle }
    if (mood === 'discovery') spawnParticles(s, 22)
    if (mood === 'marking')   spawnRipple(s)
  }, [mood])

  // Watch for theme changes (data-theme attribute on <html>) and refresh colours
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const s     = stateRef.current
      const moods = getMoods()
      s.targetMood = { ...moods[s.prevMood] || moods.idle }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Mount canvas and start loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W   = size
    const H   = size
    const cx  = W / 2
    const cy  = H / 2

    function loop() {
      const s = stateRef.current
      ctx.clearRect(0, 0, W, H)

      // Lerp current mood toward target — slower when settling into idle
      const sp = s.prevMood === 'idle' ? 0.008 : 0.032
      const cm = s.currentMood
      const tm = s.targetMood
      cm.r      = lerp(cm.r,      tm.r,      sp)
      cm.bloom  = lerp(cm.bloom,  tm.bloom,  sp)
      cm.wobble = lerp(cm.wobble, tm.wobble, sp * 0.7)
      cm.pulse  = lerp(cm.pulse,  tm.pulse,  sp)
      cm.rgb    = cm.rgb.map((v, i) => lerp(v, tm.rgb[i], sp))

      // Energy from audio level + mood pulse
      // audioLevel is 0–1 from the analyser average — boost it significantly
      // so even quiet speech makes the orb visibly react
      const audioDriven = Math.pow(audioRef.current, 0.6) * 1.2  // curve + amplify
      const moodDriven  = Math.sin(s.t * cm.speed * 200) * cm.pulse
      s.energy = lerp(s.energy, audioDriven + moodDriven, 0.15)  // faster lerp = snappier response

      drawRipples(ctx, s, cx, cy)
      drawOrb(ctx, s, cm, cx, cy, W)
      drawParticles(ctx, s)
      if (mood === 'processing') drawScanLines(ctx, s, cm, cx, cy)

      s.t++
      rafRef.current = requestAnimationFrame(loop)
    }

    loop()
    return () => cancelAnimationFrame(rafRef.current)
  }, [size]) // re-init only if size changes

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ display: 'block', width: size, height: size, background: 'transparent' }}
    />
  )
}

// ─── DRAW ORB ──────────────────────────────────────────────────────────────────

function drawOrb(ctx, s, cm, cx, cy, W) {
  const { r, bloom, wobble, rgb: [rr, rg, rb], speed } = cm
  const energy = s.energy

  // Outer bloom glow — larger radius and higher opacity
  const bloomR = r * (3.2 + bloom * 1.8)
  const grd = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, bloomR)
  grd.addColorStop(0,   `rgba(${rr},${rg},${rb},${0.18 + bloom * 0.14})`)
  grd.addColorStop(0.3, `rgba(${rr},${rg},${rb},${0.08 + bloom * 0.06})`)
  grd.addColorStop(0.6, `rgba(${rr},${rg},${rb},${0.03 + bloom * 0.02})`)
  grd.addColorStop(1,   `rgba(${rr},${rg},${rb},0)`)
  ctx.beginPath()
  ctx.arc(cx, cy, bloomR, 0, Math.PI * 2)
  ctx.fillStyle = grd
  ctx.fill()

  // Audio-reactive pulse ring
  if (s.energy > 0.05) {
    const pr = r + s.energy * r * 0.45
    const pg = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, pr + 4)
    pg.addColorStop(0, `rgba(${rr},${rg},${rb},${s.energy * 0.25})`)
    pg.addColorStop(1, `rgba(${rr},${rg},${rb},0)`)
    ctx.beginPath()
    ctx.arc(cx, cy, pr + 4, 0, Math.PI * 2)
    ctx.fillStyle = pg
    ctx.fill()
  }

  // Morphing blob — 64-point organic shape
  const PTS = 64
  ctx.beginPath()
  for (let i = 0; i <= PTS; i++) {
    const a  = (i / PTS) * Math.PI * 2
    const t  = s.t
    const n1 = Math.sin(a * 3 + t * speed * 75)  * wobble * 4.5
    const n2 = Math.cos(a * 5 + t * speed * 55 + 1.3) * wobble * 2.8
    const n3 = Math.sin(a * 7 + t * speed * 38 + 2.6) * wobble * 1.6
    const n4 = Math.cos(a * 2 + t * speed * 90 + 0.7) * wobble * 1.2   // low-freq sway
    const rad = r + n1 + n2 + n3 + n4 + energy * r * 0.18
    const x  = cx + Math.cos(a) * rad
    const y  = cy + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()

  // Main fill — inner radial gradient
  const fg = ctx.createRadialGradient(
    cx - r * 0.22, cy - r * 0.28, 0,
    cx, cy, r + wobble * 7 + energy * r * 0.18
  )
  fg.addColorStop(0,    `rgba(${rr},${rg},${rb},0.58)`)
  fg.addColorStop(0.50, `rgba(${rr},${rg},${rb},0.22)`)
  fg.addColorStop(1,    `rgba(${rr},${rg},${rb},0.05)`)
  ctx.fillStyle = fg
  ctx.fill()

  // Rim
  ctx.strokeStyle = `rgba(${rr},${rg},${rb},${0.28 + bloom * 0.18})`
  ctx.lineWidth   = 0.75
  ctx.stroke()

  // Specular highlight — moves slightly with wobble
  const hx = cx - r * 0.28 + Math.sin(s.t * speed * 30) * wobble
  const hy = cy - r * 0.30 + Math.cos(s.t * speed * 25) * wobble * 0.5
  ctx.beginPath()
  ctx.ellipse(hx, hy, r * 0.16, r * 0.09, -Math.PI / 5, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(${rr},${rg},${rb},0.32)`
  ctx.fill()

  // Slow inner swirl — 3 orbiting sub-glows
  for (let i = 0; i < 3; i++) {
    const sa  = s.t * speed * 35 + (i / 3) * Math.PI * 2
    const sx  = cx + Math.cos(sa) * r * 0.28
    const sy  = cy + Math.sin(sa) * r * 0.28
    const sg  = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.32)
    sg.addColorStop(0, `rgba(${rr},${rg},${rb},${0.07 + bloom * 0.03})`)
    sg.addColorStop(1, `rgba(${rr},${rg},${rb},0)`)
    ctx.beginPath()
    ctx.arc(sx, sy, r * 0.32, 0, Math.PI * 2)
    ctx.fillStyle = sg
    ctx.fill()
  }
}

// ─── PARTICLES ─────────────────────────────────────────────────────────────────

function spawnParticles(s, n) {
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.55 + Math.random() * 1.55
    s.particles.push({
      x:    0,   // will be offset by cx/cy in draw
      y:    0,
      vx:   Math.cos(angle) * speed,
      vy:   Math.sin(angle) * speed,
      life: 1.0,
      size: 1.4 + Math.random() * 2.6,
      rgb:  Math.random() > 0.5 ? [232, 200, 122] : [200, 184, 154],
    })
  }
}

function drawParticles(ctx, s) {
  const cx = ctx.canvas.width  / 2
  const cy = ctx.canvas.height / 2
  s.particles = s.particles.filter(p => {
    p.x  += p.vx
    p.y  += p.vy
    p.vx *= 0.962
    p.vy *= 0.962
    p.vy += 0.018   // slight gravity
    p.life -= 0.020
    if (p.life <= 0) return false
    const [pr, pg, pb] = p.rgb
    ctx.beginPath()
    ctx.arc(cx + p.x, cy + p.y, p.size * p.life, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${pr},${pg},${pb},${p.life * 0.75})`
    ctx.fill()
    return true
  })
}

// ─── RIPPLES ───────────────────────────────────────────────────────────────────

function spawnRipple(s) {
  s.ripples.push({ r: 0, life: 1.0 })
}

function drawRipples(ctx, s, cx, cy) {
  s.ripples = s.ripples.filter(rp => {
    ctx.beginPath()
    ctx.arc(cx, cy, rp.r, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(160,180,220,${rp.life * 0.35})`
    ctx.lineWidth   = 1.4 * rp.life
    ctx.stroke()
    rp.r    += 3.2
    rp.life -= 0.022
    return rp.life > 0
  })
}

// ─── PROCESSING SCAN LINES ────────────────────────────────────────────────────

function drawScanLines(ctx, s, cm, cx, cy) {
  const r   = cm.r + 14
  const [rr, rg, rb] = cm.rgb
  for (let i = 0; i < 4; i++) {
    const y = cy - r + ((s.scanLine + i * 24) % (r * 2))
    ctx.beginPath()
    ctx.moveTo(cx - r, y)
    ctx.lineTo(cx + r, y)
    ctx.strokeStyle = `rgba(${rr},${rg},${rb},0.055)`
    ctx.lineWidth   = 1
    ctx.stroke()
  }
  s.scanLine = (s.scanLine + 0.72) % (cm.r * 2 + 28)
}

// ─── UTIL ─────────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t }