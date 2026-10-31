"""Complete equivalent synthetic history; cold means first adapter read, not OS cache flush."""

import cProfile
import json
import platform
import pstats
import sys
import time

from opencode_v2_agent_cli import OpenCodeV2AgentCLI
from opencode_v2_http_history import read_session
from scenario import REPOSITORY, records
from service import ARTIFACTS, client, owned


def benchmark(transport_only: bool = False) -> dict:
    owned()
    manifest = json.loads((ARTIFACTS / "manifest.json").read_text())
    samples = []
    with client() as connection:
        expected, pages, size = records(connection, manifest["fixture"])
    for index in range(6):
        profile = cProfile.Profile()
        started = time.perf_counter()
        exported = None
        if transport_only:
            fetched = profile.runcall(read_session, manifest["fixture"], REPOSITORY)
            if [record["id"] for record in fetched] != [
                record["id"] for record in expected
            ]:
                raise RuntimeError(
                    "Production HTTP reader did not return equivalent complete records"
                )
        else:
            exported = profile.runcall(
                OpenCodeV2AgentCLI().export_session, manifest["fixture"], REPOSITORY
            )
        elapsed = time.perf_counter() - started
        if exported is not None and (
            not exported.success
            or [item.content for item in exported.messages]
            != [
                "MADE779_PAGE_FIRST",
                "MADE779_PAGE_LAST",
            ]
        ):
            raise RuntimeError(
                "Production export did not return the complete equivalent fixture"
            )
        statistics = pstats.Stats(profile).stats
        transport = sum(
            values[3]
            for key, values in statistics.items()
            if "opencode_v2_http" in key[0] and key[2] == "_read_session"
        )
        discovery = sum(
            values[3]
            for key, values in statistics.items()
            if "opencode_v2_http" in key[0] and key[2] == "_service"
        )
        if transport == 0:
            raise RuntimeError(
                "Benchmark profiling boundary changed; update measured production symbols"
            )
        samples.append(
            {
                "cache": "first-adapter-read" if index == 0 else "warm",
                "total_ms": round(elapsed * 1000, 3),
                "discovery_ms": round(discovery * 1000, 3),
                "http_fetch_ms": round((transport - discovery) * 1000, 3),
                "conversion_adapter_ms": None
                if transport_only
                else round((elapsed - transport) * 1000, 3),
            }
        )
    report = {
        "version": manifest["version"],
        "python": platform.python_version(),
        "platform": platform.platform(),
        "records": len(expected),
        "pages": pages,
        "decoded_bytes": size,
        "bytes_scope": "message-page decoded JSON; timed reader also validates metadata twice",
        "display_parts": None if exported is None else len(exported.messages),
        "transport_only_incomplete_acceptance": transport_only,
        "samples": samples,
        "method": (
            "cProfile production HTTP reader only; conversion NOT measured. "
            if transport_only
            else "cProfile production export; transport minus discovery; remainder conversion/adapter. "
        )
        + "Synthetic API import, 87 non-display payload records, two display users. "
        "No cache flush; not the PoC tool-output distribution or a universal SLA.",
    }
    filename = "benchmark-transport-only.json" if transport_only else "benchmark.json"
    (ARTIFACTS / filename).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    if any(sample["total_ms"] >= 1000 for sample in samples[1:]):
        raise RuntimeError(
            "Warm complete-history read exceeded 1 s; investigate saved phase samples"
        )
    return report


if __name__ == "__main__":
    benchmark("--transport-only" in sys.argv)
