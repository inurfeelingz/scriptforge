// frontend/src/lib/micDetect.js
// Microphone detection and optimal constraint builder.
// Covers every major brand a creator, podcaster, or musician might use.
//
// Priority order:
//   1. Exact model match (best constraints)
//   2. Brand family match (good constraints)
//   3. Generic USB audio (safe external constraints)
//   4. Built-in mic (conservative constraints)
//
// Key audio principles:
//   External mics have their own preamps — turn off browser processing
//   Built-in mics need EC/NS/AGC to be usable in noisy environments
//   Condenser mics are sensitive — AGC will cause pumping artifacts
//   Dynamic mics handle loud sources — no special treatment needed
//   48kHz is the broadcast standard — request it for any quality mic

// ─── MIC DATABASE ─────────────────────────────────────────────────────────────
// Each entry: { pattern, brand, family, type, sampleRate, stereo, bitrate, notes }
//
// type: 'condenser' | 'dynamic' | 'lavalier' | 'usb-condenser' | 'wireless'
// All sample rates are ideal targets — browser/driver may negotiate lower

export const MIC_DB = [

  // ── DJI ─────────────────────────────────────────────────────────────────────
  // Wireless lav systems. USB-C receiver. Stereo out (L=txA, R=txB).
  {
    pattern:    /dji\s?mic\s?(mini\s?2|2|mini|pro)?/i,
    brand:      'DJI',
    family:     'DJI Mic',
    type:       'wireless',
    sampleRate: 48000,
    stereo:     true,   // L + R = two transmitters or same signal (safety)
    bitrate:    192000,
    notes:      '48kHz wireless lav — disable all processing, sum stereo to mono for analysis',
  },

  // ── Røde ────────────────────────────────────────────────────────────────────
  // Broad product line — USB, wireless, USB-C. All condensers.
  {
    pattern:    /rode\s?(wireless\s?(go|me|pro)|go\s?(ii|2)?)/i,
    brand:      'Røde',
    family:     'Røde Wireless GO',
    type:       'wireless',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    192000,
    notes:      'Wireless lav/clip-on — dual channel stereo output',
  },
  {
    pattern:    /rode\s?(nt(-?usb|mini|1)|podcaster|streamer|reporter)/i,
    brand:      'Røde',
    family:     'Røde USB',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'USB condenser — high quality, disable processing',
  },
  {
    pattern:    /rode/i,
    brand:      'Røde',
    family:     'Røde',
    type:       'condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    160000,
    notes:      'Røde mic — generic match',
  },

  // ── Shure ───────────────────────────────────────────────────────────────────
  // MV series: USB direct. SM series: XLR (won't appear unless via USB interface).
  {
    pattern:    /shure\s?(mv7|mv88|mv51|mv5|motiv)/i,
    brand:      'Shure',
    family:     'Shure MV / Motiv',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'USB condenser — broadcast quality, 48kHz native',
  },
  {
    pattern:    /shure\s?(mv7\+|mv7x)/i,
    brand:      'Shure',
    family:     'Shure MV7+',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'MV7+ has onboard DSP — disable browser processing entirely',
  },
  {
    pattern:    /shure/i,
    brand:      'Shure',
    family:     'Shure',
    type:       'dynamic',
    sampleRate: 44100,
    stereo:     false,
    bitrate:    160000,
    notes:      'Shure generic match',
  },

  // ── Sennheiser / RØDE / Sennheiser Evolution ─────────────────────────────────
  {
    pattern:    /sennheiser\s?(ew|xsw|evolution|avx|mke|memory)/i,
    brand:      'Sennheiser',
    family:     'Sennheiser Wireless',
    type:       'wireless',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'Wireless system — disable processing',
  },
  {
    pattern:    /sennheiser/i,
    brand:      'Sennheiser',
    family:     'Sennheiser',
    type:       'condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    160000,
    notes:      'Sennheiser generic match',
  },

  // ── Sony ────────────────────────────────────────────────────────────────────
  // ECM-W series wireless, ECM-B series USB-C, ECM-S series shotgun
  {
    pattern:    /sony\s?(ecm[-\s]?(w[123]|b[13]|s[13])|ult-mic)/i,
    brand:      'Sony',
    family:     'Sony ECM',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'Sony USB-C mic — 48kHz native, disable processing',
  },
  {
    pattern:    /sony/i,
    brand:      'Sony',
    family:     'Sony',
    type:       'condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    160000,
    notes:      'Sony generic match',
  },

  // ── Blue / Logitech ─────────────────────────────────────────────────────────
  {
    pattern:    /blue\s?(yeti|snowball|baby\s?yeti|ember|spark|nano|compass)/i,
    brand:      'Blue',
    family:     'Blue Yeti / Snowball',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'USB condenser — 48kHz native, very popular podcast/studio mic',
  },
  {
    pattern:    /blue|logitech\s?(blue|for\s?creators)/i,
    brand:      'Blue / Logitech',
    family:     'Blue',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    160000,
    notes:      'Blue/Logitech generic match',
  },

  // ── Audio-Technica ───────────────────────────────────────────────────────────
  {
    pattern:    /audio[\s-]technica\s?(at2020|at2035|at2050|atr2500|atr2100)/i,
    brand:      'Audio-Technica',
    family:     'Audio-Technica AT20xx',
    type:       'usb-condenser',
    sampleRate: 44100,
    stereo:     false,
    bitrate:    160000,
    notes:      '44.1kHz USB mics — studio quality',
  },
  {
    pattern:    /audio[\s-]?technica/i,
    brand:      'Audio-Technica',
    family:     'Audio-Technica',
    type:       'condenser',
    sampleRate: 44100,
    stereo:     false,
    bitrate:    160000,
    notes:      'Audio-Technica generic match',
  },

  // ── Zoom ────────────────────────────────────────────────────────────────────
  // H-series recorders as USB audio interfaces, PodTrak series
  {
    pattern:    /zoom\s?(h[1-9]|podtrack|am7|am8)/i,
    brand:      'Zoom',
    family:     'Zoom H/PodTrak',
    type:       'usb-condenser',
    sampleRate: 44100,
    stereo:     true,
    bitrate:    192000,
    notes:      'Zoom recorder as USB interface — may output stereo',
  },
  {
    pattern:    /zoom/i,
    brand:      'Zoom',
    family:     'Zoom',
    type:       'condenser',
    sampleRate: 44100,
    stereo:     false,
    bitrate:    160000,
    notes:      'Zoom generic match',
  },

  // ── TASCAM ──────────────────────────────────────────────────────────────────
  {
    pattern:    /tascam\s?(dr|us|model|portacapture)/i,
    brand:      'TASCAM',
    family:     'TASCAM',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    192000,
    notes:      'TASCAM recorder/interface',
  },

  // ── Elgato ──────────────────────────────────────────────────────────────────
  {
    pattern:    /elgato\s?(wave|prompter)/i,
    brand:      'Elgato',
    family:     'Elgato Wave',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'Elgato Wave — 48kHz USB-C condenser',
  },

  // ── HyperX ──────────────────────────────────────────────────────────────────
  {
    pattern:    /hyperx\s?(quadcast|duocast|solocast)/i,
    brand:      'HyperX',
    family:     'HyperX QuadCast',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'HyperX USB condenser — 48kHz native',
  },

  // ── SteelSeries ─────────────────────────────────────────────────────────────
  {
    pattern:    /steelseries\s?(alias|arctis)/i,
    brand:      'SteelSeries',
    family:     'SteelSeries Alias',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'SteelSeries Alias — 48kHz USB condenser',
  },

  // ── Razer ───────────────────────────────────────────────────────────────────
  {
    pattern:    /razer\s?(seiren|nari|kraken)/i,
    brand:      'Razer',
    family:     'Razer Seiren',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'Razer Seiren USB condenser',
  },

  // ── FIFINE ──────────────────────────────────────────────────────────────────
  {
    pattern:    /fifine/i,
    brand:      'FIFINE',
    family:     'FIFINE',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    160000,
    notes:      'FIFINE USB condenser',
  },

  // ── Saramonic ───────────────────────────────────────────────────────────────
  // Popular wireless lav systems for videographers
  {
    pattern:    /saramonic\s?(blink|uwmic|vmic|sr)/i,
    brand:      'Saramonic',
    family:     'Saramonic',
    type:       'wireless',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'Saramonic wireless lav — 48kHz, disable processing',
  },

  // ── Hollyland ───────────────────────────────────────────────────────────────
  {
    pattern:    /hollyland\s?(lark|solidcom)/i,
    brand:      'Hollyland',
    family:     'Hollyland Lark',
    type:       'wireless',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    192000,
    notes:      'Hollyland wireless lav — dual channel stereo',
  },

  // ── Deity ───────────────────────────────────────────────────────────────────
  {
    pattern:    /deity\s?(connect|pocket|s-?mic|d-?mob)/i,
    brand:      'Deity',
    family:     'Deity',
    type:       'wireless',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    192000,
    notes:      'Deity wireless mic — 48kHz, disable processing',
  },

  // ── MOVO ────────────────────────────────────────────────────────────────────
  {
    pattern:    /movo/i,
    brand:      'MOVO',
    family:     'MOVO',
    type:       'condenser',
    sampleRate: 44100,
    stereo:     false,
    bitrate:    160000,
    notes:      'MOVO mic',
  },

  // ── Focusrite / Scarlett ─────────────────────────────────────────────────────
  // USB audio interfaces — not mics themselves but the device that appears in browser
  {
    pattern:    /focusrite|scarlett\s?([123]\s?i\s?[234]|solo|clarett)/i,
    brand:      'Focusrite',
    family:     'Scarlett Interface',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    192000,
    notes:      'USB audio interface — mic connected via XLR. Disable all browser processing.',
  },

  // ── Universal Audio ─────────────────────────────────────────────────────────
  {
    pattern:    /universal\s?audio|apollo|volt/i,
    brand:      'Universal Audio',
    family:     'Universal Audio',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    192000,
    notes:      'UA interface — 48kHz, disable all processing',
  },

  // ── MOTU ────────────────────────────────────────────────────────────────────
  {
    pattern:    /motu\s?(m[124]|audio\s?express|traveler|ultralite)/i,
    brand:      'MOTU',
    family:     'MOTU',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    192000,
    notes:      'MOTU interface — professional audio, 48kHz+',
  },

  // ── PreSonus ─────────────────────────────────────────────────────────────────
  {
    pattern:    /presonus\s?(revelator|studio\s?(24|26|1810)|quantum)/i,
    brand:      'PreSonus',
    family:     'PreSonus',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    192000,
    notes:      'PreSonus USB interface',
  },

  // ── M-Audio ──────────────────────────────────────────────────────────────────
  {
    pattern:    /m-audio|m\s?audio/i,
    brand:      'M-Audio',
    family:     'M-Audio',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    160000,
    notes:      'M-Audio interface',
  },

  // ── Behringer ────────────────────────────────────────────────────────────────
  {
    pattern:    /behringer\s?(u-phoria|umc|uphoria|xenyx)/i,
    brand:      'Behringer',
    family:     'Behringer UMC',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     true,
    bitrate:    160000,
    notes:      'Behringer USB interface',
  },

  // ── Generic USB audio (Android, unknown brands) ──────────────────────────────
  // Catch-all for any USB device that didn't match above
  {
    pattern:    /usb\s?(audio|microphone|mic|pnp|class|composite)/i,
    brand:      'USB',
    family:     'USB Audio',
    type:       'usb-condenser',
    sampleRate: 48000,
    stereo:     false,
    bitrate:    160000,
    notes:      'Generic USB audio device — disable processing as a safe default',
  },

  // ── Built-in / AirPods / headphones (last resort) ──────────────────────────
  {
    pattern:    /airpods|earpods|beats|jabra|plantronics|bose|sennheiser\s?(hd|momentum)/i,
    brand:      'Headset',
    family:     'Headset / Earbuds',
    type:       'headset',
    sampleRate: 44100,
    stereo:     false,
    bitrate:    128000,
    notes:      'Headset mic — enable EC/NS since mic is near mouth without isolation',
    keepProcessing: true,  // exception: headset mics benefit from browser processing
  },
]

// ─── DETECT MIC ───────────────────────────────────────────────────────────────

/**
 * Detect the best available microphone from MediaDevices list.
 * Returns the matched mic entry + device info, or a built-in fallback.
 *
 * @param {MediaDeviceInfo[]} devices — from navigator.mediaDevices.enumerateDevices()
 * @returns {{ device, match, isExternal, displayLabel }}
 */
export function detectMic(devices) {
  const mics = devices.filter(d => d.kind === 'audioinput')

  for (const device of mics) {
    const label = device.label || ''
    // Skip default/communications virtual devices
    if (/^default$|communications/i.test(label)) continue

    for (const entry of MIC_DB) {
      if (entry.pattern.test(label)) {
        return {
          device,
          match:        entry,
          isExternal:   true,
          displayLabel: buildLabel(entry, label),
        }
      }
    }
  }

  // No external match — find built-in
  const builtin = mics.find(d => d.label && !/^default$/i.test(d.label))
    || mics[0]

  return {
    device:       builtin || null,
    match:        null,
    isExternal:   false,
    displayLabel: 'Built-in mic',
  }
}

/**
 * Build optimal MediaStream constraints for a detected mic.
 *
 * @param {{ device, match, isExternal }} detection — from detectMic()
 * @returns {MediaStreamConstraints}
 */
export function buildConstraints(detection) {
  const { device, match, isExternal } = detection

  if (!isExternal || !match) {
    // Built-in mic: keep browser processing on
    return {
      audio: {
        deviceId:         device ? { exact: device.deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       { ideal: 44100 },
        channelCount:     { ideal: 1 },
      }
    }
  }

  // External mic: disable browser processing (it has its own preamp)
  // Exception: headset mics flagged with keepProcessing
  const keepProcessing = !!match.keepProcessing

  return {
    audio: {
      deviceId:         { exact: device.deviceId },
      echoCancellation: keepProcessing,
      noiseSuppression: keepProcessing,
      autoGainControl:  false,              // always off for external
      sampleRate:       { ideal: match.sampleRate },
      channelCount:     { ideal: match.stereo ? 2 : 1 },
    }
  }
}

/**
 * Get recording bitrate for a detected mic.
 */
export function getRecordingBitrate(detection) {
  if (!detection.match) return 128000
  return detection.match.bitrate || 160000
}

/**
 * Check if a mic needs stereo-to-mono summing in the analyser.
 */
export function needsStereoSum(detection) {
  return !!(detection.match?.stereo)
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildLabel(entry, rawLabel) {
  // Use the canonical brand+family name, not the raw OS string
  // e.g. "Microphone (DJI Mic Mini 2 (USB Audio))" → "DJI Mic Mini 2"
  if (entry.family !== entry.brand) return entry.family
  return entry.brand
}

/**
 * Get a human-readable description of what was detected — for debug/display.
 */
export function describeMic(detection) {
  if (!detection.isExternal) return 'Built-in microphone'
  const m = detection.match
  if (!m) return 'External microphone'
  return `${m.family} — ${m.type}, ${m.sampleRate / 1000}kHz${m.stereo ? ', stereo' : ''}`
}
