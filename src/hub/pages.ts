/** The website's own pages (everything else is the person's studio). Plain HTML, no scripts needed. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `
:root { color-scheme: dark; --bg:#05060a; --panel:rgba(255,255,255,.04); --line:rgba(255,255,255,.1); --text:#eef0f7; --muted:#a3a9bb; --dim:#6f768a; --accent:#ff5a1f; --accent2:#8b7bff; --danger:#ff4d6d; }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; font: 15px/1.5 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color:var(--text);
  background: radial-gradient(60% 50% at 15% 0%, rgba(255,90,31,.16), transparent 70%), radial-gradient(50% 50% at 90% 10%, rgba(139,123,255,.16), transparent 70%), var(--bg); }
.wrap { max-width: 1060px; margin: 0 auto; padding: 28px 20px 60px; display: grid; grid-template-columns: 1.15fr .85fr; gap: 48px; align-items: center; min-height: 100vh; }
@media (max-width: 860px) { .wrap { grid-template-columns: 1fr; gap: 28px; padding-top: 24px; } }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:18px; letter-spacing:-.02em; }
.logo { width:34px; height:34px; border-radius:10px; background:var(--accent); display:grid; place-items:center; box-shadow:0 6px 20px -6px rgba(255,90,31,.6); }
h1 { font-size: clamp(32px, 5vw, 50px); line-height:1.05; letter-spacing:-.035em; margin: 22px 0 14px; }
h1 span { background: linear-gradient(90deg, var(--accent), var(--accent2)); -webkit-background-clip:text; background-clip:text; color:transparent; }
.lead { color:var(--muted); font-size:16px; max-width: 520px; }
ul.feats { list-style:none; padding:0; margin: 22px 0 0; display:grid; gap:9px; color:var(--muted); font-size:14px; }
ul.feats li::before { content:'✦'; color:var(--accent); margin-right:9px; }
.card { background: var(--panel); border:1px solid var(--line); border-radius: 18px; padding: 22px; backdrop-filter: blur(20px); box-shadow: 0 30px 80px -30px rgba(0,0,0,.9); }
.tabs { display:flex; gap:4px; background: rgba(0,0,0,.3); padding:3px; border-radius:10px; margin-bottom:16px; }
.tabs a { flex:1; text-align:center; padding:7px; border-radius:8px; color:var(--muted); text-decoration:none; font-weight:600; font-size:13px; }
.tabs a.on { background: rgba(255,255,255,.09); color:var(--text); }
label { display:block; font-size:12px; color:var(--dim); margin: 10px 0 4px; font-weight:600; }
input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background: rgba(0,0,0,.35); color:var(--text); font:inherit; }
input:focus { outline: none; border-color: rgba(255,90,31,.7); }
button { width:100%; margin-top:16px; padding: 11px; border:0; border-radius: 10px; background: var(--accent); color:#fff; font: 600 15px inherit; font-family: inherit; cursor:pointer; box-shadow: 0 8px 24px -10px rgba(255,90,31,.8); }
.err { margin-top: 12px; padding: 9px 12px; border-radius: 10px; background: rgba(255,77,109,.12); color: var(--danger); font-size: 13px; }
.note { margin-top: 12px; color: var(--dim); font-size: 12px; text-align:center; }
.foot { color: var(--dim); font-size: 12px; margin-top: 26px; }
`;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="Cutroom: an AI video editor for YouTube creators. Edit, caption, make Shorts and publish, with an AI Director.">
<style>${STYLE}</style></head><body>${body}</body></html>`;

const LOGO = `<span class="logo"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span>`;

export const authPage = (opts: { mode: 'signup' | 'login'; error?: string; email?: string; name?: string; invite?: string; next?: string }) => {
  const signup = opts.mode === 'signup';
  const hidden = opts.next ? `<input type="hidden" name="next" value="${esc(opts.next)}">` : '';
  const q = (m: string) => `/${m}${opts.invite ? `?invite=${encodeURIComponent(opts.invite)}` : ''}`;
  return page(
    signup ? 'Cutroom: create your free account' : 'Cutroom: sign in',
    `<main class="wrap">
  <section>
    <div class="brand">${LOGO} Cutroom</div>
    <h1>Edit YouTube videos with an <span>AI Director</span></h1>
    <p class="lead">Describe the video you want. The Director scripts, cuts, captions, adds music and graphics, finds your best Shorts and gets it ready for YouTube. Right here in your browser.</p>
    <ul class="feats">
      <li>Free AI credits to start, no API keys</li>
      <li>Find Shorts, auto captions, subtitles in other languages</li>
      <li>Retention coach, multicam podcasts, background removal</li>
      <li>Creator plan $3 a month, or pay as you go</li>
    </ul>
  </section>
  <section class="card">
    <div class="tabs"><a href="${q('signup')}" class="${signup ? 'on' : ''}">Create account</a><a href="${q('login')}" class="${signup ? '' : 'on'}">Sign in</a></div>
    <form method="post" action="/${opts.mode}">
      ${hidden}
      ${signup ? `<label for="name">Name (optional)</label><input id="name" name="name" autocomplete="name" value="${esc(opts.name ?? '')}">` : ''}
      <label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" value="${esc(opts.email ?? '')}">
      <label for="password">Password</label><input id="password" name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">
      ${signup ? `<label for="invite">Invite code (optional)</label><input id="invite" name="invite" value="${esc(opts.invite ?? '')}" style="text-transform:uppercase">` : ''}
      ${opts.error ? `<div class="err" role="alert">${esc(opts.error)}</div>` : ''}
      <button type="submit">${signup ? 'Create account and get free credits' : 'Sign in'}</button>
    </form>
    <div class="note">${signup ? 'Free to start. Your projects stay private to your account.' : 'No account yet? Create one; it takes a minute.'}</div>
  </section>
</main>`,
  );
};

export const messagePage = (title: string, text: string, link?: { href: string; label: string }) =>
  page(`Cutroom: ${title}`, `<main class="wrap" style="grid-template-columns:1fr;max-width:560px"><section class="card"><div class="brand">${LOGO} Cutroom</div><h1 style="font-size:28px">${esc(title)}</h1><p class="lead">${esc(text)}</p>${link ? `<p><a href="${esc(link.href)}" style="color:#c7beff">${esc(link.label)}</a></p>` : ''}</section></main>`);
