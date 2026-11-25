// Transactional email through the ZeptoMail API (https://www.zoho.com/zeptomail/).
// Configure in server/.env:
//   ZEPTOMAIL_TOKEN      the Send Mail token of a ZeptoMail Mail Agent (with or without the "Zoho-enczapikey " prefix)
//   ZEPTOMAIL_API_URL    optional; defaults to the India data centre. Use https://api.zeptomail.com/v1.1/email for the US one.
//   MAIL_FROM            a sender address on a domain verified in ZeptoMail, e.g. noreply@veyrotrack.com
//   MAIL_FROM_NAME       optional display name
import { config } from './config.js';

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: { address: string; name?: string };
}
export type Mailer = (msg: MailMessage) => Promise<void>;

export const mailConfigured = () => Boolean(config.mail.token && config.mail.from);

export const sendZeptoMail: Mailer = async (msg) => {
  if (!mailConfigured()) throw new Error('mail_not_configured');
  const token = config.mail.token.startsWith('Zoho-enczapikey') ? config.mail.token : `Zoho-enczapikey ${config.mail.token}`;
  const res = await fetch(config.mail.apiUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({
      from: { address: config.mail.from, name: config.mail.fromName },
      to: msg.to.map((address) => ({ email_address: { address } })),
      ...(msg.replyTo ? { reply_to: [msg.replyTo] } : {}),
      subject: msg.subject,
      htmlbody: msg.html,
      textbody: msg.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    throw new Error(`zeptomail_http_${res.status}: ${detail}`);
  }
};
