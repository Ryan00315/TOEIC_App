export default async function handler(req, res) {
    // 1. 解決 CORS 跨網域問題 (讓你的前端可以順利打到這個後端)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 處理預檢請求
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 限制只能用 POST 方法
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    // 2. 從 Vercel 環境變數讀取 Gemini API Key
    const API_KEY = process.env.GEMINI_API_KEY;

    // 3. 給 AI 的多益專屬 Prompt
    const prompt = `你是一個專業的 TOEIC 多益英文老師。請將單字 "${text}" 進行解析。
請嚴格只回傳 JSON 格式，不要有任何 Markdown 標記 (\`\`\`json) 或其他廢話。
JSON 格式必須包含以下四個 key：
1. "meaning": 繁體中文意思 (簡潔有力)
2. "reading": KK音標 (例如 /tɛst/)
3. "example": 給出一個多益商務情境的英文例句，並附上中文翻譯
4. "collocation": 1~2 個該單字在多益最常考的搭配詞 (例如 fulfill the requirements)`;

    try {
        // 4. 打給 Google Gemini API
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    response_mime_type: "application/json", // 強制回傳 JSON
                }
            })
        });

        const json = await geminiRes.json();
        
        // 5. 解析回傳結果並回傳給前端
        const aiResponseText = json.candidates[0].content.parts[0].text;
        const resultData = JSON.parse(aiResponseText);

        res.status(200).json(resultData);

    } catch (error) {
        console.error('AI API 錯誤:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
