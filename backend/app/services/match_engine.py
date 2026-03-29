from __future__ import annotations

from math import sqrt
from typing import Any


DIMENSION_KEYS = [
    ('v1Security', '安全感'),
    ('v2Power', '权力'),
    ('v3Boundary', '边界'),
    ('v4Conflict', '冲突'),
    ('v5Emotion', '情感'),
]


def build_relationship_fit(score: float) -> dict:
    if score >= 0.78:
        return {'label': '高共振', 'score': round(score * 100), 'description': '核心互动节律兼容度高。'}
    if score >= 0.62:
        return {'label': '可培养', 'score': round(score * 100), 'description': '存在稳定共鸣基础，但仍需验证边界。'}
    return {'label': '谨慎观察', 'score': round(score * 100), 'description': '局部可对接，但推进需要更慢。'}


def _normalize_feature_map(raw: Any) -> dict[str, float]:
    if isinstance(raw, dict):
        return {key: float(raw.get(key, 0) or 0) for key, _ in DIMENSION_KEYS + [('v6Values', '价值'), ('v7Consistency', '自洽')]}
    if isinstance(raw, list):
        values = [float(item or 0) for item in raw]
        keys = ['v1Security', 'v2Power', 'v3Boundary', 'v4Conflict', 'v5Emotion', 'v6Values', 'v7Consistency']
        return {key: values[index] if index < len(values) else 0 for index, key in enumerate(keys)}
    return {key: 0 for key, _ in DIMENSION_KEYS + [('v6Values', '价值'), ('v7Consistency', '自洽')]}


def _chapter_count(raw_content: dict[str, Any]) -> int:
    chapters = raw_content.get('chapters') or []
    return len(chapters) if isinstance(chapters, list) else 0


def _report_type(raw_content: dict[str, Any]) -> str:
    meta = raw_content.get('reportMeta') or {}
    return str(meta.get('reportType') or 'detailed')


def _compatibility(source: dict[str, float], target: dict[str, float]) -> float:
    deltas = [abs(source.get(key, 0) - target.get(key, 0)) for key, _ in DIMENSION_KEYS]
    average_delta = (sum(deltas) / len(deltas)) if deltas else 1
    return max(0.0, min(1.0, 1 - average_delta))


def _overlap_dimensions(source: dict[str, float], target: dict[str, float]) -> list[str]:
    overlaps: list[str] = []
    for key, label in DIMENSION_KEYS:
        if abs(source.get(key, 0) - target.get(key, 0)) <= 0.18:
            overlaps.append(label)
    return overlaps


def _consistency_score(report: dict[str, Any]) -> float:
    raw = float(report.get('consistencyScore', 0) or 0)
    return raw / 100 if raw > 1 else raw


def _normalize_embedding(raw: Any) -> list[float]:
    if isinstance(raw, list):
        return [float(item or 0) for item in raw]
    return []


def _embedding_similarity(source: list[float], target: list[float]) -> float:
    if not source or not target:
        return 0.0
    size = min(len(source), len(target))
    if size == 0:
        return 0.0
    dot = sum(source[index] * target[index] for index in range(size))
    source_norm = sqrt(sum(source[index] * source[index] for index in range(size)))
    target_norm = sqrt(sum(target[index] * target[index] for index in range(size)))
    if source_norm == 0 or target_norm == 0:
        return 0.0
    cosine = dot / (source_norm * target_norm)
    return max(0.0, min(1.0, (cosine + 1) / 2))


def build_discovery_cards(source_report: dict[str, Any], candidate_reports: list[dict[str, Any]]) -> list[dict]:
    source_vector = _normalize_feature_map(source_report.get('vFeature'))
    source_embedding = _normalize_embedding(source_report.get('vEmbedding'))
    items: list[dict[str, Any]] = []

    for report in candidate_reports:
        target_vector = _normalize_feature_map(report.get('vFeature'))
        target_embedding = _normalize_embedding(report.get('vEmbedding'))
        feature_score = _compatibility(source_vector, target_vector)
        embedding_score = _embedding_similarity(source_embedding, target_embedding)
        score = round((feature_score * 0.55) + (embedding_score * 0.25) + (_consistency_score(report) * 0.2), 4)
        overlap_dimensions = _overlap_dimensions(source_vector, target_vector)
        raw_content = report.get('rawContent') or {}
        items.append(
            {
                'reportId': report.get('id'),
                'anonymousId': f"ANON{str(report.get('id', ''))[-4:].upper()}",
                'resonanceScore': score,
                'featureVector': {key: target_vector.get(key, 0) for key, _ in DIMENSION_KEYS},
                'consistencyScore': _consistency_score(report),
                'embeddingScore': round(embedding_score, 4),
                'overlapDimensions': overlap_dimensions,
                'isLowFidelity': _chapter_count(raw_content) < 3,
                'relationshipFit': build_relationship_fit(score),
                'reportType': _report_type(raw_content),
                'chapterCount': _chapter_count(raw_content),
            }
        )

    return sorted(items, key=lambda item: (item['resonanceScore'], item['consistencyScore']), reverse=True)


def build_deep_match(source_report: dict[str, Any], target_report: dict[str, Any]) -> dict:
    source_vector = _normalize_feature_map(source_report.get('vFeature'))
    target_vector = _normalize_feature_map(target_report.get('vFeature'))
    source_embedding = _normalize_embedding(source_report.get('vEmbedding'))
    target_embedding = _normalize_embedding(target_report.get('vEmbedding'))
    feature_compatibility = _compatibility(source_vector, target_vector)
    embedding_compatibility = _embedding_similarity(source_embedding, target_embedding)
    compatibility = (feature_compatibility * 0.7) + (embedding_compatibility * 0.3)
    overlap_dimensions = _overlap_dimensions(source_vector, target_vector)
    score = round(compatibility, 2)
    score_pct = round(score * 100)
    high_gap_dimensions = [label for key, label in DIMENSION_KEYS if abs(source_vector.get(key, 0) - target_vector.get(key, 0)) >= 0.22]

    resonance_points = [f'双方在「{label}」维度的节律接近，较容易形成自然对接。' for label in overlap_dimensions[:3]]
    if not resonance_points:
        resonance_points = ['双方并非天然同频，但具备可协商的互动空间。']

    tension_zones = [
        {
            'title': f'{label}维度存在错位',
            'description': f'双方在「{label}」上的需求节律差异较大，推进时需要更明确说明预期。',
            'severity': min(10, max(4, round(abs(source_vector.get(key, 0) - target_vector.get(key, 0)) * 10))),
        }
        for key, label in DIMENSION_KEYS
        if abs(source_vector.get(key, 0) - target_vector.get(key, 0)) >= 0.2
    ][:3]

    warning = None
    if score < 0.55:
        warning = '当前匹配显示核心关系节律存在较大偏差，建议显著放慢推进速度。'
    elif len(high_gap_dimensions) >= 3:
        warning = f'在 {"、".join(high_gap_dimensions[:3])} 维度差异同时偏高，容易在深入互动时集中爆发张力。'

    return {
        'matchId': None,
        'resonanceScore': score_pct,
        'resonancePoints': resonance_points,
        'tensionZones': tension_zones,
        'powerDynamics': '更适合通过显式协商建立节律，而不是依赖默认默契。' if high_gap_dimensions else '双方更适合协商式推进，权力动态相对均衡。',
        'growthPotential': '如果先对齐节奏、边界和回应期待，这组关系有较好的成长空间。' if score >= 0.62 else '成长空间存在，但前提是先降低误解成本并建立稳定反馈机制。',
        'criticalWarning': warning,
        'icebreakers': [
            f'你在关系里最在意的「{overlap_dimensions[0]}」安全感是什么？' if overlap_dimensions else '你会通过什么信号判断一个人值得继续了解？',
            '如果节奏不一致，你更希望对方怎么表达？',
            '你认为什么样的边界感会让关系更稳定？',
        ],
        'summary': f'两人在 {"、".join(overlap_dimensions[:3]) if overlap_dimensions else "多个维度"} 上存在一定对接基础，共鸣评分约为 {score_pct}/100。',
        'embeddingScore': round(embedding_compatibility, 4),
        'relationshipFit': build_relationship_fit(score),
        'guidance': ['先确认沟通频率', '避免用试探代替表达', '尽早说明各自边界'],
        'unlockMilestones': [
            {'stage': 0, 'label': '匿名试探', 'requirement': '建立连接后立即可用', 'unlocked': True},
            {'stage': 1, 'label': '主题交换', 'requirement': '累计 5 条有效消息', 'unlocked': False},
            {'stage': 2, 'label': '边界试探', 'requirement': '累计 10 条有效消息', 'unlocked': False},
            {'stage': 3, 'label': '深层解锁', 'requirement': '累计 15 条有效消息', 'unlocked': False},
        ],
    }
