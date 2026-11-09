const APP = process.env.NEXT_PUBLIC_APP_NAME ?? "DeedWood";

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
<tr><td><p style="font-weight:600;color:#0C4C54;margin:0 0 16px">${APP}</p><h1 style="font-size:20px;margin:0 0 16px">${title}</h1>${body}</td></tr></table></body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#0C4C54;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${label}</a></p>`;
}

export function magicLinkEmail(url: string) {
  return {
    subject: `Your ${APP} sign-in link`,
    html: layout("Sign in", `<p>Click the button below to sign in. This link expires in 15 minutes and can be used once.</p>${button(url, "Sign in")}<p style="color:#475569;font-size:13px">If you didn't request this, you can ignore this email.</p>`),
    text: `Sign in to ${APP}: ${url}\nThis link expires in 15 minutes.`,
  };
}

export function inviteEmail(opts: { orgName: string; inviterName: string; roleName: string; url: string }) {
  return {
    subject: `${opts.inviterName} invited you to ${opts.orgName} on ${APP}`,
    html: layout(
      `Join ${opts.orgName}`,
      `<p>${opts.inviterName} invited you to join <strong>${opts.orgName}</strong> as <strong>${opts.roleName}</strong>.</p>${button(opts.url, "Accept invitation")}`,
    ),
    text: `${opts.inviterName} invited you to join ${opts.orgName} as ${opts.roleName}. Accept: ${opts.url}`,
  };
}
