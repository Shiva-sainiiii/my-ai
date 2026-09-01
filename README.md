# Personal AI Gateway

Ek single master API key se saare free-tier AI providers (Groq, Google AI
Studio, OpenRouter, Cloudflare Workers AI, Pollinations) ka access — text,
vision, image-generation, sab kuch. Jab ek provider/key ka daily ya per-minute
limit hit ho jaaye, gateway automatically agla available key ya provider try
karta hai — koi manual switching nahi.

## Is version me kya sudhara (UI pass)

Backend (`lib/`, `pages/api/`) same hai — sirf `pages/index.js` UI poori tarah
rewrite hui hai:

- **Vision testing fix**: "Vision" category select karne pe ab image upload
  field dikhta hai (tap-to-upload + drag-drop, preview, remove button). Image
  automatically base64 data URL me convert hoke request ke saath OpenAI-style
  multi-part `content` array me jaata hai — backend ka format already yahi
  expect karta tha, sirf UI se koi rasta nahi tha image bhejne ka.
- **Documentation fix**: "Use from anywhere" section ab tabs ke saath saari 4
  categories (Text, Vision, Multilingual, Image Gen) ka curl example dikhata
  hai, har ek ke saath ek-line note ki us category ka request/response shape
  baaki se kaise alag hai. Copy button bhi add kiya.
- **Mobile responsive**: purani UI fixed-width inline `gridTemplateColumns`
  table use karti thi jo chhoti screen pe toot jaati thi. Ab real CSS
  (`styles/globals.css`) hai — category picker ek segmented control hai (no
  dropdown-hunting on mobile), model list cards me hai (table nahi), sab kuch
  320px se upar properly stack/wrap karta hai.
- UI/UX polish: loading spinners, disabled states jab tak required fields
  (master key, image jab vision selected ho) na bhare ho, error messages
  saaf dikhte hain, focus states keyboard users ke liye.

Agar aage router/registry/adapters me changes chahiye (naye providers, model
list update, etc.) wo is pass me nahi chhue gaye — sirf UI improve hui hai.

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
