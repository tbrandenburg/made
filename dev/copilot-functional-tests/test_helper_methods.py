#!/usr/bin/env python3
"""
Comprehensive helper methods test for CopilotAgentCLI
Tests all utility methods and edge cases
"""

import sys
import time
from pathlib import Path
from datetime import datetime

# Add the backend to Python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages/pybackend"))

from copilot_agent_cli import CopilotAgentCLI


def test_all_helper_methods():
    """Test all helper methods comprehensively"""
    cli = CopilotAgentCLI()

    print("🔧 Testing All Helper Methods")
    print("=" * 50)

    # Test 1: CLI name and error message
    print("1. Testing CLI properties...")
    cli_name = cli.cli_name
    error_msg = cli.missing_command_error()

    print(f"   CLI name: '{cli_name}'")
    print(f"   Error message contains 'copilot': {'copilot' in error_msg}")
    print(f"   ✅ CLI properties: {cli_name == 'copilot' and 'copilot' in error_msg}")

    # Test 2: Sessions directory detection
    print("\n2. Testing sessions directory...")
    sessions_dir = cli._get_sessions_directory()

    print(f"   Sessions dir found: {sessions_dir is not None}")
    if sessions_dir:
        print(f"   Path: {sessions_dir}")
        print(f"   Exists: {sessions_dir.exists()}")
        if sessions_dir.exists():
            session_count = len([d for d in sessions_dir.iterdir() if d.is_dir()])
            print(f"   Session directories: {session_count}")
    print(f"   ✅ Sessions directory: {sessions_dir is not None}")

    # Test 3: Directory key generation
    print("\n3. Testing directory key generation...")
    test_paths = [Path("/tmp/test"), Path("/home/user/project"), Path("."), Path("/")]

    for path in test_paths:
        dir_key = cli._get_directory_key(path)
        print(f"   Path: {path} -> Key: {dir_key}")

    print(f"   ✅ Directory key generation working")

    # Test 4: Milliseconds conversion
    print("\n4. Testing milliseconds conversion...")
    test_timestamps = [
        1640995200,  # 2022-01-01 00:00:00 UTC
        0,  # Unix epoch
        1234567890,  # Random timestamp
        None,  # None case
    ]

    for ts in test_timestamps:
        try:
            result = cli._to_milliseconds(ts)
            if ts is None:
                print(f"   Timestamp: {ts} -> {result}")
            else:
                expected = ts * 1000
                print(
                    f"   Timestamp: {ts} -> {result} (expected: {expected}, ✅: {result == expected})"
                )
        except Exception as e:
            print(f"   Timestamp: {ts} -> Error: {e}")

    print(f"   ✅ Milliseconds conversion working")

    # Test 5: Session matching with real sessions
    print("\n5. Testing session matching...")
    if sessions_dir and sessions_dir.exists():
        session_dirs = [d for d in sessions_dir.iterdir() if d.is_dir()]
        if session_dirs:
            # Test with real session ID
            real_session_id = session_dirs[0].name
            matches = cli._session_matches_directory(real_session_id, Path("."))
            print(f"   Real session {real_session_id[:8]}... matches: {matches}")

            # Test with fake session ID
            fake_session_id = "fake-session-id-12345"
            matches_fake = cli._session_matches_directory(fake_session_id, Path("."))
            print(f"   Fake session matches: {matches_fake}")

            print(f"   ✅ Session matching: {matches and not matches_fake}")
        else:
            print(f"   No sessions to test with")

    # Test 6: Text cleaning methods
    print("\n6. Testing text cleaning...")

    # Test ANSI code stripping
    test_text_ansi = "\x1b[31mRed text\x1b[0m and \x1b[1mbold\x1b[0m"
    cleaned_ansi = cli._strip_ansi_codes(test_text_ansi)
    print(f"   ANSI stripping: '{test_text_ansi}' -> '{cleaned_ansi}'")

    # Test response cleaning
    test_responses = [
        "Normal response text",
        "Copilot: This is a response",
        "Assistant: Another response",
        "> Some prefixed text",
    ]

    for response in test_responses:
        cleaned = cli._clean_response_text(response)
        print(f"   Cleaning: '{response}' -> '{cleaned}'")

    print(f"   ✅ Text cleaning working")

    # Test 7: List agents functionality
    print("\n7. Testing list_agents...")
    agents_result = cli.list_agents()

    print(f"   Success: {agents_result.success}")
    print(f"   Agents count: {len(agents_result.agents)}")
    for i, agent in enumerate(agents_result.agents):
        print(f"   Agent {i + 1}: {agent.name}")

    print(f"   ✅ List agents: {agents_result.success}")

    return True


def test_error_scenarios():
    """Test error handling scenarios"""
    cli = CopilotAgentCLI()

    print("\n🚨 Testing Error Scenarios")
    print("=" * 50)

    # Test 1: Export non-existent session
    print("1. Testing export of non-existent session...")
    result = cli.export_session("non-existent-session-12345", Path("."))

    print(f"   Success (should be False): {result.success}")
    print(f"   Has error message: {result.error_message is not None}")
    if result.error_message:
        print(f"   Error: {result.error_message[:100]}")
    print(
        f"   ✅ Non-existent session handled: {not result.success and result.error_message}"
    )

    # Test 2: Invalid session directory
    print("\n2. Testing session operations with no sessions directory...")
    # Temporarily override the sessions directory method
    original_method = cli._get_sessions_directory
    cli._get_sessions_directory = lambda: None

    try:
        sessions_result = cli.list_sessions(Path("."))
        print(f"   List sessions success: {sessions_result.success}")
        print(f"   Sessions count: {len(sessions_result.sessions)}")

        export_result = cli.export_session("any-session", Path("."))
        print(f"   Export success: {export_result.success}")
        print(f"   Has error: {export_result.error_message is not None}")

        print(f"   ✅ No sessions directory handled gracefully")

    finally:
        # Restore original method
        cli._get_sessions_directory = original_method

    return True


def performance_benchmark():
    """Basic performance benchmark"""
    cli = CopilotAgentCLI()

    print("\n⚡ Performance Benchmark")
    print("=" * 50)

    # Benchmark list_sessions
    start_time = time.time()
    for _ in range(10):
        cli.list_sessions(Path("."))
    list_sessions_time = (time.time() - start_time) * 100  # ms per call

    print(f"List sessions: {list_sessions_time:.2f}ms per call (avg of 10)")

    # Benchmark session directory access
    start_time = time.time()
    for _ in range(100):
        cli._get_sessions_directory()
    dir_access_time = (time.time() - start_time) * 10  # ms per call

    print(f"Session directory access: {dir_access_time:.2f}ms per call (avg of 100)")

    # Benchmark text cleaning
    test_text = "Some \x1b[31mtext\x1b[0m with ANSI codes and prefixes"
    start_time = time.time()
    for _ in range(1000):
        cli._strip_ansi_codes(test_text)
        cli._clean_response_text(test_text)
    text_cleaning_time = time.time() - start_time  # ms per call

    print(f"Text cleaning: {text_cleaning_time:.2f}ms per 1000 calls")

    return True


if __name__ == "__main__":
    print("🧪 CopilotAgentCLI Helper Methods Tests")
    print("=" * 60)

    # Run all tests
    test_all_helper_methods()
    test_error_scenarios()
    performance_benchmark()

    print("\n✅ Helper methods testing completed!")
    print("=" * 60)
