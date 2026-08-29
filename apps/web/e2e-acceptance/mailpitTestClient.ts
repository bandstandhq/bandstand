// SPDX-License-Identifier: Apache-2.0
//
// Talks to Mailpit's REST API (docker/compose.yml, apps/server/src/lib/mailer.ts's
// dev/CI SMTP target) so acceptance tests can verify an email actually arrived and
// follow the real link in it, instead of stubbing the mailer.
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSearchResult {
  messages: Array<{ ID: string }>;
}

interface MailpitMessage {
  Subject: string;
  HTML: string;
  Text: string;
}

/** Polls Mailpit until a message matching `to`/`subject` shows up, then returns its full body. */
export async function waitForEmail(to: string, subject: string, timeoutMs = 10_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:${to} subject:"${subject}"`);
  while (Date.now() < deadline) {
    const searchRes = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    const { messages } = (await searchRes.json()) as MailpitSearchResult;
    const latest = messages[0];
    if (latest) {
      const messageRes = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`);
      return (await messageRes.json()) as MailpitMessage;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No email to "${to}" with subject "${subject}" arrived in Mailpit within ${timeoutMs}ms`);
}

/** Pulls the first link out of an HTML email body — good enough for emails that only ever contain one action link. */
export function extractFirstLink(html: string): string {
  const match = html.match(/href="([^"]+)"/);
  if (!match) throw new Error(`No link found in email body:\n${html}`);
  return match[1]!.replace(/&amp;/g, '&');
}
