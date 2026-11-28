# Cutroom Cloud: accounts, credits and the AI gateway

Cutroom Cloud lets people use the Director without an API key. They create an account in **Settings → Cutroom AI**, get free credits, and pay only for the AI they use. The app treats Cloud as one more OpenAI-compatible provider. Cloud forwards each request to OpenRouter with **your** key and charges the account what that request really cost.

```
Cutroom app ── Bearer crk_… ──▶ Cutroom Cloud ── your OpenRouter key ──▶ OpenRouter ──▶ DeepSeek, Qwen, Gemini, Claude…
  (Settings → Cutroom AI)        accounts, credit ledger,                 reports each request's cost
                                 model catalog, admin
```

Cloud is a separate server in `src/cloud/`. It runs on Node 22.5+ (built-in SQLite), with one database file and no other services. Everything else in Cutroom stays local and free: editing, rendering, local transcription and voices.

## Run it

```bash
cp .env.cloud.example .env.cloud     # set OPENROUTER_API_KEY and ADMIN_TOKEN
npm run cloud                        # http://localhost:8787
```

The app looks for Cloud at `CUTROOM_CLOUD_URL`, or `http://localhost:8787` by default. A user can change it under **Settings → Cutroom AI → Advanced**. Once Cloud is deployed, set `DEFAULT_CLOUD_URL` in `src/server/config.ts` to its address so builds point there.

### Deploy

**Quick way:** on a fresh Ubuntu 24.04 server, run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Aashir01/YouTube-Video-Editor/main/scripts/setup-cloud-server.sh | bash
```

The script ([scripts/setup-cloud-server.sh](../scripts/setup-cloud-server.sh)) does everything in the steps below:

- installs Node 22, Caddy and SQLite;
- opens only SSH, HTTP and HTTPS;
- installs Cloud as a systemd service with a generated `ADMIN_TOKEN`;
- serves it over HTTPS, at `DOMAIN` or else at `<ip>.sslip.io`;
- backs up the database daily.

Then add `OPENROUTER_API_KEY` to `/home/cutroom/app/.env.cloud` and run `systemctl restart cutroom-cloud`. Run the script again to update.

**By hand:**

A small VPS is plenty to start with: Cloud only relays requests and writes small rows.

1. Install Node 22.5 or newer and copy the repository (or the Docker image, which includes `src/cloud`).
2. Put `.env.cloud` next to it with `CLOUD_DB=/var/lib/cutroom/cloud.db` and `TRUST_PROXY=1`.
3. Run `npm run cloud` under systemd (or `docker run … cutroom npm run cloud`), behind Caddy or nginx for HTTPS:

   ```
   cloud.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```

4. Back up the database daily. Run `sqlite3 /var/lib/cutroom/cloud.db ".backup /backups/cloud-$(date +%F).db"`: it is safe while Cloud is running.

## Plans and credits

**One credit = $0.001 of upstream cost** (`CREDIT_USD`). Each request is charged `ceil(cost × CLOUD_MARKUP / CREDIT_USD)`. The cost comes from OpenRouter's `usage.cost` for that request. If an upstream reports no cost, Cloud uses tokens × catalog price. The 1.15 markup covers OpenRouter's fee on credit purchases, payment fees and the free credits.

| | Price | Credits | Models |
|---|---|---|---|
| **Free** | $0 | 300 once at signup, plus 50 each month | standard |
| **Creator** | $3/month ($9 a quarter, $29 a year) | 2,000 each month, no rollover | standard + Pro |
| **Credit packs** | $5 / $10 / $20 | 4,000 / 8,500 / 18,000, never expire | unlock Pro |

**Spending order:**

1. this month's allowance;
2. gifts (signup, referrals);
3. bought credits.

**Free and Pro models:** free accounts use the standard models. Pro models (Claude, GPT-5, Gemini Pro) need Creator or a bought pack.

**Before a request:** Cloud checks that the account can afford the prompt plus a normal-length reply. It also allows at most 4 requests running at once per account.

**When credits run out:** the Director stops with "You're out of Cutroom AI credits…", and the top-bar meter turns red.

All of these numbers are settings in `.env.cloud`.

### Invites and the badge (the growth loop)

- **Invites:** every account has an invite code, shown in Settings → Cutroom AI with **Copy invite** and **WhatsApp** buttons.
  - **The friend** gets 100 extra credits for joining with it.
  - **The inviter** gets 300 credits once the friend has really used Cutroom AI (100 credits of requests), so made-up accounts earn nothing. This reward is capped at 10 a month.
  - **On the friend's first purchase,** the inviter gets 1,000 more.
  - **Where it goes:** rewards land in the gift bucket. The amounts are set by the `REFERRAL_*` variables.
- **The badge:** renders made while signed in on the **Free** plan end with a small "Made with Cutroom" badge for the last 3.5 seconds. YouTube uploads from the app add a line to the description: "Edited with Cutroom" and a link.
  - **Creator** removes both; the Export dialog says so.
  - **Not signed in:** people using their own keys, or no AI at all, never get the badge.
  - **Link:** the address is `PRODUCT.site` in `src/shared/product.ts`.

### Will $3 cover a creator's month?

The target is about 10 videos, 10 Shorts and 3 long videos a month on Creator (2,000 credits).

**How Cutroom Auto routes requests:**

- Text steps go to DeepSeek V3.2. It is $0.28 in / $0.42 out per million tokens, and repeated prompts hit its cache at about a tenth of that price.
- Only steps with frames go to Gemini 2.5 Flash.
- Small jobs (titles, translations, Find Shorts) use Cutroom Fast (Gemini Flash-Lite).

**Estimates:**

| Job | Typical tokens | Credits |
|---|---|---|
| A 10-minute video, edited with the Director | ~400K in (mostly cached) / 15K out | ~60 |
| A Short (Find Shorts + touch-up) | ~150K in / 6K out | ~30 |
| A 40-minute podcast | ~900K in / 30K out | ~140 |

That comes to about 1,300 credits for the month, leaving room for retries and translations.

These are estimates. The ledger records tokens and upstream cost for every request, so check real usage with `GET /v1/admin/stats` after launch. Then tune `CREATOR_MONTHLY_CREDITS`, the markup or the catalog.

### Margins

| Product | Revenue after payment fees (~5% + $0.50) | Upstream cost if every credit is used | Margin |
|---|---|---|---|
| Creator, paid quarterly | ~$2.68 a month | 2,000 credits = $1.74 (+ OpenRouter fee) | ~$0.85 a month |
| $5 pack | $4.25 | 4,000 credits = $3.48 (+ fee) | ~$0.58 |

Monthly billing at $3 loses about $0.65 to the fixed fee, so offer quarterly or yearly first. Most accounts don't use every credit.

## Models

The catalog is in `src/cloud/catalog.ts`. To replace it without code, point `CLOUD_MODELS` at a JSON file with entries like this:

```json
[{ "id": "auto", "name": "Cutroom Auto", "route": ["deepseek/deepseek-v3.2"], "visionRoute": ["google/gemini-2.5-flash"], "tier": "standard", "vision": true, "note": "…", "price": { "input": 0.3, "output": 2.5 } }]
```

**How the fields work:**

- **`id`:** what the app sends.
- **`route`:** the OpenRouter models to try, in order. OpenRouter falls back down the list.
- **`visionRoute`:** used instead of `route` when a request carries images.
- **`price`:** only for estimates, and for upstreams that report no cost.
- **`markup`:** optional, per model, on top of the global markup.

The app signs in with `auto` (Director) and `auto-fast` (small jobs). Changing those two entries moves every user to a new model at once.

Check model ids and prices on openrouter.ai/models before you launch: they change often.

## Admin

Everything takes `Authorization: Bearer $ADMIN_TOKEN`:

```bash
C=https://cloud.example.com; A="Authorization: Bearer $ADMIN_TOKEN"; J="Content-Type: application/json"
# a manual payment (JazzCash, Easypaisa, bank transfer): ref makes it count once
curl -X POST $C/v1/admin/purchase -H "$A" -H "$J" -d '{"email":"user@example.com","product":"creator_quarter","ref":"jazzcash-123456"}'
# products: creator_month, creator_quarter, creator_year, pack_5, pack_10, pack_20
curl -X POST $C/v1/admin/grant -H "$A" -H "$J" -d '{"email":"user@example.com","credits":500,"note":"Sorry for the outage"}'
curl -X POST $C/v1/admin/plan  -H "$A" -H "$J" -d '{"email":"user@example.com","plan":"creator","months":1}'
curl "$C/v1/admin/users?q=example.com" -H "$A"
curl  $C/v1/admin/stats -H "$A"          # users, paid users, requests, credits spent, upstream cost (30 days)
```

## Payments

There is no registered business yet, so payments start manual:

1. Set `CONTACT_URL` (a WhatsApp link works well). Each plan in the app shows **Ask for this** and links there.
2. The person pays you through JazzCash, Easypaisa or a bank transfer.
3. You apply the payment with `/v1/admin/purchase`, using the transaction id as `ref`.

**Once the business is registered:**

- **Merchant of record:** use one that pays out to Pakistan. Paddle and Polar did when this was written; confirm before signing up. Stripe alone doesn't onboard Pakistani businesses.
- **Checkout links:** set one per product, `CHECKOUT_URL_<PRODUCT>`. The app adds the buyer's `?email=`.
- **Webhook:** add a webhook route that verifies the provider's signature and calls `ledger.purchase(userId, product, transactionId)`, which applies each transaction only once.
- **Regional prices** (for example $3 in South Asia, more elsewhere) are set in the payment provider.

## Security

- **Passwords:** hashed with scrypt.
- **App tokens** (`crk_…`): only their SHA-256 hash is stored. The app keeps the token in its settings (file mode 600) and never sends it to the browser.
- **Limits:**
  - signups: `SIGNUPS_PER_IP_PER_DAY` per network;
  - sign-ins: 20 failed attempts per network per 15 minutes;
  - requests: 32 MB per request body and 4 AI requests at once per account.
- **Admin:** endpoints are disabled unless `ADMIN_TOKEN` is set, and the token is compared in constant time.
- **Before a public launch:**
  - add email verification or Google sign-in, so signup credits can't be farmed with throwaway emails;
  - add a captcha (for example Cloudflare Turnstile) on signup;
  - set a monthly spend limit on the OpenRouter key.

## API

| | |
|---|---|
| `GET /v1/health` | status |
| `GET /v1/models` | catalog (OpenAI list format plus `tier`, `vision`, `note`, `price`) |
| `GET /v1/plans` | plans, products, checkout links, contact |
| `POST /v1/account/signup` | `{ email, password, name?, device?, referral? }` → `{ token, account }` |
| `POST /v1/account/login` | `{ email, password, device? }` → `{ token, account }` |
| `POST /v1/account/logout` | revoke this token |
| `GET /v1/account` | plan, credits by bucket, next reset |
| `GET /v1/account/usage` | ledger rows (model, tokens, cost) and this period's totals |
| `POST /v1/chat/completions` | OpenAI-compatible, streaming or not, billed in credits. `402 out_of_credits`, `403 pro_model` |
