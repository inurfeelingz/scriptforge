// frontend/src/pages/BillingPage.jsx
// Subscription plans — monthly / yearly toggle, PayPal checkout

import { useState, useEffect } from 'react'
import { Check, Zap, Crown, Sparkles, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'

const TIER_ICONS = { free: Sparkles, pro: Zap, studio: Crown }
const TIER_COLORS = {
  free:   { accent: 'var(--text3)',    border: 'var(--border)',    bg: 'transparent' },
  pro:    { accent: '#60a5fa',         border: 'rgba(96,165,250,0.3)', bg: 'rgba(96,165,250,0.04)' },
  studio: { accent: 'var(--accent)',   border: 'var(--accent-mid)', bg: 'var(--accent-lo)' },
}

export default function BillingPage() {
  const { profile, notify } = useStore()
  const [plans,    setPlans]    = useState([])
  const [status,   setStatus]   = useState(null)
  const [yearly,   setYearly]   = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [subbing,  setSubbing]  = useState(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/billing/plans'),
      api.get('/billing/status'),
    ]).then(([p, s]) => {
      setPlans(p.plans || [])
      setStatus(s)
    }).catch(() => {}).finally(() => setLoading(false))

    // Handle PayPal return
    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') === 'success') {
      notify('Subscription activated — welcome! 🎉', 'success', 5000)
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('billing') === 'cancelled') {
      notify('Subscription cancelled', 'info')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function handleSubscribe(plan, period) {
    const planKey = `${plan.id}_${period}`
    setSubbing(planKey)
    try {
      const { approvalUrl } = await api.post('/billing/subscribe', { planKey })
      window.location.href = approvalUrl
    } catch (err) {
      notify(err.message, 'error')
      setSubbing(null)
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel your subscription? You\'ll keep access until the end of your billing period.')) return
    setCancelling(true)
    try {
      await api.post('/billing/cancel', {})
      notify('Subscription cancelled — you\'ll keep access until end of billing period', 'info', 5000)
      setStatus(s => ({ ...s, status: 'cancelled' }))
    } catch (err) {
      notify(err.message, 'error')
    }
    setCancelling(false)
  }

  const currentTier = profile?.tier || 'free'

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
      <RefreshCw size={20} style={{ color: 'var(--text3)', animation: 'spin 1s linear infinite' }}/>
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto space-y-8">

      {/* Header */}
      <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '2rem', color: 'var(--text)', marginBottom: 8 }}>
          Simple, transparent pricing
        </h1>
        <p style={{ color: 'var(--text2)', fontSize: '1rem' }}>
          Save hours per episode. Cancel anytime.
        </p>
      </div>

      {/* Monthly / Yearly toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '4px', background: 'var(--surface)', borderRadius: 12, width: 'fit-content', margin: '0 auto', border: '1px solid var(--border)' }}>
        <button
          onClick={() => setYearly(false)}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 500, background: !yearly ? 'var(--surface2)' : 'transparent', color: !yearly ? 'var(--text)' : 'var(--text3)', transition: 'all 0.15s' }}
        >Monthly</button>
        <button
          onClick={() => setYearly(true)}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 500, background: yearly ? 'var(--surface2)' : 'transparent', color: yearly ? 'var(--text)' : 'var(--text3)', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          Yearly
          <span style={{ fontSize: '0.75rem', padding: '1px 6px', borderRadius: 99, background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}>
            Save 2 months
          </span>
        </button>
      </div>

      {/* Plans */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {plans.map(plan => {
          const Icon      = TIER_ICONS[plan.id] || Sparkles
          const colors    = TIER_COLORS[plan.id]
          const isCurrent = currentTier === plan.id
          const price     = yearly ? plan.yearlyMonthly : plan.monthly
          const planKey   = `${plan.id}_${yearly ? 'yearly' : 'monthly'}`
          const isSubbing = subbing === planKey
          const isFree    = plan.id === 'free'

          return (
            <div
              key={plan.id}
              style={{
                border: `1px solid ${isCurrent ? colors.accent : plan.popular ? colors.border : 'var(--border)'}`,
                borderRadius: 16,
                padding: '28px 24px',
                background: isCurrent ? colors.bg : plan.popular ? 'var(--surface)' : 'var(--surface)',
                position: 'relative',
                display: 'flex', flexDirection: 'column', gap: 20,
                boxShadow: plan.popular ? `0 0 0 1px ${colors.border}, 0 4px 24px rgba(0,0,0,0.2)` : 'none',
              }}
            >
              {/* Popular badge */}
              {plan.popular && !isCurrent && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', padding: '3px 12px', background: '#60a5fa', borderRadius: 99, fontSize: '0.75rem', fontWeight: 700, color: '#080c10', whiteSpace: 'nowrap' }}>
                  Most popular
                </div>
              )}

              {/* Current badge */}
              {isCurrent && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', padding: '3px 12px', background: colors.accent, borderRadius: 99, fontSize: '0.75rem', fontWeight: 700, color: '#080c10', whiteSpace: 'nowrap' }}>
                  Current plan
                </div>
              )}

              {/* Plan header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${colors.accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} style={{ color: colors.accent }}/>
                </div>
                <div>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '1.1rem', color: 'var(--text)' }}>{plan.name}</div>
                  {plan.id !== 'free' && yearly && (
                    <div style={{ fontSize: '0.75rem', color: '#4ade80' }}>Save ${plan.savings}/year</div>
                  )}
                </div>
              </div>

              {/* Price */}
              <div>
                {isFree ? (
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, fontFamily: 'Syne, sans-serif', color: 'var(--text)' }}>Free</div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: '2.2rem', fontWeight: 800, fontFamily: 'Syne, sans-serif', color: 'var(--text)' }}>${price}</span>
                    <span style={{ color: 'var(--text3)', fontSize: '0.9rem' }}>/month</span>
                  </div>
                )}
                {yearly && !isFree && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginTop: 2 }}>
                    Billed ${plan.yearly}/year
                  </div>
                )}
              </div>

              {/* Features */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                {plan.features.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check size={14} style={{ color: colors.accent, flexShrink: 0 }}/>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text2)' }}>{f}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              {isFree ? (
                isCurrent ? (
                  <div style={{ padding: '12px', textAlign: 'center', borderRadius: 10, border: '1px solid var(--border)', color: 'var(--text3)', fontSize: '0.875rem' }}>
                    Your current plan
                  </div>
                ) : null
              ) : isCurrent ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ padding: '10px', textAlign: 'center', borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.accent, fontSize: '0.875rem', fontWeight: 500 }}>
                    ✓ Active — {status?.period === 'yearly' ? 'Annual' : 'Monthly'} billing
                  </div>
                  {status?.status !== 'cancelled' && (
                    <button
                      onClick={handleCancel}
                      disabled={cancelling}
                      style={{ padding: '8px', background: 'none', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, color: '#f87171', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit' }}
                    >
                      {cancelling ? 'Cancelling...' : 'Cancel subscription'}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => handleSubscribe(plan, yearly ? 'yearly' : 'monthly')}
                  disabled={!!subbing}
                  style={{
                    padding: '13px', borderRadius: 10, border: 'none', cursor: subbing ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', fontSize: '0.9375rem', fontWeight: 600,
                    background: plan.popular
                      ? 'linear-gradient(135deg, #60a5fa, #3b82f6)'
                      : plan.id === 'studio'
                      ? 'linear-gradient(135deg, #e8b84b, #d4a853)'
                      : 'var(--surface2)',
                    color: (plan.popular || plan.id === 'studio') ? '#080c10' : 'var(--text)',
                    opacity: subbing && !isSubbing ? 0.5 : 1,
                    boxShadow: plan.popular ? '0 4px 16px rgba(96,165,250,0.3)' : plan.id === 'studio' ? '0 4px 16px rgba(212,168,83,0.3)' : 'none',
                  }}
                >
                  {isSubbing ? 'Redirecting to PayPal...' : `Get ${plan.name}`}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Fine print */}
      <p style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.8125rem', paddingBottom: 20 }}>
        Payments processed securely by PayPal. Cancel anytime. No hidden fees.
      </p>
    </div>
  )
}
