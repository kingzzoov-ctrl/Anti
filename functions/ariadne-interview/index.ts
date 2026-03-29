const __deprecated = true;
import {
  ARIADNE_INTERVIEW_PROMPT,
  ARIADNE_REPORT_PROMPT,
  PROMPT_ASSET_VERSION,
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return jsonResponse(410, {
    error: "deprecated_function",
    message: "This Blink function has been retired. Use the Ariadne FastAPI backend endpoints instead.",
    target: "/api/v1/ariadne/interview",
    architecture: "fastapi-postgres-redis",
  });
});
      const convergeThreshold = Number(convergeThresholdStr);

      if (tokenBalance < tokenCost) {
        return new Response(
          JSON.stringify({ error: "token_insufficient", balance: tokenBalance, required: tokenCost }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const currentTurns = Math.floor(messages.length / 2) + 1;

      const stageHint = (() => {
        const existingStage = currentStage || "DIVERGENT";
        if (existingStage === "DIVERGENT" && currentTurns >= convergeThreshold) {
          return "\n\n[系统提示：请在本轮回复结尾加上 <<STAGE:CONVERGE>>]";
        }
        if (existingStage === "DIVERGENT" && currentTurns >= pressThreshold) {
          return "\n\n[系统提示：请在本轮回复结尾加上 <<STAGE:PRESS>>]";
        }
        if (existingStage === "PRESS" && currentTurns >= convergeThreshold) {
          return "\n\n[系统提示：请在本轮回复结尾加上 <<STAGE:CONVERGE>>]";
        }
        return "";
      })();

      const llmMessages = [
        { role: "system" as const, content: ARIADNE_SYSTEM_PROMPT },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role === "ai" ? "assistant" as const : m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: (userMessage || "") + stageHint },
      ];

      // Deduct token before streaming
      const newBalance = tokenBalance - tokenCost;
      await blink.db.userProfiles.update(profile.id as string, {
        tokenBalance: String(newBalance),
        updatedAt: new Date().toISOString(),
      });

      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          let fullContent = "";
          let detectedStage: string | null = null;
          const contradictions: unknown[] = [];

          const send = (data: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          try {
            // ── Correct streamText usage: async iteration over textStream ──
            const { textStream } = await blink.ai.streamText({
              model: modelName,
              messages: llmMessages,
            });

            for await (const chunk of textStream) {
              fullContent += chunk;

              // Detect stage transitions
              const stageMatch = fullContent.match(/<<STAGE:(PRESS|CONVERGE)>>/);
              if (stageMatch && !detectedStage) {
                detectedStage = stageMatch[1];
              }

              // Extract contradictions (deduplicated by statementA)
              const contradictionMatches = [
                ...fullContent.matchAll(
                  /<<CONTRADICTION:dimension=([^,]+),severity=([^,]+),statementA=([^,]+),statementB=([^>]+)>>/g
                ),
              ];
              for (const match of contradictionMatches) {
                const alreadyTracked = contradictions.some(
                  (c: unknown) =>
                    (c as Record<string, unknown>).userStatementA === match[3]
                );
                if (!alreadyTracked) {
                  contradictions.push({
                    dimension: match[1],
                    severity: parseFloat(match[2]),
                    userStatementA: match[3],
                    userStatementB: match[4],
                  });
                }
              }

              // Strip meta-markers before sending to client
              const displayChunk = chunk.replace(/<<[^>]+>>/g, "");
              send({ type: "text", chunk: displayChunk });
            }

            const cleanContent = fullContent.replace(/<<[^>]+>>/g, "").trim();

            const resolvedStage = resolveStage(
              detectedStage,
              currentTurns,
              pressThreshold,
              convergeThreshold,
              currentStage || "DIVERGENT"
            );

            // Sync session state back to DB
            if (sessionId) {
              try {
                const existingSession = await blink.db.interviewSessions.get(sessionId) as Record<string, unknown> | null;

                let existingContradictions: unknown[] = [];
                let existingContextVars: Record<string, unknown> = {};
                let existingTokenConsumed = 0;

                if (existingSession) {
                  try { existingContradictions = JSON.parse(existingSession.extractedContradictions as string || "[]"); } catch (_) { /* use default */ }
                  try { existingContextVars = JSON.parse(existingSession.contextVariables as string || "{}"); } catch (_) { /* use default */ }
                  existingTokenConsumed = Number(existingSession.tokenConsumed) || 0;
                }

                const mergedContradictions = [...existingContradictions];
                for (const c of contradictions) {
                  const dup = mergedContradictions.some(
                    (e: unknown) =>
                      (e as Record<string, unknown>).dimension === (c as Record<string, unknown>).dimension &&
                      (e as Record<string, unknown>).userStatementA === (c as Record<string, unknown>).userStatementA
                  );
                  if (!dup) mergedContradictions.push(c);
                }

                const updatedContextVars: Record<string, unknown> = {
                  ...existingContextVars,
                  detectedStageAtTurn:
                    resolvedStage !== (currentStage || "DIVERGENT")
                      ? { stage: resolvedStage, turn: currentTurns }
                      : (existingContextVars.detectedStageAtTurn ?? null),
                };

                if (!updatedContextVars.coreTopic && messages.length > 0) {
                  const firstUserMsg = messages.find(
                    (m: { role: string; content: string }) => m.role === "user"
                  );
                  if (firstUserMsg) {
                    updatedContextVars.coreTopic = (firstUserMsg.content as string).slice(0, 100);
                  }
                }

                await blink.db.interviewSessions.update(sessionId, {
                  currentStage: resolvedStage,
                  turnCount: String(currentTurns),
                  extractedContradictions: JSON.stringify(mergedContradictions),
                  contextVariables: JSON.stringify(updatedContextVars),
                  tokenConsumed: String(existingTokenConsumed + tokenCost),
                  updatedAt: new Date().toISOString(),
                });
              } catch (dbErr) {
                console.error("Session sync error:", dbErr);
              }
            }

            send({
              type: "done",
              fullContent: cleanContent,
              stage: resolvedStage,
              turnCount: currentTurns,
              detectedStage,
              contradictions,
              tokenBalance: newBalance,
            });
          } catch (err) {
            console.error("Stream error:", err);
            send({ type: "error", message: "神经元连接波动，请重试。" });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── Action: generate_report ──────────────────────────────────────────────
    if (action === "generate_report") {
      const auth = await blink.auth.verifyToken(req.headers.get("Authorization"));
      if (!auth.valid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!userId || !messages) {
        return new Response(
          JSON.stringify({ error: "Missing userId or messages" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const userProfiles = await blink.db.userProfiles.list({ where: { userId }, limit: 1 });
      if (userProfiles.length === 0) {
        return new Response(JSON.stringify({ error: "User profile not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const profile = userProfiles[0] as Record<string, unknown>;
      const tokenBalance = Number(profile.tokenBalance) || 0;

      const [reportCostValue, reportModelName] = await Promise.all([
        getSystemConfig(blink, "TOKEN_COST_REPORT_GENERATE", "20"),
        getSystemConfig(blink, "LLM_MODEL_REPORT", "gpt-4.1"),
      ]);

      const tokenCost = Number(reportCostValue);

      if (tokenBalance < tokenCost) {
        return new Response(
          JSON.stringify({ error: "token_insufficient", balance: tokenBalance }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const conversationText = messages
        .map((m: { role: string; content: string }) => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join("\n\n");

      const { text } = await blink.ai.generateText({
        model: reportModelName,
        messages: [
          { role: "system", content: REPORT_GENERATION_PROMPT },
          { role: "user", content: `以下是完整的问询对话记录：\n\n${conversationText}` },
        ],
      });

      // Strip markdown fences if present
      let jsonText = text.trim();
      const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonText = fenceMatch[1].trim();

      let reportData: Record<string, unknown>;
      try {
        reportData = normalizeReportData(JSON.parse(jsonText));
      } catch {
        return new Response(
          JSON.stringify({ error: "Report generation failed — JSON parse error", raw: text }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Deduct token
      const newBalance = tokenBalance - tokenCost;
      await blink.db.userProfiles.update(profile.id as string, {
        tokenBalance: String(newBalance),
        updatedAt: new Date().toISOString(),
      });

      const existingReports = await blink.db.insightReports.list({ where: { userId } });
      const reportVersion = existingReports.length + 1;

      let stageData: Record<string, unknown> = {};
      if (sessionId) {
        try {
          const session = await blink.db.interviewSessions.get(sessionId) as Record<string, unknown> | null;
          if (session) {
            let contextVars: Record<string, unknown> = {};
            try { contextVars = JSON.parse(session.contextVariables as string || "{}"); } catch (_) { /* use default */ }
            stageData = {
              finalStage: session.currentStage,
              turnCount: session.turnCount,
              tokenConsumed: session.tokenConsumed,
              contextVariables: contextVars,
            };
          }
        } catch (err) {
          console.error("Stage data fetch error:", err);
        }
      }

      const reportId = `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await blink.db.insightReports.create({
        id: reportId,
        userId,
        title: `洞察报告 · ${new Date().toLocaleDateString("zh-CN")}`,
        rawContent: JSON.stringify(reportData),
        vFeature: JSON.stringify((reportData.featureAnalysis as Record<string, unknown>)?.vFeature || (reportData.vFeature as Record<string, number>) || {}),
        consistencyScore: String((reportData.featureAnalysis as Record<string, unknown>)?.consistencyScore || reportData.consistencyScore || 0),
        isPublic: "0",
        version: String(reportVersion),
        stageData: JSON.stringify(stageData),
      });

      if (sessionId) {
        try {
          await blink.db.interviewSessions.update(sessionId, {
            status: "COMPLETED",
            updatedAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error("Session status update error:", err);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          reportId,
          report: reportData,
          version: reportVersion,
          tokenBalance: newBalance,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Handler error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

Deno.serve(handler);

if (__deprecated) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  };

  function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  Deno.serve((req: Request) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    return json(
      {
        error: 'deprecated_function',
        message: 'Legacy Blink interview function has been retired. Use the FastAPI Ariadne backend instead.',
        target: '/api/v1/ariadne/interview/turn | /api/v1/ariadne/report/generate | /api/v1/ariadne/sessions',
        architecture: 'fastapi-postgres-redis',
      },
      410,
    );
  });
}
