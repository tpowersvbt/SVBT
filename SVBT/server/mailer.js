// Optional email delivery for password setup/reset links.
// Configure RESEND_API_KEY and EMAIL_FROM (a sender on a domain verified with Resend) to email links automatically.
// Without them, the Administration screens show the link to the administrator so it can be shared directly.
export const emailConfigured = (env = process.env) => !!(env.RESEND_API_KEY && env.EMAIL_FROM);

export async function sendPasswordLink({ to, name, link, purpose, expiresAt }, env = process.env) {
  if (!emailConfigured(env)) return false;
  const subject = purpose === 'setup' ? 'Set up your Silicon Valley Bank and Trust sign-in' : 'Reset your Silicon Valley Bank and Trust password';
  const message = `Hello ${name},\n\nUse this single-use link to ${purpose === 'setup' ? 'choose your password' : 'reset your password'}:\n${link}\n\nThe link expires ${new Date(expiresAt).toUTCString()}. If you did not expect this message, ignore it.`;
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text: message }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) console.error(`Password email was not accepted by the email provider (HTTP ${response.status}).`);
    return response.ok;
  } catch (error) {
    console.error(`Password email could not be sent: ${error.message}`);
    return false;
  }
}
