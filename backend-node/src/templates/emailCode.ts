/** The verification-code email (plain text + HTML). */

export interface EmailCodeContext {
  code: string;
  name: string;
  isSignup: boolean;
  isReset: boolean;
  minutes: number;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const plural = (n: number) => (n === 1 ? '' : 's');

export function emailCodeText({ code, name, isSignup, isReset, minutes }: EmailCodeContext): string {
  let intro: string;
  if (isSignup) intro = `Hi${name ? ` ${name}` : ''}! Welcome aboard.\n\nYour code to finish signing up: ${code}`;
  else if (isReset) intro = `We received a request to reset your password.\n\nYour code to reset the password: ${code}`;
  else intro = `Your verification code: ${code}`;
  return (
    `${intro}\n\n` +
    `It expires in ${minutes} minute${plural(minutes)}.\n` +
    "If you didn't request this code, you can safely ignore this email.\n"
  );
}

export function emailCodeHtml({ code, name, isSignup, isReset, minutes }: EmailCodeContext): string {
  const safeCode = escapeHtml(code);
  const title = isSignup ? 'Confirm your email' : isReset ? 'Reset your password' : 'Your verification code';
  const lead = isSignup
    ? `Hi${name ? ` ${escapeHtml(name)}` : ''}! Enter this code to finish creating your account:`
    : isReset
      ? 'Enter this code to choose a new password:'
      : 'Enter this code to continue:';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeCode} is your verification code</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1f24;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;">
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:22px;">
                  ${title}
                </h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#6b7280;">
                  ${lead}
                </p>
                <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f4f5f7;border-radius:12px;font-family:'SFMono-Regular',Consolas,monospace;">
                  ${safeCode}
                </div>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b7280;">
                  The code expires in ${minutes} minute${plural(minutes)}. If you didn't request it, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}
