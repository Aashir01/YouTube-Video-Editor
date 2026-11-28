# The Cutroom website

People use Cutroom in their browser: they create an account and work in their own private studio. That studio is the same editor as the desktop app, with the Director already signed in to Cutroom AI. Nothing to install.

```
browser ─ https ─▶ Caddy ─▶ web hub (src/hub, :8080) ──▶ studio of person A (127.0.0.1:random)
                              │  sign-up / sign-in       ──▶ studio of person B
                              │  session cookie            (started on demand, stopped when idle)
                              ▼
                       Cutroom Cloud (:8787): accounts, credits, AI gateway
```

- **The hub** shows the sign-up page, which is also the landing page. Accounts are Cutroom Cloud accounts.
  - **Sessions:** after sign-in the browser holds only a random session id, in an HttpOnly, SameSite cookie. The person's Cloud token stays on the server.
  - **Passing traffic through:** every other request goes to that person's studio, including live updates, uploads and video seeking.
- **A studio** is the normal app in website mode (`CUTROOM_HOSTED=1`). It has its own data folder (`HUB_DATA/users/<account>/data`) and listens only on 127.0.0.1.
  - **Start and stop:** it starts on first use, in a second or two. It stops after `HUB_IDLE_MINUTES` without use, unless it is rendering, running the Director or working on a job.
  - **Shared caches:** studios share the render bundle and AI models (`HUB_DATA/shared-cache`), so only the first render ever bundles.
- **Website mode** changes four things:
  - No MCP: MCP servers start programs, and there is no `/mcp` endpoint.
  - Server-side downloads of user-given URLs can't reach private networks: the hub, other studios, or the cloud provider's metadata service.
  - A storage quota by plan, and an upload size limit.
  - Renders up to 1080p, with a limited number of frames worked on at once.

## Deploy

The website runs on the same server as Cutroom Cloud.

1. Point a domain at the server, for example `cutroom.aashirnoman.dev`, with an A record.
2. Run, as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Aashir01/YouTube-Video-Editor/main/scripts/setup-web-server.sh | WEB_DOMAIN=cutroom.aashirnoman.dev bash
```

[scripts/setup-web-server.sh](../scripts/setup-web-server.sh) does the following:

- installs FFmpeg, fonts and the libraries the render browser needs;
- updates the code and builds the editor;
- downloads the render browser;
- writes `.env.hub`;
- runs the hub as the `cutroom-web` systemd service, with its memory capped below the server's;
- adds the domain to Caddy without touching the Cloud site.

Run it again to update. Open studios restart.

## Settings (`.env.hub`)

| | Default | |
|---|---|---|
| `CLOUD_URL` | `http://127.0.0.1:8787` | Cutroom Cloud on the same server; the hub passes each visitor's address on for its sign-up limits |
| `HUB_MAX_APPS` | 40 | studios running at once; when full, the one unused longest (and not busy) stops |
| `HUB_IDLE_MINUTES` | 20 | stop a studio this long after its last use (an open tab counts as use) |
| `STORAGE_FREE_MB` / `STORAGE_CREATOR_MB` | 3000 / 30000 | storage per person, by plan (read when the studio starts) |
| `MAX_UPLOAD_MB` | 4096 | largest single upload |
| `RENDER_CONCURRENCY` | 2 | frames each render works on at once |
| `STUDIO_MEMORY_MB` | 3072 | memory each studio's Node process may use |
| `YOUTUBE_API_KEY` | | a Data API key every studio's idea radar may use (one shared daily quota) |

**Sizing:** an idle studio uses about 150–300 MB. Rendering is CPU-bound and shared between everyone, so with 4 vCPU only a few renders run quickly at the same time.

**Watching it:**
- `curl 127.0.0.1:8080/hub/health` shows how many studios are running.
- `journalctl -u cutroom-web` shows the hub's log.
- Each studio's log is `HUB_DATA/users/<account>/studio.log`.

## Not there yet

- **Password reset:** there is no reset by email yet, because Cloud has no email sending. Until then, reset a password by hand or create a new account.
- **YouTube uploads from the website** need a Google OAuth client of type *Web application*, with `https://<domain>/api/youtube/callback` as its redirect. For everyone to use it, Cutroom needs its own client verified by Google (the upload scope is a sensitive scope). Until then, people download the video and upload it themselves.
- **Isolation:** all studios run as the same system user. They are separated by folders and by never being reachable from outside, not by the operating system. Running each studio as its own user, or in a container, is the next step for stronger isolation.
- **Backups:** back up `HUB_DATA` (people's projects and media) along with the Cloud database. A provider snapshot is simplest.
