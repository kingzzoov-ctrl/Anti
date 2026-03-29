"""add notification events queue

Revision ID: 20250918_0002
Revises: 20250918_0001
Create Date: 2025-09-18 00:10:00
"""
from alembic import op
import sqlalchemy as sa


revision = '20250918_0002'
down_revision = '20250918_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'notification_events',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('user_id', sa.String(length=64), nullable=False),
        sa.Column('kind', sa.String(length=64), nullable=False),
        sa.Column('channel', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='queued'),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_retries', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('source_kind', sa.String(length=64), nullable=True),
        sa.Column('source_id', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('delivered_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_notification_events_user_id', 'notification_events', ['user_id'])
    op.create_index('ix_notification_events_kind', 'notification_events', ['kind'])
    op.create_index('ix_notification_events_channel', 'notification_events', ['channel'])
    op.create_index('ix_notification_events_status', 'notification_events', ['status'])
    op.create_index('ix_notification_events_scheduled_at', 'notification_events', ['scheduled_at'])


def downgrade() -> None:
    op.drop_index('ix_notification_events_scheduled_at', table_name='notification_events')
    op.drop_index('ix_notification_events_status', table_name='notification_events')
    op.drop_index('ix_notification_events_channel', table_name='notification_events')
    op.drop_index('ix_notification_events_kind', table_name='notification_events')
    op.drop_index('ix_notification_events_user_id', table_name='notification_events')
    op.drop_table('notification_events')
