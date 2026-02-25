import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import NodeCache from "node-cache";

dotenv.config();

const app = express();
app.use(express.json());

// --- CORS (mejorado) ---
const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // requests sin origin (postman, server-to-server)
      if (!origin) return cb(null, true);

      // si pusiste "*" permitís todos
      if (allowedOrigins.includes("*")) return cb(null, true);

      // match exacto
      if (allowedOrigins.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
  }),
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Memoria simple por sessionId (30 min)
const memory = new NodeCache({ stdTTL: 60 * 30 });

// --- Config del personaje (por env) ---
const PERSONA_NAME = process.env.PERSONA_NAME ?? "PíoPío AI";
const PERSONA_STYLE =
  process.env.PERSONA_STYLE ??
  "Eres un pajarito tierno que responde con cariño, claridad y buena onda.";

const MAX_SENTENCES = Number(process.env.MAX_SENTENCES ?? 2);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 90);
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

function buildSystemPrompt() {
  return `
Eres ${PERSONA_NAME}.
${PERSONA_STYLE}

Reglas:
- Sé breve: máximo ${MAX_SENTENCES} frases.
- Tono: cálido, cercano, con toques tiernos (sin exagerar).
- No uses markdown.
- Devuelve solo el texto de la respuesta, sin comillas ni etiquetas.
`.trim();
}

app.get("/chat", async (req, res) => {
  try {
    const message = String(req.query.message ?? "").trim();
    const sessionId = String(req.query.sessionId ?? "").trim();

    if (!message) return res.status(400).json({ error: "Missing message" });
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const history = memory.get(sessionId) ?? [];

    const nextHistory = [...history, { role: "user", content: message }].slice(
      -12,
    );

    const response = await openai.responses.create({
      model: MODEL,
      input: [{ role: "system", content: buildSystemPrompt() }, ...nextHistory],
      max_output_tokens: MAX_OUTPUT_TOKENS,
    });

    const output = (response.output_text ?? "").trim();

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

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Backend listening on :${port}`));
