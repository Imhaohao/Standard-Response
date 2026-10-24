from rollcall_d import env


def test_environment_wins_over_file(monkeypatch):
    monkeypatch.setattr(env, "_file_values", lambda: {"ROLLCALL_TEST_KEY": "from-file"})
    assert env.env_value("ROLLCALL_TEST_KEY") == "from-file"
    monkeypatch.setenv("ROLLCALL_TEST_KEY", "from-env")
    assert env.env_value("ROLLCALL_TEST_KEY") == "from-env"


def test_first_set_key_is_used(monkeypatch):
    monkeypatch.setattr(env, "_file_values", lambda: {"B": "b"})
    monkeypatch.delenv("A", raising=False)
    assert env.env_value("A", "B") == "b"
    assert env.env_value("MISSING_ONE") is None
