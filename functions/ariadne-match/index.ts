import { createClient } from "npm:@blinkdotnew/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const MATCH_SYSTEM_PROMPT = `You are a deep resonance analyst for Ariadne.
You receive two psychological profiles (insight reports) and must perform a precise compatibility analysis.

Your analysis must cover:
1. Core Resonance Points: Where these two people fundamentally align (shared needs, complementary fears)
2. Tension Zones (火药桶): Specific combinations of their patterns that will create recurring friction
3. Power Dynamics: How their V2 (power) and V3 (boundary) profiles interact
4. Growth Potential: What each person could learn from or through the other
5. Critical Warning: If compatibility is genuinely low, state it clearly without sugarcoating

Format your response as structured JSON:
{
  "resonanceScore": 0.0-1.0,
  "resonancePoints": ["...", "..."],
  "tensionZones": [
    { "title": "...", "description": "...", "severity": 0.0-1.0 }
  ],
  "powerDynamics": "...",
  "growthPotential": "...",
  "criticalWarning": "..." or null,
  "icebreakers": ["...", "...", "..."],
  "summary": "One paragraph executive summary"
}

Be analytically honest. Low compatibility gets a low score. Do not fabricate resonance.
Respond in Chinese.`;

// ── Helper: read system_configs ───────────────────────────────────────────────
async function getSystemConfig(blink: any, key: string, defaultValue: string): Promise<string> {
  try {
    const results = await blink.db.systemConfigs.list({ where: { key }, limit: 1 });
    if (results.length > 0) return (results[0] as any).value as string;
  } catch { /* ignore */ }
  return defaultValue;
}

// ── Helper: upsert exposure log for one user ─────────────────────────────────
async function upsertExposureLog(blink: any, targetUserId: string, today: string): Promise<void> {
  try {
    const existing = await blink.db.exposureLogs.list({
      where: { userId: targetUserId, date: today },
      limit: 1,
    });
    if (existing.length > 0) {
      const rec = existing[0] as Record<string, unknown>;
      await blink.db.exposureLogs.update(rec.id as string, {
        dailyExposureCount: Number(rec.dailyExposureCount || 0) + 1,
      });
    } else {
      await blink.db.exposureLogs.create({
        id: `exp_${targetUserId}_${today}_${Math.random().toString(36).slice(2, 6)}`,
        userId: targetUserId,
        date: today,
        dailyExposureCount: 1,
      });
    }
  } catch (err) {
    console.error("upsertExposureLog error:", err);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const projectId = Deno.env.get("BLINK_PROJECT_ID");
    const secretKey = Deno.env.get("BLINK_SECRET_KEY");
    if (!projectId || !secretKey) {
      return new Response(JSON.stringify({ error: "Missing config" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blink = createClient({ projectId, secretKey });
    const auth = await blink.auth.verifyToken(req.headers.get("Authorization"));
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, userId, targetReportId, threadId, matchId: bodyMatchId, targetUserId } = body;

    // ── Action: update_exposure ───────────────────────────────────────────────
    if (action === "update_exposure") {
      if (!targetUserId) {
        return new Response(JSON.stringify({ error: "Missing targetUserId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const today = new Date().toISOString().slice(0, 10);
      await upsertExposureLog(blink, targetUserId, today);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: Discovery Search ──────────────────────────────────────────────
    if (action === "discover") {
      // Get current user's latest public report
      const userReports = await blink.db.insightReports.list({
        where: { userId, isPublic: "1" },
        orderBy: { createdAt: "desc" },
        limit: 1,
      });

      if (userReports.length === 0) {
        return new Response(JSON.stringify({ error: "No report found. Complete an interview first." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userReport = userReports[0] as Record<string, unknown>;
      const userFeature = JSON.parse((userReport.vFeature as string) || "{}") as Record<string, number>;

      // Read config values
      const [decayFactorStr, thresholdStr, consistencyMinStr] = await Promise.all([
        getSystemConfig(blink, "MATCH_DECAY_FACTOR", "0.05"),
        getSystemConfig(blink, "MATCH_RESONANCE_THRESHOLD", "0.55"),
        getSystemConfig(blink, "CONSISTENCY_MIN_THRESHOLD", "0.6"),
      ]);
      const decayFactor = parseFloat(decayFactorStr) || 0.05;
      const threshold = parseFloat(thresholdStr) || 0.55;
      const consistencyMin = parseFloat(consistencyMinStr) || 0.6;

      // Get all public reports excluding user's own
      const allReports = await blink.db.insightReports.list({
        where: { isPublic: "1" },
        orderBy: { createdAt: "desc" },
        limit: 100,
      });

      const candidates = allReports.filter(
        (r) => (r as Record<string, unknown>).userId !== userId
      ) as Record<string, unknown>[];

      // Filter out low-fidelity reports below consistency threshold
      const qualifiedCandidates = candidates.filter(
        (r) => Number(r.consistencyScore || 0) >= consistencyMin
      );

      // Collect candidate userIds for batch exposure query
      const today = new Date().toISOString().slice(0, 10);
      const candidateUserIds = qualifiedCandidates.map((r) => r.userId as string);

      // Batch-query exposure_logs for today for all candidates
      let exposureMap: Record<string, number> = {};
      if (candidateUserIds.length > 0) {
        try {
          const exposureLogs = await blink.db.exposureLogs.list({
            where: { date: today },
            limit: 500,
          });
          for (const log of exposureLogs as Record<string, unknown>[]) {
            const uid = log.userId as string;
            if (candidateUserIds.includes(uid)) {
              exposureMap[uid] = Number(log.dailyExposureCount || 0);
            }
          }
        } catch (err) {
          console.error("Exposure log query error:", err);
        }
      }

      // Compute scores with exposure decay
      const scored = qualifiedCandidates.map((r) => {
        let feature: Record<string, number> = {};
        try {
          feature = JSON.parse((r.vFeature as string) || "{}") as Record<string, number>;
        } catch { /* skip */ }

        const consistencyScore = Number(r.consistencyScore) || 0;
        const resonanceScore = computeResonanceScore(userFeature, feature, consistencyScore);

        const exposureCount = exposureMap[r.userId as string] || 0;
        const finalScore = resonanceScore * Math.max(0, 1 - exposureCount * decayFactor);

        return {
          reportId: r.id as string,
          userId: r.userId as string,
          anonymousId: `Anon_${(r.id as string).slice(-6)}`,
          resonanceScore: Math.round(finalScore * 100) / 100,
          featureVector: feature,
          consistencyScore,
          isLowFidelity: consistencyScore < consistencyMin,
          overlapDimensions: getOverlapDimensions(userFeature, feature),
        };
      });

      // Filter below threshold and sort
      const results = scored
        .filter((s) => s.resonanceScore >= threshold)
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

          // Save match record to DB
          try {
            await blink.db.matchRecords.create({
              id: matchId,
              userIdA: userId,
              userIdB: targetReport.userId as string,
              resonanceScore: String(matchData.resonanceScore || 0),
              matchAnalysis: JSON.stringify(matchData),
              status: "complete",
            });
          } catch (dbErr) {
            console.error("Save match record error:", dbErr);
          }

          // Send final done event
          send(JSON.stringify({
            type: "done",
            match: matchData,
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
                content: `You are a conversation starter expert for Ariadne. Generate exactly 3 icebreaker questions that would naturally spark a deep, authentic conversation between two people based on their psychological profiles. Return ONLY a JSON array of 3 strings. Respond in Chinese.`,
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
