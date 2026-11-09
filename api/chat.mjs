
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

    if (
      request.headers.get("authorization") !==
      `Bearer ${password}`
    ) {
      return new Response(
        JSON.stringify({ error: "Unauthorised." }),
        { status: 401, headers }
      );
    }

    try {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error("OpenAI API key is not configured.");
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
          role: m.role,
          content: m.content.slice(0, 4000)
        }));

      if (!messages.length) {
        return new Response(
          JSON.stringify({ error: "No valid messages." }),
          { status: 400, headers }
        );
      }

      const result = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-6-astra",
            instructions:
              "You are TAKU AI, a helpful gold trading assistant. " +
              "You specialise in XAUUSD analysis and trading education. " +
              "You do not claim to see live market prices unless data is provided. " +
              "You cannot execute trades or access MT5 yet. " +
              "Never invent market data or claim a trade was placed.",
            input: messages,
            max_output_tokens: 700,
            store: false
          })
        }
      );

      const data = await result.json();

      if (!result.ok) {
        return new Response(
          JSON.stringify({
            error: "AI service request failed.",
            details: data.error?.message || "Unknown API error."
          }),
          { status: result.status, headers }
        );
      }

      return new Response(
        JSON.stringify({ reply: data.output_text || "No response received." }),
        { status: 200, headers }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Server error. Please try again." }),
        { status: 500, headers }
      );
    }
  }
};
