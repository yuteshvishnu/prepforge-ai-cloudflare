import { useState } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("resume");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);

  const sendMessage = async () => {
    if (!message.trim()) return;

    setLoading(true);
    setResponse("");
    setSteps([]);

    try {
      const res = await fetch("http://localhost:8787/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          mode,
          sessionId: "yutesh-demo-session",
        }),
      });

      if (!res.body) {
        setResponse("No stream received.");
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const lines = event.split("\n");
          let eventType = "";
          let data = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.replace("event: ", "").trim();
            }
            if (line.startsWith("data: ")) {
              data = line.replace("data: ", "").trim();
            }
          }

          if (!data) continue;

          const parsed = JSON.parse(data);

          if (eventType === "step") {
            setSteps((prev) => [...prev, parsed.message]);
          }

          if (eventType === "plan" && parsed.steps) {
            setSteps((prev) => [...prev, ...parsed.steps]);
          }

          if (eventType === "final") {
            setResponse(parsed.response || "No response received.");
          }

          if (eventType === "error") {
            setResponse(parsed.message || "Something went wrong.");
          }
        }
      }
    } catch (err) {
      setResponse("Network error or backend not running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "800px", margin: "40px auto", fontFamily: "Arial, sans-serif", padding: "20px" }}>
      <h1>PrepForge AI</h1>
      <p>Cloudflare AI job application copilot</p>

      <div style={{ marginBottom: "12px" }}>
        <label>Mode: </label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="resume">Resume</option>
          <option value="interview">Interview</option>
        </select>
      </div>

      <textarea
        rows={8}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Paste a resume bullet, job description, or interview question..."
        style={{ width: "100%", padding: "12px", marginBottom: "12px" }}
      />

      <button onClick={sendMessage} disabled={loading} style={{ padding: "10px 16px", cursor: "pointer" }}>
        {loading ? "Generating..." : "Send"}
      </button>

      <div style={{ marginTop: "24px" }}>
        <h2>Agent Steps</h2>
        <div style={{ color: "#333", background: "#f5f5f5", padding: "16px", borderRadius: "8px" }}>
          {steps.length === 0 ? (
            <div>No steps yet.</div>
          ) : (
            steps.map((step, index) => (
              <div key={index} style={{ marginBottom: "8px" }}>
                ⚙️ {step}
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ marginTop: "24px" }}>
        <h2>Response</h2>
        <div style={{ whiteSpace: "pre-wrap", color: "#333", background: "#f5f5f5", padding: "16px", borderRadius: "8px" }}>
          {response || "Your AI response will appear here."}
        </div>
      </div>
    </div>
  );
}

export default App;