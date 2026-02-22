#!/usr/bin/env python3
"""
OpenCode Database Explorer

A simple CLI tool to explore and query the OpenCode SQLite database.
This tool helps understand the database schema, view recent sessions,
and export session content for analysis.

Usage:
    python opencode_db_explorer.py schema        # Show database schema
    python opencode_db_explorer.py sessions      # List recent sessions
    python opencode_db_explorer.py export <id>   # Export specific session
    python opencode_db_explorer.py stats         # Show database statistics
    python opencode_db_explorer.py search <term> # Search session content
"""

import sqlite3
import json
import sys
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any


def get_db_path() -> Optional[Path]:
    """Get the OpenCode database path."""
    # Check environment variable first
    env_path = os.environ.get("OPENCODE_DATABASE_PATH")
    if env_path and Path(env_path).exists():
        return Path(env_path)

    # Standard location
    db_path = Path.home() / ".local/share/opencode/opencode.db"
    return db_path if db_path.exists() else None


def connect_db() -> sqlite3.Connection:
    """Connect to the OpenCode database."""
    db_path = get_db_path()
    if not db_path:
        print("❌ OpenCode database not found!")
        print("Expected location: ~/.local/share/opencode/opencode.db")
        sys.exit(1)

    print(f"📁 Database: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def format_timestamp(timestamp: Any) -> str:
    """Format timestamp for display."""
    if not timestamp:
        return "Unknown"

    try:
        # Handle different timestamp formats (seconds, milliseconds, etc.)
        ts = float(timestamp)
        if ts > 1e11:  # Likely milliseconds
            ts = ts / 1000
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, OSError):
        return str(timestamp)


def show_schema():
    """Display the database schema."""
    conn = connect_db()
    cursor = conn.cursor()

    print("\n🗄️  OpenCode Database Schema")
    print("=" * 50)

    # Get all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = cursor.fetchall()

    for table in tables:
        table_name = table["name"]
        print(f"\n📋 Table: {table_name}")
        print("-" * 30)

        # Get table info
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()

        for col in columns:
            pk_marker = " (PRIMARY KEY)" if col["pk"] else ""
            null_marker = " NOT NULL" if col["notnull"] else ""
            print(f"  • {col['name']:20} {col['type']}{pk_marker}{null_marker}")

    conn.close()


def show_sessions(limit: int = 20, directory: Optional[str] = None):
    """List recent sessions."""
    conn = connect_db()
    cursor = conn.cursor()

    print(f"\n📝 Recent Sessions (limit: {limit})")
    print("=" * 80)

    if directory:
        query = """
        SELECT id, title, directory, time_updated, time_created
        FROM session 
        WHERE directory = ?
        ORDER BY time_updated DESC 
        LIMIT ?
        """
        cursor.execute(query, (directory, limit))
    else:
        query = """
        SELECT id, title, directory, time_updated, time_created
        FROM session 
        ORDER BY time_updated DESC 
        LIMIT ?
        """
        cursor.execute(query, (limit,))

    sessions = cursor.fetchall()

    if not sessions:
        print("No sessions found.")
        conn.close()
        return

    for session in sessions:
        title = session["title"] or f"Session {session['id'][:8]}..."
        updated = format_timestamp(session["time_updated"])
        directory_short = session["directory"][-50:] if session["directory"] else "N/A"

        print(f"🔹 {session['id']}")
        print(f"   Title: {title[:60]}")
        print(f"   Directory: ...{directory_short}")
        print(f"   Updated: {updated}")
        print()

    conn.close()


def export_session(session_id: str):
    """Export session content in detail."""
    conn = connect_db()
    cursor = conn.cursor()

    print(f"\n📤 Exporting Session: {session_id}")
    print("=" * 60)

    # Get session info
    cursor.execute(
        """
        SELECT id, title, directory, time_created, time_updated 
        FROM session WHERE id = ?
    """,
        (session_id,),
    )

    session = cursor.fetchone()
    if not session:
        print(f"❌ Session {session_id} not found!")
        conn.close()
        return

    print(f"📋 Title: {session['title']}")
    print(f"📁 Directory: {session['directory']}")
    print(f"🕐 Created: {format_timestamp(session['time_created'])}")
    print(f"🕑 Updated: {format_timestamp(session['time_updated'])}")

    # Get messages and parts
    cursor.execute(
        """
        SELECT 
            m.id as message_id, m.time_created as msg_time, m.data as msg_data,
            p.id as part_id, p.time_created as part_time, p.data as part_data
        FROM message m 
        LEFT JOIN part p ON m.id = p.message_id
        WHERE m.session_id = ?
        ORDER BY m.time_created, p.time_created
    """,
        (session_id,),
    )

    rows = cursor.fetchall()

    if not rows:
        print("\n📭 No messages found in this session.")
        conn.close()
        return

    print(f"\n💬 Messages ({len(set(r['message_id'] for r in rows))} messages)")
    print("-" * 60)

    current_message_id = None
    message_count = 0

    for row in rows:
        if row["message_id"] != current_message_id:
            current_message_id = row["message_id"]
            message_count += 1

            # Parse message data
            try:
                msg_data = json.loads(row["msg_data"]) if row["msg_data"] else {}
            except json.JSONDecodeError:
                msg_data = {}

            role = msg_data.get("role", "unknown")
            msg_time = format_timestamp(row["msg_time"])

            print(f"\n📨 Message {message_count} ({role}) - {msg_time}")
            print(f"   ID: {row['message_id']}")

            if msg_data:
                print(f"   Data: {json.dumps(msg_data, indent=2)[:200]}...")

        # Show part data
        if row["part_id"]:
            try:
                part_data = json.loads(row["part_data"]) if row["part_data"] else {}
                part_type = part_data.get("type", "unknown")
                part_time = format_timestamp(row["part_time"])

                print(f"      🔹 Part: {row['part_id']} ({part_type}) - {part_time}")

                # Show content based on type
                if part_type == "text" and part_data.get("text"):
                    text_content = part_data["text"][:100]
                    print(f"         Text: {text_content}...")
                elif part_type == "tool" and part_data.get("tool"):
                    print(f"         Tool: {part_data['tool']}")
                elif part_type == "reasoning" and part_data.get("text"):
                    reasoning_content = part_data["text"][:100]
                    print(f"         Reasoning: {reasoning_content}...")
                else:
                    print(f"         Data: {str(part_data)[:100]}...")

            except json.JSONDecodeError:
                print(f"      🔹 Part: {row['part_id']} (malformed JSON)")

    conn.close()


def show_stats():
    """Show database statistics."""
    conn = connect_db()
    cursor = conn.cursor()

    print("\n📊 Database Statistics")
    print("=" * 40)

    # Session count
    cursor.execute("SELECT COUNT(*) as count FROM session")
    session_count = cursor.fetchone()["count"]
    print(f"📝 Total Sessions: {session_count:,}")

    # Message count
    cursor.execute("SELECT COUNT(*) as count FROM message")
    message_count = cursor.fetchone()["count"]
    print(f"💬 Total Messages: {message_count:,}")

    # Part count
    cursor.execute("SELECT COUNT(*) as count FROM part")
    part_count = cursor.fetchone()["count"]
    print(f"🔹 Total Parts: {part_count:,}")

    # Recent activity
    cursor.execute("""
        SELECT COUNT(*) as count FROM session 
        WHERE time_updated > datetime('now', '-7 days')
    """)
    recent_sessions = cursor.fetchone()["count"]
    print(f"🕐 Sessions (last 7 days): {recent_sessions:,}")

    # Top directories
    cursor.execute("""
        SELECT directory, COUNT(*) as count 
        FROM session 
        WHERE directory IS NOT NULL
        GROUP BY directory 
        ORDER BY count DESC 
        LIMIT 5
    """)
    directories = cursor.fetchall()

    print(f"\n📁 Top Directories:")
    for dir_info in directories:
        dir_path = (
            dir_info["directory"][-50:]
            if len(dir_info["directory"]) > 50
            else dir_info["directory"]
        )
        print(f"   {dir_info['count']:3d} sessions: ...{dir_path}")

    conn.close()


def search_content(search_term: str, limit: int = 10):
    """Search for content in sessions."""
    conn = connect_db()
    cursor = conn.cursor()

    print(f"\n🔍 Searching for: '{search_term}' (limit: {limit})")
    print("=" * 60)

    # Search in session titles
    cursor.execute(
        """
        SELECT id, title, directory, time_updated
        FROM session 
        WHERE title LIKE ? 
        ORDER BY time_updated DESC 
        LIMIT ?
    """,
        (f"%{search_term}%", limit),
    )

    title_matches = cursor.fetchall()

    if title_matches:
        print("📋 Sessions with matching titles:")
        for session in title_matches:
            title = session["title"] or f"Session {session['id'][:8]}..."
            updated = format_timestamp(session["time_updated"])
            print(f"  • {session['id']}: {title} ({updated})")

    # Search in message/part content
    cursor.execute(
        """
        SELECT DISTINCT m.session_id, s.title, m.id as message_id, p.data
        FROM message m
        JOIN session s ON m.session_id = s.id
        LEFT JOIN part p ON m.id = p.message_id
        WHERE m.data LIKE ? OR p.data LIKE ?
        ORDER BY m.time_created DESC
        LIMIT ?
    """,
        (f"%{search_term}%", f"%{search_term}%", limit),
    )

    content_matches = cursor.fetchall()

    if content_matches:
        print(f"\n💬 Messages with matching content:")
        for match in content_matches:
            title = match["title"] or f"Session {match['session_id'][:8]}..."
            print(f"  • {match['session_id']}: {title}")
            print(f"    Message: {match['message_id']}")

    if not title_matches and not content_matches:
        print("No matches found.")

    conn.close()


def main():
    """Main CLI interface."""
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1].lower()

    try:
        if command == "schema":
            show_schema()

        elif command == "sessions":
            limit = (
                int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 20
            )
            directory = sys.argv[3] if len(sys.argv) > 3 else None
            show_sessions(limit, directory)

        elif command == "export":
            if len(sys.argv) < 3:
                print("❌ Please provide a session ID")
                sys.exit(1)
            export_session(sys.argv[2])

        elif command == "stats":
            show_stats()

        elif command == "search":
            if len(sys.argv) < 3:
                print("❌ Please provide a search term")
                sys.exit(1)
            search_term = " ".join(sys.argv[2:])
            search_content(search_term)

        else:
            print(f"❌ Unknown command: {command}")
            print(__doc__)
            sys.exit(1)

    except KeyboardInterrupt:
        print("\n\n👋 Goodbye!")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
