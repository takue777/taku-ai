
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
        JSON.stringify({
          error: "Chat security is not configured."
        }),
        { status: 503, headers }
      );
    }

    if (
      request.headers.get("authorization") !==
      `Bearer ${password}`
    ) {
      return new Response(
        JSON.stringify({ error: "Unauthorized." }),
        { status: 401, headers }
      );
    }

    try {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return new Response(
          JSON.stringify({
            error: "Gemini API key is not configured."
          }),
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

      // Validate and prepare conversation history.
      const messages = [];

      for (const message of body.messages) {
        if (
          !message ||
          !["user", "assistant"].includes(message.role) ||
          typeof message.content !== "string"
        ) {
          continue;
        }

        const content = message.content.slice(0, 4000).trim();

        if (!content) continue;

        const role =
          message.role === "assistant" ? "model" : "user";

        // Gemini conversations must start with a user message.
        if (messages.length === 0 && role === "model") {
          continue;
        }

        const previous = messages[messages.length - 1];

        // Combine consecutive messages with the same role.
        if (previous && previous.role === role) {
          previous.parts[0].text += "\n" + content;
        } else {
          messages.push({
            role,
            parts: [{ text: content }]
          });
        }
      }

      if (
        messages.length === 0 ||
        messages[messages.length - 1].role !== "user"
      ) {
        return new Response(
          JSON.stringify({
            error: "Please send a new user message."
          }),
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
                  "You are TAKU AI, a helpful and intelligent gold trading assistant. " +
                  "You specialise in XAUUSD analysis, forex trading education, " +
                  "market structure, order blocks, risk management and trading psychology. " +
                  "Give clear, practical and professional answers. " +
                  "Never invent live market prices or market data. " +
                  "Only analyse live prices when the user provides them or a reliable " +
                  "live data source is connected. " +
                  "You cannot execute trades or access MT5 yet. " +
                  "Never claim that you have placed or executed a trade. " +
                  "Always explain trading risks and avoid guaranteeing profits."
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

      // Return the actual Gemini error instead of hiding it.
      if (!result.ok) {
        console.error("GEMINI API ERROR:", data);

        return new Response(
          JSON.stringify({
            error: "Gemini API request failed.",
            details:
              data.error?.message ||
              data.error?.status ||
              "Unknown Gemini API error."
          }),
          { status: result.status, headers }
        );
      }

      const reply = (
        data.candidates?.[0]?.content?.parts || []
      )
        .map(part => part.text || "")
        .join("\n")
        .trim();

      if (!reply) {
        console.error(
          "GEMINI EMPTY RESPONSE:",
          JSON.stringify(data)
        );

        return new Response(
          JSON.stringify({
            error: "Gemini returned no text.",
            details:
              data.promptFeedback?.blockReason ||
              data.candidates?.[0]?.finishReason ||
              "No response was generated."
          }),
          { status: 502, headers }
        );
      }

      return new Response(
        JSON.stringify({ reply }),
        { status: 200, headers }
      );

    } catch (error) {
      console.error("TAKU AI SERVER ERROR:", error);

      return new Response(
        JSON.stringify({
          error: "Taku AI server error.",
          details: error.message || "Unknown server error."
        }),
        { status: 500, headers }
      );
    }
  }
};
