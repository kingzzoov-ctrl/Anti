"""bootstrap report jobs table

Revision ID: 20250918_0001
Revises: 
Create Date: 2025-09-18 00:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '20250918_0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'report_jobs',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('user_id', sa.String(length=64), nullable=False),
        sa.Column('session_id', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='queued'),
        sa.Column('progress', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('report_id', sa.String(length=64), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_report_jobs_user_id', 'report_jobs', ['user_id'])
    op.create_index('ix_report_jobs_session_id', 'report_jobs', ['session_id'])
    op.create_index('ix_report_jobs_status', 'report_jobs', ['status'])


def downgrade() -> None:
    op.drop_index('ix_report_jobs_status', table_name='report_jobs')
    op.drop_index('ix_report_jobs_session_id', table_name='report_jobs')
    op.drop_index('ix_report_jobs_user_id', table_name='report_jobs')
    op.drop_table('report_jobs')
