# FEDL Email Worker

Handles incoming emails and can send emails using Cloudflare Workers Email.

## Setup

### 1. Configure Email Routing (Cloudflare Dashboard)

1. Go to **Email** → **Email Routing** in Cloudflare Dashboard
2. Select your domain **fedl.site**
3. Add an email address: `help@fedl.site`
4. Create a routing rule:
   - **When**: A message is sent to `help@fedl.site`
   - **Then**: Route to **Worker** → `fedl-email-worker`

### 2. Deploy the Worker

```bash
cd worker
npm install
npx wrangler deploy
```

### 3. Configure Worker Bindings

In `wrangler.jsonc`, add:

```json
{
  "name": "fedl-email-worker",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "vars": {
    "FORWARD_TO": "your-inbox@gmail.com"
  }
}
```

### 4. Environment Variables

| Variable | Purpose |
|----------|---------|
| `FORWARD_TO` | Email address to forward incoming emails to |
| `SEND_EMAIL` | Cloudflare Email binding (auto-configured) |

## API Endpoints

### Send Email
```
POST /send
Content-Type: application/json

{
  "to": "user@example.com",
  "subject": "Password Reset",
  "text": "Click here to reset: ..."
}
```

### Update wrangler.jsonc for Cloudflare Pages/Workers

Make sure your `wrangler.jsonc` has the email binding configured in the Cloudflare dashboard under Workers & Pages → your worker → Settings → Variables.
