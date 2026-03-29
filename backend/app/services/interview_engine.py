from __future__ import annotations
from collections import Counter
from datetime import UTC, datetime
import hashlib
from typing import Iterable
from uuid import uuid4


FEATURE_KEYWORDS = {
    'v1Security': ['安全感', '稳定', '靠谱', '信任', '确定', '陪伴', '长期'],
    'v2Power': ['主导', '掌控', '平等', '控制', '被动', '强势', '决策'],
    'v3Boundary': ['边界', '空间', '尊重', '距离', '隐私', '分寸', '独处'],
    'v4Conflict': ['冲突', '争吵', '冷战', '逃避', '沟通', '解释', '和好'],
    'v5Emotion': ['情绪', '表达', '敏感', '共情', '脆弱', '在意', '喜欢'],
    'v6Values': ['价值观', '责任', '家庭', '婚姻', '成长', '原则', '未来'],
}


def _utcnow_iso_z() -> str:
    return datetime.now(UTC).isoformat().replace('+00:00', 'Z')

DIMENSION_LABELS = {
    'v1Security': '安全感',
    'v2Power': '权力协商',
    'v3Boundary': '边界感',
    'v4Conflict': '冲突处理',
    'v5Emotion': '情绪表达',
    'v6Values': '价值排序',
    'v7Consistency': '自洽度',
}


def infer_stage(turn_count: int, current_stage: str) -> str:
    if current_stage in {'COMPLETE', 'REPORT_READY'}:
        return 'COMPLETE'
    if turn_count >= 20:
        return 'CONVERGE'
    if turn_count >= 8:
        return 'PRESS'
    return 'DIVERGENT'


def _recent_user_messages(messages: Iterable[dict], limit: int = 4) -> list[str]:
    transcript = _extract_transcript(messages)
    return transcript[-limit:]


def _extract_focus_dimensions(text: str) -> list[str]:
    hits: list[tuple[str, int]] = []
    for key, keywords in FEATURE_KEYWORDS.items():
        count = sum(text.count(keyword) for keyword in keywords)
        if count > 0:
            hits.append((key, count))
    hits.sort(key=lambda item: item[1], reverse=True)
    return [key for key, _ in hits[:2]]


def _detect_contradictions(transcript: list[str]) -> list[dict]:
    joined = '\n'.join(transcript)
    contradictions: list[dict] = []

    contradiction_rules = [
        ('既想靠近又怕受伤', ['想靠近', '喜欢', '投入'], ['怕', '担心', '受伤', '失望']),
        ('既要空间又要高频回应', ['空间', '边界', '独处'], ['秒回', '陪伴', '高频', '回应']),
        ('既强调平等又持续试探控制感', ['平等', '尊重'], ['控制', '掌控', '主导', '试探']),
        ('既说要沟通又倾向回避冲突', ['沟通', '说开'], ['冷战', '逃避', '不说', '憋着']),
    ]

    for title, left_words, right_words in contradiction_rules:
        if any(word in joined for word in left_words) and any(word in joined for word in right_words):
            user_statement_a = next((item for item in transcript if any(word in item for word in left_words)), left_words[0])
            user_statement_b = next((item for item in transcript if any(word in item for word in right_words)), right_words[0])
            contradictions.append(
                {
                    'id': f"cdr_{abs(hash(title)) % 10_000}_{len(contradictions) + 1}",
                    'dimension': title,
                    'userStatementA': user_statement_a[:160],
                    'userStatementB': user_statement_b[:160],
                    'aiAnalysis': f'你的表达里同时出现了“{left_words[0]}”与“{right_words[0]}”一类信号，说明真实需求与防御策略可能同时存在。',
                    'severity': 68,
                }
            )

    return contradictions[:3]


def _extract_context_variables(user_message: str, transcript: list[str], stage: str) -> dict[str, str]:
    joined = '\n'.join([*transcript, user_message])
    focus_dimensions = _extract_focus_dimensions(joined)
    primary_focus = DIMENSION_LABELS.get(focus_dimensions[0], '关系节律') if focus_dimensions else '关系节律'
    relationship_goal = '建立稳定且可持续的亲密关系'
    if any(word in joined for word in ['结婚', '长期', '未来', '家庭']):
        relationship_goal = '寻找可进入长期承诺与共同生活的关系'
    elif any(word in joined for word in ['了解', '接触', '观察', '慢慢来']):
        relationship_goal = '先建立基本了解，再决定是否深入投入'

    defense_mode = 'risk_scan' if any(word in joined for word in ['怕', '担心', '风险', '失望']) else 'open_probe'
    communication_style = 'indirect' if any(word in joined for word in ['试探', '观察', '不说', '憋着']) else 'direct'

    return {
        'lastStage': stage,
        'primaryFocusDimension': primary_focus,
        'relationshipGoal': relationship_goal,
        'defenseMode': defense_mode,
        'communicationStyle': communication_style,
        'latestUserSignal': user_message[:120],
    }


def _merge_context_variables(existing: dict[str, str] | None, incoming: dict[str, str]) -> dict[str, str]:
    merged = dict(existing or {})
    merged.update({key: value for key, value in incoming.items() if value})
    return merged


def _merge_contradictions(existing: list[dict] | None, incoming: list[dict]) -> list[dict]:
    result: list[dict] = []
    seen_ids: set[str] = set()
    for item in [*(existing or []), *incoming]:
        item_id = str(item.get('id', ''))
        if not item_id or item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        result.append(item)
    return result[:6]


def _is_off_topic(text: str) -> bool:
    stripped = (text or '').strip()
    if not stripped:
        return True
    off_topic_keywords = ['天气', '吃饭', '哈哈', '在吗', '收到', '看看再说', '随便', '不知道聊什么']
    relationship_keywords = [keyword for keywords in FEATURE_KEYWORDS.values() for keyword in keywords]
    if any(keyword in stripped for keyword in relationship_keywords):
        return False
    if len(stripped) <= 6:
        return True
    return any(keyword in stripped for keyword in off_topic_keywords)


def _completion_reason(
    *,
    turn_count: int,
    contradictions: list[dict],
    off_topic_count: int,
    consistency_score: float,
    stage: str,
) -> str | None:
    if off_topic_count >= 3:
        return 'bad_case_off_topic'
    if stage == 'CONVERGE' and turn_count >= 18 and consistency_score >= 0.68:
        return 'sufficient_convergence'
    if len(contradictions) >= 4 and consistency_score >= 0.72 and turn_count >= 16:
        return 'contradictions_stabilized'
    if turn_count >= 24:
        return 'max_turn_guardrail'
    return None


def _build_state_machine_context(
    *,
    turn_count: int,
    stage: str,
    user_message: str,
    transcript: list[str],
    contradictions: list[dict],
    prior_state: dict[str, object] | None = None,
) -> dict[str, object]:
    previous = dict(prior_state or {})
    off_topic_increment = 1 if _is_off_topic(user_message) else 0
    off_topic_count = int(previous.get('offTopicCount', 0) or 0) + off_topic_increment
    keyword_hits = _keyword_hits([*transcript, user_message])
    active_dimensions = [DIMENSION_LABELS[key] for key, count in keyword_hits.items() if count > 0][:3]
    transcript_len = len([*transcript, user_message])
    consistency_proxy = max(0.35, min(0.95, 0.42 + min(0.2, transcript_len * 0.02) + min(0.18, len(contradictions) * 0.03)))
    readiness = stage == 'CONVERGE' and turn_count >= 16 and consistency_proxy >= 0.66 and off_topic_count < 3
    completion_reason = _completion_reason(
        turn_count=turn_count,
        contradictions=contradictions,
        off_topic_count=off_topic_count,
        consistency_score=consistency_proxy,
        stage=stage,
    )
    bad_case_flags: list[str] = []
    if off_topic_count >= 3:
        bad_case_flags.append('off_topic_drift')
    if transcript_len < 6 and turn_count >= 10:
        bad_case_flags.append('shallow_material')
    if len(contradictions) == 0 and turn_count >= 12:
        bad_case_flags.append('weak_contradiction_signal')

    return {
        'readiness': readiness,
        'offTopicCount': off_topic_count,
        'badCaseFlags': bad_case_flags,
        'completionReason': completion_reason,
        'activeDimensions': active_dimensions,
        'consistencyProxy': round(consistency_proxy, 2),
        'stateContextVersion': 'ariadne-state-machine-v2',
    }


def _build_question(stage: str, user_message: str, transcript: list[str], contradictions: list[dict]) -> str:
    if _is_off_topic(user_message):
        return '先不要岔开。把注意力拉回亲密关系本身：最近一次你明显想靠近、退缩、试探或失望的场景，具体发生了什么？'

    latest_context = '\n'.join(transcript[-4:] + [user_message])
    focus_dimensions = _extract_focus_dimensions(latest_context)
    focus_label = DIMENSION_LABELS.get(focus_dimensions[0], '关系节律') if focus_dimensions else '关系节律'

    if stage == 'DIVERGENT':
        if focus_label == '安全感':
            return '具体说一个最近的关系场景：对方做了什么，会让你立刻觉得这段关系是安全的，或者不安全的？'
        if focus_label == '边界感':
            return '把你说的“边界”说得更具体一点：你最不能接受对方越过的线，到底是什么？'
        if focus_label == '情绪表达':
            return '当你说自己在意、敏感或有情绪时，你通常会直接表达，还是先压住不说？举一次真实例子。'
        return '别只说判断，继续展开一个真实场景：当关系开始推进时，你通常先观察什么，再决定要不要投入？'

    if stage == 'PRESS':
        if contradictions:
            contradiction_label = str(contradictions[0].get('dimension') or '需求与防御并存')
            return f'你前面的表达里已经出现一个张力：{contradiction_label}。现在直接回答，你真正更优先保护的，是哪一边，为什么？'
        if focus_label == '冲突处理':
            return '你说到沟通或冲突时，不要再讲原则。告诉我：你上一次真正不舒服时，为什么没有当场说清楚？'
        if focus_label == '权力协商':
            return '你对主导权很敏感。直接回答：你害怕失去决定权，还是害怕自己投入后没有被同等对待？'
        return '你前后的表达已经有防御痕迹。不要解释对错，只回答：你最怕关系里再次发生什么？'

    if stage == 'CONVERGE':
        priorities = []
        if focus_dimensions:
            priorities = [DIMENSION_LABELS[key] for key in focus_dimensions]
        if not priorities:
            priorities = ['安全感', '边界感']
        return f'现在收束：如果只能留下两条最核心标准，请你用一句话分别说清楚你在「{priorities[0]}」和「{priorities[1]}」上的底线。'

    return '本轮已经完成。'


def build_interview_reply(
    user_message: str,
    turn_count: int,
    current_stage: str,
    messages: Iterable[dict] | None = None,
    context_variables: dict[str, str] | None = None,
    existing_contradictions: list[dict] | None = None,
    state_context: dict[str, object] | None = None,
) -> dict:
    stage = infer_stage(turn_count, current_stage)
    prefix = {
        'DIVERGENT': '继续展开，把你真实的反应和关系场景说具体。',
        'PRESS': '你前后的表达里有张力，请直接回答你究竟在防御什么。',
        'CONVERGE': '现在开始收束，请归纳你真正的底层需求、边界和判断。',
        'COMPLETE': '本轮已经完成。',
    }[stage]
    transcript = _recent_user_messages(messages or [])
    contradictions = _merge_contradictions(existing_contradictions, _detect_contradictions([*transcript, user_message]))
    merged_context_variables = _merge_context_variables(context_variables, _extract_context_variables(user_message, transcript, stage))
    machine_context = _build_state_machine_context(
        turn_count=turn_count,
        stage=stage,
        user_message=user_message,
        transcript=transcript,
        contradictions=contradictions,
        prior_state=state_context,
    )
    effective_stage = 'REPORT_READY' if bool(machine_context.get('readiness')) else stage
    if machine_context.get('completionReason') in {'bad_case_off_topic', 'max_turn_guardrail'}:
        effective_stage = 'COMPLETE'
    question = _build_question(stage, user_message, transcript, contradictions)
    return {
        'reply': f'{prefix}\n\n你刚才提到：{user_message[:120]}\n\n{question}',
        'stage': effective_stage,
        'contradictions': contradictions,
        'contextVariables': merged_context_variables,
        'stateContext': machine_context,
    }


def _extract_transcript(messages: Iterable[dict]) -> list[str]:
    return [str(m.get('content', '')).strip() for m in messages if m.get('role') == 'user' and str(m.get('content', '')).strip()]


def _keyword_hits(transcript: list[str]) -> dict[str, int]:
    joined = '\n'.join(transcript)
    return {
        key: sum(joined.count(keyword) for keyword in keywords)
        for key, keywords in FEATURE_KEYWORDS.items()
    }


def _feature_score(hit_count: int, transcript_len: int, emphasis: float = 0.0) -> float:
    baseline = 0.35 + min(0.35, transcript_len * 0.03)
    keyword_bonus = min(0.25, hit_count * 0.06)
    value = max(0.0, min(0.95, baseline + keyword_bonus + emphasis))
    return round(value, 2)


def _build_summary(transcript: list[str]) -> str:
    if not transcript:
        return '需要更多问询素材来形成高置信画像。'
    if len(transcript) == 1:
        return transcript[0][:120]
    segments = [item[:70] for item in transcript[:3]]
    return '；'.join(segment for segment in segments if segment)


def _context_summary(context_variables: dict[str, str] | None) -> list[str]:
    context = context_variables or {}
    items: list[str] = []
    if context.get('relationshipGoal'):
        items.append(f"当前关系目标：{context['relationshipGoal']}")
    if context.get('primaryFocusDimension'):
        items.append(f"当前核心焦点：{context['primaryFocusDimension']}")
    if context.get('defenseMode'):
        items.append(f"防御模式：{context['defenseMode']}")
    if context.get('communicationStyle'):
        items.append(f"沟通风格：{context['communicationStyle']}")
    return items


def _infer_patterns(transcript: list[str]) -> dict[str, list[str] | str]:
    joined = '\n'.join(transcript)
    needs: list[str] = []
    patterns: list[str] = []
    risks: list[str] = []
    suggestions: list[str] = []

    if any(word in joined for word in ['安全感', '稳定', '确定', '靠谱']):
        needs.append('你对稳定回应和确定性有较高需求。')
    if any(word in joined for word in ['边界', '空间', '隐私', '分寸']):
        needs.append('你非常在意关系中的边界感和被尊重感。')
    if any(word in joined for word in ['喜欢', '表达', '情绪', '共情']):
        needs.append('你希望情绪能被看见，而不是只被理性处理。')

    if any(word in joined for word in ['观察', '试探', '慢慢', '先看']):
        patterns.append('你倾向先观察再投入，通过试探确认安全后才会推进。')
    if any(word in joined for word in ['冷战', '逃避', '不说', '憋着']):
        patterns.append('遇到张力时，你可能会出现延迟表达或压抑反应。')
    if any(word in joined for word in ['控制', '主导', '被动', '拉扯']):
        patterns.append('你对关系中的主导权变化较敏感，容易注意失衡感。')

    if any(word in joined for word in ['怕', '担心', '风险', '失望']):
        risks.append('你会提前预判关系风险，这能保护自己，但也可能压缩自然流动。')
    if any(word in joined for word in ['冷战', '逃避', '误会']):
        risks.append('一旦沟通不透明，误解成本会迅速上升。')
    if any(word in joined for word in ['边界', '空间']) and any(word in joined for word in ['喜欢', '陪伴', '回应']):
        risks.append('你同时要亲密与空间，若不显式表达，伴侣容易误读你的节奏。')

    suggestions.append('先对齐沟通节律，再讨论承诺与边界。')
    if any(word in joined for word in ['边界', '空间', '隐私']):
        suggestions.append('把你的边界从“默认期待”改成“明确说明”。')
    if any(word in joined for word in ['怕', '担心', '试探', '观察']):
        suggestions.append('减少试探式确认，改用直接表达需求来降低误会。')

    return {
        'needs': needs or ['你需要更多稳定、清晰、可验证的互动反馈。'],
        'patterns': patterns or ['你在关系推进前会先观察风险，再决定是否投入。'],
        'risks': risks or ['当前素材显示你对不确定性较敏感，容易在模糊阶段保持防御。'],
        'suggestions': suggestions[:3],
    }


def _build_v_feature(transcript: list[str]) -> tuple[dict[str, float], int]:
    hits = _keyword_hits(transcript)
    transcript_len = len(transcript)
    unique_ratio = 0.0
    if transcript_len:
        normalized = [''.join(item.split())[:80] for item in transcript]
        unique_ratio = len(set(normalized)) / max(1, len(normalized))

    v_feature = {
        'v1Security': _feature_score(hits['v1Security'], transcript_len, 0.04),
        'v2Power': _feature_score(hits['v2Power'], transcript_len),
        'v3Boundary': _feature_score(hits['v3Boundary'], transcript_len, 0.02),
        'v4Conflict': _feature_score(hits['v4Conflict'], transcript_len),
        'v5Emotion': _feature_score(hits['v5Emotion'], transcript_len, 0.03),
        'v6Values': _feature_score(hits['v6Values'], transcript_len),
        'v7Consistency': round(max(0.35, min(0.95, 0.45 + unique_ratio * 0.35 + min(0.15, transcript_len * 0.015))), 2),
    }
    consistency_score = int(round(v_feature['v7Consistency'] * 100))
    return v_feature, consistency_score


def _build_v_embedding(transcript: list[str], context_variables: dict[str, str] | None = None, dimensions: int = 1536) -> list[float]:
    if dimensions <= 0:
        return []

    source_parts = [*transcript]
    if context_variables:
        source_parts.extend(f'{key}:{value}' for key, value in sorted(context_variables.items()))

    joined = '\n'.join(part.strip() for part in source_parts if part and part.strip())
    if not joined:
        return [0.0] * dimensions

    vector = [0.0] * dimensions
    for token in joined.split():
        digest = hashlib.sha256(token.encode('utf-8')).digest()
        bucket = int.from_bytes(digest[:2], 'big') % dimensions
        sign = 1.0 if digest[2] % 2 == 0 else -1.0
        weight = 0.35 + (digest[3] / 255) * 0.65
        vector[bucket] += sign * weight

    norm = sum(value * value for value in vector) ** 0.5
    if norm <= 0:
        return vector
    return [round(value / norm, 6) for value in vector]


def _build_chapters(
    summary: str,
    transcript: list[str],
    patterns: dict[str, list[str] | str],
    consistency_score: int,
    context_variables: dict[str, str] | None = None,
    contradictions: list[dict] | None = None,
) -> list[dict]:
    evidence = transcript[:3]
    confidence = 'high' if len(transcript) >= 6 else 'medium' if len(transcript) >= 3 else 'low'
    context_points = _context_summary(context_variables)
    contradiction_items = contradictions or []
    contradiction_points = [str(item.get('dimension') or '需求与防御并存') for item in contradiction_items[:3]]
    return [
        {
            'id': 'deep_needs',
            'title': '深层需求',
            'summary': '从用户表达中抽取稳定需求、边界诉求与关系期待。',
            'content': ' '.join([*patterns['needs'], *context_points[:2]]),
            'keyPoints': [*patterns['needs'][:2], *context_points[:2]][:4],
            'confidence': confidence,
            'evidenceQuotes': evidence[:2],
            'status': 'complete',
        },
        {
            'id': 'relationship_pattern',
            'title': '关系模式',
            'summary': '识别在推进、试探、防御和回应中的重复动作。',
            'content': ' '.join(patterns['patterns']),
            'keyPoints': patterns['patterns'][:3],
            'confidence': confidence,
            'evidenceQuotes': evidence[1:3],
            'status': 'complete',
        },
        {
            'id': 'risk_and_guidance',
            'title': '风险与建议',
            'summary': f'结合当前自洽度 {consistency_score}/100，给出最优先调整动作。',
            'content': ' '.join([*patterns['risks'], *patterns['suggestions'], *([f"当前开放矛盾：{'；'.join(contradiction_points)}"] if contradiction_points else [])]),
            'keyPoints': [*patterns['risks'][:2], *patterns['suggestions'][:2], *contradiction_points[:1]][:4],
            'confidence': confidence,
            'evidenceQuotes': evidence[:1],
            'status': 'complete',
        },
        {
            'id': 'session_overview',
            'title': '问询概览',
            'summary': '概述本轮问询的素材密度与主要主题。',
            'content': summary,
            'keyPoints': [f'有效用户表达 {len(transcript)} 段', f'主要主题覆盖 {max(1, len([k for k in FEATURE_KEYWORDS if any(word in "\n".join(transcript) for word in FEATURE_KEYWORDS[k])]))} 个维度'],
            'confidence': confidence,
            'evidenceQuotes': evidence,
            'status': 'complete',
        },
        {
            'id': 'state_machine_context',
            'title': '状态机侧写',
            'summary': '把问询过程中沉淀的上下文变量和开放矛盾写入报告。',
            'content': '；'.join(context_points + ([f"开放矛盾：{'；'.join(contradiction_points)}"] if contradiction_points else ['当前未检测到高置信开放矛盾。'])),
            'keyPoints': [*context_points[:3], *contradiction_points[:2]][:4] or ['当前未形成足够的状态变量沉淀'],
            'confidence': confidence,
            'evidenceQuotes': evidence[:2],
            'status': 'complete',
        },
    ]


def build_report(
    messages: Iterable[dict],
    user_id: str,
    session_id: str,
    context_variables: dict[str, str] | None = None,
    contradictions: list[dict] | None = None,
) -> dict:
    transcript = _extract_transcript(messages)
    summary = _build_summary(transcript)
    patterns = _infer_patterns(transcript)
    v_feature, consistency_score = _build_v_feature(transcript)
    keyword_counter = Counter()
    for text in transcript:
        for words in FEATURE_KEYWORDS.values():
            for word in words:
                if word in text:
                    keyword_counter[word] += text.count(word)

    top_keywords = [word for word, _ in keyword_counter.most_common(5)]
    chapters = _build_chapters(summary, transcript, patterns, consistency_score, context_variables, contradictions)
    low_confidence = len(transcript) < 3
    contradiction_items = contradictions or []
    context_payload = context_variables or {}
    v_embedding = _build_v_embedding(transcript, context_payload)
    report_id = f'report_{session_id}_{uuid4().hex[:8]}'
    lineage_id = f'lineage_{session_id}'
    return {
        'id': report_id,
        'userId': user_id,
        'title': 'Ariadne 结构化洞见报告',
        'rawContent': {
            'title': 'Ariadne 结构化洞见报告',
            'summary': summary,
            'reportMeta': {
                'schemaVersion': 'ariadne-report-v3',
                'promptAssetVersion': '2026-03-29.prompt-unified.v1',
                'reportType': 'detailed',
                'lineageId': lineage_id,
                'generatedAt': _utcnow_iso_z(),
                'language': 'zh-CN',
                'sourceSessionId': session_id,
                'turnCount': len(transcript),
                'stateContextVersion': 'session-v1',
            },
            'chapters': chapters,
            'keywordSignals': top_keywords,
            'dimensionLabels': DIMENSION_LABELS,
            'contradictions': contradiction_items,
            'stateContext': context_payload,
            'featureAnalysis': {
                'vFeature': v_feature,
                'consistencyScore': consistency_score,
                'vectorNarrative': f"当前主要聚焦于{context_payload.get('primaryFocusDimension', '关系节律')}，整体自洽度约 {consistency_score}/100。",
            },
            'qualityFlags': {
                'isLowConfidence': low_confidence,
                'hasOpenContradictions': len(contradiction_items) > 0,
                'coverageWarnings': [] if len(transcript) >= 3 else ['当前问询轮次不足，建议继续补充素材'],
                'missingDimensions': [DIMENSION_LABELS[key] for key, hit_count in _keyword_hits(transcript).items() if hit_count == 0][:4],
            },
        },
        'vFeature': v_feature,
        'vEmbedding': v_embedding,
        'consistencyScore': consistency_score,
        'isPublic': False,
        'version': 1,
        'createdAt': _utcnow_iso_z(),
    }
