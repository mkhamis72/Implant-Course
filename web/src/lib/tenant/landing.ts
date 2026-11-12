import { normaliseHost } from './host';

/** The bare domain: every company is <name>.imploid.net, so this one belongs to none of them. */
const LANDING_HOSTS = new Set(['imploid.net', 'www.imploid.net']);

export function isLandingHost(raw: string | null | undefined): boolean {
  const host = normaliseHost(raw);
  return host !== null && LANDING_HOSTS.has(host);
}

/**
 * A plain page for the bare domain (also the Supabase Auth Site URL, the fallback no company owns). It names no
 * company, so it reveals nothing about who uses the service; no app shell, no Supabase call, nothing loaded.
 */
export function landingResponse(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Implant Course Manager</title></head>`
    + `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2933;line-height:1.5">`
    + `<h1 style="margin-bottom:.5rem">Implant Course Manager</h1>`
    + `<p>Patients, surgeries, stock and course reports for implant courses.</p>`
    + `<p>To sign in, open your organisation’s own address, for example <strong>yourcourse.imploid.net</strong>. Your course organiser can give you the link.</p>`
    + `<p><a href="/privacy">Privacy</a></p>`
    + `</body></html>`;
  return plainPage(html);
}

const PRIVACY_CONTACT = 'implantcourseapp@gmail.com';

/**
 * The public privacy page, on the bare domain only (/privacy). Google asks for one before "Sign in with Google"
 * can be offered to everyone. Like the landing page it names no company and loads nothing. Keep it true: change
 * the text when what the app stores or shares changes.
 */
export function privacyResponse(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy – Implant Course Manager</title></head>`
    + `<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:8vh auto;padding:0 1rem 4rem;color:#1f2933;line-height:1.55">`
    + `<p><a href="/">Implant Course Manager</a></p>`
    + `<h1>Privacy</h1>`
    + `<p>Last updated: 12 November 2026.</p>`
    + `<p>Implant Course Manager is a web app that organisers of dental implant courses use to run their courses. Each organisation has its own address and its own data. This page says what the app keeps about the people who sign in, and why.</p>`
    + `<h2>Your account</h2>`
    + `<p>Your organisation’s admin creates your account. We keep your name, your email address, your role, and whether your account is active. Your password is stored only in a scrambled (hashed) form that we cannot read. If you turn on two-step sign-in, we keep the secret that your authenticator app uses.</p>`
    + `<p>Each time you sign in we record a session: when it started, and the IP address and browser it came from. We use this to keep you signed in and to protect your account.</p>`
    + `<h2>Sign in with Google</h2>`
    + `<p>If you choose “Sign in with Google”, Google tells us your email address, whether Google has confirmed it, and an identifier for your Google account. We use these only to find your existing account and sign you in. We keep the identifier so that the same Google account is recognised next time.</p>`
    + `<p>We never see your Google password. We do not read your Gmail, contacts, calendar, files or anything else in your Google account. We do not use what Google tells us for advertising, and we do not pass it to anyone else.</p>`
    + `<h2>What your organisation enters</h2>`
    + `<p>Organisers record course information in the app, such as patients, surgeries, stock and reports. That information belongs to the organisation that entered it, and it decides who can see it. If you have a question about a record an organisation holds, ask that organisation.</p>`
    + `<h2>Sharing</h2>`
    + `<p>We do not sell personal information and we show no adverts. Information is stored with the companies that host the app and its database, and email is sent through an email service. They handle it only to run the app for us.</p>`
    + `<h2>Cookies</h2>`
    + `<p>The app uses only the cookies it needs to keep you signed in. There are no tracking or advertising cookies.</p>`
    + `<h2>Keeping and deleting</h2>`
    + `<p>We keep your account while your organisation uses the app. Sessions end on their own after a period without use. To have your account corrected or deleted, or to stop using Google sign-in, ask your organisation’s admin or write to us.</p>`
    + `<h2>Contact</h2>`
    + `<p><a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a></p>`
    + `</body></html>`;
  return plainPage(html);
}

function plainPage(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
