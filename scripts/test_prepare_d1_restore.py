import sqlite3
import unittest
from prepare_d1_restore import prepare, prepare_plan


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

    def test_data_can_cross_batches_with_foreign_keys_enabled(self):
        tables, data, objects = prepare_plan("""
CREATE TABLE child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES parent(id));
INSERT INTO child VALUES('child','parent');
CREATE TABLE parent(id TEXT PRIMARY KEY);
INSERT INTO parent VALUES('parent');
""")
        restored = sqlite3.connect(':memory:')
        self.addCleanup(restored.close)
        restored.execute('PRAGMA foreign_keys=ON')
        for statement in tables + data + objects:
            restored.execute(statement)
            restored.commit()
        self.assertEqual(restored.execute('SELECT * FROM child').fetchall(), [('child','parent')])
        self.assertEqual(restored.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_nullable_cycle_without_values_does_not_block_real_employee_data(self):
        tables,data,objects = prepare_plan("""
CREATE TABLE employees(id TEXT PRIMARY KEY,deleted_by TEXT REFERENCES users(id));
CREATE TABLE users(id TEXT PRIMARY KEY,employee_id TEXT REFERENCES employees(id));
INSERT INTO users VALUES('user','employee');
INSERT INTO employees VALUES('employee',NULL);
""")
        restored=sqlite3.connect(':memory:')
        self.addCleanup(restored.close)
        restored.execute('PRAGMA foreign_keys=ON')
        for statement in tables+data+objects:
            restored.execute(statement)
            restored.commit()
        self.assertEqual(restored.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_composite_fk_unique_index_exists_before_child_data(self):
        groups=prepare_plan("""
CREATE TABLE parent(company TEXT,employee TEXT);
CREATE TABLE child(company TEXT,employee TEXT,FOREIGN KEY(company,employee) REFERENCES parent(company,employee));
INSERT INTO parent VALUES('company','employee');
INSERT INTO child VALUES('company','employee');
CREATE UNIQUE INDEX parent_key ON parent(company,employee);
""")
        restored=sqlite3.connect(':memory:')
        self.addCleanup(restored.close)
        restored.execute('PRAGMA foreign_keys=ON')
        for group in groups:
            for statement in group:
                restored.execute(statement)
                restored.commit()
        self.assertEqual(restored.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_autoincrement_metadata_is_preserved_without_recreating_internal_table(self):
        tables,data,objects=prepare_plan("""
CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT);
INSERT INTO items VALUES(3,'kept');
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('items',10);
""")
        restored=sqlite3.connect(':memory:')
        self.addCleanup(restored.close)
        for statement in tables+data+objects:
            restored.execute(statement)
            restored.commit()
        restored.execute("INSERT INTO items(value) VALUES('next')")
        self.assertEqual(restored.execute("SELECT id FROM items WHERE value='next'").fetchone()[0],11)


if __name__ == '__main__':
    unittest.main()
