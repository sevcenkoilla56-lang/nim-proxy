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

// Translates text from Chinese to English using Google Translate's free endpoint
async function translateToEnglish(text) {
  try {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" + encodeURIComponent(text);
    const resp = await fetch(url);
    const data = await resp.json();
    // Google returns nested arrays — this joins all translated chunks together
    const translated = data[0].map(chunk => chunk[0]).join("");
    return translated;
  } catch (err) {
    console.error("Translation failed:", err);
    // If translation fails for any reason, return the original text untouched
    return text;
  }
}

// Finds the <think>...</think> block, translates it, puts it back
async function translateThinkingBlock(text) {
  if (!text) return text;

  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);

  if (!thinkMatch) {
    // No thinking block found — return as is
    return text;
  }

  const originalThinking = thinkMatch[1].trim();
  const afterThink = text.replace(/<think>[\s\S]*?<\/think>/i, "").trim();

  // Only translate if it actually contains Chinese characters
  const hasChinese = /[\u4e00-\u9fff]/.test(originalThinking);

  if (!hasChinese) {
    // Already in English — no translation needed
    return text;
  }

  const translatedThinking = await translateToEnglish(originalThinking);

  // Rebuild the message with translated thinking block + the final reply
  return `<think>\n${translatedThinking}\n</think>\n\n${afterThink}`;
}

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
    body.stream = false;

    delete body.user;
    delete body.logit_bias;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;

    if (!body.max_tokens) body.max_tokens = 1024;
    body.max_tokens = Math.min(Number(body.max_tokens), 4096);

    const headers = {
      "Authorization": `Bearer ${NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    };

    const nvidiaResp = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });

    const data = await nvidiaResp.json();

    // Translate thinking blocks in all choices
    if (data.choices && Array.isArray(data.choices)) {
      for (let i = 0; i < data.choices.length; i++) {
        if (data.choices[i].message && data.choices[i].message.content) {
          data.choices[i].message.content = await translateThinkingBlock(
            data.choices[i].message.content
          );
        }
      }
    }

    res.status(nvidiaResp.status).json(data);

  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
