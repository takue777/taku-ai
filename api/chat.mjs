
export default {
  async fetch(request) {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    };

    const send = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });

    if (request.method !== "POST") {
      return send({ error: "Method not allowed." }, 405);
    }

    const password = process.env.TAKU_CHAT_PASSWORD;

    if (!password) {
      return send({ error: "Chat security is not configured." }, 503);
    }

    if (
      request.headers.get("authorization") !==
      `Bearer ${password}`
    ) {
      return send({ error: "Unauthorized." }, 401);
    }

    try {
      const body = await request.json();

      if (
        !Array.isArray(body.messages) ||
        body.messages.length === 0 ||
        body.messages.length > 20
      ) {
        return send({ error: "Invalid messages." }, 400);
      }

      const messages = body.messages
        .filter(m =>
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string"
        )
        .map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          content: m.content.slice(0, 4000)
        }));

      while (messages.length && messages[0].role !== "user") {
        messages.shift();
      }

      if (!messages.length) {
        return send({ error: "No valid user message." }, 400);
      }

      // Combine consecutive messages with the same role.
      const conversation = [];

      for (const message of messages) {
        const previous = conversation[conversation.length - 1];

        if (previous && previous.role === message.role) {
          previous.content += "\n" + message.content;
        } else {
          conversation.push({ ...message });
        }
      }

      const systemPrompt =
        "You are TAKU AI, a helpful and knowledgeable gold and forex trading assistant. " +
        "You specialise in XAUUSD, market structure, order blocks, BOS, CHoCH, " +
        "entries, stop losses, take profits and risk management. " +
        "Give clear, practical and honest answers. " +
        "Never invent live market prices or claim to access MT5. " +
        "Never claim to have executed a trade. " +
        "If market data is not provided, explain that live data is unavailable.";

      // STEP 1: TRY GOOGLE GEMINI FIRST.
      const geminiKey = process.env.GEMINI_API_KEY;

      let geminiError = "Gemini API key is not configured.";

      if (geminiKey) {
        try {
          const geminiMessages = conversation.map(m => ({
            role: m.role,
            parts: [{ text: m.content }]
          }));

          const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": geminiKey.trim()
              },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{ text: systemPrompt }]
                },
                contents: geminiMessages,
                generationConfig: {
                  maxOutputTokens: 700
                }
              })
            }
          );

          const data = await response.json();

          if (!response.ok) {
            throw new Error(
              data.error?.message || `Gemini error: ${response.status}`
            );
          }

          const reply = (data.candidates?.[0]?.content?.parts || [])
            .map(part => part.text || "")
            .join("\n")
            .trim();

          if (!reply) {
            throw new Error("Gemini returned an empty response.");
          }

          return send({
            reply,
            provider: "Gemini"
          });

        } catch (error) {
          geminiError = error.message || "Gemini request failed.";
          console.error("GEMINI ERROR:", geminiError);
        }
      }

      // STEP 2: IF GEMINI FAILS, TRY OPENAI GPT.
      const openaiKey = process.env.OPENAI_API_KEY;

      if (!openaiKey) {
        return send({
          error: "Gemini failed and the GPT backup is not configured yet.",
          geminiError,
          backupStatus: "Add OPENAI_API_KEY when OpenAI billing is activated."
        }, 503);
      }

      try {
        const openaiMessages = [
          {
            role: "system",
            content: systemPrompt
          },
          ...conversation.map(m => ({
            role: m.role === "model" ? "assistant" : "user",
            content: m.content
          }))
        ];

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiKey.trim()}`
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              messages: openaiMessages,
              max_completion_tokens: 700
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error?.message || `OpenAI error: ${response.status}`
          );
        }

        const reply = data.choices?.[0]?.message?.content?.trim();

        if (!reply) {
          throw new Error("OpenAI returned an empty response.");
        }

        return send({
          reply,
          provider: "OpenAI GPT",
          fallback: true
        });

      } catch (error) {
        console.error("OPENAI ERROR:", error.message);

        return send({
          error: "Both AI providers failed.",
          geminiError,
          openaiError: error.message
        }, 502);
      }

    } catch (error) {
      console.error("TAKU AI SERVER ERROR:", error);

      return send({
        error: "Taku AI server error.",
        details: error.message || "Unknown error."
      }, 500);
    }
  }
};
