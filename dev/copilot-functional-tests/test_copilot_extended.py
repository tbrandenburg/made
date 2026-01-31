#!/usr/bin/env python3
"""
Extended real-world functional tests for CopilotAgentCLI
Tests session resumption, conversation context, and tool usage
"""

import sys
import json
import time
from pathlib import Path
from datetime import datetime

# Add the backend to Python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages/pybackend"))

from copilot_agent_cli import CopilotAgentCLI


class ExtendedCopilotTester:
    def __init__(self):
        self.cli = CopilotAgentCLI()
        self.test_results = []
        self.test_session_id = None

    def log_test(self, test_name: str, success: bool, details: str, duration: float):
        """Log test results"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "duration_ms": round(duration * 1000, 2),
            "timestamp": datetime.now().isoformat(),
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name} ({duration * 1000:.1f}ms)")
        print(f"   Details: {details}")
        print()

    def test_create_conversation_session(self):
        """Test creating a new conversation session"""
        start_time = time.time()

        try:
            # Start a conversation about coding
            message = "I'm working on a Python project. Can you help me understand list comprehensions? Give a brief explanation."
            result = self.cli.run_agent(message, None, None, None, Path("."))

            success = result.success and len(result.response_parts) > 0
            if success:
                # Extract session ID for follow-up tests
                self.test_session_id = result.session_id

            details = f"Success: {result.success}, Response parts: {len(result.response_parts)}"
            if result.response_parts:
                response_text = result.response_parts[0].text
                details += f", Response length: {len(response_text)}, Contains 'comprehension': {'comprehension' in response_text.lower()}"

            if result.session_id:
                details += f", Session ID: {result.session_id[:12]}..."

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Create Conversation Session", success, details, time.time() - start_time
        )
        return success

    def test_resume_conversation_context(self):
        """Test resuming conversation with context"""
        if not self.test_session_id:
            print("⚠️  SKIP Resume Conversation Context (no session ID)")
            return False

        start_time = time.time()

        try:
            # Continue the previous conversation
            message = "Can you give me a simple example of what we just discussed?"
            result = self.cli.run_agent(
                message, self.test_session_id, None, None, Path(".")
            )

            success = result.success and result.session_id == self.test_session_id
            details = f"Success: {result.success}, Session resumed: {result.session_id == self.test_session_id}"

            if result.response_parts:
                response_text = result.response_parts[0].text
                # Check if response relates to list comprehensions from previous question
                has_context = any(
                    keyword in response_text.lower()
                    for keyword in ["comprehension", "list", "example", "for"]
                )
                details += f", Response length: {len(response_text)}, Has context: {has_context}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Resume Conversation Context", success, details, time.time() - start_time
        )
        return success

    def test_export_conversation_session(self):
        """Test exporting the conversation we just created"""
        if not self.test_session_id:
            print("⚠️  SKIP Export Conversation Session (no session ID)")
            return False

        start_time = time.time()

        try:
            result = self.cli.export_session(self.test_session_id, Path("."))

            success = (
                result.success and len(result.messages) >= 2
            )  # At least question + answer
            details = f"Success: {result.success}, Messages: {len(result.messages)}"

            if success:
                user_messages = [m for m in result.messages if m.role == "user"]
                assistant_messages = [
                    m for m in result.messages if m.role == "assistant"
                ]

                details += f", User msgs: {len(user_messages)}, Assistant msgs: {len(assistant_messages)}"

                # Check if our messages are in there
                if user_messages:
                    first_user_msg = user_messages[0].content
                    has_comprehension = "comprehension" in first_user_msg.lower()
                    details += f", Contains our question: {has_comprehension}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Export Conversation Session", success, details, time.time() - start_time
        )
        return success

    def test_file_operations_prompt(self):
        """Test prompt that might use file operations"""
        start_time = time.time()

        try:
            # Ask about files in current directory (should use tools)
            message = (
                "What files are in the current directory? Just give me a brief summary."
            )
            result = self.cli.run_agent(message, None, None, None, Path("."))

            success = result.success
            details = f"Success: {result.success}"

            if result.response_parts:
                response_text = result.response_parts[0].text
                # Check if it mentions some files we know exist
                mentions_files = any(
                    filename in response_text.lower()
                    for filename in ["test", ".py", "json", "functional"]
                )
                details += f", Response length: {len(response_text)}, Mentions files: {mentions_files}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "File Operations Prompt", success, details, time.time() - start_time
        )
        return success

    def test_session_directory_contents(self):
        """Test examining real session directory structure"""
        start_time = time.time()

        try:
            sessions_dir = self.cli._get_sessions_directory()

            if not sessions_dir or not sessions_dir.exists():
                success = False
                details = "Sessions directory not found"
            else:
                session_dirs = [d for d in sessions_dir.iterdir() if d.is_dir()]

                # Check structure of first session
                if session_dirs:
                    sample_session = session_dirs[0]
                    events_file = sample_session / "events.jsonl"
                    has_events = events_file.exists()

                    other_files = [
                        f.name
                        for f in sample_session.iterdir()
                        if f.is_file() and f.name != "events.jsonl"
                    ]

                    success = True
                    details = f"Sessions: {len(session_dirs)}, Sample session: {sample_session.name}, Has events.jsonl: {has_events}, Other files: {len(other_files)}"
                    if other_files:
                        details += f" ({', '.join(other_files[:3])})"
                else:
                    success = False
                    details = "No session directories found"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Session Directory Contents", success, details, time.time() - start_time
        )
        return success

    def test_parse_real_events_structure(self):
        """Test parsing real events.jsonl structure in detail"""
        start_time = time.time()

        try:
            sessions_dir = self.cli._get_sessions_directory()

            if not sessions_dir:
                success = False
                details = "No sessions directory"
            else:
                # Find a session with substantial events
                best_session = None
                max_events = 0

                for session_dir in sessions_dir.iterdir():
                    if session_dir.is_dir():
                        events_file = session_dir / "events.jsonl"
                        if events_file.exists():
                            try:
                                with open(events_file, "r") as f:
                                    event_count = sum(1 for line in f if line.strip())
                                if event_count > max_events:
                                    max_events = event_count
                                    best_session = events_file
                            except Exception:
                                pass

                if best_session:
                    # Parse the events and analyze structure
                    messages = self.cli._parse_events_jsonl(best_session)

                    event_types = set()
                    with open(best_session, "r") as f:
                        for line in f:
                            if line.strip():
                                try:
                                    event = json.loads(line)
                                    event_types.add(event.get("type", "unknown"))
                                except json.JSONDecodeError:
                                    pass

                    success = len(messages) > 0
                    details = f"Best session events: {max_events}, Parsed messages: {len(messages)}, Event types: {len(event_types)}"
                    if event_types:
                        details += f" ({', '.join(sorted(event_types)[:5])})"
                else:
                    success = False
                    details = "No events files found with content"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Parse Real Events Structure", success, details, time.time() - start_time
        )
        return success

    def test_helper_methods(self):
        """Test utility helper methods"""
        start_time = time.time()

        try:
            # Test directory key generation
            test_path = Path("/tmp/test/directory")
            dir_key = self.cli._get_directory_key(test_path)

            # Test milliseconds conversion
            test_timestamp = 1640995200  # 2022-01-01 00:00:00 UTC
            ms_timestamp = self.cli._to_milliseconds(test_timestamp)

            # Test session matching
            test_session_data = {"directory": str(test_path)}
            matches = self.cli._session_matches_directory(test_session_data, test_path)

            success = (
                isinstance(dir_key, str)
                and ms_timestamp == 1640995200000
                and matches is True
            )

            details = f"Dir key type: {type(dir_key).__name__}, MS conversion: {ms_timestamp}, Session match: {matches}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test("Helper Methods", success, details, time.time() - start_time)
        return success

    def run_extended_tests(self):
        """Run all extended functional tests"""
        print("🔬 Starting Extended GitHub Copilot CLI Tests")
        print("=" * 60)
        print()

        # Test 1: Create a conversation session
        self.test_create_conversation_session()

        # Small delay to ensure session is saved
        time.sleep(0.5)

        # Test 2: Resume conversation with context
        self.test_resume_conversation_context()

        # Test 3: Export the conversation
        self.test_export_conversation_session()

        # Test 4: File operations prompt
        self.test_file_operations_prompt()

        # Test 5: Examine session directory
        self.test_session_directory_contents()

        # Test 6: Parse real events structure
        self.test_parse_real_events_structure()

        # Test 7: Helper methods
        self.test_helper_methods()

        # Summary
        self.print_summary()

    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("📊 EXTENDED TEST SUMMARY")
        print("=" * 60)

        total_tests = len(self.test_results)
        passed_tests = sum(1 for r in self.test_results if r["success"])
        failed_tests = total_tests - passed_tests

        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_tests}")
        print(f"❌ Failed: {failed_tests}")
        print(f"Success Rate: {(passed_tests / total_tests) * 100:.1f}%")

        total_time = sum(r["duration_ms"] for r in self.test_results)
        print(f"Total Time: {total_time:.1f}ms")

        # Show failed tests
        if failed_tests > 0:
            print("\n🚨 FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"   ❌ {result['test']}: {result['details']}")

        return passed_tests == total_tests


if __name__ == "__main__":
    tester = ExtendedCopilotTester()
    all_passed = tester.run_extended_tests()

    # Save detailed results
    results_file = Path(__file__).parent / "extended_test_results.json"
    with open(results_file, "w") as f:
        json.dump(
            {
                "timestamp": datetime.now().isoformat(),
                "copilot_version": "0.0.395",
                "all_passed": all_passed,
                "results": tester.test_results,
            },
            f,
            indent=2,
        )

    print(f"\n📄 Extended results saved to: {results_file}")

    # Exit with appropriate code
    sys.exit(0 if all_passed else 1)
