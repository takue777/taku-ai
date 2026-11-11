
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

      if (!apiKey || !apiKey.trim()) {
        return new Response(
          JSON.stringify({
            error: "Gemini API key is missing."
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

        if (messages.length === 0 && role === "model") {
          continue;
        }

        const previous = messages[messages.length - 1];

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
            error: "Please send a new message."
          }),
          { status: 400, headers }
        );
      }

      const result = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey.trim()
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text:
                  "You are TAKU AI, an intelligent gold and forex trading assistant. " +
                  "Your speciality is XAUUSD. " +
                  "You help users understand market structure, order blocks, " +
                  "breaks of structure, changes of character, entries, " +
                  "stop losses, take profits and risk management. " +
                  "You provide clear, practical and professional analysis. " +
                  "Never invent live prices or market information. " +
                  "Only analyse live market data when it is provided. " +
                  "You cannot execute trades or access MT5 yet. " +
                  "Never claim to have placed a trade. " +
                  "Always explain trading risks. " +
                  "Never guarantee profits."
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
        console.error("GEMINI API ERROR:", data);

        return new Response(
          JSON.stringify({
            error: "Gemini API request failed.",
            details:
              data.error?.message ||
              data.error?.status ||
              "Unknown Gemini error."
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
        return new Response(
          JSON.stringify({
            error: "Gemini returned no response.",
            details:
              data.promptFeedback?.blockReason ||
              data.candidates?.[0]?.finishReason ||
              "No text was generated."
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
          details: error.message || "Unknown error."
        }),
        { status: 500, headers }
      );
    }
  }
};
