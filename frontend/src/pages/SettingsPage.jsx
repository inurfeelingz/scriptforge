// frontend/src/pages/SettingsPage.jsx
// Modernized: readable fonts, admin tier panel, usage bar, better layout

import { useState, useEffect } from 'react'
import { Send, Check, AlertCircle, Shield, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { users as usersApi, categories as catApi, episodes as episodesApi, testWebhook } from '../lib/api'

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, subtitle, children, accent }) {
  return (
    <div className="sf-card" style={{ marginBottom: '1.25rem' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{
          fontFamily: 'Syne, sans-serif',
          fontSize: '1.1rem',
          fontWeight: 700,
          color: 'var(--sf-text)',
          margin: 0,
        }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--sf-text2)',
            marginTop: '0.375rem',
            lineHeight: 1.6,
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, hint, wide, multiline }) {
  return (
    <div style={{ gridColumn: wide ? 'span 2' : undefined }}>
      <label className="sf-label">{label}</label>
      {hint && (
        <p style={{ fontSize: '0.75rem', color: 'var(--sf-text3)', marginBottom: '0.375rem' }}>
          {hint}
        </p>
      )}
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="sf-input"
          rows={3}
          style={{ resize: 'vertical' }}
        />
      ) : (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="sf-input"
        />
      )}
    </div>
  )
}

function UsageBar({ used, max, label }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  const cls = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : ''
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--sf-text2)' }}>{label}</span>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--sf-text)' }}>
          {used} / {max >= 9999 ? '∞' : max}
        </span>
      </div>
      <div className="sf-usage-bar-track">
        <div
          className={`sf-usage-bar-fill ${cls}`}
          style={{ width: max >= 9999 ? '5%' : `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { profile, setProfile, activeCategoryId, activeCategory, notify, theme, setTheme } = useStore()
  const cat = activeCategory?.()

  const [name,           setName]          = useState(profile?.display_name || '')
  const [saving,         setSaving]        = useState(false)
  const [savingVoice,    setSavingVoice]   = useState(false)
  const [webhookTesting, setWebhookTesting]= useState(false)
  const [webhookStatus,  setWebhookStatus] = useState(null)
  const [usage,          setUsage]         = useState(null)

  // Admin: tier editor state
  const [adminUsers,     setAdminUsers]    = useState(null)
  const [adminLoading,   setAdminLoading]  = useState(false)
  const [tierSaving,     setTierSaving]    = useState({})

  useEffect(() => {
    episodesApi.usage().then(setUsage).catch(() => {})
  }, [])

  // Load user list if admin
  useEffect(() => {
    if (!profile?.is_admin) return
    setAdminLoading(true)
    usersApi.list?.()
      .then(data => setAdminUsers(data?.users || []))
      .catch(() => setAdminUsers([]))
      .finally(() => setAdminLoading(false))
  }, [profile?.is_admin])

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
  const setV = k => v => setVoice(prev => ({ ...prev, [k]: v }))

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

  async function changeUserTier(userId, tier) {
    setTierSaving(s => ({ ...s, [userId]: true }))
    try {
      const limits = {
        free:   { max_episodes_pm: 8,    max_categories: 3    },
        pro:    { max_episodes_pm: 30,   max_categories: 10   },
        studio: { max_episodes_pm: 9999, max_categories: 9999 },
      }
      // Direct Supabase call via admin route
      const res = await fetch(`/api/admin/users/${userId}/tier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await import('../lib/supabase')).getSession().then(s => s?.access_token)}` },
        body: JSON.stringify({ tier }),
      })
      if (!res.ok) throw new Error('Failed')
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, tier } : u))
      if (userId === profile?.id) setProfile({ ...profile, tier, ...limits[tier] })
      notify(`Tier updated to ${tier}`, 'success')
    } catch (err) {
      notify('Failed to update tier', 'error')
    }
    setTierSaving(s => ({ ...s, [userId]: false }))
  }

  const TIERS = {
    free:   { label: 'Free',   episodes: 8,    categories: 3    },
    pro:    { label: 'Pro',    episodes: 30,   categories: 10   },
    studio: { label: 'Studio', episodes: 9999, categories: 9999 },
  }
  const tierInfo = TIERS[profile?.tier || 'free']

  const tierColor = {
    free:   'var(--sf-text3)',
    pro:    'var(--sf-blue)',
    studio: 'var(--sf-accent)',
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1.75rem' }}>Settings</h1>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <Section title="Profile">
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label className="sf-label">Display name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveProfile()}
              className="sf-input"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="sf-label">Email</label>
            <div style={{
              padding: '0.625rem 0.875rem',
              background: 'var(--sf-surface2)',
              border: '1px solid var(--sf-border)',
              borderRadius: 'var(--sf-radius-sm)',
              fontSize: '0.9375rem',
              color: 'var(--sf-text2)',
            }}>
              {profile?.email || '—'}
            </div>
          </div>
          <div>
            <button onClick={saveProfile} disabled={saving} className="sf-btn sf-btn-primary">
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </Section>

      {/* ── Plan & usage ─────────────────────────────────────────────────── */}
      <Section title="Plan & Usage">
        {/* Tier display */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '1rem',
          background: 'var(--sf-surface2)',
          borderRadius: 'var(--sf-radius-sm)',
          marginBottom: '1.25rem',
        }}>
          <div style={{
            width: 44, height: 44,
            borderRadius: 10,
            background: 'var(--sf-accent-glow)',
            border: '1px solid var(--sf-accent-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.25rem',
          }}>
            {profile?.tier === 'studio' ? '🏆' : profile?.tier === 'pro' ? '⚡' : '✦'}
          </div>
          <div>
            <div style={{
              fontFamily: 'Syne, sans-serif',
              fontWeight: 700,
              fontSize: '1.1rem',
              color: tierColor[profile?.tier || 'free'],
            }}>
              {tierInfo.label} Plan
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--sf-text2)', marginTop: 2 }}>
              {tierInfo.episodes >= 9999 ? 'Unlimited' : tierInfo.episodes} episodes/mo
              · {tierInfo.categories >= 9999 ? 'Unlimited' : tierInfo.categories} workspaces
            </div>
          </div>
        </div>

        {/* Usage bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <UsageBar
            used={profile?.episodes_this_month || 0}
            max={profile?.max_episodes_pm || 8}
            label="Episodes this month"
          />
        </div>

        {/* Cost breakdown if available */}
        {usage && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.75rem',
            marginTop: '1.25rem',
          }}>
            {[
              { label: 'Episodes generated', value: usage.episodesThisMonth },
              { label: 'Tokens used',         value: ((usage.inputTokens + usage.outputTokens) / 1000).toFixed(1) + 'k' },
              { label: 'Est. API cost',        value: '$' + usage.estimatedCostUsd.toFixed(3) },
            ].map(({ label, value }) => (
              <div key={label} className="sf-stat">
                <div className="sf-stat-label">{label}</div>
                <div className="sf-stat-value" style={{ fontSize: '1.25rem' }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Admin: tier management ────────────────────────────────────────── */}
      {profile?.is_admin && (
        <Section
          title="Admin — User Management"
          subtitle="You have admin access. Manage user tiers directly from here."
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'var(--sf-accent-glow)',
            border: '1px solid var(--sf-accent-dim)',
            borderRadius: 8,
            marginBottom: '1rem',
          }}>
            <Shield size={14} style={{ color: 'var(--sf-accent)' }}/>
            <span style={{ fontSize: '0.8125rem', color: 'var(--sf-accent)', fontWeight: 500 }}>
              Admin mode active — changes take effect immediately
            </span>
          </div>

          {adminLoading ? (
            <div style={{ color: 'var(--sf-text3)', fontSize: '0.875rem' }}>Loading users…</div>
          ) : adminUsers?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {adminUsers.map(user => (
                <div key={user.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  background: 'var(--sf-surface2)',
                  borderRadius: 8,
                  border: user.id === profile?.id ? '1px solid var(--sf-accent-dim)' : '1px solid var(--sf-border)',
                  flexWrap: 'wrap',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--sf-surface3)',
                    border: '1px solid var(--sf-border2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8125rem', fontWeight: 600,
                    color: 'var(--sf-text2)',
                    flexShrink: 0,
                  }}>
                    {(user.display_name || user.email || '?')[0].toUpperCase()}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--sf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.display_name || '(no name)'}
                      {user.id === profile?.id && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--sf-accent)', marginLeft: 6 }}>you</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sf-text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.email}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    {['free', 'pro', 'studio'].map(t => (
                      <button
                        key={t}
                        disabled={tierSaving[user.id]}
                        onClick={() => changeUserTier(user.id, t)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          fontFamily: 'Figtree, sans-serif',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          background: user.tier === t ? (t === 'studio' ? 'var(--sf-accent)' : t === 'pro' ? 'var(--sf-blue)' : 'var(--sf-surface3)') : 'transparent',
                          color: user.tier === t ? (t === 'free' ? 'var(--sf-text)' : '#0a0a0f') : 'var(--sf-text3)',
                          borderColor: user.tier === t ? (t === 'studio' ? 'var(--sf-accent)' : t === 'pro' ? 'var(--sf-blue)' : 'var(--sf-border2)') : 'var(--sf-border)',
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.875rem', color: 'var(--sf-text3)' }}>No users found.</div>
          )}
        </Section>
      )}

      {/* ── Voice profile ─────────────────────────────────────────────────── */}
      {activeCategoryId && (
        <Section
          title={`Voice profile — ${cat?.name || ''}`}
          subtitle="The more specific you are, the more Claude writes in your actual voice rather than generic documentary style."
        >
          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--sf-accent)',
              marginBottom: '0.75rem',
            }}>Sentence patterns</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <Field label="Length pattern"   value={voice.sentenceLengthPattern} onChange={setV('sentenceLengthPattern')} placeholder="short punchy bursts then longer reflective ones" />
              <Field label="Typical length"   value={voice.typicalSentenceLength} onChange={setV('typicalSentenceLength')} placeholder="8–12 words" />
              <Field label="Rhythm"           value={voice.rhythmNote}            onChange={setV('rhythmNote')}            placeholder="builds slowly then releases with a short punchy line" />
              <Field label="Vocabulary level" value={voice.vocabularyLevel}       onChange={setV('vocabularyLevel')}       placeholder="conversational, no jargon" />
            </div>
          </div>

          <hr className="sf-divider"/>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--sf-accent)', marginBottom: '0.75rem',
            }}>Structure</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <Field label="Hook style"       value={voice.hookStyle}          onChange={setV('hookStyle')}          placeholder="drops straight into the action" />
              <Field label="Build to reveal"  value={voice.revealBuildPattern} onChange={setV('revealBuildPattern')} placeholder="plants a detail early, pays off two minutes later" />
              <Field label="Open loop"        value={voice.openLoopStyle}      onChange={setV('openLoopStyle')}      placeholder="asks a question, answers it halfway through" />
              <Field label="CTA style"        value={voice.ctaStyle}           onChange={setV('ctaStyle')}           placeholder="low pressure, single ask at the very end" />
            </div>
          </div>

          <hr className="sf-divider"/>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--sf-accent)', marginBottom: '0.75rem',
            }}>Language fingerprint <span style={{ color: 'var(--sf-text3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— comma-separated</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <Field label="Signature phrases"       wide value={voice.signaturePhrases}  onChange={setV('signaturePhrases')}  placeholder="and that's when it clicked, I wasn't expecting that" hint="Phrases that sound unmistakably like you" />
              <Field label="Characteristic openers"  wide value={voice.sentenceOpeners}   onChange={setV('sentenceOpeners')}   placeholder="So, The thing is, Which meant that, And then" hint="How you tend to start sentences" />
              <Field label="Rhetorical devices"      wide value={voice.rhetoricalDevices} onChange={setV('rhetoricalDevices')} placeholder="rhetorical questions, callbacks, rule of three" />
              <Field label="Phrases to AVOID"        wide value={voice.avoidPhrases}      onChange={setV('avoidPhrases')}      placeholder="dive deep, let's unpack, game-changer, journey" hint="Claude will actively avoid these clichés" />
              <Field label="Humour style"                 value={voice.humourStyle}        onChange={setV('humourStyle')}        placeholder="dry, self-deprecating, timing-based" />
              <Field label="Storytelling style"           value={voice.storytellingStyle}  onChange={setV('storytellingStyle')}  placeholder="personal, first-person, present tense" />
            </div>
          </div>

          <button onClick={saveVoiceProfile} disabled={savingVoice} className="sf-btn sf-btn-accent-ghost" style={{ width: '100%' }}>
            {savingVoice ? 'Saving…' : 'Save voice profile'}
          </button>
        </Section>
      )}

      {/* ── Notifications ─────────────────────────────────────────────────── */}
      <Section
        title="Notifications"
        subtitle="Get a message in Discord or Slack when a generation completes, even if you've closed the tab."
      >
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--sf-text2)', lineHeight: 1.6 }}>
            Set{' '}
            <code style={{ background: 'var(--sf-surface3)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8125rem', color: 'var(--sf-accent)' }}>DISCORD_WEBHOOK_URL</code>
            {' '}or{' '}
            <code style={{ background: 'var(--sf-surface3)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8125rem', color: 'var(--sf-accent)' }}>SLACK_WEBHOOK_URL</code>
            {' '}in your Railway backend environment variables.
          </p>
        </div>
        <button
          onClick={sendTestWebhook}
          disabled={webhookTesting}
          className="sf-btn sf-btn-ghost"
        >
          {webhookTesting ? (
            <div style={{ width: 14, height: 14, border: '2px solid var(--sf-text3)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}/>
          ) : webhookStatus === 'ok' ? (
            <Check size={14} style={{ color: 'var(--sf-green)' }}/>
          ) : webhookStatus === 'error' ? (
            <AlertCircle size={14} style={{ color: 'var(--sf-red)' }}/>
          ) : (
            <Send size={14}/>
          )}
          {webhookTesting ? 'Sending…' : webhookStatus === 'ok' ? 'Sent successfully' : 'Send test notification'}
        </button>
      </Section>

      {/* ── Appearance ────────────────────────────────────────────────────── */}
      <Section title="Appearance">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--sf-text)' }}>Theme</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--sf-text2)', marginTop: 2 }}>Dark recommended for low-light studio use</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['dark', 'light'].map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`sf-btn ${theme === t ? 'sf-btn-accent-ghost' : 'sf-btn-ghost'}`}
                style={{ padding: '7px 18px', fontSize: '0.875rem', textTransform: 'capitalize' }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Keyboard shortcuts ────────────────────────────────────────────── */}
      <Section title="Keyboard shortcuts">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {[
            ['Teleprompter', 'Space = play/pause · ↑↓ = speed · R = restart'],
            ['Generate',     'Cmd+Enter = generate · Tab between fields'],
            ['Chat',         'Enter = send · Shift+Enter = new line'],
            ['Vault',        'Click Select to enter bulk mode'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: '1rem' }}>
              <span style={{
                width: 110, flexShrink: 0,
                fontSize: '0.875rem', fontWeight: 500,
                color: 'var(--sf-text2)',
              }}>{k}</span>
              <span style={{ fontSize: '0.875rem', color: 'var(--sf-text3)' }}>{v}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}