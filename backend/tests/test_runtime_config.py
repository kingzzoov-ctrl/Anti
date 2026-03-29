from app.services.runtime_config import _coerce_runtime_value


def test_coerce_runtime_value_supports_basic_types():
    assert _coerce_runtime_value('3', 'int') == 3
    assert _coerce_runtime_value('0.75', 'float') == 0.75
    assert _coerce_runtime_value('true', 'bool') is True
    assert _coerce_runtime_value(None, 'string') == ''


def test_coerce_runtime_value_handles_invalid_numbers():
    assert _coerce_runtime_value('oops', 'int') == 0
    assert _coerce_runtime_value('oops', 'float') == 0.0
