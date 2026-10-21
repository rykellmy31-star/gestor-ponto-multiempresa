#!/usr/bin/env python3
"""Read-only public repository guards: migrations and tracked secrets."""
from __future__ import annotations
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

MIN_REQUIRED_MIGRATION = 38
MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")
BLOCKED_NAMES = {'.dev.vars', '.env', '.npmrc', '.pypirc', 'id_rsa', 'id_ed25519'}
BLOCKED_SUFFIXES = {'.pem', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db'}


def verify_migrations(root: Path, minimum: int = MIN_REQUIRED_MIGRATION) -> int:
    folder = root / 'migrations'
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError('Migration directory is missing or unsafe')
    entries = sorted(p for p in folder.iterdir() if p.suffix == '.sql')
    if len(entries) < minimum:
        raise ValueError(f'Expected at least {minimum} migration files, found {len(entries)}')
    seen: set[int] = set()
    for p in entries:
        m = MIGRATION_NAME.fullmatch(p.name)
        if m is None or p.is_symlink() or not p.is_file():
            raise ValueError(f'Invalid or unsafe migration file: {p.name}')
        number = int(m.group(1))
        if number in seen:
            raise ValueError(f'Duplicate migration number: {number:04d}')
        seen.add(number)
        if not p.read_bytes().strip():
            raise ValueError(f'Empty migration file: {p.name}')
    count = max(seen)
    if seen != set(range(1, count + 1)):
        missing = sorted(set(range(1, count + 1)) - seen)
        raise ValueError(f'Migration sequence has gaps: {missing}')
    return count


def is_blocked_tracked_path(name: str) -> bool:
    path = PurePosixPath(name)
    base = path.name.lower()
    if base in {'.dev.vars.example', '.env.example'}:
        return False
    if base in BLOCKED_NAMES or base.startswith('.dev.vars.') or base.startswith('.env.'):
        return True
    if any(base.endswith(ext) for ext in BLOCKED_SUFFIXES):
        return True
    return name.lower().startswith('.aws/') and base == 'credentials'


def verify_tracked_secrets(root: Path) -> None:
    proc = subprocess.run(['git', 'ls-files', '-z'], cwd=root,
                          check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    names = [name.decode('utf-8') for name in proc.stdout.split(b'\0') if name]
    unsafe = [name for name in names if is_blocked_tracked_path(name)]
    if unsafe:
        # Only paths, never the actual secret values.
        raise ValueError('Sensitive file paths committed: ' + ', '.join(sorted(unsafe)))


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    try:
        n = verify_migrations(root)
        verify_tracked_secrets(root)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'REPOSITORY GUARD FAILED: {error}', file=sys.stderr)
        return 1
    print(f'REPOSITORY GUARD OK: migrations 0001-{n:04d}; no blocked tracked secret filenames')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
