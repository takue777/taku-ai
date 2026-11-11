
export default {
  async fetch(request) {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    };

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers }
      );
    }

    const password = process.env.TAKU_CHAT_PASSWORD;

    if (!password) {
      return new Response(
        JSON.stringify({ error: "Chat security is not configured." }),
        { status: 503, headers }
      );
    }

    if (request.headers.get("authorization") !== `Bearer ${password}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized." }),
        { status: 401, headers }
      );
    }

    try {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "Gemini API key is not configured." }),
          { status: 503, headers }
        );
      }

      const body = await request.json();

      if (
        !Array.isArray(body.messages) ||
        body.messages.length === 0 ||
        body.messages.length > 20
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid messages." }),
          { status: 400, headers }
        );
      }

      const messages = body.messages
        .filter(m =>
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string"
        )
        .map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content.slice(0, 4000) }]
        }));

      if (!messages.length) {
        return new Response(
          JSON.stringify({ error: "No valid messages." }),
          { status: 400, headers }
        );
      }

      const result = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text:
                  "You are TAKU AI, a helpful gold trading assistant. " +
                  "You specialise in XAUUSD analysis and trading education. " +
                  "You do not claim to see live market prices unless data is provided. " +
                  "You cannot execute trades or access MT5 yet. " +
                  "Never invent market data or claim a trade was placed."
              }]
            },
            contents: messages,
            generationConfig: {
              maxOutputTokens: 700
            }
          })
        }
      );

      const data = await result.json();

      if (!result.ok) {
        return new Response(
          JSON.stringify({
            error: "Gemini AI request failed.",
            details: data.error?.message || "Unknown API error."
          }),
          { status: result.status, headers }
        );
      }

      const reply = (data.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || "")
        .join("\n");

      return new Response(
        JSON.stringify({
          reply: reply || "No response received."
        }),
        { status: 200, headers }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Server error. Please try again."
        }),
        { status: 500, headers }
      );
    }
  }
};
