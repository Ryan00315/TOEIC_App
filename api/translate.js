const cache = new Map();
const requestLog = [];

let blockedUntil = 0;

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 快取保留 7 天
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分鐘
const RATE_LIMIT_MAX = 15; // 每分鐘最多允許的請求次數

function normalizeText(input) {
  return String(input || "").trim().replace(/\s+/g, " ");
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (!value || now - value.savedAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

function isRateLimited() {
  const now = Date.now();
  while (requestLog.length && now - requestLog[0] > RATE_LIMIT_WINDOW_MS) {
    requestLog.shift();
  }
  if (requestLog.length >= RATE_LIMIT_MAX) {
    return true;
  }
  requestLog.push(now);
  return false;
}

function extractRetrySeconds(message) {
  const msg = String(message || "");
  const match = msg.match(/retry in\s*([\d.]+)s/i);
  if (!match) return null;
  const sec = Math.ceil(parseFloat(match[1]));
  return Number.isFinite(sec) ? sec : null;
}

export default async function handler(req, res) {
  // 允許所有的跨網域請求 (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  cleanupCache();

  try {
    const { text } = req.body || {};
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return res.status(400).json({ error: "Missing text" });
    }

    const now = Date.now();

    // 1) 檢查是否在冷卻期
    if (now < blockedUntil) {
      const waitSec = Math.ceil((blockedUntil - now) / 1000);
      return res.status(429).json({
        error: `Quota cooling down. Please retry in ${waitSec}s`
      });
    }

    // 2) 檢查伺服器快取 (Memory Cache)
    const cached = cache.get(normalizedText);
    if (cached && cached.value) {
      return res.status(200).json({
        ...cached.value,
        cached: true
      });
    }

    // 3) 檢查是否超出限流
    if (isRateLimited()) {
      return res.status(429).json({
        error: "Too many requests. Please try again later."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    // 多益專屬 Prompt
    const prompt = `你是一個專業的 TOEIC 多益英文老師。請將單字 "${normalizedText}" 進行解析。
請嚴格只回傳 JSON 格式，不要有任何 Markdown 標記 (\`\`\`json) 或其他廢話。
JSON 格式必須包含以下四個 key：
1. "meaning": 繁體中文意思 (簡潔有力)
2. "reading": KK音標 (例如 /tɛst/)
3. "example": 給出一個多益商務情境的英文例句，並附上中文翻譯
4. "collocation": 1~2 個該單字在多益最常考的搭配詞 (例如 fulfill the requirements)`.trim();

    // 呼叫 Gemini 1.5 Flash API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    // 處理 API 錯誤與限流
    if (!response.ok) {
      const apiError = data?.error?.message || data?.message || "Gemini API error";
      const retrySec = extractRetrySeconds(apiError);

      if (retrySec) {
        blockedUntil = Date.now() + retrySec * 1000;
      } else if (/quota|rate limit|too many requests|exceeded|resource exhausted/i.test(apiError)) {
        blockedUntil = Date.now() + 15000; // 預設冷卻 15 秒
      }

      return res.status(response.status || 429).json({
        error: apiError
      });
    }

    const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      return res.status(500).json({ error: "No model output" });
    }

    let result;
    try {
      result = JSON.parse(resultText);
    } catch {
      return res.status(500).json({
        error: "Model returned invalid JSON",
        raw: resultText
      });
    }

    // 確保四個欄位都有值，如果沒有則給空字串
    const finalResult = {
      meaning: result?.meaning || "",
      reading: result?.reading || "",
      example: result?.example || "",
      collocation: result?.collocation || ""
    };

    // 4) 成功後寫入快取
    cache.set(normalizedText, {
      value: finalResult,
      savedAt: Date.now()
    });

    return res.status(200).json({
      ...finalResult,
      cached: false
    });

  } catch (err) {
    const message = err?.message || "Server error";

    const retrySec = extractRetrySeconds(message);
    if (retrySec) {
      blockedUntil = Date.now() + retrySec * 1000;
    } else if (/quota|rate limit|too many requests|exceeded|resource exhausted/i.test(message)) {
      blockedUntil = Date.now() + 15000;
    }

    return res.status(500).json({
      error: message
    });
  }
}
