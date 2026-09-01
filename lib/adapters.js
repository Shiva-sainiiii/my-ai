/**
 * ADAPTERS
 * ---------------------------------------------------------------
 * Every provider speaks a slightly different dialect. Each adapter
 * takes the gateway's normalized OpenAI-style payload and:
 *   1. Translates it to the provider's native request format
 *   2. Calls the provider
 *   3. Translates the response back to OpenAI-style
 *   4. Detects rate-limit responses and flags them distinctly
 *      (so the router knows to cool down + move to next candidate,
 *      rather than just failing outright)
 *
 * Return shape every adapter must produce:
 *   { data }                                  -> success
 *   { error: true, message }                  -> hard failure
 *   { rateLimited: true, retryAfterSeconds }   -> soft failure, retry elsewhere
 */

async function groqCall({ key, model, payload }) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key.value}`,
    },
    body: JSON.stringify({ ...payload, model }),
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
    return { rateLimited: true, retryAfterSeconds: retryAfter };
  }
  if (!res.ok) {
    const text = await res.text();
    return { error: true, message: `Groq ${res.status}: ${text.slice(0, 300)}` };
  }
  const data = await res.json();
  return { data };
}

async function openrouterCall({ key, model, payload }) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key.value}`,
      // OpenRouter asks for these but they're optional/cosmetic
      "HTTP-Referer": process.env.GATEWAY_PUBLIC_URL || "https://localhost",
      "X-Title": "Personal AI Gateway",
    },
    body: JSON.stringify({ ...payload, model }),
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
    return { rateLimited: true, retryAfterSeconds: retryAfter };
  }
  if (!res.ok) {
    const text = await res.text();
    return { error: true, message: `OpenRouter ${res.status}: ${text.slice(0, 300)}` };
  }
  const data = await res.json();
  return { data };
}

// Pulls the real mime type out of a data URL (e.g. "data:image/png;base64,...")
// instead of assuming jpeg — PNG/WebP uploads were previously mislabeled,
// which some providers reject or silently misdecode.
function parseDataUrl(url) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url || "");
  if (match) return { mimeType: match[1], data: match[2] };
  // Not a data URL (e.g. a raw https:// image URL) — fall back to the
  // previous split() behavior so http(s) URLs aren't broken either way.
  return { mimeType: "image/jpeg", data: (url || "").split(",")[1] || url };
}

async function googleAiStudioCall({ key, model, payload }) {
  // Google's native format differs from OpenAI's — translate messages[].
  const contents = (payload.messages || [])
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: Array.isArray(m.content)
        ? m.content.map((c) => {
            if (c.type !== "image_url") return { text: c.text };
            const { mimeType, data } = parseDataUrl(c.image_url.url);
            return { inline_data: { mime_type: mimeType, data } };
          })
        : [{ text: m.content }],
    }));

  const systemMsg = (payload.messages || []).find((m) => m.role === "system");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key.value}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
      generationConfig: {
        maxOutputTokens: payload.max_tokens || 8192,
        temperature: payload.temperature ?? 1,
      },
    }),
  });

  if (res.status === 429) {
    return { rateLimited: true, retryAfterSeconds: 60 };
  }
  if (!res.ok) {
    const text = await res.text();
    return { error: true, message: `Google AI Studio ${res.status}: ${text.slice(0, 300)}` };
  }
  const raw = await res.json();

  // Normalize back to OpenAI-style shape so the client always gets
  // the same response format regardless of which provider answered.
  const text = raw.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const data = {
    id: `google-${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: raw.usageMetadata?.promptTokenCount || 0,
      completion_tokens: raw.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: raw.usageMetadata?.totalTokenCount || 0,
    },
  };
  return { data };
}

async function cloudflareCall({ key, model, payload }) {
  const accountId = key.accountId;
  if (!accountId) {
    return { error: true, message: "Missing CF_ACCOUNT_ID for this key — set it in env vars." };
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key.value}`,
    },
    body: JSON.stringify({ messages: payload.messages }),
  });

  if (res.status === 429) {
    return { rateLimited: true, retryAfterSeconds: 60 };
  }
  if (!res.ok) {
    const text = await res.text();
    return { error: true, message: `Cloudflare ${res.status}: ${text.slice(0, 300)}` };
  }
  const raw = await res.json();
  const text = raw.result?.response || "";
  const data = {
    id: `cf-${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  };
  return { data };
}

async function cloudflareImageCall({ key, model, payload }) {
  const accountId = key.accountId;
  if (!accountId) {
    return { error: true, message: "Missing CF_ACCOUNT_ID for this key." };
  }
  const prompt = payload.prompt || payload.messages?.[payload.messages.length - 1]?.content || "";

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key.value}`,
    },
    body: JSON.stringify({ prompt }),
  });

  if (res.status === 429) return { rateLimited: true, retryAfterSeconds: 60 };
  if (!res.ok) {
    const text = await res.text();
    return { error: true, message: `Cloudflare image ${res.status}: ${text.slice(0, 300)}` };
  }

  // Flux/SDXL on Workers AI return raw image bytes (binary), not JSON
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const raw = await res.json();
    // Some CF image models return base64 in JSON instead of raw bytes
    return { data: { image_base64: raw.result?.image, model } };
  }
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return { data: { image_base64: base64, model } };
}

async function pollinationsCall({ key, model, payload }) {
  const prompt = payload.prompt || payload.messages?.[payload.messages.length - 1]?.content || "";
  const encoded = encodeURIComponent(prompt);
  // nologo=true removes the watermark IF you have a valid sk_ key attached;
  // on pure anonymous (no key) requests the watermark still appears.
  let url = `https://image.pollinations.ai/prompt/${encoded}?model=${model}&nologo=true`;

  const hasRealKey = key?.value && key.value !== "nokey";
  if (hasRealKey) {
    url += `&token=${key.value}`;
  }

  const res = await fetch(url);
  if (res.status === 429) {
    // Anonymous tier is ~1 req/15s — cool down a bit longer than other providers.
    return { rateLimited: true, retryAfterSeconds: hasRealKey ? 15 : 20 };
  }
  if (!res.ok) {
    return { error: true, message: `Pollinations ${res.status}` };
  }
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return { data: { image_base64: base64, model, source_url: url.replace(/&token=[^&]+/, "") } };
}

module.exports = {
  groq: { call: groqCall },
  openrouter: { call: openrouterCall },
  google_ai_studio: { call: googleAiStudioCall },
  cloudflare: {
    call: async (args) => {
      // route to text vs image handler based on model id
      if (args.model.includes("flux") || args.model.includes("stable-diffusion")) {
        return cloudflareImageCall(args);
      }
      return cloudflareCall(args);
    },
  },
  pollinations: { call: pollinationsCall },
};
