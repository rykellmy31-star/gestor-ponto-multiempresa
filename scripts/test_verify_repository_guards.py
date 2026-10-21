import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('verify_repository_guards.py')
spec = importlib.util.spec_from_file_location('verify_repository_guards', SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RepositoryGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'migrations').mkdir()
        for n in range(1, 39):
            (self.root / 'migrations' / f'{n:04d}_example.sql').write_text('SELECT 1;\n')
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)

    def test_38_contiguous_migrations_are_valid(self):
        self.assertEqual(mod.verify_migrations(self.root), 38)

    def test_missing_migration_is_rejected(self):
        (self.root / 'migrations' / '0017_example.sql').unlink()
        with self.assertRaisesRegex(ValueError, 'at least 38'):
            mod.verify_migrations(self.root)

    def test_gap_after_minimum_is_rejected(self):
        (self.root / 'migrations' / '0040_example.sql').write_text('SELECT 1;')
        with self.assertRaisesRegex(ValueError, 'gaps'):
            mod.verify_migrations(self.root)

    def test_duplicate_number_is_rejected(self):
        (self.root / 'migrations' / '0038_other.sql').write_text('SELECT 2;')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            mod.verify_migrations(self.root)

    def test_empty_migration_is_rejected(self):
        (self.root / 'migrations' / '0038_example.sql').write_text(' \n')
        with self.assertRaisesRegex(ValueError, 'Empty'):
            mod.verify_migrations(self.root)

    def test_symlink_migration_is_rejected(self):
        (self.root / 'migrations' / '0038_example.sql').unlink()
        (self.root / 'migrations' / '0038_example.sql').symlink_to('0037_example.sql')
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            mod.verify_migrations(self.root)

    def test_secret_file_path_is_rejected_without_printing_contents(self):
        (self.root / '.dev.vars').write_text('CONFIDENTIAL_UNIQUE_MARKER')
        subprocess.run(['git', 'add', '.dev.vars'], cwd=self.root, check=True)
        with self.assertRaisesRegex(ValueError, 'Sensitive file paths committed: .dev.vars') as cm:
            mod.verify_tracked_secrets(self.root)
        self.assertNotIn('CONFIDENTIAL_UNIQUE_MARKER', str(cm.exception))

    def test_example_file_and_sql_are_allowed(self):
        (self.root / '.dev.vars.example').write_text('placeholder')
        subprocess.run(['git', 'add', '.dev.vars.example'], cwd=self.root, check=True)
        mod.verify_tracked_secrets(self.root)


if __name__ == '__main__':
    unittest.main()
