from typing import Literal, Any
from pydantic import BaseModel, ConfigDict, Field


class AriadneBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ChatMessage(AriadneBaseModel):
    role: Literal['system', 'assistant', 'user', 'ai']
    content: str
    stage: str | None = None


class InterviewTurnRequest(AriadneBaseModel):
    action: Literal['interview_turn'] = 'interview_turn'
    session_id: str | None = Field(default=None, alias='sessionId')
    user_id: str = Field(alias='userId')
    message: str = Field(alias='userMessage')
    messages: list[ChatMessage] = Field(default_factory=list)
    current_stage: str = Field(default='DIVERGENT', alias='currentStage')
    turn_count: int = Field(default=0, alias='turnCount')
    max_turns: int = Field(default=30, alias='maxTurns')


class GenerateReportRequest(AriadneBaseModel):
    action: Literal['generate_report'] = 'generate_report'
    session_id: str = Field(alias='sessionId')
    user_id: str = Field(alias='userId')
    messages: list[ChatMessage] = Field(default_factory=list)


class ReportJobCreateRequest(AriadneBaseModel):
    action: Literal['generate_report_async'] = 'generate_report_async'
    session_id: str = Field(alias='sessionId')
    user_id: str = Field(alias='userId')
    messages: list[ChatMessage] = Field(default_factory=list)


class InterviewStreamRequest(AriadneBaseModel):
    action: Literal['interview_stream'] = 'interview_stream'
    session_id: str | None = Field(default=None, alias='sessionId')
    user_id: str = Field(alias='userId')
    message: str = Field(alias='userMessage')
    messages: list[ChatMessage] = Field(default_factory=list)
    current_stage: str = Field(default='DIVERGENT', alias='currentStage')
    turn_count: int = Field(default=0, alias='turnCount')
    max_turns: int = Field(default=30, alias='maxTurns')


class SessionStateUpsertRequest(AriadneBaseModel):
    user_id: str = Field(alias='userId')
    status: str = 'IN_PROGRESS'
    current_stage: str = Field(default='DIVERGENT', alias='currentStage')
    turn_count: int = Field(default=0, alias='turnCount')
    max_turns: int = Field(default=30, alias='maxTurns')
    context_variables: dict[str, str] = Field(default_factory=dict, alias='contextVariables')
    extracted_contradictions: list[dict[str, Any]] = Field(default_factory=list, alias='extractedContradictions')
    messages: list[dict[str, Any]] = Field(default_factory=list)
    token_consumed: int = Field(default=0, alias='tokenConsumed')


class TogglePublicRequest(AriadneBaseModel):
    is_public: bool = Field(alias='isPublic')


class StrategyAssetActivateRequest(AriadneBaseModel):
    version: str


class SocialThreadUpsertRequest(AriadneBaseModel):
    user_id_a: str = Field(alias='userIdA')
    user_id_b: str = Field(alias='userIdB')
    match_id: str | None = Field(default=None, alias='matchId')
    unlock_stage: int = Field(default=0, alias='unlockStage')
    icebreakers: list[str] = Field(default_factory=list)
    tension_report: dict[str, Any] = Field(default_factory=dict, alias='tensionReport')
    unlock_milestones: list[dict[str, Any]] = Field(default_factory=list, alias='unlockMilestones')
    messages: list[dict[str, Any]] = Field(default_factory=list)


class SystemConfigUpdateRequest(AriadneBaseModel):
    value: str
    type: str | None = None


class UserProfileUpdateRequest(AriadneBaseModel):
    display_name: str | None = Field(default=None, alias='displayName')
    tier: str | None = None
    token_balance: float | None = Field(default=None, alias='tokenBalance')
    notification_channels: dict[str, Any] | None = Field(default=None, alias='notificationChannels')
    matching_enabled: bool | None = Field(default=None, alias='matchingEnabled')
    is_admin: bool | None = Field(default=None, alias='isAdmin')


class DiscoverRequest(AriadneBaseModel):
    action: Literal['discover'] = 'discover'
    user_id: str = Field(alias='userId')


class DeepMatchRequest(AriadneBaseModel):
    action: Literal['deep_match'] = 'deep_match'
    user_id: str = Field(alias='userId')
    target_report_id: str = Field(alias='targetReportId')


class IcebreakerRequest(AriadneBaseModel):
    action: Literal['generate_icebreakers'] = 'generate_icebreakers'
    user_id: str | None = Field(default=None, alias='userId')
    thread_id: str = Field(alias='threadId')
    match_id: str = Field(alias='matchId')


class GenericResponse(AriadneBaseModel):
    ok: bool = True
    message: str = 'ok'
    data: dict[str, Any] = Field(default_factory=dict)
