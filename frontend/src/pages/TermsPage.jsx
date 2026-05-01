// frontend/src/pages/TermsPage.jsx
export default function TermsPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.8 }}>
      <div style={{ marginBottom: 40 }}>
        <img src="/icon-mark.svg" alt="WhispaCuts" style={{ width: 36, height: 36, marginBottom: 16 }}/>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '2rem', marginBottom: 8 }}>Terms of Service</h1>
        <p style={{ color: 'var(--text3)', fontSize: '0.875rem' }}>Last updated: April 30, 2026</p>
      </div>

      {[
        {
          title: '1. Acceptance of Terms',
          body: `By creating an account or using WhispaCuts, you agree to these Terms of Service. If you do not agree, do not use the service. These terms apply to all users including free, Pro, and Studio tier subscribers.`
        },
        {
          title: '2. Description of Service',
          body: `WhispaCuts is an AI-powered content creation platform for independent video creators. It provides tools including: voice session capture (Companion), AI episode script generation, EDL export for video editing, short-form content suggestions, YouTube analytics integration, and series management tools.`
        },
        {
          title: '3. Your Account',
          body: `You are responsible for maintaining the security of your account credentials. You must provide accurate information when creating your account. You may not share your account with others or use it for commercial resale of the service itself. You must be at least 16 years old to use WhispaCuts.`
        },
        {
          title: '4. Subscriptions and Billing',
          body: `WhispaCuts offers Free, Pro ($19/month or $190/year), and Studio ($49/month or $490/year) plans. Subscriptions are billed in advance through PayPal. You can cancel at any time — cancellation takes effect at the end of your current billing period and you retain access until then. We do not offer refunds for partial billing periods. We reserve the right to change pricing with 30 days notice to existing subscribers.`
        },
        {
          title: '5. Your Content',
          body: `You retain full ownership of all content you create using WhispaCuts — your scripts, voice memos, episode plans, and creative work are yours. By using the service, you grant us a limited license to process your content solely to provide the service (transcription, AI generation, storage). We do not claim ownership of your content and will not use it to train AI models without your explicit consent.`
        },
        {
          title: '6. AI-Generated Content',
          body: `WhispaCuts uses AI to assist with content creation. The AI-generated scripts, suggestions, and metadata are tools to assist your creative process — you are responsible for reviewing, editing, and verifying all AI output before publishing. We make no guarantees about the accuracy, originality, or fitness of AI-generated content for any particular purpose.`
        },
        {
          title: '7. Acceptable Use',
          body: `You may not use WhispaCuts to create content that is illegal, defamatory, or infringes third-party intellectual property rights. You may not attempt to reverse-engineer, scrape, or abuse the platform's APIs. You may not use the service to generate spam, misinformation, or content designed to deceive. Violation of these terms may result in account termination.`
        },
        {
          title: '8. YouTube Integration',
          body: `When you connect your YouTube account, you authorise WhispaCuts to access your YouTube Analytics data as described in our Privacy Policy. Your use of YouTube data through WhispaCuts is also governed by the YouTube Terms of Service (https://www.youtube.com/t/terms) and Google API Services User Data Policy.`
        },
        {
          title: '9. Availability and Uptime',
          body: `We aim for high availability but do not guarantee uninterrupted service. We may perform maintenance, updates, or experience downtime. We are not liable for losses arising from service unavailability. We reserve the right to modify or discontinue features with reasonable notice.`
        },
        {
          title: '10. Limitation of Liability',
          body: `WhispaCuts is provided "as is". To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages arising from your use of the service. Our total liability to you for any claim shall not exceed the amount you paid us in the 3 months preceding the claim.`
        },
        {
          title: '11. Termination',
          body: `You may delete your account at any time from Settings. We may suspend or terminate accounts that violate these terms. Upon termination, your right to use the service ends and we will delete your data in accordance with our Privacy Policy.`
        },
        {
          title: '12. Changes to Terms',
          body: `We may update these terms as the service evolves. We will notify you of material changes via email or in-app notification at least 14 days before they take effect. Continued use after changes constitutes acceptance.`
        },
        {
          title: '13. Governing Law',
          body: `These terms are governed by the laws of the jurisdiction in which WhispaCuts operates. Any disputes shall be resolved through good-faith negotiation first. If unresolved, disputes shall be subject to binding arbitration.`
        },
        {
          title: '14. Contact',
          body: `Questions about these terms? Email us at legal@whispacuts.com.`
        },
      ].map(({ title, body }) => (
        <div key={title} style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '1.1rem', color: 'var(--text)', marginBottom: 8 }}>{title}</h2>
          <p style={{ color: 'var(--text2)', fontSize: '0.9375rem', whiteSpace: 'pre-line' }}>{body}</p>
        </div>
      ))}
    </div>
  )
}
