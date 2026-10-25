const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT) || 8000;
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const maxRequestBytes = 32 * 1024;
const systemInstruction = `You are Wanderwise, a capable, friendly travel-planning chatbot. Answer the user's actual question directly and use the full conversation for context, including follow-up requests. Never make the user repeat trip details they already gave you.

For trip-planning requests, give a useful, personalized answer rather than a generic sample itinerary. When relevant, include:
- A short trip overview (origin, destination, duration, and travel style).
- A practical day-by-day plan with realistic time blocks and sensible travel order.
- Route and transport options, with approximate journey time and cost only when you can give a reasonable estimate.
- A clear budget breakdown and total, stating currency, whether it is per person, what is included, and what is excluded.
- Relevant food, stay, booking, accessibility, and local travel tips.
- Important caveats and a brief next step or follow-up question.

Use rupees (₹) for India trips and the currency appropriate to the destination otherwise. Show estimates as ranges and do not pretend prices, bus frequencies, opening hours, tickets, or schedules are live or confirmed. If a key detail such as origin or dates is missing, say what assumption you are making or ask a focused question; never invent a city to fill a gap. Keep calculations internally consistent and label uncertain details clearly.

For other questions, respond naturally and helpfully instead of forcing an itinerary template. Be warm, clear, detailed enough to be genuinely useful, and avoid unnecessary filler. Use Markdown headings, short paragraphs, bold emphasis, numbered steps, bullets, and a compact table when they make the answer easier to scan. Finish every section and sentence; prioritize the user's requested details over optional tips. Keep most answers under 700 words unless the user asks for more. Think carefully, but do not reveal private chain-of-thought; provide the answer and useful reasoning summary only.`;

function loadEnvironmentFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!entry || entry[1] in process.env) continue;
    process.env[entry[1]] = entry[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

loadEnvironmentFile();

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxRequestBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return false;
  }

  return messages.every((message) =>
    message &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.text === "string" &&
    message.text.trim().length > 0 &&
    message.text.length <= 4000
  ) && messages.at(-1).role === "user";
}

async function handleChat(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST to send a chat message." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_NEW_ROTATED_GEMINI_API_KEY_HERE") {
    sendJson(response, 503, { error: "Gemini isn't configured. Add a new rotated key to .env, then restart the server." });
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.message });
    return;
  }

  if (!validateMessages(body.messages)) {
    sendJson(response, 400, { error: "Send up to 20 valid chat messages. Each message must be no longer than 4,000 characters, and the last one must be from the user." });
    return;
  }

  const input = body.messages
    .map(({ role, text }) => `${role === "user" ? "Traveler" : "Wanderwise"}: ${text.trim()}`)
    .join("\n\n");

  let upstream;
  try {
    upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        input,
        system_instruction: systemInstruction,
        store: false,
        generation_config: {
          max_output_tokens: 4096,
          thinking_level: "low",
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    sendJson(response, 502, { error: "Couldn't connect to Gemini. Check the server's internet connection and try again." });
    return;
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    sendJson(response, 502, { error: "Gemini returned an unreadable response. Please try again." });
    return;
  }

  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    const message = upstream.status === 401 || upstream.status === 403
      ? "Gemini rejected the API key. Check that the new key in .env is valid and enabled."
      : upstream.status === 429
        ? "Gemini is receiving too many requests. Please try again shortly."
        : result.error?.message || "Gemini couldn't complete that request. Please try again.";
    sendJson(response, status, { error: message });
    return;
  }

  if (result.status && result.status !== "completed") {
    sendJson(response, 502, { error: `Gemini did not finish the answer (status: ${result.status}). Please try again.` });
    return;
  }

  const stepText = (result.steps || [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const reply = [result.output_text, result.outputText, stepText]
    .find((text) => typeof text === "string" && text.trim());

  if (!reply) {
    const errorStep = result.steps?.find((step) => step.type === "error");
    sendJson(response, 502, {
      error: errorStep?.message || result.error?.message || "Gemini returned no text. Please try again.",
    });
    return;
  }

  sendJson(response, 200, { reply: reply.trim() });
}

const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
]);

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/api/chat") {
    await handleChat(request, response);
    return;
  }

  const file = publicFiles.get(pathname);
  if (!file || request.method !== "GET") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const [filename, contentType] = file;
  response.writeHead(200, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  fs.createReadStream(path.join(root, filename)).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Wanderwise is running at http://localhost:${port}`);
});
