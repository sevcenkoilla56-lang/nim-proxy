const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// Allow requests from JanitorAI
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Health check — Render uses this
app.get('/', (req, res) => {
  res.send('NIM Proxy is running!');
});

// Main proxy endpoint — forwards to NVIDIA NIM
app.post('/v1/chat/completions', async (req, res) => {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'NVIDIA_API_KEY not set in environment'
    });
  }

  // Always use Kimi K2.5
  const body = {
    ...req.body,
    model: 'moonshotai/kimi-k2.5'
  };

  try {
    const response = await fetch(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Models list endpoint
app.get('/v1/models', (req, res) => {
  res.json({
    data: [{
      id: 'moonshotai/kimi-k2.5',
      object: 'model'
    }]
  });
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
