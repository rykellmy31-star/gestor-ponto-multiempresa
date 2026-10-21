"""Reorder a D1 export without rewriting values or SQL object definitions.

SQLite complete_statement handles quoted semicolons and CREATE TRIGGER bodies.
The destination must independently be verified as a new, empty staging database.
"""
import re
import sqlite3
import json
from pathlib import Path
import sys


def without_leading_comments(statement):
    previous = None
    while previous != statement:
        previous = statement
        statement = re.sub(r'^\s*(?:--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)', '', statement)
    return statement.lstrip()


def prepare_plan(sql):
    statements = []
    pending = ''
    for character in sql:
        pending += character
        if character == ';' and sqlite3.complete_statement(pending):
            statements.append(pending)
            pending = ''
    if without_leading_comments(pending).strip():
        raise ValueError('Exportacao contem instrucao SQL incompleta.')
    groups = [[], [], []]
    for statement in statements:
        source = without_leading_comments(statement)
        if re.match(r'^CREATE\s+TABLE\b', source, re.I):
            groups[0].append(statement)
        elif re.match(r'^INSERT\s+INTO\b', source, re.I):
            groups[1].append(statement)
        elif re.match(r'^CREATE\s+(?:(?:UNIQUE\s+)?INDEX|VIEW|TRIGGER)\b', source, re.I):
            groups[2].append(statement)
        elif re.fullmatch(r'(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END(?:\s+TRANSACTION)?|PRAGMA\s+[^;]+)\s*;\s*', source, re.I):
            # D1's importer owns the transaction. foreign_keys=OFF cannot be
            # relied upon in D1; use its supported deferred-FK mode instead.
            continue
        elif re.match(r'^(?:DELETE\s+FROM|INSERT\s+INTO)\s+["`\[]?sqlite_sequence\b', source, re.I):
            continue
        else:
            raise ValueError('Exportacao contem instrucao fora do formato permitido.')
    if not groups[0]:
        raise ValueError('Exportacao nao contem tabelas.')
    sequence_pattern = re.compile(r'^INSERT\s+INTO\s+["`\[]?sqlite_sequence\b', re.I)
    sequence_data = [statement for statement in groups[1] if sequence_pattern.match(without_leading_comments(statement))]
    groups[1] = [statement for statement in groups[1] if not sequence_pattern.match(without_leading_comments(statement))]
    # Derive table dependencies from SQLite itself, not from regexes over
    # REFERENCES clauses. This keeps FK parents before children across batches.
    schema = sqlite3.connect(':memory:')
    try:
        for statement in groups[0]:
            schema.execute(statement)
        # Work only in this private in-memory copy. Nullable references such
        # as employees.deleted_by -> users do not create a data dependency
        # when every restored value is NULL; users.employee_id still does.
        for statement in groups[1]:
            schema.execute(statement)
        automatic_sequences = dict(schema.execute('SELECT name,MAX(seq) FROM sqlite_sequence GROUP BY name')) if sequence_data else {}
        for statement in sequence_data:
            schema.execute(statement)
        names = [row[0] for row in schema.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        quote = lambda name: '"' + name.replace('"', '""') + '"'
        remaining = {name: {row[2] for row in schema.execute('PRAGMA foreign_key_list(' + quote(name) + ')')
                           if row[2] != name and schema.execute('SELECT 1 FROM ' + quote(name) + ' WHERE ' + quote(row[3]) + ' IS NOT NULL LIMIT 1').fetchone()}
                     for name in names}
        order = []
        while remaining:
            ready = sorted(name for name, parents in remaining.items() if not parents.intersection(remaining))
            if not ready:
                raise ValueError('Dependencias ciclicas exigem revisao da recuperacao.')
            for name in ready:
                order.append(name)
                del remaining[name]
        rank = {name: i for i, name in enumerate(order)}
        def table_rank(statement):
            match = re.match(r'^INSERT\s+INTO\s+(?:"([^"]+)"|`([^`]+)`|\[([^]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))', without_leading_comments(statement), re.I)
            if not match:
                raise ValueError('Tabela do INSERT nao identificada.')
            name = next(value for value in match.groups() if value is not None)
            if name not in rank:
                raise ValueError('INSERT em tabela fora do schema permitido.')
            return rank[name]
        groups[1].sort(key=table_rank)
        if sequence_data:
            # Explicit row IDs recreate counters, but a deleted highest row may
            # leave a higher source counter. Preserve it without recreating or
            # clearing SQLite's internal table and without touching CF metadata.
            for name, sequence in schema.execute('SELECT name,MAX(seq) FROM sqlite_sequence GROUP BY name'):
                if name not in rank:
                    raise ValueError('Sequencia fora das tabelas da aplicacao.')
                if not isinstance(sequence, int) or sequence < 0:
                    raise ValueError('Contador de sequencia invalido.')
                if sequence <= automatic_sequences.get(name, 0):
                    continue
                literal = "'" + name.replace("'", "''") + "'"
                groups[1].append('UPDATE sqlite_sequence SET seq=' + str(sequence) + ' WHERE name=' + literal + ';')
    finally:
        schema.close()
    return groups


def prepare_sections(sql):
    groups = prepare_plan(sql)
    return ['\n'.join(groups[0]) + '\n',
            'PRAGMA defer_foreign_keys=TRUE;\n' + '\n'.join(groups[1]) + '\n',
            '\n'.join(groups[2]) + '\n']


def prepare(sql):
    sections = prepare_sections(sql)
    return 'PRAGMA defer_foreign_keys=TRUE;\n' + '\n'.join(sections)


if __name__ == '__main__':
    try:
        input_path, output_path = map(Path, sys.argv[1:])
        with output_path.open('x', encoding='utf-8') as output:
            source = input_path.read_text(encoding='utf-8')
            output.write(json.dumps(prepare_plan(source)) if output_path.suffix == '.json' else prepare(source))
        output_path.chmod(0o600)
    except Exception as error:
        # Never echo SQL or values in public CI logs.
        reason = str(error) if isinstance(error, ValueError) else getattr(error, 'sqlite_errorname', type(error).__name__)
        print('Preparacao do SQL de recuperacao recusada: ' + reason, file=sys.stderr)
        sys.exit(1)
