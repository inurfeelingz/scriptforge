// frontend/src/pages/SettingsPage.jsx
import { useState, useEffect } from 'react'
import { Zap, Send, Check, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { users as usersApi, categories as catApi, episodes as episodesApi, testWebhook } from '../lib/api'

export default function SettingsPage() {
  const { profile, setProfile, activeCategoryId, activeCategory, notify, theme, setTheme } = useStore()
  const cat = activeCategory?.()

  const [name,           setName]          = useState(profile?.display_name || '')
  const [saving,         setSaving]        = useState(false)
  const [savingVoice,    setSavingVoice]   = useState(false)
  const [webhookTesting, setWebhookTesting]= useState(false)
  const [webhookStatus,  setWebhookStatus] = useState(null)   // null | 'ok' | 'error'
  const [usage,          setUsage]         = useState(null)

  // Load usage stats on mount
  useEffect(() => {
    episodesApi.usage()
      .then(data => setUsage(data))
      .catch(() => {})
  }, [])

  // Voice profile fields
  const vp = cat?.voice_profile || {}
  const vc = vp.voiceCharacteristics  || {}
  const sp = vp.structuralPatterns    || {}
  const lf = vp.languageFingerprint   || {}

  const [voice, setVoice] = useState({
    sentenceLengthPattern: vc.sentenceLengthPattern || '',
    typicalSentenceLength: vc.typicalSentenceLength || '',
    rhythmNote:            vc.rhythmNote            || '',
    vocabularyLevel:       vc.vocabularyLevel       || '',
    hookStyle:             sp.hookStyle             || '',
    revealBuildPattern:    sp.revealBuildPattern    || '',
    openLoopStyle:         sp.openLoopStyle         || '',
    ctaStyle:              sp.ctaStyle              || '',
    transitionPhrases:     (sp.transitionPhrases    || []).join(', '),
    signaturePhrases:      (lf.signaturePhrases     || []).join(', '),
    sentenceOpeners:       (lf.sentenceOpeners      || []).join(', '),
    rhetoricalDevices:     (lf.rhetoricalDevices    || []).join(', '),
    avoidPhrases:          (lf.avoidPhrases         || []).join(', '),
    humourStyle:           lf.humourStyle           || '',
    storytellingStyle:     lf.storytellingStyle     || '',
  })

  useEffect(() => {
    const vp2 = cat?.voice_profile || {}
    const vc2 = vp2.voiceCharacteristics || {}
    const sp2 = vp2.structuralPatterns   || {}
    const lf2 = vp2.languageFingerprint  || {}
    setVoice({
      sentenceLengthPattern: vc2.sentenceLengthPattern || '',
      typicalSentenceLength: vc2.typicalSentenceLength || '',
      rhythmNote:            vc2.rhythmNote            || '',
      vocabularyLevel:       vc2.vocabularyLevel       || '',
      hookStyle:             sp2.hookStyle             || '',
      revealBuildPattern:    sp2.revealBuildPattern    || '',
      openLoopStyle:         sp2.openLoopStyle         || '',
      ctaStyle:              sp2.ctaStyle              || '',
      transitionPhrases:     (sp2.transitionPhrases    || []).join(', '),
      signaturePhrases:      (lf2.signaturePhrases     || []).join(', '),
      sentenceOpeners:       (lf2.sentenceOpeners      || []).join(', '),
      rhetoricalDevices:     (lf2.rhetoricalDevices    || []).join(', '),
      avoidPhrases:          (lf2.avoidPhrases         || []).join(', '),
      humourStyle:           lf2.humourStyle           || '',
      storytellingStyle:     lf2.storytellingStyle     || '',
    })
  }, [activeCategoryId])

  const csv = s => s.split(',').map(x => x.trim()).filter(Boolean)

  async function saveProfile() {
    setSaving(true)
    try {
      const { profile: updated } = await usersApi.updateProfile({ displayName: name })
      setProfile(updated)
      notify('Profile saved', 'success')
    } catch (err) { notify(err.message, 'error') }
    setSaving(false)
  }

  async function saveVoiceProfile() {
    if (!activeCategoryId) return
    setSavingVoice(true)
    try {
      await catApi.update(activeCategoryId, {
        voice_profile: {
          voiceCharacteristics: {
            sentenceLengthPattern: voice.sentenceLengthPattern,
            typicalSentenceLength: voice.typicalSentenceLength,
            rhythmNote:            voice.rhythmNote,
            vocabularyLevel:       voice.vocabularyLevel,
          },
          structuralPatterns: {
            hookStyle:          voice.hookStyle,
            revealBuildPattern: voice.revealBuildPattern,
            openLoopStyle:      voice.openLoopStyle,
            ctaStyle:           voice.ctaStyle,
            transitionPhrases:  csv(voice.transitionPhrases),
          },
          languageFingerprint: {
            signaturePhrases:  csv(voice.signaturePhrases),
            sentenceOpeners:   csv(voice.sentenceOpeners),
            rhetoricalDevices: csv(voice.rhetoricalDevices),
            avoidPhrases:      csv(voice.avoidPhrases),
            humourStyle:       voice.humourStyle,
            storytellingStyle: voice.storytellingStyle,
          },
        }
      })
      notify('Voice profile saved', 'success')
    } catch (err) { notify(err.message, 'error') }
    setSavingVoice(false)
  }

  async function sendTestWebhook() {
    setWebhookTesting(true)
    setWebhookStatus(null)
    try {
      await testWebhook()
      setWebhookStatus('ok')
      notify('Test notification sent', 'success')
    } catch (err) {
      setWebhookStatus('error')
      notify('Webhook failed: ' + err.message, 'error')
    }
    setWebhookTesting(false)
  }

  const TIERS = {
    free:   { label: 'Free',      episodes: '8/mo',      categories: '3'         },
    pro:    { label: 'Pro',       episodes: '30/mo',     categories: '10'        },
    studio: { label: 'Studio',    episodes: 'Unlimited', categories: 'Unlimited' },
  }
  const tier = TIERS[profile?.tier || 'free']

  // ── Shared field component ──────────────────────────────────────────────────
  const Field = ({ label, k, placeholder, hint, wide }) => (
    <div className={`space-y-1 ${wide ? 'col-span-2' : ''}`}>
      <label className="text-xs text-[#666] uppercase tracking-wide">{label}</label>
      {hint && <div className="text-[10px] text-[#444]">{hint}</div>}
      <input
        value={voice[k]}
        onChange={e => setVoice(v => ({ ...v, [k]: e.target.value }))}
        placeholder={placeholder}
        className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40 transition-colors"
      />
    </div>
  )

  // ── Section wrapper ─────────────────────────────────────────────────────────
  const Section = ({ title, children, subtitle }) => (
    <div className="border border-[#1a1a1a] rounded-lg p-6 space-y-5">
      <div>
        <h2 className="text-sm text-[#888]">{title}</h2>
        {subtitle && <p className="text-xs text-[#444] mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-serif text-[#f0ede8]">Settings</h1>

      {/* ── Profile ───────────────────────────────────────────────────────── */}
      <Section title="Profile">
        <div className="space-y-1">
          <label className="text-xs text-[#666]">Display name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveProfile()}
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] outline-none focus:border-[#c8b89a]/40 transition-colors"
          />
        </div>
        <div className="text-xs text-[#444]">Email: {profile?.email}</div>
        <button
          onClick={saveProfile}
          disabled={saving}
          className="px-4 py-2 bg-[#c8b89a]/10 border border-[#c8b89a]/20 text-[#c8b89a] rounded text-sm hover:bg-[#c8b89a]/20 disabled:opacity-40 transition-all"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </Section>

      {/* ── Voice profile ─────────────────────────────────────────────────── */}
      {activeCategoryId && (
        <Section
          title={`Voice profile — ${cat?.name || ''}`}
          subtitle="The more specific you are here, the more Claude writes in your actual voice rather than generic documentary style."
        >
          <div className="space-y-1 pb-1">
            <div className="text-xs text-[#c8b89a] uppercase tracking-wide font-medium">Sentence patterns</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field k="sentenceLengthPattern"  label="Length pattern"       placeholder="short punchy bursts then longer reflective ones" />
            <Field k="typicalSentenceLength"  label="Typical length"       placeholder="8–12 words" />
            <Field k="rhythmNote"             label="Rhythm"               placeholder="builds slowly then releases with a short punchy line" />
            <Field k="vocabularyLevel"        label="Vocabulary level"     placeholder="conversational, no jargon" />
          </div>

          <div className="space-y-1 pt-3 pb-1 border-t border-[#111]">
            <div className="text-xs text-[#c8b89a] uppercase tracking-wide font-medium">Structure</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field k="hookStyle"              label="Hook style"           placeholder="drops straight into the action" />
            <Field k="revealBuildPattern"     label="Build to reveal"      placeholder="plants a detail early, pays it off two minutes later" />
            <Field k="openLoopStyle"          label="Open loop"            placeholder="asks a question, answers it halfway through" />
            <Field k="ctaStyle"               label="CTA style"            placeholder="low pressure, single ask at the very end" />
          </div>

          <div className="space-y-1 pt-3 pb-1 border-t border-[#111]">
            <div className="text-xs text-[#c8b89a] uppercase tracking-wide font-medium">Language fingerprint — comma-separated</div>
          </div>
          <div className="space-y-4">
            <Field k="signaturePhrases"   label="Signature phrases"       placeholder="and that's when it clicked, I wasn't expecting that" hint="Phrases that sound unmistakably like you" wide />
            <Field k="sentenceOpeners"    label="Characteristic openers"  placeholder="So, The thing is, Which meant that, And then" hint="How you tend to start sentences" wide />
            <Field k="rhetoricalDevices"  label="Rhetorical devices"      placeholder="rhetorical questions, callbacks, rule of three" wide />
            <Field k="avoidPhrases"       label="Phrases to AVOID"        placeholder="dive deep, let's unpack, game-changer, journey" hint="Clichés that don't sound like you — Claude will actively avoid these" wide />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field k="humourStyle"        label="Humour style"            placeholder="dry, self-deprecating, timing-based" />
            <Field k="storytellingStyle"  label="Storytelling style"      placeholder="personal, first-person, present tense" />
          </div>

          <button
            onClick={saveVoiceProfile}
            disabled={savingVoice}
            className="w-full py-2.5 bg-[#c8b89a]/10 border border-[#c8b89a]/20 text-[#c8b89a] rounded text-sm hover:bg-[#c8b89a]/20 disabled:opacity-40 transition-all"
          >
            {savingVoice ? 'Saving...' : 'Save voice profile'}
          </button>
        </Section>
      )}

      {/* ── Plan ──────────────────────────────────────────────────────────── */}
      <Section title="Plan">
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full border text-sm ${
            profile?.tier === 'studio' ? 'border-[#c8b89a]/40 text-[#c8b89a]' :
            profile?.tier === 'pro'    ? 'border-blue-500/40 text-blue-400' :
            'border-[#333] text-[#555]'
          }`}>{tier?.label}</span>
          <span className="text-xs text-[#444]">{tier?.episodes} · {tier?.categories} categories</span>
        </div>
        <div className="text-xs text-[#444]">
          Episodes this month: {profile?.episodes_this_month || 0} / {profile?.max_episodes_pm || 8}
        </div>
      </Section>

      {/* ── Usage & cost ──────────────────────────────────────────────────── */}
      {usage && (
        <Section title="Usage this month" subtitle="Estimated Claude API cost based on token usage. Resets on the 1st.">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Episodes generated', value: usage.episodesThisMonth },
              { label: 'Tokens used',         value: ((usage.inputTokens + usage.outputTokens) / 1000).toFixed(1) + 'k' },
              { label: 'Estimated cost',       value: '$' + usage.estimatedCostUsd.toFixed(3) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-[#0a0a0a] border border-[#111] rounded p-3">
                <div className="text-[10px] text-[#444] uppercase tracking-wide mb-1">{label}</div>
                <div className="text-lg font-serif text-[#c8b89a]">{value}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#333]">
            Based on claude-sonnet pricing. Input: $0.003/1k tokens · Output: $0.015/1k tokens.
            Actual billing is between you and Anthropic — check your API dashboard for exact figures.
          </p>
        </Section>
      )}

      {/* ── Notifications ─────────────────────────────────────────────────── */}
      <Section
        title="Notifications"
        subtitle="Get a message in Discord or Slack when a generation completes, even if you've closed the tab."
      >
        <div className="space-y-2">
          <div className="text-xs text-[#555]">
            Set <code className="bg-[#111] px-1 rounded text-[#c8b89a]">DISCORD_WEBHOOK_URL</code> or{' '}
            <code className="bg-[#111] px-1 rounded text-[#c8b89a]">SLACK_WEBHOOK_URL</code> in your Railway backend environment variables.
          </div>
          <button
            onClick={sendTestWebhook}
            disabled={webhookTesting}
            className="flex items-center gap-2 px-4 py-2 border border-[#1a1a1a] rounded text-sm text-[#555] hover:text-[#c8b89a] hover:border-[#c8b89a]/20 disabled:opacity-40 transition-all"
          >
            {webhookTesting ? (
              <div className="w-3 h-3 border border-[#555] border-t-transparent rounded-full animate-spin"/>
            ) : webhookStatus === 'ok' ? (
              <Check size={13} className="text-[#40a060]"/>
            ) : webhookStatus === 'error' ? (
              <AlertCircle size={13} className="text-red-400"/>
            ) : (
              <Send size={13}/>
            )}
            {webhookTesting ? 'Sending...' : webhookStatus === 'ok' ? 'Sent successfully' : 'Send test notification'}
          </button>
        </div>
      </Section>

      {/* ── Appearance ────────────────────────────────────────────────────── */}
      <Section title="Appearance">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[#ccc]">Theme</div>
            <div className="text-xs text-[#444] mt-0.5">Dim is recommended for most environments</div>
          </div>
          <div className="flex gap-2">
            {[
              { key: 'dark', label: 'Dark' },
              { key: 'dim',  label: 'Dim'  },
              { key: 'light',label: 'Light' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTheme(key)}
                className={`px-4 py-1.5 rounded border text-xs capitalize transition-all ${
                  theme === key
                    ? 'border-[#c8b89a]/40 text-[#c8b89a] bg-[#c8b89a]/5'
                    : 'border-[#1a1a1a] text-[#555] hover:border-[#333] hover:text-[#888]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Keyboard shortcuts ────────────────────────────────────────────── */}
      <Section title="Keyboard shortcuts">
        {[
          ['Teleprompter', 'Space = play/pause · ↑↓ = speed · R = restart'],
          ['Generate',     'Cmd+Enter = generate · Tab between fields'],
          ['Chat',         'Enter = send · Shift+Enter = new line'],
          ['Vault',        'Click Select to enter bulk mode'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-4 text-xs">
            <span className="text-[#555] w-24 shrink-0">{k}</span>
            <span className="text-[#444]">{v}</span>
          </div>
        ))}
      </Section>
    </div>
  )
}