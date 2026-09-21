#!/usr/bin/env python3
"""Python communication module for PHP backend.

Provides a CLI interface that PHP can call via subprocess.
Usage: python3 comm.py <command> [args...]
Outputs JSON to stdout.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core import cli_command

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('{"success": false, "error": "No command specified"}')
        sys.exit(1)

    command = sys.argv[1]
    args = sys.argv[2:]
    result = cli_command(command, *args)
    print(result)