import { useState, useEffect } from "react";

export default function Home() {
  const [masterKey, setMasterKey] = useState("");
  const [models, setModels] = useState(null);
  const [testPrompt, setTestPrompt] = useState("Hello! Which model are you?");
  const [testCategory, setTestCategory] = useState("text");
  const [testResult, setTestResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("gw_master_key") : "";
    if (saved) setMasterKey(saved);
  }, []);

  function saveKey(k) {
    setMasterKey(k);
    if (typeof window !== "undefined") localStorage.setItem("gw_master_key", k);
  }

  async function loadModels() {
    const res = await fetch("/api/v1/models", {
      headers: { Authorization: `Bearer ${masterKey}` },
    });
    const data = await res.json();
    setModels(data);
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
        setTestResult({
          provider: res.headers.get("X-Gateway-Provider"),
          model: res.headers.get("X-Gateway-Model"),
          raw: data,
          isImage: true,
        });
      } else {
        const res = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${masterKey}`,
          },
          body: JSON.stringify({
            category: testCategory,
            messages: [{ role: "user", content: testPrompt }],
          }),
        });
        const data = await res.json();
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

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>Personal AI Gateway</h1>
        <p style={styles.subtitle}>
          One master key → every free-tier model, auto-failover across providers.
        </p>

        <section style={styles.card}>
          <label style={styles.label}>Master Key</label>
          <input
            style={styles.input}
            type="password"
            placeholder="Paste your GATEWAY_MASTER_KEY"
            value={masterKey}
            onChange={(e) => saveKey(e.target.value)}
          />
          <button style={styles.btn} onClick={loadModels}>
            Load configured models
          </button>
        </section>

        {models && (
          <section style={styles.card}>
            <h2 style={styles.h2}>Configured Models ({models.data.filter((m) => m.active).length} active)</h2>
            <div style={styles.table}>
              {models.data.map((m, i) => (
                <div key={i} style={{ ...styles.row, opacity: m.active ? 1 : 0.35 }}>
                  <span style={styles.badge}>{m.provider_name}</span>
                  <span style={styles.modelId}>{m.model}</span>
                  <span style={styles.cats}>{m.categories.join(", ")}</span>
                  <span style={styles.ctx}>
                    {m.context_window ? `${(m.context_window / 1000).toFixed(0)}k ctx` : "—"}
                  </span>
                  <span style={styles.limits}>
                    {m.limits.rpm ? `${m.limits.rpm}/min` : ""} {m.limits.rpd ? `${m.limits.rpd}/day` : ""}
                  </span>
                  <span style={{ color: m.active ? "#4ade80" : "#6b7280" }}>
                    {m.active
                      ? m.org_level_limit && m.keys_configured > 1
                        ? `${m.keys_configured} keys (1 usable⚠️)`
                        : `${m.keys_configured} key(s)`
                      : "no key"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={styles.card}>
          <h2 style={styles.h2}>Test the gateway</h2>
          <select style={styles.input} value={testCategory} onChange={(e) => setTestCategory(e.target.value)}>
            <option value="text">text</option>
            <option value="vision">vision</option>
            <option value="multilingual">multilingual</option>
            <option value="image_gen">image_gen</option>
          </select>
          <textarea
            style={{ ...styles.input, minHeight: 80 }}
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
          />
          <button style={styles.btn} onClick={runTest} disabled={loading || !masterKey}>
            {loading ? "Running..." : "Send test request"}
          </button>

          {testResult && (
            <div style={styles.resultBox}>
              {testResult.error ? (
                <p style={{ color: "#f87171" }}>{testResult.error}</p>
              ) : (
                <>
                  <p style={styles.meta}>
                    Answered by <b>{testResult.provider}</b> / <b>{testResult.model}</b>
                  </p>
                  {testResult.isImage ? (
                    testResult.raw?.data?.[0]?.b64_json ? (
                      <img
                        src={`data:image/png;base64,${testResult.raw.data[0].b64_json}`}
                        style={{ maxWidth: "100%", borderRadius: 8, marginTop: 8 }}
                      />
                    ) : (
                      <pre style={styles.pre}>{JSON.stringify(testResult.raw, null, 2)}</pre>
                    )
                  ) : (
                    <p style={styles.answer}>
                      {testResult.raw?.choices?.[0]?.message?.content || JSON.stringify(testResult.raw)}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>Use from anywhere</h2>
          <pre style={styles.pre}>{`curl ${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "category": "text",
    "messages": [{"role":"user","content":"hi"}]
  }'`}</pre>
        </section>
      </div>
    </div>
  );
}

const styles = {
  page: { background: "#0a0a0a", minHeight: "100vh", color: "#e5e5e5", fontFamily: "system-ui, sans-serif" },
  container: { maxWidth: 780, margin: "0 auto", padding: "40px 20px" },
  h1: { fontSize: 28, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: 600, marginBottom: 12, color: "#d4d4d4" },
  subtitle: { color: "#a3a3a3", marginBottom: 28, fontSize: 14 },
  card: {
    background: "#141414",
    border: "1px solid #262626",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  label: { display: "block", fontSize: 12, color: "#a3a3a3", marginBottom: 6 },
  input: {
    width: "100%",
    background: "#0a0a0a",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#e5e5e5",
    fontSize: 14,
    marginBottom: 10,
    boxSizing: "border-box",
  },
  btn: {
    background: "#e5e5e5",
    color: "#0a0a0a",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  table: { display: "flex", flexDirection: "column", gap: 6 },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 2fr 1.5fr 0.8fr 1.2fr 0.8fr",
    gap: 8,
    fontSize: 12,
    padding: "8px 10px",
    background: "#0a0a0a",
    borderRadius: 6,
    alignItems: "center",
  },
  badge: { color: "#93c5fd" },
  modelId: { color: "#e5e5e5", fontFamily: "monospace", fontSize: 11 },
  cats: { color: "#a3a3a3" },
  ctx: { color: "#fbbf24" },
  limits: { color: "#a3a3a3", fontSize: 11 },
  resultBox: { marginTop: 14, padding: 14, background: "#0a0a0a", borderRadius: 8 },
  meta: { fontSize: 12, color: "#a3a3a3", marginBottom: 8 },
  answer: { fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" },
  pre: { fontSize: 12, whiteSpace: "pre-wrap", color: "#a3a3a3", overflowX: "auto" },
};
