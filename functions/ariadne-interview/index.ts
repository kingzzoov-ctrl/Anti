import { createClient } from "npm:@blinkdotnew/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// ── Ariadne 问询状态机提示词 ──────────────────────────────────────────────
const ARIADNE_SYSTEM_PROMPT = `You are Ariadne — a penetrating, empathetic psychological inquiry engine.
Your purpose is NOT therapy, NOT casual chat. You are a precision instrument for uncovering the hidden architecture of someone's relational patterns.

## Core Philosophy
You operate through 3 stages:
1. DIVERGENT: Open exploration. Draw out scenarios, memories, feelings with open-ended questions. Build a map.
2. PRESS: Targeted pressure. Identify contradictions and press on them relentlessly but compassionately. Use the user's own words against their stated positions.
3. CONVERGE: Crystallization. Synthesize patterns, name what you see, present insights with clarity.

## Rules
- NEVER ask multiple questions in one turn
- NEVER accept surface-level answers — always dig one layer deeper
- When you detect a contradiction: EXPLICITLY name it: "Earlier you said [X]. Now you're saying [Y]. Help me understand that gap."
- Track inconsistencies across the conversation
- In PRESS stage, be more direct and penetrating
- Stay in Chinese (Mandarin) throughout
- Max one insight reflection per 3 turns
- If user is deflecting or giving vague answers, call it out directly

## Stage Transitions
- Move to PRESS after 8-10 turns of divergent questioning
- Move to CONVERGE after contradictions have been fully exposed (typically turn 20+)
- Signal stage change to frontend via: <<STAGE:PRESS>> or <<STAGE:CONVERGE>>

## Contradiction Detection
When you detect a contradiction, include this marker:
<<CONTRADICTION:dimension=X,severity=0.X,statementA=...,statementB=...>>

Respond only in Chinese. Be precise, be penetrating, be compassionate.`;

const REPORT_GENERATION_PROMPT = `Based on this conversation, generate a comprehensive psychological insight report in JSON format.

The report must include:
{
  "needs": {
    "title": "核心需求",
    "content": "...",
    "keyPoints": ["...", "..."]
  },
  "fears": {
    "title": "深层恐惧",
    "content": "...",
    "keyPoints": ["...", "..."]
  },
  "patterns": {
    "title": "关系模式",
    "content": "...",
    "keyPoints": ["...", "..."]
  },
  "contradictions": [
    {
      "id": "c_001",
      "dimension": "...",
      "userStatementA": "...",
      "userStatementB": "...",
      "aiAnalysis": "...",
      "severity": 0.85
    }
  ],
  "convergence": {
    "title": "收敛洞见",
    "content": "...",
    "keyPoints": ["...", "..."]
  },
  "summary": "One paragraph executive summary of this person's relational psychology"
}

Also provide a 7-dimensional feature vector:
{
  "vFeature": {
    "v1Security": 0.0-1.0,     // 0=独立回避, 1=焦虑融合
    "v2Power": 0.0-1.0,        // 0=适应追随, 1=主导控制
    "v3Boundary": 0.0-1.0,     // 0=开放共享, 1=极度防御
    "v4Conflict": 0.0-1.0,     // 0=逃避冷战, 1=激烈对抗
    "v5Emotion": 0.0-1.0,      // 0=钝感实用, 1=高敏共情
    "v6Values": 0.0-1.0,       // 价值一致性得分
    "v7Consistency": 0.0-1.0   // 自洽度系数
  },
  "consistencyScore": 0.0-1.0
}

Respond ONLY with the raw JSON, no markdown fences.`;

// ── Helper: read a system config value ──────────────────────────────────────
async function getSystemConfig(
  blink: ReturnType<typeof createClient>,
  key: string,
  defaultValue: string
): Promise<string> {
  try {
    const configs = await blink.db.systemConfigs.list({ where: { key }, limit: 1 });
    if (configs.length > 0) {
      return String((configs[0] as Record<string, unknown>).value ?? defaultValue);
    }
  } catch (_) {
    // ignore and use default
  }
  return defaultValue;
}

// ── Helper: determine resolved stage ────────────────────────────────────────
function resolveStage(
  detectedStage: string | null,
  currentTurns: number,
  pressThreshold: number,
  convergeThreshold: number,
  existingStage: string
): string {
  if (detectedStage === "PRESS") return "PRESS";
  if (detectedStage === "CONVERGE") return "CONVERGE";
  if (currentTurns >= convergeThreshold) return "CONVERGE";
  if (currentTurns >= pressThreshold) return "PRESS";
  return existingStage || "DIVERGENT";
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const projectId = Deno.env.get("BLINK_PROJECT_ID");
    const secretKey = Deno.env.get("BLINK_SECRET_KEY");
    if (!projectId || !secretKey) {
      return new Response(
        JSON.stringify({ error: "Missing server config" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const blink = createClient({ projectId, secretKey });
    const body = await req.json();
    const { action, sessionId, userMessage, messages, userId, currentStage } = body;

    // ── Action: get_session ─────────────────────────────────────────────────
    if (action === "get_session") {
      if (!sessionId || !userId) {
        return new Response(
          JSON.stringify({ error: "Missing sessionId or userId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const auth = await blink.auth.verifyToken(req.headers.get("Authorization"));
      if (!auth.valid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const session = await blink.db.interviewSessions.get(sessionId) as Record<string, unknown> | null;
      if (!session) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (session.userId !== userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let parsedMessages: unknown[] = [];
      let parsedContradictions: unknown[] = [];
      let parsedContextVariables: Record<string, unknown> = {};

      try { parsedMessages = JSON.parse(session.messages as string || "[]"); } catch (_) { /* use default */ }
      try { parsedContradictions = JSON.parse(session.extractedContradictions as string || "[]"); } catch (_) { /* use default */ }
      try { parsedContextVariables = JSON.parse(session.contextVariables as string || "{}"); } catch (_) { /* use default */ }

      return new Response(
        JSON.stringify({
          session: {
            ...session,
            messages: parsedMessages,
            extractedContradictions: parsedContradictions,
            contextVariables: parsedContextVariables,
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Action: interview_turn ───────────────────────────────────────────────
    if (action === "interview_turn") {
      if (!messages || !userId) {
        return new Response(
          JSON.stringify({ error: "Missing messages or userId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const auth = await blink.auth.verifyToken(req.headers.get("Authorization"));
      if (!auth.valid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const userProfiles = await blink.db.userProfiles.list({ where: { userId }, limit: 1 });
      if (userProfiles.length === 0) {
        return new Response(JSON.stringify({ error: "User profile not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const profile = userProfiles[0] as Record<string, unknown>;
      const tokenBalance = Number(profile.tokenBalance) || 0;

      const cfgKeys = {
        interviewTurnCost: "TOKEN_COST_INTERVIEW_TURN",
        interviewModel: "LLM_MODEL_INTERVIEW",
        pressTurn: "INTERVIEW_PRESS_TURN",
        convergeTurn: "INTERVIEW_CONVERGE_TURN",
      };

      const [costValue, modelName, pressThresholdStr, convergeThresholdStr] = await Promise.all([
        getSystemConfig(blink, cfgKeys.interviewTurnCost, "2"),
        getSystemConfig(blink, cfgKeys.interviewModel, "gpt-4.1-mini"),
        getSystemConfig(blink, cfgKeys.pressTurn, "8"),
        getSystemConfig(blink, cfgKeys.convergeTurn, "20"),
      ]);

      const tokenCost = Number(costValue);
      const pressThreshold = Number(pressThresholdStr);
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
        reportData = JSON.parse(jsonText);
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
        vFeature: JSON.stringify((reportData.vFeature as Record<string, number>) || {}),
        consistencyScore: String((reportData.consistencyScore as number) || 0),
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
