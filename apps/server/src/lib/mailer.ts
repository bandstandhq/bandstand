// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generic SMTP mailer — the only mail implementation, in dev and production.
// Points at Mailpit locally (docker/compose.yml); a real SMTP relay in
// production. No vendor-specific SDK (Resend/Postmark/etc.) by design.
import nodemailer from 'nodemailer';

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? 'Bandstand <no-reply@bandstand.local>',
    to,
    subject,
    html,
  });
}
