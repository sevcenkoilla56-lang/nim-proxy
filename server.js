const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "moonshotai/kimi-k2.5";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.json({ status: "Proxy is running!", model: DEFAULT_MODEL });
});

app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [{
      id: DEFAULT_MODEL,
      object: "model",
      created: 1700000000,
      owned_by: "moonshotai"
    }]
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  if (!NVIDIA_API_KEY) {
    return res.status(500).json({ error: "NVIDIA_API_KEY is not set on the server" });
  }

  try {
    const body = req.body;

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: "Empty request body received" });
    }

    body.model = DEFAULT_MODEL;

    delete body.user;
    delete body.logit_bias;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;

    if (!body.max_tokens) body.max_tokens = 1024;
    body.max_tokens = Math.min(Number(body.max_tokens), 4096);

    const isStreaming = body.stream === true;

    const headers = {
      "Authorization": `Bearer ${NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": isStreaming ? "text/event-stream" : "application/json"
    };

    const nvidiaResp = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });

    if (isStreaming) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      nvidiaResp.body.pipe(res);
    } else {
      const data = await nvidiaResp.json();
      res.status(nvidiaResp.status).json(data);
    }

  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
