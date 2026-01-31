#!/usr/bin/env python3
"""
Session management test for CopilotAgentCLI
Tests session creation, discovery, and resumption patterns
"""

import sys
import json
import time
import subprocess
from pathlib import Path
from datetime import datetime

# Add the backend to Python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages/pybackend"))

from copilot_agent_cli import CopilotAgentCLI


def test_session_workflow():
    """Test complete session workflow"""
    cli = CopilotAgentCLI()

    print("🔍 Testing Session Management Workflow")
    print("=" * 50)

    # Step 1: Get sessions before our test
    print("1. Getting existing sessions...")
    before_result = cli.list_sessions(Path("."))
    before_count = len(before_result.sessions) if before_result.success else 0
    print(f"   Found {before_count} existing sessions")

    # Step 2: Create a new conversation
    print("\n2. Creating new conversation...")
    message = (
        "Hello, this is a test session. Please respond with 'Test session confirmed'."
    )

    start_time = time.time()
    result = cli.run_agent(message, None, None, None, Path("."))
    duration = time.time() - start_time

    print(f"   Duration: {duration * 1000:.1f}ms")
    print(f"   Success: {result.success}")
    print(f"   Response parts: {len(result.response_parts)}")

    if result.response_parts:
        response_text = result.response_parts[0].text
        print(f"   Response preview: {response_text[:100]}...")

    # Step 3: Wait and check for new session
    print("\n3. Waiting for session to be saved...")
    time.sleep(2)  # Give copilot time to save the session

    after_result = cli.list_sessions(Path("."))
    after_count = len(after_result.sessions) if after_result.success else 0
    print(f"   Found {after_count} sessions (was {before_count})")

    # Step 4: Find the newest session (likely ours)
    newest_session = None
    if after_result.success and after_result.sessions:
        # Sort by session ID (which includes timestamp) to find newest
        sorted_sessions = sorted(
            after_result.sessions, key=lambda s: s.session_id, reverse=True
        )
        newest_session = sorted_sessions[0]
        print(f"   Newest session: {newest_session.session_id}")

    # Step 5: Test session export
    if newest_session:
        print(f"\n4. Exporting newest session...")
        export_result = cli.export_session(newest_session.session_id, Path("."))

        print(f"   Export success: {export_result.success}")
        if export_result.success:
            print(f"   Messages exported: {len(export_result.messages)}")
            for i, msg in enumerate(export_result.messages):
                preview = (
                    msg.content[:50] + "..." if len(msg.content) > 50 else msg.content
                )
                print(f"   Message {i + 1} ({msg.role}): {preview}")

    # Step 6: Test session resumption
    if newest_session:
        print(f"\n5. Testing session resumption...")
        resume_message = (
            "Do you remember what I just said about this being a test session?"
        )

        resume_result = cli.run_agent(
            resume_message, newest_session.session_id, None, None, Path(".")
        )

        print(f"   Resume success: {resume_result.success}")
        print(
            f"   Session ID matches: {resume_result.session_id == newest_session.session_id}"
        )

        if resume_result.response_parts:
            resume_response = resume_result.response_parts[0].text
            print(f"   Resume response preview: {resume_response[:100]}...")

            # Check if it shows context awareness
            context_keywords = ["test", "session", "remember", "yes", "confirmed"]
            has_context = any(
                keyword in resume_response.lower() for keyword in context_keywords
            )
            print(f"   Shows context awareness: {has_context}")

    return True


def test_real_copilot_commands():
    """Test actual copilot CLI commands directly"""
    print("\n🔧 Testing Direct Copilot CLI Commands")
    print("=" * 50)

    # Test 1: Version check
    try:
        result = subprocess.run(
            ["copilot", "--version"], capture_output=True, text=True, timeout=5
        )
        print(f"1. Version: {result.stdout.strip()}")
        print(f"   Success: {result.returncode == 0}")
    except Exception as e:
        print(f"1. Version check failed: {e}")

    # Test 2: Help command
    try:
        result = subprocess.run(
            ["copilot", "--help"], capture_output=True, text=True, timeout=5
        )
        print(f"2. Help command: {len(result.stdout)} chars")
        print(f"   Success: {result.returncode == 0}")
        print(f"   Contains '-p': {'-p' in result.stdout}")
    except Exception as e:
        print(f"2. Help command failed: {e}")

    # Test 3: Simple prompt (what our CLI uses)
    try:
        start_time = time.time()
        result = subprocess.run(
            [
                "copilot",
                "-p",
                "What is 2+2? Give a one word answer.",
                "--allow-all-tools",
                "--silent",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        duration = time.time() - start_time

        print(f"3. Simple prompt: {duration * 1000:.1f}ms")
        print(f"   Success: {result.returncode == 0}")
        print(f"   Stdout: {len(result.stdout)} chars")
        print(f"   Stderr: {len(result.stderr)} chars")

        if result.stdout:
            print(f"   Response preview: {result.stdout[:100]}...")

    except Exception as e:
        print(f"3. Simple prompt failed: {e}")

    return True


def inspect_session_structure():
    """Inspect real copilot session structure"""
    print("\n🔬 Inspecting Real Session Structure")
    print("=" * 50)

    cli = CopilotAgentCLI()

    # Get sessions directory
    sessions_dir = cli._get_sessions_directory()
    if not sessions_dir or not sessions_dir.exists():
        print("No sessions directory found")
        return False

    print(f"Sessions directory: {sessions_dir}")

    session_dirs = [d for d in sessions_dir.iterdir() if d.is_dir()]
    print(f"Total sessions: {len(session_dirs)}")

    # Examine first few sessions
    for i, session_dir in enumerate(session_dirs[:3]):
        print(f"\nSession {i + 1}: {session_dir.name}")

        # List files
        files = list(session_dir.iterdir())
        print(f"   Files: {[f.name for f in files]}")

        # Check events.jsonl
        events_file = session_dir / "events.jsonl"
        if events_file.exists():
            try:
                with open(events_file, "r") as f:
                    lines = f.readlines()
                print(f"   Events: {len(lines)} lines")

                # Show event types
                event_types = set()
                for line in lines:
                    try:
                        event = json.loads(line.strip())
                        event_types.add(event.get("type", "unknown"))
                    except:
                        pass

                print(f"   Event types: {sorted(event_types)}")

                # Parse with our CLI
                messages = cli._parse_events_jsonl(events_file)
                print(f"   Parsed messages: {len(messages)}")

            except Exception as e:
                print(f"   Events parsing error: {e}")

        # Check workspace.yaml
        workspace_file = session_dir / "workspace.yaml"
        if workspace_file.exists():
            try:
                with open(workspace_file, "r") as f:
                    content = f.read()
                print(f"   Workspace: {len(content)} chars")
            except Exception as e:
                print(f"   Workspace reading error: {e}")

    return True


if __name__ == "__main__":
    print("🧪 CopilotAgentCLI Session Management Tests")
    print("=" * 60)

    # Run all tests
    test_session_workflow()
    test_real_copilot_commands()
    inspect_session_structure()

    print("\n✅ Session management testing completed!")
    print("=" * 60)
