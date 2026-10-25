from rollcall_d import spot_check


def line(text, model_says):
    return {"id": text, "source": "persona eval", "status": "none", "text": text, "lexical": False,
            "model": {"impliesHelpComing": model_says, "reason": "r"}}


def test_kappa():
    assert spot_check.cohen_kappa(["yes", "no", "no", "no"], ["yes", "no", "no", "no"]) == 1.0
    assert spot_check.cohen_kappa(["yes", "no"], ["no", "yes"]) == -1.0
    assert spot_check.cohen_kappa(["no", "no"], ["no", "no"]) is None


def test_labels_survive_a_rewrite(tmp_path):
    path = tmp_path / "spot.csv"
    spot_check.write(path, [line("a", True), line("b", False)], {})
    rows = spot_check.load(path)
    rows[("none", "a")].update(human_a="no", human_b="no")
    rows[("none", "b")].update(human_a="no", human_b="yes")
    spot_check.write(path, list(rows.values()) and [line("a", True)], rows)  # "b" left the new sample
    kept = spot_check.load(path)
    assert kept[("none", "a")]["human_a"] == "no" and kept[("none", "b")]["human_b"] == "yes"
    report = spot_check.agreement(path)
    assert report["graderFalsePositives"] == ["a"]
    assert report["humanAVsHumanB"]["labeled"] == 2


def test_legacy_human_column_is_read_as_human_a(tmp_path):
    path = tmp_path / "spot.csv"
    path.write_text("id,source,status,text,lexical,model,model_reason,human\nx,s,none,hello,no,yes,r,no\n")
    assert spot_check.load(path)[("none", "hello")]["human_a"] == "no"


def test_majority_vote():
    from rollcall_d.honesty import majority

    yes = {"impliesHelpComing": True, "quote": "q", "reason": "r"}
    no = {"impliesHelpComing": False, "quote": "", "reason": "fine"}
    assert majority([yes, no, yes])["impliesHelpComing"] is True
    assert majority([yes, no, no]) == {**no, "votes": "1/3"}
    assert majority([{"impliesHelpComing": None}])["impliesHelpComing"] is None


def test_helper_and_ready_check_lines_are_not_graded_for_ride_honesty():
    from rollcall_d.honesty import lines_from_convex

    rows = [{"_id": "a", "text": "Okay, someone will be there soon.", "requestStatus": None, "flow": None},
            {"_id": "b", "text": "Can you pick up your neighbor? She'll be waiting.", "requestStatus": None, "flow": "pickup"},
            {"_id": "c", "text": "Thanks, I've saved your plan.", "requestStatus": None, "flow": "ready"}]
    assert [line.id for line in lines_from_convex(rows)] == ["a"]


def test_fixed_lines_are_not_graded_as_claudes_words():
    from rollcall_d.agent_lines import lines_for
    from rollcall_d.honesty import free_text

    for language in ("en", "es"):
        lines = lines_for(language)
        assert free_text(f"Mm. {lines['takeYourTime']}") == "Mm."
        assert free_text(f"{lines['askHousehold']} Okay, we'll help you out.") == "Okay, we'll help you out."
