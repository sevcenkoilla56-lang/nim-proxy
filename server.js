const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "moonshotai/kimi-k2.5";

// How many tokens Kimi is allowed to spend thinking
// 512 = quick thoughts, rarely times out
// 1024 = moderate, good balance
// 2048 = deeper thinking, might occasionally be slow
const MAX_THINKING_TOKENS = 512;

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

function splitIntoChunks(text, maxLength = 1000) {
  const chunks = [];
  let current = "";
  const sentences = text.split(/(?<=[。！？\.\!\?])/);
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

async function translateChunk(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" + encodeURIComponent(text);
    const resp = await fetch(url, { signal: controller.signal });
    const data = await resp.json();
    return data[0].map(chunk => chunk[0]).join("");
  } catch (err) {
    console.error("Chunk translation failed:", err.message);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateToEnglish(text) {
  const chunks = splitIntoChunks(text, 1000);
  const translated = await Promise.all(chunks.map(translateChunk));
  return translated.join(" ");
}

async function translateThinkingBlock(text) {
  if (!text) return text;

  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (!thinkMatch) return text;

  const originalThinking = thinkMatch[1].trim();
  const afterThink = text.replace(/<think>[\s\S]*?<\/think>/i, "").trim();

  const hasChinese = /[\u4e00-\u9fff]/.test(originalThinking);
  if (!hasChinese) return text;

  const translatedThinking = await translateToEnglish(originalThinking);

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

    // This is the key line — caps how long Kimi is allowed to think
    body.chat_template_kwargs = { max_thinking_tokens: MAX_THINKING_TOKENS };

    const headers = {
      "Authorization": `Bearer ${NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    };

    const nvidiaResp = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      timeout: 25000
    });

    const data = await nvidiaResp.json();

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
