import { useState, useEffect, useRef, useCallback } from "react";

const CATEGORIES = [
  { id: "text", label: "Text" },
  { id: "vision", label: "Vision" },
  { id: "multilingual", label: "Multilingual" },
  { id: "image_gen", label: "Image Gen" },
];

const DEFAULT_PROMPTS = {
  text: "Hello! Which model are you?",
  vision: "What's in this image?",
  multilingual: "Translate 'good morning' into French, Japanese, and Hindi.",
  image_gen: "A lighthouse at dusk, watercolor style",
};

// Curl / usage snippets for each category, shown in the docs card.
function buildSnippet(category, origin, masterKey) {
  const key = masterKey || "YOUR_MASTER_KEY";
  if (category === "image_gen") {
    return `curl ${origin}/api/v1/images/generations \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "a lighthouse at dusk, watercolor style"
  }'`;
  }
  if (category === "vision") {
    return `curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "category": "vision",
    "messages": [{
      "role": "user",
      "content": [
        { "type": "text", "text": "What is in this image?" },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<BASE64_DATA>" } }
      ]
    }]
  }'`;
  }
  if (category === "multilingual") {
    return `curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "category": "multilingual",
    "messages": [{ "role": "user", "content": "Translate good morning into French, Japanese, and Hindi" }]
  }'`;
  }
  return `curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "category": "text",
    "messages": [{ "role": "user", "content": "hi" }]
  }'`;
}

const CATEGORY_NOTES = {
  text: "Plain chat completion. Routes across every text-capable model, biggest context window first.",
  vision: "Send an image alongside your prompt using OpenAI's multi-part content format — a text part plus an image_url part with a base64 data URL. Only routes to vision-tagged models.",
  multilingual: "Same endpoint as text, filtered to models tagged strong at multilingual output.",
  image_gen: "Separate endpoint — returns a base64 PNG instead of a chat message. Response shape differs from the other three categories.",
};

export default function Home() {
  const [masterKey, setMasterKey] = useState("");
  const [origin, setOrigin] = useState("");
  const [models, setModels] = useState(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  const [testCategory, setTestCategory] = useState("text");
  const [testPrompt, setTestPrompt] = useState(DEFAULT_PROMPTS.text);
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [imageName, setImageName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const [docsTab, setDocsTab] = useState("text");
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("gw_master_key");
    if (saved) setMasterKey(saved);
    setOrigin(window.location.origin);
  }, []);

  function saveKey(k) {
    setMasterKey(k);
    if (typeof window !== "undefined") localStorage.setItem("gw_master_key", k);
  }

  // Switching category swaps in a sensible default prompt, but only if
  // the user hasn't typed a custom one over a *different* category's default.
  function handleCategoryChange(cat) {
    setTestCategory(cat);
    setTestResult(null);
    if (Object.values(DEFAULT_PROMPTS).includes(testPrompt)) {
      setTestPrompt(DEFAULT_PROMPTS[cat]);
    }
    if (cat !== "vision") {
      clearImage();
    }
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result);
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setImageDataUrl(null);
    setImageName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }, []);

  async function loadModels() {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch("/api/v1/models", {
        headers: { Authorization: `Bearer ${masterKey}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setModels(data);
    } catch (e) {
      setModelsError(e.message);
    }
    setModelsLoading(false);
  }

  async function runTest() {
    setLoading(true);
    setTestResult(null);
    try {
      if (testCategory === "image_gen") {
        const res = await fetch("/api/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${masterKey}`,
          },
          body: JSON.stringify({ prompt: testPrompt }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        setTestResult({
          provider: res.headers.get("X-Gateway-Provider"),
          model: res.headers.get("X-Gateway-Model"),
          raw: data,
          isImage: true,
        });
      } else {
        const content =
          testCategory === "vision" && imageDataUrl
            ? [
                { type: "text", text: testPrompt },
                { type: "image_url", image_url: { url: imageDataUrl } },
              ]
            : testPrompt;

        const res = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${masterKey}`,
          },
          body: JSON.stringify({
            category: testCategory,
            messages: [{ role: "user", content }],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        setTestResult({
          provider: res.headers.get("X-Gateway-Provider"),
          model: res.headers.get("X-Gateway-Model"),
          raw: data,
          isImage: false,
        });
      }
    } catch (e) {
      setTestResult({ error: e.message });
    }
    setLoading(false);
  }

  function copySnippet() {
    const snippet = buildSnippet(docsTab, origin || "https://your-gateway.vercel.app", masterKey);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const needsImage = testCategory === "vision";
  const canRunTest = masterKey && (!needsImage || imageDataUrl) && testPrompt.trim();
  const activeModelCount = models?.data?.filter((m) => m.active).length ?? null;

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <div className="eyebrow">
            <span className="pulse-dot" aria-hidden="true" />
            personal-ai-gateway
          </div>
          <h1 className="title">AI Gateway</h1>
          <p className="subtitle">
            One master key, every free-tier model behind it. Automatic fallback across providers when one is rate-limited.
          </p>
        </header>

        {/* ---------------- Master key ---------------- */}
        <section className="card">
          <div className="card-title">
            <h2>Master key</h2>
          </div>
          <div className="field">
            <input
              className="input"
              type="password"
              placeholder="Paste your GATEWAY_MASTER_KEY"
              value={masterKey}
              onChange={(e) => saveKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <button className="btn btn-secondary" onClick={loadModels} disabled={!masterKey || modelsLoading}>
            {modelsLoading ? <span className="spinner" /> : null}
            {modelsLoading ? "Loading..." : "Load configured models"}
          </button>
          {modelsError && <p className="result-error" style={{ marginTop: 10 }}>{modelsError}</p>}
        </section>

        {/* ---------------- Models ---------------- */}
        {models && (
          <section className="card">
            <div className="card-title">
              <h2>Configured models</h2>
              <span className="hint">{activeModelCount} active</span>
            </div>
            <div className="model-list">
              {models.data.map((m, i) => (
                <div key={i} className={`model-item${m.active ? "" : " inactive"}`}>
                  <div className="model-item-top">
                    <span className="provider-badge">{m.provider_name}</span>
                    <span className="model-id">{m.model}</span>
                    <span
                      className={`status-tag ${
                        m.active ? (m.org_level_limit && m.keys_configured > 1 ? "warn" : "ok") : "off"
                      }`}
                    >
                      {m.active
                        ? m.org_level_limit && m.keys_configured > 1
                          ? `${m.keys_configured} keys (1 usable)`
                          : `${m.keys_configured} key(s)`
                        : "no key"}
                    </span>
                  </div>
                  <div className="model-meta">
                    <span className="cat">{m.categories.join(", ")}</span>
                    {m.context_window && <span>{(m.context_window / 1000).toFixed(0)}k ctx</span>}
                    {(m.limits.rpm || m.limits.rpd) && (
                      <span>
                        {m.limits.rpm ? `${m.limits.rpm}/min` : ""} {m.limits.rpd ? `${m.limits.rpd}/day` : ""}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------------- Test panel ---------------- */}
        <section className="card">
          <div className="card-title">
            <h2>Test the gateway</h2>
          </div>

          <div className="field">
            <label className="field-label">Category</label>
            <div className="segmented" role="tablist" aria-label="Test category">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={testCategory === c.id}
                  className={testCategory === c.id ? "active" : ""}
                  onClick={() => handleCategoryChange(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 8 }}>{CATEGORY_NOTES[testCategory]}</p>
          </div>

          {needsImage && (
            <div className="field">
              <label className="field-label">Image</label>
              {!imageDataUrl ? (
                <div
                  className={`dropzone${dragOver ? " dragover" : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                  <div className="dropzone-text">
                    <strong>Tap to upload</strong> or drag an image here
                  </div>
                </div>
              ) : (
                <div className="image-preview-wrap">
                  <img src={imageDataUrl} alt={imageName || "Uploaded preview"} className="image-preview" />
                  <button className="image-remove" onClick={clearImage} aria-label="Remove image" type="button">
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label className="field-label">{testCategory === "image_gen" ? "Image prompt" : "Prompt"}</label>
            <textarea
              className="textarea"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
            />
          </div>

          <button className="btn" onClick={runTest} disabled={loading || !canRunTest}>
            {loading ? <span className="spinner" /> : null}
            {loading ? "Running..." : "Send test request"}
          </button>
          {needsImage && !imageDataUrl && (
            <p className="muted" style={{ marginTop: 8 }}>Upload an image to test vision.</p>
          )}

          {testResult && (
            <div className="result-box">
              {testResult.error ? (
                <p className="result-error">{testResult.error}</p>
              ) : (
                <>
                  <p className="result-meta">
                    Answered by <b>{testResult.provider}</b> / <b>{testResult.model}</b>
                  </p>
                  {testResult.isImage ? (
                    testResult.raw?.data?.[0]?.b64_json ? (
                      <img
                        src={`data:image/png;base64,${testResult.raw.data[0].b64_json}`}
                        className="result-image"
                        alt="Generated result"
                      />
                    ) : (
                      <pre className="pre">{JSON.stringify(testResult.raw, null, 2)}</pre>
                    )
                  ) : (
                    <p className="result-answer">
                      {testResult.raw?.choices?.[0]?.message?.content || JSON.stringify(testResult.raw)}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* ---------------- Docs ---------------- */}
        <section className="card">
          <div className="card-title">
            <h2>Use from anywhere</h2>
          </div>
          <div className="tab-row" role="tablist" aria-label="Documentation category">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={docsTab === c.id}
                className={`tab${docsTab === c.id ? " active" : ""}`}
                onClick={() => setDocsTab(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginBottom: 10 }}>{CATEGORY_NOTES[docsTab]}</p>
          <div className="code-block-wrap">
            <button className="copy-btn" onClick={copySnippet} type="button">
              {copied ? "Copied" : "Copy"}
            </button>
            <pre className="pre">{buildSnippet(docsTab, origin || "https://your-gateway.vercel.app", masterKey)}</pre>
          </div>
        </section>

        <p className="footer-note">Personal AI gateway · master key never leaves your browser except to call your own API routes</p>
      </div>
    </div>
  );
}
