/**
 * Sending email.
 *  - EMAIL_HOST set     -> SMTP (nodemailer)
 *  - no EMAIL_HOST      -> the message is printed to the console (development)
 *  - 'memory' (tests)   -> kept in `outbox`
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { settings } from '../config.ts';

export interface Message {
  subject: string;
  text: string;
  html: string;
  from: string;
  to: string[];
}

export const outbox: Message[] = [];

let transporter: Transporter | null = null;
let transporterKey = '';

function smtp(): Transporter {
  const { host, port, user, password, useSsl, useTls, timeout } = settings.SMTP;
  const key = JSON.stringify(settings.SMTP);
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: useSsl, // implicit TLS on 465
      requireTLS: useTls, // STARTTLS on 587, refuse to send without it
      ignoreTLS: !useSsl && !useTls,
      auth: user ? { user, pass: password } : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    });
    transporterKey = key;
  }
  return transporter;
}

/** Hooks for tests: replace to simulate failures. */
export const mailer = {
  async send(message: Omit<Message, 'from'>): Promise<void> {
    const full: Message = { ...message, from: settings.DEFAULT_FROM_EMAIL };
    if (settings.EMAIL_BACKEND === 'memory') {
      outbox.push(full);
      return;
    }
    if (settings.EMAIL_BACKEND === 'console') {
      const line = '-'.repeat(79);
      console.log(
        `${line}\nSubject: ${full.subject}\nFrom: ${full.from}\nTo: ${full.to.join(', ')}\n\n${full.text}\n${line}`,
      );
      return;
    }
    await smtp().sendMail(full);
  },
};
