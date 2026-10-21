import importlib.util
from pathlib import Path
import io
import os
import stat
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('integrate_v68', HERE / 'crj-integrate-v68.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def zip_bytes(members):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in members:
            archive.writestr(name, content)
    return out.getvalue()


class IntegrationGuardTests(unittest.TestCase):
    def test_good_package_unpack(self):
        data = zip_bytes([(M.ARCHIVE_ROOT + '/crj_v68.py', 'pass\n')])
        with tempfile.TemporaryDirectory() as directory:
            path = M.safe_unpack(data, Path(directory))
            self.assertEqual((path / 'crj_v68.py').read_text(), 'pass\n')

    def test_cannot_escape_destination(self):
        data = zip_bytes([(M.ARCHIVE_ROOT + '/../../../outside.txt', 'attack'),
                          (M.ARCHIVE_ROOT + '/crj_v68.py', 'pass')])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'Unsafe ZIP member'):
                M.safe_unpack(data, Path(directory))
            self.assertFalse((Path(directory).parent / 'outside.txt').exists())

    def test_symlink_in_zip_rejected(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            info = zipfile.ZipInfo(M.ARCHIVE_ROOT + '/crj_v68.py')
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, '../../escape')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'object type'):
                M.safe_unpack(out.getvalue(), Path(directory))

    def test_duplicate_filename_rejected(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            for _ in range(2):
                archive.writestr(M.ARCHIVE_ROOT + '/crj_v68.py', 'pass')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'Unsafe ZIP member'):
                M.safe_unpack(out.getvalue(), Path(directory))

    def test_wrong_root_rejected(self):
        data = zip_bytes([('WRONG/crj_v68.py', 'pass')])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'Unapproved ZIP root'):
                M.safe_unpack(data, Path(directory))

    def test_launch_commit_rejects_unrecognized_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.check_call(['git', 'init', '-q', str(root)])
            subprocess.check_call(['git', 'config', 'user.email', 'unit@example.com'], cwd=root)
            subprocess.check_call(['git', 'config', 'user.name', 'Unit'], cwd=root)
            (root / 'old.txt').write_text('old')
            subprocess.check_call(['git', 'add', '.'], cwd=root)
            subprocess.check_call(['git', 'commit', '-qm', 'old'], cwd=root)
            parent = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
            (root / 'bad.sh').write_text('bad')
            subprocess.check_call(['git', 'add', '.'], cwd=root)
            subprocess.check_call(['git', 'commit', '-qm', 'bad'], cwd=root)
            head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
            with patch.object(M, 'EXPECTED_PARENT', parent), patch.dict(os.environ, {'GITHUB_SHA': head}):
                with self.assertRaisesRegex(RuntimeError, 'unexpected source files'):
                    M.verify_launch_commit(root)

    def test_checkout_head_mismatch_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            subprocess.check_call(['git', 'init', '-q', str(root)])
            subprocess.check_call(['git', 'config', 'user.email', 'unit@example.com'], cwd=root)
            subprocess.check_call(['git', 'config', 'user.name', 'Unit'], cwd=root)
            (root / 'x').write_text('x')
            subprocess.check_call(['git', 'add', '.'], cwd=root)
            subprocess.check_call(['git', 'commit', '-qm', 'initial'], cwd=root)
            with patch.dict(os.environ, {'GITHUB_SHA': '0'*40}):
                with self.assertRaisesRegex(RuntimeError, 'SHA does not match checkout'):
                    M.verify_launch_commit(root)

if __name__ == '__main__':
    unittest.main()
