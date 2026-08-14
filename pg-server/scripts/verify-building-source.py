from decimal import Decimal
from pathlib import Path
import re
import sys

from docx import Document


def read_document_rows(document_path):
    document = Document(document_path)
    return [
        (
            row.cells[1].text.strip(),
            Decimal(row.cells[3].text),
            Decimal(row.cells[2].text),
            Decimal(row.cells[4].text),
            row.cells[5].text.strip(),
            int(row.cells[6].text),
        )
        for row in document.tables[0].rows[1:]
    ]


def read_migration_rows(migration_path):
    sql = Path(migration_path).read_text(encoding="utf-8")
    seed_block = sql.split("WITH seed", 1)[1].split("INSERT INTO static.buildings", 1)[0]
    pattern = re.compile(
        r"\('((?:''|[^'])*)',\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*"
        r"'((?:''|[^'])*)',\s*(\d+)\)"
    )
    return [
        (
            match.group(1).replace("''", "'"),
            Decimal(match.group(2)),
            Decimal(match.group(3)),
            Decimal(match.group(4)),
            match.group(5).replace("''", "'"),
            int(match.group(6)),
        )
        for match in pattern.finditer(seed_block)
    ]


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: verify-building-source.py POINTS.docx 006_building_catalog.sql")
    expected = read_document_rows(sys.argv[1])
    actual = read_migration_rows(sys.argv[2])
    if expected != actual:
        mismatches = [
            (index, expected_row, actual_row)
            for index, (expected_row, actual_row) in enumerate(zip(expected, actual), 1)
            if expected_row != actual_row
        ]
        raise AssertionError(
            f"source mismatch: docx={len(expected)}, sql={len(actual)}, first={mismatches[:3]}"
        )
    print(f"DOCX_SQL_EXACT_MATCH=true\nROWS={len(actual)}")


if __name__ == "__main__":
    main()
