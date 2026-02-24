import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import NodeCache from "node-cache";

dotenv.config();

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN?.split(",") ?? "*",
  }),
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Memoria simple por sessionId (30 min)
const memory = new NodeCache({ stdTTL: 60 * 30 });

function buildSantaSystemPrompt() {
  return `
You are Santa Claus.
Rules:
- Be friendly, playful and warm.
- Keep responses short (max 2 sentences).
- Write in the user's language (Spanish if user writes Spanish).
- No markdown, output only the answer text.
`.trim();
}

// --- 1) CHAT ---
app.get("/chat", async (req, res) => {
  try {
    const message = String(req.query.message ?? "").trim();
    const sessionId = String(req.query.sessionId ?? "").trim();

    if (!message) return res.status(400).json({ error: "Missing message" });
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    // Traer historial
    const history = memory.get(sessionId) ?? [];
    // Guardar el user msg en historial
    const nextHistory = [...history, { role: "user", content: message }].slice(
      -12,
    ); // limita memoria

    const response = await openai.responses.create({
      model: "gpt-4.1-mini", // barato y bueno
      input: [
        { role: "system", content: buildSantaSystemPrompt() },
        ...nextHistory,
      ],
      max_output_tokens: 80,
    });

    const output = (response.output_text ?? "").trim();

    // Guardar respuesta en memoria
    const updated = [
      ...nextHistory,
      { role: "assistant", content: output },
    ].slice(-12);
    memory.set(sessionId, updated);

    res.json({ output });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// --- 2) TTS (ElevenLabs) ---
app.get("/tts", async (req, res) => {
  try {
    const text = String(req.query.message ?? "").trim();
    if (!text) return res.status(400).json({ error: "Missing message" });

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      return res.status(500).json({ error: "Missing ElevenLabs config" });
    }

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.4, similarity_boost: 0.8 },
        }),
      },
    );

    if (!r.ok) {
      const msg = await r.text();
      console.error("ElevenLabs error:", msg);
      return res.status(500).json({ error: "TTS failed" });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    const arrayBuffer = await r.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TTS failed" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Backend listening on :${port}`));
