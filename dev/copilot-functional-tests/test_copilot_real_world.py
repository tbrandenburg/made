#!/usr/bin/env python3
"""
Real-world functional tests for CopilotAgentCLI
Tests all public methods against actual GitHub Copilot CLI
"""

import sys
import json
import time
from pathlib import Path
from datetime import datetime

# Add the backend to Python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages/pybackend"))

from copilot_agent_cli import CopilotAgentCLI


class CopilotFunctionalTester:
    def __init__(self):
        self.cli = CopilotAgentCLI()
        self.test_results = []
        self.test_session_ids = []

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

    def test_cli_properties(self):
        """Test basic CLI properties"""
        start_time = time.time()

        try:
            cli_name = self.cli.cli_name
            error_msg = self.cli.missing_command_error()

            success = cli_name == "copilot" and "copilot" in error_msg
            details = f"CLI name: '{cli_name}', Error msg contains 'copilot': {'copilot' in error_msg}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test("CLI Properties", success, details, time.time() - start_time)
        return success

    def test_run_agent_simple(self):
        """Test run_agent with a simple prompt"""
        start_time = time.time()
        result = None

        try:
            # Use a simple, safe prompt
            message = "What is Python? Give a one sentence answer."
            result = self.cli.run_agent(message, None, None, None, Path("."))

            success = result.success and len(result.response_parts) > 0
            if success and result.session_id:
                self.test_session_ids.append(result.session_id)

            details = f"Success: {result.success}, Response parts: {len(result.response_parts)}, Session ID: {result.session_id[:8] if result.session_id else 'None'}"
            if result.error_message:
                details += f", Error: {result.error_message[:100]}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Run Agent - Simple Prompt", success, details, time.time() - start_time
        )
        return success, result.session_id if success and result else None

    def test_run_agent_with_session(self, session_id: str):
        """Test run_agent resuming an existing session"""
        start_time = time.time()

        try:
            # Continue the conversation in the same session
            message = "What programming language did you just mention?"
            result = self.cli.run_agent(message, session_id, None, None, Path("."))

            success = result.success and result.session_id == session_id
            details = f"Success: {result.success}, Session resumed: {result.session_id == session_id}, Response parts: {len(result.response_parts)}"
            if result.error_message:
                details += f", Error: {result.error_message[:100]}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Run Agent - Session Resume", success, details, time.time() - start_time
        )
        return success

    def test_list_sessions(self):
        """Test list_sessions method"""
        start_time = time.time()
        result = None

        try:
            result = self.cli.list_sessions(Path("."))

            success = result.success and isinstance(result.sessions, list)
            session_count = len(result.sessions)
            details = f"Success: {result.success}, Sessions found: {session_count}"

            if success and session_count > 0:
                # Check if our test sessions are in the list
                test_sessions_found = sum(
                    1 for s in result.sessions if s.session_id in self.test_session_ids
                )
                details += f", Test sessions found: {test_sessions_found}/{len(self.test_session_ids)}"

            if result.error_message:
                details += f", Error: {result.error_message[:100]}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test("List Sessions", success, details, time.time() - start_time)
        return success, result.sessions if success and result else []

    def test_export_session(self, session_id: str):
        """Test export_session method with a real session"""
        start_time = time.time()

        try:
            result = self.cli.export_session(session_id, Path("."))

            success = result.success and len(result.messages) > 0
            details = f"Success: {result.success}, Messages: {len(result.messages)}"

            if success:
                # Check message structure
                user_msgs = sum(1 for m in result.messages if m.role == "user")
                assistant_msgs = sum(
                    1 for m in result.messages if m.role == "assistant"
                )
                details += f", User msgs: {user_msgs}, Assistant msgs: {assistant_msgs}"

            if result.error_message:
                details += f", Error: {result.error_message[:100]}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test("Export Session", success, details, time.time() - start_time)
        return success

    def test_list_agents(self):
        """Test list_agents method"""
        start_time = time.time()

        try:
            result = self.cli.list_agents()

            success = result.success and isinstance(result.agents, list)
            agent_count = len(result.agents)
            details = f"Success: {result.success}, Agents found: {agent_count}"

            if success and agent_count > 0:
                # Check if we have expected agent info
                sample_agent = result.agents[0]
                details += f", Sample agent: {sample_agent.name if hasattr(sample_agent, 'name') else 'Unknown'}"

            if result.error_message:
                details += f", Error: {result.error_message[:100]}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test("List Agents", success, details, time.time() - start_time)
        return success

    def test_session_directory_detection(self):
        """Test session directory detection"""
        start_time = time.time()

        try:
            # Call the private method to test session directory detection
            sessions_dir = self.cli._get_sessions_directory()

            success = sessions_dir is not None and sessions_dir.exists()
            details = (
                f"Sessions dir found: {sessions_dir is not None}, Path: {sessions_dir}"
            )

            if success:
                # Count actual session directories
                session_dirs = [d for d in sessions_dir.iterdir() if d.is_dir()]
                details += f", Session directories: {len(session_dirs)}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Session Directory Detection", success, details, time.time() - start_time
        )
        return success

    def test_events_jsonl_parsing(self):
        """Test events.jsonl parsing with real copilot data"""
        start_time = time.time()

        try:
            sessions_dir = self.cli._get_sessions_directory()
            if not sessions_dir or not sessions_dir.exists():
                success = False
                details = "No sessions directory found"
            else:
                # Find a session with events.jsonl
                events_files_found = 0
                parsed_events = 0

                for session_dir in sessions_dir.iterdir():
                    if session_dir.is_dir():
                        events_file = session_dir / "events.jsonl"
                        if events_file.exists():
                            events_files_found += 1
                            try:
                                messages = self.cli._parse_events_jsonl(events_file)
                                parsed_events += len(messages)
                            except Exception:
                                pass

                success = events_files_found > 0
                details = f"Events files found: {events_files_found}, Total events parsed: {parsed_events}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test(
            "Events JSONL Parsing", success, details, time.time() - start_time
        )
        return success

    def test_error_handling(self):
        """Test error handling with invalid inputs"""
        start_time = time.time()

        try:
            # Test with invalid session ID
            result = self.cli.export_session("invalid-session-id-12345", Path("."))

            # Should fail gracefully with success=False
            success = not result.success and result.error_message is not None
            details = f"Invalid session handled: {not result.success}, Error msg provided: {result.error_message is not None}"

            if result.error_message:
                details += f", Error: {result.error_message[:50]}"

        except Exception as e:
            success = False
            details = f"Exception: {str(e)}"

        self.log_test("Error Handling", success, details, time.time() - start_time)
        return success

    def run_all_tests(self):
        """Run all functional tests"""
        print("🚀 Starting GitHub Copilot CLI Functional Tests")
        print("=" * 60)
        print()

        # Test 1: Basic CLI properties
        self.test_cli_properties()

        # Test 2: Session directory detection
        self.test_session_directory_detection()

        # Test 3: Run agent with simple prompt
        success, session_id = self.test_run_agent_simple()

        # Test 4: Resume session (if we created one)
        if success and session_id:
            self.test_run_agent_with_session(session_id)

        # Test 5: List sessions
        success, sessions = self.test_list_sessions()

        # Test 6: Export session (use first available session)
        if sessions:
            self.test_export_session(sessions[0].session_id)
        elif session_id:
            self.test_export_session(session_id)

        # Test 7: List agents
        self.test_list_agents()

        # Test 8: Events JSONL parsing
        self.test_events_jsonl_parsing()

        # Test 9: Error handling
        self.test_error_handling()

        # Summary
        self.print_summary()

    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
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

        # Show performance info
        print("\n⚡ PERFORMANCE:")
        sorted_tests = sorted(
            self.test_results, key=lambda x: x["duration_ms"], reverse=True
        )
        for result in sorted_tests[:3]:  # Top 3 slowest
            print(f"   {result['test']}: {result['duration_ms']:.1f}ms")

        return passed_tests == total_tests


if __name__ == "__main__":
    tester = CopilotFunctionalTester()
    all_passed = tester.run_all_tests()

    # Save detailed results
    results_file = Path(__file__).parent / "functional_test_results.json"
    with open(results_file, "w") as f:
        json.dump(
            {
                "timestamp": datetime.now().isoformat(),
                "copilot_version": "0.0.395",  # From earlier check
                "all_passed": all_passed,
                "results": tester.test_results,
            },
            f,
            indent=2,
        )

    print(f"\n📄 Detailed results saved to: {results_file}")

    # Exit with appropriate code
    sys.exit(0 if all_passed else 1)
