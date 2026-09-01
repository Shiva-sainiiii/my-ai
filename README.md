# Personal AI Gateway

Ek single master API key se saare free-tier AI providers (Groq, Google AI
Studio, OpenRouter, Cloudflare Workers AI, Pollinations) ka access — text,
vision, image-generation, sab kuch. Jab ek provider/key ka daily ya per-minute
limit hit ho jaaye, gateway automatically agla available key ya provider try
karta hai — koi manual switching nahi.

## Round 2: vision 503 fix + registry correction + multimodal category

**Root cause of vision returning 503 (all providers exhausted):** Groq had
deprecated BOTH of its vision candidates server-side —
`meta-llama/llama-4-scout-17b-16e-instruct` (deprecated Jun 17, 2026) and
`meta-llama/llama-4-maverick-17b-128e-instruct` (deprecated Feb 20, 2026).
Every call to them failed instantly since the model IDs no longer exist on
Groq's side — this is a genuine registry-drift bug, not an intent/config
issue. On top of that:

- `gemini-2.0-flash` in the Google section was **shut down June 1, 2026** —
  a dead model sitting in the candidate list, guaranteed to fail.
- `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` (Groq text models)
  are also deprecated (announced Jun 17, 2026) — this wasn't causing visible
  failures because text/multimodal still had other working candidates
  (Cloudflare), but they were dead weight burning through router attempts.
- Cloudflare's vision model (`@cf/meta/llama-3.2-11b-vision-instruct`) is
  still live and free, but Cloudflare requires a **one-time per-account
  license acceptance** before it actually serves image requests. **Action
  needed from you**: for every `CF_KEY_N` / `CF_ACCOUNT_ID_N` pair
  configured in Vercel, run this once —
  ```
  curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
    -H "Authorization: Bearer $CF_TOKEN" -d '{"prompt":"agree"}'
  ```
  Until you do this per account, that one candidate will keep failing even
  though the code and model ID are both correct — everything else in the
  registry fix should already get you a working vision response from Groq,
  Google, or OpenRouter before it ever reaches Cloudflare in the fallback
  order.

**Registry fixes (`lib/registry.js`)**: removed every dead model above,
replaced Groq's vision slot with `qwen/qwen3.6-27b` (Groq's own recommended
migration target — a single free, current, Preview-tier model that natively
does text + image in, text out), replaced Groq's text slot with
`openai/gpt-oss-120b` / `openai/gpt-oss-20b`, replaced `gemini-2.0-flash`
with `gemini-3-flash-preview` alongside the still-valid `gemini-2.5-flash`
and `gemini-2.5-flash-lite`.

**"Multilingual" → "Multimodal"**: the old `multilingual` category was
functionally redundant with `text` (most text models here have decent
multilingual output anyway). Replaced it with what was actually wanted — a
`multimodal` category for models where text+image is one native model
rather than two separate calls. Currently routes to `qwen/qwen3.6-27b`
(Groq), the Gemini Flash models, and the OpenRouter/Cloudflare vision
models — anywhere a single model genuinely does both. `pages/index.js`'s
UI, docs tabs, and curl examples were all updated to match; the image
upload flow now works for both the Vision and Multimodal tabs.

**Also fixed**: `lib/adapters.js`'s Google adapter was hardcoding
`mime_type: "image/jpeg"` for every uploaded image regardless of actual
file type — harmless for `.jpg` uploads (which is why your test looked
fine on the working providers) but would silently mislabel PNG/WebP
uploads sent to Google. Now parses the real mime type out of the data URL.

## Round 1: UI/UX pass

Backend (`lib/`, `pages/api/`) unchanged in round 1 — `pages/index.js` UI was
rewritten for image upload support, full docs coverage of every category,
and mobile responsiveness via a real `styles/globals.css` instead of fixed
inline-style grids.

## Kaise kaam karta hai

```
Your App / curl
      │  Authorization: Bearer <GATEWAY_MASTER_KEY>
      ▼
 /api/v1/chat/completions  (ya /images/generations)
      │
      ▼
   router.js
      │  1. category ke hisaab se saare matching (provider, key, model)
      │     combos ki ek list banata hai — sorted by context window (default)
      │  2. Vercel KV me check karta hai: is combo ka rpm/rpd already
      │     exhausted to nahi? cooldown me to nahi?
      │  3. Nahi hai to us combo ko try karta hai
      │  4. 429 mila -> us combo ko cooldown me daal ke agla try karta hai
      │  5. Success mila -> response wapas bhej deta hai
      ▼
  Groq / Google / OpenRouter / Cloudflare / Pollinations
```

Failover fully automatic hai — aapko kuch bhi manually switch nahi karna.

## Setup (5 steps)

### 1. Redis database banao
Vercel dashboard > apna project > **Storage** tab > **Browse Storage** >
**Redis** (marketplace integration). Connect karte waqt jo "Custom Prefix"
poochta hai wahan `KV` bhar dena (default `STORAGE` ko replace karke) — code
`KV_REDIS_URL` (ya `REDIS_URL`/`KV_URL`, jo bhi mile) env var dhoondta hai.

**⚠️ Sep 2026 se Vercel ka Redis integration sirf ek raw connection string
deta hai** (`KV_<PREFIX>_URL`, jaisे `redis://default:xxx@host:6379`) — purana
"Vercel KV" product jo REST API vars (`KV_REST_API_URL`/`TOKEN`) deta tha, wo
ab standalone nahi hai. Isliye ye gateway `@vercel/kv` ke bajaye standard
`redis` (node-redis) npm package use karta hai, jo TCP connection string se
seedha connect hota hai — koi extra REST vars nahi chahiye.

**Ye step zaroori hai** — serverless functions stateless hote hain, so rate-limit
tracking (kitne requests already ho chuke is minute/day me) ke liye ek shared
persistent store chahiye. Bina iske, "next key pe switch ho jaye" wala feature
reliably kaam nahi karega.

### 2. Har provider se free API keys lo

| Provider | Kahan se milega | Free limits (verified Sep 2026) | Multi-key rotation kaam karega? |
|---|---|---|---|
| Groq | console.groq.com/keys | 30 rpm, 1000-14400 rpd (model-dependent) | ❌ **Nahi** — org-level limit |
| Google AI Studio | aistudio.google.com/apikey | 10-15 rpm, 250-1500 rpd (model-dependent) | ❌ **Nahi** — project-level limit |
| OpenRouter | openrouter.ai/settings/keys | 20 rpm, 50 rpd (1000 rpd after lifetime $10 credit) | ✅ **Haan** — per-account limit |
| Cloudflare Workers AI | dash.cloudflare.com (Account ID) + API Token with Workers AI:Edit | 10,000 neurons/day shared pool | ❌ **Nahi** — account-level limit |
| Pollinations | koi key nahi chahiye (ya sk_ key free milta hai enter.pollinations.ai se) | ~4 rpm anonymous (watermarked); sk_ key se zyada aur bina watermark | ✅ Haan, agar alag keys ho |

**⚠️ Bahut important — "multi-key rotation" sirf tab kaam karta hai jab keys
genuinely separate accounts se ho:**

Groq, Google AI Studio, aur Cloudflare — teeno ki free-tier limit **account/project
level** pe lagti hai, per-key nahi. Ek hi account se banayi gayi multiple keys
**same bucket share karengi** — koi extra headroom nahi milega.

Is repo me `orgLevelLimit: false` set hai in teeno providers ke liye, kyunki
current setup me har provider ke 4 configured keys **4 genuinely separate
accounts** se hain (user-verified — code khud ye verify nahi kar sakta).
Isi wajah se `router.js` in teeno providers ki saari 4 keys try karta hai,
sirf pehli wali nahi.

**Agar future me kisi provider me ek naya key add karna ho:** wo zaroor ek
**bilkul nayi account** se hona chahiye — kisi existing account ki dusri key
nahi. Agar galti se same-account ki do keys registry me aa gayin, to woh
dono ek hi bucket share karengi aur aapko sirf extra 429 errors milenge,
real headroom nahi. Aisi situation me us provider ka `orgLevelLimit` wapas
`true` kar dena taaki gateway sirf ek key try kare.

### 3. Master key generate karo
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Ye output `GATEWAY_MASTER_KEY` env var me daal do. Ye wahi key hai jo aap
har request me use karoge — baaki saari provider keys internally chhupi
rehti hain.

### 4. Saare env vars Vercel me daalo
`.env.example` file ko reference bana ke Vercel dashboard > Settings >
Environment Variables me sab paste karo.

### 5. Deploy
```bash
vercel --prod
```
Ya bas GitHub pe push kar do agar Vercel already git-connected hai — auto
deploy ho jayega.

## Use karna

### Text / reasoning / multilingual chat
```bash
curl https://your-gateway.vercel.app/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "text",
    "messages": [{"role":"user","content":"Explain quantum computing simply"}]
  }'
```

### Vision (image samajhna)
```bash
curl https://your-gateway.vercel.app/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "vision",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Is image me kya hai?"},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
      ]
    }]
  }'
```

### Image generation
```bash
curl https://your-gateway.vercel.app/api/v1/images/generations \
  -H "Authorization: Bearer YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a cyberpunk city at night, neon lights"}'
```

### Specific provider/model force karna
Normally gateway khud best available choose karta hai (biggest context
window first). Agar aapko specific provider/model chahiye:
```json
{
  "category": "text",
  "provider": "groq",
  "model": "llama-3.3-70b-versatile",
  "messages": [...]
}
```

### Configured models dekhna
Browser me apne deployed URL pe jaao — dashboard dikhega jisme saare
active models, unke limits, aur ek test-request button hoga. Ya:
```bash
curl https://your-gateway.vercel.app/api/v1/models \
  -H "Authorization: Bearer YOUR_MASTER_KEY"
```

## Naya provider ya model add karna

Sab kuch `lib/registry.js` me hai. Naya model add karna ho to bas us
provider ke `models` array me entry daal do — code kahin aur change
karne ki zaroorat nahi. Bilkul naya provider add karna ho to:
1. `lib/registry.js` me naya provider block add karo
2. `lib/adapters.js` me uske request/response format ka adapter likho
3. `.env.example` me uske key env vars document karo

## Important notes

- **Rate limits registry me hardcoded hain** — providers apne free-tier
  limits kabhi bhi change kar sakte hain. Agar consistently 429 aa raha
  hai, `lib/registry.js` me us model ke `limits` object update kar do.
- **Cloudflare ka rpd null hai** kyunki wo per-model nahi, poore account
  ka ek shared "10,000 neurons/day" budget hai — exact request count
  model-dependent hai, isliye hard rpd cap nahi laga sakte. Neuron
  exhaust hote hi provider khud 429 dega, jo gateway automatically
  catch karke agle provider pe switch kar dega.
- **Pollinations ka rate limit unofficial/soft hai** — koi published
  number nahi hai, `rpm: 60` ek polite conservative guess hai.
