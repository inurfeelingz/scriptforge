// frontend/src/pages/PrivacyPage.jsx
export default function PrivacyPage() {
  const S = ({ title, children }) => (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '1.1rem', color: 'var(--text)', marginBottom: 8 }}>{title}</h2>
      <div style={{ color: 'var(--text2)', fontSize: '0.9375rem', lineHeight: 1.8 }}>{children}</div>
    </div>
  )
  const p = (text) => <p style={{ marginBottom: 12 }}>{text}</p>

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', color: 'var(--text)', fontFamily: 'inherit' }}>
      <div style={{ marginBottom: 40 }}>
        <img src="/icon-mark.svg" alt="WhispaCuts" style={{ width: 36, height: 36, marginBottom: 16 }}/>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '2rem', marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ color: 'var(--text3)', fontSize: '0.875rem' }}>Last updated: April 30, 2026 · Effective date: April 30, 2026</p>
        <p style={{ color: 'var(--text3)', fontSize: '0.875rem', marginTop: 8 }}>
          This policy applies to all users of WhispaCuts worldwide, including users in the United States, the European Union, the United Kingdom, and other jurisdictions.
        </p>
      </div>

      <S title="1. Who We Are">
        {p('WhispaCuts ("we", "us", "our") is a content creation platform for independent video creators, operated at whispacuts.com.')}
        {p('Data Controller (EU/UK): WhispaCuts, contact: privacy@whispacuts.com')}
        {p('For all privacy inquiries including GDPR/CCPA requests, contact us at privacy@whispacuts.com. We aim to respond within 30 days.')}
      </S>

      <S title="2. Children's Privacy (COPPA & GDPR-K)">
        {p('WhispaCuts does not knowingly collect personal data from children under 13 years of age. In compliance with the Children\'s Online Privacy Protection Act (COPPA) and applicable EU laws, we require age verification at sign-up. If we discover that a user under 13 has created an account, we will delete their data immediately.')}
        {p('Users aged 13–16 in the EU require parental consent in some member states. If you are a parent or guardian and believe your child has created an account without consent, contact us at privacy@whispacuts.com.')}
      </S>

      <S title="3. Information We Collect">
        {p('Account data: email address, display name, and password (hashed — we never see your plaintext password).')}
        {p('Creative content: voice recordings and transcriptions captured through the Companion app; episode scripts, track information, and other content you submit for AI generation. This content is yours and we process it only to deliver the service.')}
        {p('YouTube Analytics data: when you connect your YouTube account, we access video performance metrics (views, retention, engagement) via Google\'s OAuth system. We do not access your private messages, subscriber identities, or any YouTube data beyond analytics.')}
        {p('Usage data: pages visited, features used, generation requests made, error logs, and IP addresses. We use this to improve the service and diagnose issues.')}
        {p('Payment data: subscription status and PayPal subscription IDs. We do not store your full payment card details — PayPal handles all payment processing.')}
      </S>

      <S title="4. Legal Basis for Processing (GDPR)">
        {p('For users in the EU/EEA and UK, we process your data under the following legal bases:')}
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          {['Contract performance — to provide the WhispaCuts service you signed up for',
            'Legitimate interests — to improve the service, prevent fraud, and ensure security',
            'Consent — for optional features such as YouTube Analytics integration (you can withdraw at any time)',
            'Legal obligation — where required by law'].map((item, i) => (
            <li key={i} style={{ marginBottom: 6 }}>{item}</li>
          ))}
        </ul>
      </S>

      <S title="5. How We Use Your Information">
        {p('To provide the service: generate episode scripts, voice memos, EDL files, analytics insights, and all other features of WhispaCuts.')}
        {p('Voice recordings are transcribed using OpenAI Whisper solely to generate your session notes. We do not retain raw audio longer than necessary to complete transcription.')}
        {p('We do not sell your personal data to any third party — ever.')}
        {p('We do not use your creative content to train AI models without your explicit, separate consent.')}
        {p('We may use anonymised, aggregated usage statistics to improve the platform.')}
      </S>

      <S title="6. YouTube & Google API Data">
        {p('Our use of YouTube API data complies with the YouTube API Services Terms of Service and the Google API Services User Data Policy.')}
        {p('We request only the minimum scopes needed: youtube.readonly and yt-analytics.readonly. We store only the analytics metrics needed for insights. We do not share your YouTube data with any third party.')}
        {p('You can revoke WhispaCuts\' access to your YouTube account at any time at myaccount.google.com/permissions or by disconnecting from Settings. Upon disconnection we delete all stored YouTube tokens.')}
      </S>

      <S title="7. California Privacy Rights (CCPA/CPRA)">
        {p('California residents have the following rights under the California Consumer Privacy Act:')}
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          {['Right to know what personal information we collect, use, and disclose',
            'Right to delete your personal information',
            'Right to opt out of the sale of personal information (we do not sell your data)',
            'Right to non-discrimination for exercising your privacy rights',
            'Right to correct inaccurate personal information'].map((item, i) => (
            <li key={i} style={{ marginBottom: 6 }}>{item}</li>
          ))}
        </ul>
        {p('To exercise these rights, email privacy@whispacuts.com with "CCPA Request" in the subject line. We will respond within 45 days.')}
      </S>

      <S title="8. EU/UK Rights (GDPR & UK GDPR)">
        {p('EU and UK residents have the following rights:')}
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          {['Right of access — obtain a copy of your personal data',
            'Right to rectification — correct inaccurate data',
            'Right to erasure ("right to be forgotten")',
            'Right to restrict processing',
            'Right to data portability — receive your data in a machine-readable format',
            'Right to object to processing based on legitimate interests',
            'Right to withdraw consent at any time (where processing is based on consent)',
            'Right to lodge a complaint with your national data protection authority'].map((item, i) => (
            <li key={i} style={{ marginBottom: 6 }}>{item}</li>
          ))}
        </ul>
        {p('To exercise these rights, email privacy@whispacuts.com. We respond within 30 days. If we fail to respond adequately, EU users may contact their national supervisory authority; UK users may contact the ICO (ico.org.uk).')}
      </S>

      <S title="9. Data Retention">
        {p('Account data is retained while your account is active. Voice session recordings and transcriptions are retained in your session journals until you delete them. If you delete your account, we remove your personal data within 30 days, except where retention is required by law (e.g. financial records for tax purposes, retained for 7 years).')}
      </S>

      <S title="10. International Data Transfers">
        {p('WhispaCuts is operated from servers hosted by Railway (Singapore region) and Netlify (global CDN). If you are in the EU/UK, your data may be transferred outside the EEA/UK. We ensure such transfers are protected by appropriate safeguards including Standard Contractual Clauses (SCCs) where applicable.')}
      </S>

      <S title="11. Third-Party Services">
        {p('We use: Supabase (auth & database), OpenAI (voice transcription), Anthropic Claude (AI generation), PayPal (payments), Google/YouTube (analytics), Railway (servers), Netlify (frontend). Each has its own privacy policy.')}
      </S>

      <S title="12. Cookies">
        {p('We use essential cookies for authentication only (keeping you logged in). No advertising cookies, no tracking pixels, no third-party analytics cookies. You can disable cookies but this will prevent you from staying logged in.')}
      </S>

      <S title="13. Security">
        {p('We use HTTPS encryption, hashed authentication tokens, row-level database security, and access controls. If you discover a vulnerability, contact security@whispacuts.com.')}
      </S>

      <S title="14. Changes to This Policy">
        {p('We will notify you of material changes via email or in-app notification at least 14 days before changes take effect. The current version is always available at whispacuts.com/privacy.')}
      </S>

      <S title="15. Contact & DPO">
        {p('Privacy enquiries: privacy@whispacuts.com')}
        {p('Security issues: security@whispacuts.com')}
        {p('Legal: legal@whispacuts.com')}
      </S>
    </div>
  )
}
