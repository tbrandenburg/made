
import pytest

from system_metrics_service import get_system_metrics, read_pressure


def test_pressure_reads_some_avg10_not_full_or_longer_windows(tmp_path):
    path = tmp_path / "cpu"
    path.write_text(
        "some avg10=12.34 avg60=20.00 avg300=30.00 total=123456\n"
        "full avg10=1.00 avg60=2.00 avg300=3.00 total=456\n"
    )
    assert read_pressure(path) == 12.34
    path.write_text("some avg10=0.00 avg60=20.00 avg300=30.00 total=123456\n")
    assert read_pressure(path) == 0.0


@pytest.mark.parametrize(
    "contents",
    [
        "",
        "full avg10=2.00",
        "some avg60=2.00",
        "some bad",
        "some avg10=nan",
        "some avg10=inf",
        "some avg10=-1",
        "some avg10=101",
    ],
)
def test_unsupported_or_invalid_pressure_is_unavailable(tmp_path, contents):
    path = tmp_path / "memory"
    assert read_pressure(path) is None
    path.write_text(contents)
    assert read_pressure(path) is None


def test_real_system_metrics_and_unavailable_disk(tmp_path):
    metrics = get_system_metrics(tmp_path)
    assert set(metrics) == {
        "cpuUtilization",
        "cpuPressure",
        "ramUtilization",
        "memoryPressure",
        "diskUtilization",
        "ioPressure",
    }
    assert 0 <= metrics["diskUtilization"] <= 100
    assert all(value is None or 0 <= value <= 100 for value in metrics.values())
    missing = get_system_metrics(tmp_path / "missing")
    assert missing["diskUtilization"] is None
    assert set(missing) == set(metrics)
