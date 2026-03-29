"""add notification idempotency and dead letter

Revision ID: 20250918_0003
Revises: 20250918_0002
Create Date: 2025-09-18 00:20:00
"""
from alembic import op
import sqlalchemy as sa


revision = '20250918_0003'
down_revision = '20250918_0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('notification_events', sa.Column('idempotency_key', sa.String(length=128), nullable=True))
    op.add_column('notification_events', sa.Column('dead_lettered_at', sa.DateTime(), nullable=True))
    op.create_index('ix_notification_events_idempotency_key', 'notification_events', ['idempotency_key'])


def downgrade() -> None:
    op.drop_index('ix_notification_events_idempotency_key', table_name='notification_events')
    op.drop_column('notification_events', 'dead_lettered_at')
    op.drop_column('notification_events', 'idempotency_key')
