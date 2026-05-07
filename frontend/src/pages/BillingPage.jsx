// frontend/src/pages/BillingPage.jsx
// Single unified plan — WhispaCuts Studio

import { useState, useEffect } from 'react'
import { Check, Sparkles, RefreshCw, Zap, AlertTriangle, Coins, Plus, ChevronDown } from 'lucide-react'
import { useStore } from '../store'
import { api, credits as creditsApi } from '../lib/api'

export default function BillingPage() {
  const { profile, notify } = useStore()
  const [status,     setStatus]     = useState(null)
  const [creditData, setCreditData] = useState(null)
  const [yearly,     setYearly]     = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [subbing,    setSubbing]    = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [buying,     setBuying]     = useState(null)
  const [showPacks,  setShowPacks]  = useState(false)

  useEffect(() => {
    api.get('/billing/status').then(s => setStatus(s)).catch(() => {}).finally(() => setLoading(false))
    creditsApi.balance().then(d => setCreditData(d)).catch(() => {})

    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') === 'success') {
      notify('Subscription activated — welcome to Studio! 🎉', 'success', 5000)
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('billing') === 'cancelled') {
      notify('Subscription cancelled', 'info')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function handleSubscribe() {
    const planKey = yearly ? 'studio_yearly' : 'studio_monthly'
    setSubbing(true)
    try {
      const { approvalUrl } = await api.post('/billing/subscribe', { planKey })
      window.location.href = approvalUrl
    } catch (err) {
      notify(err.message, 'error')
      setSubbing(false)
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel your subscription? You'll keep access until the end of your billing period.")) return
    setCancelling(true)
    try {
      await api.post('/billing/cancel', {})
      notify("Subscription cancelled — access continues until billing period ends", 'info', 5000)
      setStatus(s => ({ ...s, status: 'cancelled' }))
    } catch (err) {
      notify(err.message, 'error')
    }
    setCancelling(false)
  }

  async function handleBuyCredits(packId) {
    setBuying(packId)
    try {
      const { approvalUrl } = await creditsApi.purchase(packId)
      window.location.href = approvalUrl
    } catch (err) {
      notify(err.message, 'error')
      setBuying(null)
    }
  }

  const isStudio = status?.tier === 'studio' || status?.tier === 'pro'
  const isActive = status?.status === 'active'

  const FEATURES = [
    'Unlimited episodes per month',
    'Unlimited workspaces',
    'Full AI generation — VO script, EDL clip map, Shorts moments, SEO metadata',
    'Companion voice recorder & brainstorm',
    'YouTube Analytics integration',
    'Session journals & script library',
    'Series bible & voice profile training',
    'Shot list generator',
    'Sound library placement',
    'Knowledge Base (KB) — chat with your AI assistant',
    'Schedule & publish planning',
  ]

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
      <RefreshCw size={20} style={{ color: '#444', animation: 'spin 1s linear infinite' }}/>
    </div>
  )

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 4px' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', padding: '24px 0 32px' }}>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '2rem', color: '#f0ede8', marginBottom: 10 }}>
          One plan. Everything included.
        </h1>
        <p style={{ color: '#666', fontSize: '1rem', maxWidth: 440, margin: '0 auto' }}>
          No feature tiers, no gotchas. You get the full platform — AI generation, analytics, scheduling, companion, all of it.
        </p>
      </div>

      {/* Current status banner */}
      {isStudio && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderRadius: 12, marginBottom: 24,
          background: 'rgba(212,168,83,0.08)', border: '1px solid rgba(212,168,83,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={16} style={{ color: '#d4a853' }}/>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#d4a853' }}>
                Studio — {status?.period === 'yearly' ? 'Annual' : 'Monthly'}
              </div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                {status?.status === 'cancelled'
                  ? 'Cancelled — access until end of billing period'
                  : status?.nextBilling
                  ? `Next billing: ${new Date(status.nextBilling).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}`
                  : 'Active subscription'}
              </div>
            </div>
          </div>
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              style={{ fontSize: 11, color: '#555', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
            >
              {cancelling ? 'Cancelling...' : 'Cancel subscription'}
            </button>
          )}
        </div>
      )}

      {/* Credit balance panel */}
      {creditData && (
        <div style={{
          borderRadius: 14, padding: '20px 24px', marginBottom: 24,
          background: '#0c0e18', border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={15} style={{ color: '#d4a853' }}/>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#c8b89a' }}>Your credits</span>
            </div>
            <button
              onClick={() => setShowPacks(s => !s)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 12, color: '#d4a853', background: 'rgba(212,168,83,0.1)',
                border: '1px solid rgba(212,168,83,0.2)', borderRadius: 7,
                padding: '5px 11px', cursor: 'pointer',
              }}
            >
              <Plus size={11}/> Buy more
              <ChevronDown size={11} style={{ transform: showPacks ? 'rotate(180deg)' : 'none', transition: '0.15s' }}/>
            </button>
          </div>

          {/* Balance bar */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#f0ede8', fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>
                {creditData.balance ?? 0}
              </span>
              <span style={{ fontSize: 12, color: '#444', alignSelf: 'flex-end', marginBottom: 3 }}>
                of {creditData.monthly ?? 0} monthly credits
              </span>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
              <div style={{
                height: '100%', borderRadius: 3, transition: 'width 0.4s',
                width: `${Math.min(100, ((creditData.balance ?? 0) / (creditData.monthly ?? 1)) * 100)}%`,
                background: (creditData.balance ?? 0) < 20
                  ? 'linear-gradient(90deg,#e05550,#e07840)'
                  : 'linear-gradient(90deg,#d4a853,#6ab87a)',
              }}/>
            </div>
            {(creditData.balance ?? 0) < 20 && (
              <p style={{ fontSize: 11, color: '#e05550', marginTop: 6 }}>
                ⚠ Running low — top up to keep generating
              </p>
            )}
          </div>

          {/* Cost reference */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Episode', cost: 10 },
              { label: 'Chat msg', cost: 1 },
              { label: 'Hook variants', cost: 2 },
              { label: 'Vault recs', cost: 2 },
            ].map(item => (
              <div key={item.label} style={{ fontSize: 11, color: '#555' }}>
                <span style={{ color: '#d4a853', fontWeight: 600 }}>{item.cost}cr</span> {item.label}
              </div>
            ))}
          </div>

          {/* Credit packs */}
          {showPacks && creditData.packs && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p style={{ fontSize: 11, color: '#555', marginBottom: 12 }}>
                Packs are one-time purchases — credits don't expire.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {creditData.packs.map(pack => (
                  <button
                    key={pack.id}
                    onClick={() => handleBuyCredits(pack.id)}
                    disabled={buying === pack.id}
                    style={{
                      padding: '14px 12px', borderRadius: 10, border: '1px solid rgba(212,168,83,0.2)',
                      background: 'rgba(212,168,83,0.06)', cursor: buying ? 'not-allowed' : 'pointer',
                      textAlign: 'center', transition: 'all 0.15s', opacity: buying === pack.id ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(212,168,83,0.4)'; e.currentTarget.style.background = 'rgba(212,168,83,0.1)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(212,168,83,0.2)'; e.currentTarget.style.background = 'rgba(212,168,83,0.06)' }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#d4a853', fontFamily: "'Syne', sans-serif" }}>
                      {pack.credits}
                    </div>
                    <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>credits</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ede8' }}>${pack.price}</div>
                    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{pack.episodes}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pricing card */}
      <div style={{
        borderRadius: 20, overflow: 'hidden',
        border: '1px solid rgba(212,168,83,0.25)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
        background: 'linear-gradient(180deg, #0f1020 0%, #0a0c16 100%)',
      }}>
        {/* Card header */}
        <div style={{
          padding: '28px 32px 24px',
          background: 'linear-gradient(135deg, rgba(212,168,83,0.08) 0%, transparent 60%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Sparkles size={18} style={{ color: '#d4a853' }}/>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#d4a853', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              WhispaCuts Studio
            </span>
          </div>

          {/* Billing toggle */}
          <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, width: 'fit-content', marginBottom: 20, border: '1px solid rgba(255,255,255,0.08)' }}>
            {['Monthly', 'Yearly'].map(p => (
              <button key={p} onClick={() => setYearly(p === 'Yearly')} style={{
                padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
                background: (p === 'Yearly') === yearly ? 'rgba(212,168,83,0.15)' : 'transparent',
                color: (p === 'Yearly') === yearly ? '#d4a853' : '#555',
              }}>
                {p}
                {p === 'Yearly' && <span style={{ marginLeft: 5, fontSize: 10, color: '#6ab87a' }}>Save 17%</span>}
              </button>
            ))}
          </div>

          {/* Price */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#f0ede8', fontFamily: "'Syne', sans-serif", lineHeight: 1, letterSpacing: '-0.03em' }}>
              ${yearly ? '40' : '49'}
            </span>
            <span style={{ fontSize: 13, color: '#555', marginBottom: 7, fontFamily: "'Figtree', sans-serif" }}>/month</span>
          </div>
          {yearly && (
            <div style={{ fontSize: 12, color: '#666' }}>
              Billed as $490/year · saves $98 vs monthly
            </div>
          )}
        </div>

        {/* Features */}
        <div style={{ padding: '24px 32px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 28 }}>
            {FEATURES.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Check size={13} style={{ color: '#d4a853', flexShrink: 0, marginTop: 2 }}/>
                <span style={{ fontSize: 12.5, color: '#b0b4c0', lineHeight: 1.5 }}>{f}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          {!isStudio ? (
            <button
              onClick={handleSubscribe}
              disabled={subbing}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                cursor: subbing ? 'not-allowed' : 'pointer', fontFamily: "'Syne', sans-serif",
                fontSize: '1rem', fontWeight: 700,
                background: 'linear-gradient(135deg, #d4a853 0%, #e8c46a 100%)',
                color: '#0a0c14', transition: 'all 0.15s',
                opacity: subbing ? 0.7 : 1,
                boxShadow: '0 4px 20px rgba(212,168,83,0.3)',
              }}
            >
              {subbing ? 'Redirecting to PayPal...' : `Start Studio — ${yearly ? '$490/year' : '$49/month'}`}
            </button>
          ) : (
            <div style={{ textAlign: 'center', fontSize: 13, color: '#555', padding: '8px 0' }}>
              ✓ You're on Studio — all features are active
            </div>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: '#444', marginTop: 12 }}>
            Billed via PayPal · Cancel anytime · No hidden fees
          </p>
        </div>
      </div>

      {/* Free tier note */}
      <div style={{
        marginTop: 20, padding: '14px 18px', borderRadius: 10,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <AlertTriangle size={13} style={{ color: '#555', flexShrink: 0, marginTop: 2 }}/>
        <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>
          <strong style={{ color: '#666' }}>Free tier:</strong> 3 episodes per month, 1 workspace, all features available. Upgrade when you're ready to go unlimited.
        </div>
      </div>
    </div>
  )
}