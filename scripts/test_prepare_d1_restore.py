import sqlite3
import unittest
from prepare_d1_restore import prepare


class RestoreOrderingTests(unittest.TestCase):
    def test_tables_before_data_and_triggers_after_data(self):
        exported = """
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES parent(id),note TEXT);
INSERT INTO child VALUES('child','parent','text; CREATE TABLE fake;');
CREATE TABLE revision(value INTEGER);
INSERT INTO revision VALUES(0);
CREATE TRIGGER inserted AFTER INSERT ON child BEGIN
 UPDATE revision SET value=value+1;
END;
CREATE TABLE parent(id TEXT PRIMARY KEY);
INSERT INTO parent VALUES('parent');
COMMIT;
"""
        restored = sqlite3.connect(':memory:')
        self.addCleanup(restored.close)
        restored.execute('PRAGMA foreign_keys=ON')
        restored.executescript('BEGIN;\n' + prepare(exported) + '\nCOMMIT;')
        self.assertEqual(restored.execute('SELECT note FROM child').fetchone()[0], 'text; CREATE TABLE fake;')
        self.assertEqual(restored.execute('SELECT value FROM revision').fetchone()[0], 0)
        restored.execute("INSERT INTO child VALUES('second','parent','after restore')")
        self.assertEqual(restored.execute('SELECT value FROM revision').fetchone()[0], 1)
        self.assertEqual(restored.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_comments_and_quoted_semicolons_are_preserved(self):
        sql = "-- initial comment;\nCREATE TABLE example(value TEXT); INSERT INTO example VALUES('it''s; valid'); -- final comment"
        restored = sqlite3.connect(':memory:')
        self.addCleanup(restored.close)
        restored.executescript(prepare(sql))
        self.assertEqual(restored.execute('SELECT value FROM example').fetchone()[0], "it's; valid")

    def test_unknown_or_incomplete_sql_is_refused_without_echoing_values(self):
        for sql in ['CREATE TABLE x(id); DROP TABLE x;', "CREATE TABLE x(id); INSERT INTO x VALUES('private-marker", 'SELECT 1;']:
            with self.assertRaises(ValueError) as error:
                prepare(sql)
            self.assertNotIn('private-marker', str(error.exception))


if __name__ == '__main__':
    unittest.main()
