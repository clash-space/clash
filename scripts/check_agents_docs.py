#!/usr/bin/env python3
"""
Script to verify the integrity of the Agent-Optimized Documentation System (AODS).
Usage: python3 scripts/check_agents_docs.py
"""

import os
import json
import sys
from pathlib import Path

# Configuration
REQUIRED_FIELDS = ["summary", "context_hints", "subdirectories", "key_files"]
MANDATORY_DIRS = [
    "apps/api",
    "apps/web",
    "apps/auth-gateway",
    "packages/shared-types",
    "docs"
]

def load_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ Error reading {path}: {e}")
        return None

def check_structure(data, file_path):
    missing = [field for field in REQUIRED_FIELDS if field not in data]
    if missing:
        print(f"❌ {file_path} is missing fields: {missing}")
        return False
    return True

def check_key_files_exist(data, base_dir):
    key_files = data.get("key_files", {})
    all_exist = True
    for filename, _ in key_files.items():
        file_path = base_dir / filename
        if not file_path.exists():
            print(f"❌ {base_dir}/agents.json references missing file: {filename}")
            all_exist = False
    return all_exist

def main():
    root_dir = Path(os.getcwd())
    print(f"🔍 Checking AODS integrity in {root_dir}...\n")

    has_error = False

    # 1. Check Mandatory Directories
    print("📂 Checking mandatory directory coverage...")
    for rel_path in MANDATORY_DIRS:
        dir_path = root_dir / rel_path
        agent_file = dir_path / "agents.json"
        if not agent_file.exists():
            print(f"❌ Missing agents.json in mandatory directory: {rel_path}")
            has_error = True
        else:
            print(f"✅ Found {rel_path}/agents.json")

    # 2. Find and Validate All agents.json files
    print("\n📝 Validating all agents.json files...")
    for agents_file in root_dir.rglob("agents.json"):
        rel_path = agents_file.relative_to(root_dir)
        data = load_json(agents_file)

        if not data:
            has_error = True
            continue

        # Check Structure
        if not check_structure(data, rel_path):
            has_error = True
            continue

        # Check Key Files existence
        if not check_key_files_exist(data, agents_file.parent):
            has_error = True
            continue

        print(f"✅ Validated {rel_path}")

    if has_error:
        print("\n🚫 Documentation checks FAILED.")
        sys.exit(1)
    else:
        print("\n✨ All documentation checks PASSED.")
        sys.exit(0)

if __name__ == "__main__":
    main()
