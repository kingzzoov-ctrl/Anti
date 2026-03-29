const __deprecated = true;
import { ARIADNE_ICEBREAKER_PROMPT, ARIADNE_MATCH_PROMPT } from "../_shared/ariadnePrompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const MATCH_SYSTEM_PROMPT = ARIADNE_MATCH_PROMPT;

function buildRelationshipFit(resonanceScore: number) {
  if (resonanceScore >= 0.78) {
    return {
      label: "高共振",
      score: Math.round(resonanceScore * 100),
      description: "双方在核心互动节律上具有较高兼容性，可进入深度连接观察期。",
    };
  }
  if (resonanceScore >= 0.62) {
    return {
      label: "可培养",
      score: Math.round(resonanceScore * 100),
      description: "存在稳定共鸣基础，但仍需要通过沟通验证边界与推进节奏。",
    };
  }
  return {
    label: "谨慎观察",
    score: Math.round(resonanceScore * 100),
    description: "局部维度可对接，但关系推进容易受张力点影响，需要慢速试探。",
  };
}

function buildUnlockMilestones() {
  return [
    { stage: 0, label: "匿名试探", requirement: "建立连接后可见，适合确认基本沟通意愿", unlocked: true },
    { stage: 1, label: "主题交换", requirement: "累计 5 条有效消息，进入稳定来回", unlocked: false },
    { stage: 2, label: "边界试探", requirement: "累计 10 条有效消息，可讨论关系节奏与边界", unlocked: false },
    { stage: 3, label: "深层解锁", requirement: "累计 15 条有效消息，进入完全解锁阶段", unlocked: false },
  ];
}

function normalizeMatchData(matchData: Record<string, unknown>) {
  const rawScore = Number(matchData.resonanceScore ?? 0);
  const resonanceScore = rawScore > 1 ? rawScore / 100 : rawScore;
  const relationshipFit = buildRelationshipFit(resonanceScore);
  const unlockMilestones = buildUnlockMilestones();

  return {
    resonanceScore,
    resonancePoints: Array.isArray(matchData.resonancePoints) ? matchData.resonancePoints.map(String) : [],
    tensionZones: Array.isArray(matchData.tensionZones)
      ? matchData.tensionZones.map((zone) => ({
          title: String((zone as Record<string, unknown>).title ?? "未命名张力点"),
          description: String((zone as Record<string, unknown>).description ?? ""),
          severity: Number((zone as Record<string, unknown>).severity ?? 0),
        }))
      : [],
    powerDynamics: String(matchData.powerDynamics ?? ""),
    growthPotential: String(matchData.growthPotential ?? ""),
    criticalWarning: matchData.criticalWarning ? String(matchData.criticalWarning) : null,
    icebreakers: Array.isArray(matchData.icebreakers) ? matchData.icebreakers.map(String).slice(0, 5) : [],
    summary: String(matchData.summary ?? ""),
    relationshipFit,
    guidance: Array.isArray(matchData.guidance) ? matchData.guidance.map(String).slice(0, 4) : [],
    unlockMilestones,
  };
}

function extractReportMeta(report: Record<string, unknown>) {
  try {
    const rawContent = typeof report.rawContent === "string"
      ? JSON.parse(report.rawContent as string)
      : (report.rawContent as Record<string, unknown> | undefined) ?? {};
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
        target: "/api/v1/ariadne/match",
        architecture: "fastapi-postgres-redis",
      });
    });
        .sort((a, b) => b.resonanceScore - a.resonanceScore)
        .slice(0, 20);

      // Asynchronously update exposure_logs for shown candidates (don't await)
      const shownUserIds = results.map((r) => r.userId);
      Promise.all(
        shownUserIds.map((uid) => upsertExposureLog(blink, uid, today))
      ).catch((err) => console.error("Async exposure update error:", err));

      // Strip internal userId from response to keep anonymous
      const sanitizedResults = results.map(({ userId: _uid, ...rest }) => rest);

      return new Response(JSON.stringify({ results: sanitizedResults }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: Deep Match (SSE Streaming) ───────────────────────────────────
    if (action === "deep_match") {
      if (!targetReportId) {
        return new Response(JSON.stringify({ error: "Missing targetReportId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check token balance
      const userProfiles = await blink.db.userProfiles.list({ where: { userId }, limit: 1 });
      if (!userProfiles.length) {
        return new Response(JSON.stringify({ error: "Profile not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const profile = userProfiles[0] as Record<string, unknown>;
      const tokenBalance = Number(profile.tokenBalance) || 0;
      const deepMatchCostKey = ["TOKEN", "COST", "DEEP", "MATCH"].join("_");
      const [costConfig, llmModel] = await Promise.all([
        blink.db.systemConfigs.list({ where: { key: deepMatchCostKey }, limit: 1 }),
        getSystemConfig(blink, "LLM_MODEL_MATCH", "gpt-4.1"),
      ]);
      const tokenCost = costConfig.length > 0 ? Number((costConfig[0] as Record<string, unknown>).value) : 50;

      if (tokenBalance < tokenCost) {
        return new Response(JSON.stringify({ error: "token_insufficient", balance: tokenBalance }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch both reports
      const [userReportList, targetReportList] = await Promise.all([
        blink.db.insightReports.list({ where: { userId }, orderBy: { createdAt: "desc" }, limit: 1 }),
        blink.db.insightReports.list({ where: { id: targetReportId }, limit: 1 }),
      ]);

      if (!userReportList.length || !targetReportList.length) {
        return new Response(JSON.stringify({ error: "报告缺失，无法进行推演。" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userReport = userReportList[0] as Record<string, unknown>;
      const targetReport = targetReportList[0] as Record<string, unknown>;

      // Deduct tokens upfront
      const newBalance = tokenBalance - tokenCost;
      await blink.db.userProfiles.update(profile.id as string, {
        tokenBalance: String(newBalance),
        updatedAt: new Date().toISOString(),
      });

      // Build SSE streaming response
      const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const sseHeaders = {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      };

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (data: string) => {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          let fullText = "";
          try {
            // Use streaming AI generation
            const { textStream } = await blink.ai.streamText({
              model: llmModel,
              messages: [
                { role: "system", content: MATCH_SYSTEM_PROMPT },
                {
                  role: "user",
                  content: `【用户 A 画像】：\n${JSON.stringify(userReport.rawContent)}\n\n【用户 B 画像】：\n${JSON.stringify(targetReport.rawContent)}\n\n请执行深度推演，生成完整的双人关系张力报告。`,
                },
              ],
            });

            for await (const chunk of textStream) {
              fullText += chunk;
              send(JSON.stringify({ type: "chunk", content: chunk }));
            }
          } catch (streamErr) {
            console.error("Stream AI error:", streamErr);
            // Fallback: try non-streaming
            try {
              const { text } = await blink.ai.generateText({
                model: llmModel,
                messages: [
                  { role: "system", content: MATCH_SYSTEM_PROMPT },
                  {
                    role: "user",
                    content: `【用户 A 画像】：\n${JSON.stringify(userReport.rawContent)}\n\n【用户 B 画像】：\n${JSON.stringify(targetReport.rawContent)}\n\n请执行深度推演，生成完整的双人关系张力报告。`,
                  },
                ],
              });
              fullText = text;
              send(JSON.stringify({ type: "chunk", content: text }));
            } catch (fallbackErr) {
              console.error("Fallback AI error:", fallbackErr);
              send(JSON.stringify({ type: "error", error: "AI generation failed" }));
              controller.close();
              return;
            }
          }

          // Parse the final JSON
          let matchData: Record<string, unknown>;
          try {
            // Extract JSON from possible markdown code fences
            const jsonMatch = fullText.match(/```(?:json)?\s*([\s\S]*?)```/);
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : fullText.trim();
            matchData = JSON.parse(jsonStr);
          } catch {
            matchData = {
              summary: fullText,
              resonanceScore: 0.5,
              tensionZones: [],
              resonancePoints: [],
              icebreakers: [],
            };
          }

          const normalizedMatchData = normalizeMatchData(matchData);

          // Save match record to DB
          try {
            await blink.db.matchRecords.create({
              id: matchId,
              userIdA: userId,
              userIdB: targetReport.userId as string,
              resonanceScore: String(normalizedMatchData.resonanceScore || 0),
              matchAnalysis: JSON.stringify(normalizedMatchData),
              status: "complete",
            });
          } catch (dbErr) {
            console.error("Save match record error:", dbErr);
          }

          // Send final done event
          send(JSON.stringify({
            type: "done",
            match: normalizedMatchData,
            matchId,
            tokenBalance: newBalance,
          }));

          controller.close();
        },
      });

      return new Response(stream, { status: 200, headers: sseHeaders });
    }

    // ── Action: Generate Icebreakers ─────────────────────────────────────────
    if (action === "generate_icebreakers") {
      const matchId = bodyMatchId;
      if (!matchId || !threadId) {
        return new Response(JSON.stringify({ error: "Missing matchId or threadId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch match record
      const matchRecordList = await blink.db.matchRecords.list({ where: { id: matchId }, limit: 1 });
      if (!matchRecordList.length) {
        return new Response(JSON.stringify({ error: "Match record not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const matchRecord = matchRecordList[0] as Record<string, unknown>;

      // Parse existing match_analysis for icebreakers
      let matchAnalysis: Record<string, unknown> = {};
      try {
        matchAnalysis = JSON.parse((matchRecord.matchAnalysis as string) || "{}");
      } catch { /* skip */ }

      const existingIcebreakers = matchAnalysis.icebreakers as string[] | undefined;

      // If icebreakers already exist in the match record, check the thread
      if (existingIcebreakers && existingIcebreakers.length > 0) {
        // Update social_threads with icebreakers
        try {
          const threadList = await blink.db.socialThreads.list({ where: { id: threadId }, limit: 1 });
          if (threadList.length > 0) {
            const thread = threadList[0] as Record<string, unknown>;
            const threadIcebreakers: string[] = [];
            try {
              const parsed = JSON.parse((thread.icebreakers as string) || "[]");
              if (Array.isArray(parsed)) threadIcebreakers.push(...parsed);
            } catch { /* skip */ }

            if (threadIcebreakers.length === 0) {
              await blink.db.socialThreads.update(threadId, {
                icebreakers: JSON.stringify(existingIcebreakers),
                updatedAt: new Date().toISOString(),
              });
            }
          }
        } catch (err) {
          console.error("Thread icebreaker update error:", err);
        }

        return new Response(JSON.stringify({ icebreakers: existingIcebreakers }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Otherwise, fetch both reports and generate icebreakers via AI
      const userIdA = matchRecord.userIdA as string;
      const userIdB = matchRecord.userIdB as string;

      const [reportsA, reportsB] = await Promise.all([
        blink.db.insightReports.list({ where: { userId: userIdA }, orderBy: { createdAt: "desc" }, limit: 1 }),
        blink.db.insightReports.list({ where: { userId: userIdB }, orderBy: { createdAt: "desc" }, limit: 1 }),
      ]);

      let icebreakers: string[] = [];

      if (reportsA.length && reportsB.length) {
        const rA = reportsA[0] as Record<string, unknown>;
        const rB = reportsB[0] as Record<string, unknown>;

        try {
          const { text } = await blink.ai.generateText({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "system",
                content: ARIADNE_ICEBREAKER_PROMPT,
              },
              {
                role: "user",
                content: `【用户 A 画像】：\n${JSON.stringify(rA.rawContent)}\n\n【用户 B 画像】：\n${JSON.stringify(rB.rawContent)}\n\n请生成3个能打开对话的破冰问题。只返回JSON数组格式。`,
              },
            ],
          });

          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              icebreakers = parsed.slice(0, 3).map(String);
            }
          }
        } catch (aiErr) {
          console.error("Icebreaker AI error:", aiErr);
          icebreakers = ["你最近有什么让你印象深刻的经历？", "你觉得什么样的关系让你感觉最自在？", "如果可以改变一件过去的事，你会选择什么？"];
        }
      } else {
        icebreakers = ["你最近有什么让你印象深刻的经历？", "你觉得什么样的关系让你感觉最自在？", "如果可以改变一件过去的事，你会选择什么？"];
      }

      // Update social_threads with generated icebreakers
      try {
        const threadList = await blink.db.socialThreads.list({ where: { id: threadId }, limit: 1 });
        if (threadList.length > 0) {
          await blink.db.socialThreads.update(threadId, {
            icebreakers: JSON.stringify(icebreakers),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error("Thread update error:", err);
      }

      return new Response(JSON.stringify({ icebreakers }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Match handler error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

function computeResonanceScore(
  a: Record<string, number>,
  b: Record<string, number>,
  bConsistency: number
): number {
  if (!a.v1Security && !b.v1Security) return 0;

  const dims = ["v1Security", "v2Power", "v3Boundary", "v4Conflict", "v5Emotion"] as const;
  let score = 0;
  let weight = 0;

  for (const dim of dims) {
    const av = a[dim] ?? 0.5;
    const bv = b[dim] ?? 0.5;

    // Power and security: complement is better
    if (dim === "v1Security" || dim === "v2Power") {
      const complement = 1 - Math.abs(av - bv);
      score += complement * 0.2;
    } else {
      // Others: similarity is better
      const similarity = 1 - Math.abs(av - bv);
      score += similarity * 0.2;
    }
    weight += 0.2;
  }

  // V6/V7 bonus
  const v7a = a["v7Consistency"] ?? 0.7;
  const v7b = b["v7Consistency"] ?? 0.7;
  const consistencyBonus = (v7a + v7b) / 2;
  score = score * (0.8 + consistencyBonus * 0.2);

  // Friction penalty: both high conflict
  const v4a = a["v4Conflict"] ?? 0.5;
  const v4b = b["v4Conflict"] ?? 0.5;
  if (v4a > 0.75 && v4b > 0.75) score *= 0.7;
  if (v4a < 0.25 && v4b < 0.25) score *= 0.8;

  // Low fidelity penalty
  if (bConsistency < 0.6) score *= 0.8;

  return Math.min(1, Math.max(0, score));
}

function getOverlapDimensions(a: Record<string, number>, b: Record<string, number>): string[] {
  const labels: Record<string, string> = {
    v1Security: "安全型",
    v2Power: "权力格局",
    v3Boundary: "边界观",
    v4Conflict: "冲突方式",
    v5Emotion: "情绪粒度",
  };
  const overlapping: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const av = a[key] ?? 0.5;
    const bv = b[key] ?? 0.5;
    if (Math.abs(av - bv) < 0.2) overlapping.push(label);
  }
  return overlapping;
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
        message: 'Legacy Blink match function has been retired. Use the FastAPI Ariadne backend instead.',
        target: '/api/v1/ariadne/match/discover | /api/v1/ariadne/match/deep | /api/v1/ariadne/match/icebreakers',
        architecture: 'fastapi-postgres-redis',
      },
      410,
    );
  });
}
