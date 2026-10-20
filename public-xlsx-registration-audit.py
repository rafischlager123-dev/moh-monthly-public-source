"""Read public originals only; emit registration keys for independent coverage.

No workbook modification, macro execution, external links, or company file input.
"""
import hashlib
import json
import re
import unicodedata
from pathlib import Path
import openpyxl

root = Path("source-http-proof").resolve()
manifest = json.loads((root / "files.json").read_text(encoding="utf-8"))
headers = ["מספר תכשיר", "שם תכשיר באנגלית", "שם תכשיר בעברית", "התוויה", "יצרן", "בעל רישום", "צורת מינון", "דרך מתן", "דרך מתן בעברית", "מרכיבים", "גנרי"]
def clean(value):
    return " ".join(re.sub(r"[\u200e\u200f\u202a-\u202e]", "", unicodedata.normalize("NFKC", str(value or ""))).split())

results = []
for file in manifest:
    if not re.fullmatch(r"[a-f0-9]{64}", file["sha256"]):
        raise ValueError("Invalid original hash")
    path = root / (file["sha256"] + ".xlsx")
    content = path.read_bytes()
    if len(content) > 2097152 or hashlib.sha256(content).hexdigest() != file["sha256"]:
        raise ValueError("Original bytes failed readback")
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=False, keep_links=False)
    populated = [list(sheet.values) for sheet in workbook if sheet.max_row > 1]
    workbook.close()
    if len(populated) != 1:
        raise ValueError("Ambiguous source worksheet")
    rows = populated[0]
    if not 2 <= len(rows) <= 5001:
        raise ValueError("Original row bound exceeded")
    actual_headers = [clean(v) for v in rows[0]]
    if len(actual_headers) != 11 or set(actual_headers) != set(headers):
        raise ValueError("Official original columns changed")
    column = actual_headers.index("מספר תכשיר")
    keys = []
    for row in rows[1:]:
        if not any(value is not None and value != "" for value in row):
            continue
        raw = str(row[column] or "").strip()
        if not re.fullmatch(r"\d{3}[ -]\d{2}[ -]\d{5}[ -]\d{2}|\d{12}", raw):
            raise ValueError("Invalid or formula registration cell")
        keys.append(re.sub(r"\D", "", raw))
    if not keys or len(set(keys)) != len(keys):
        raise ValueError("Empty or duplicate source registrations")
    results.append({"sha256": file["sha256"], "periods": file["periods"], "registrations": keys})
print(json.dumps(results, ensure_ascii=True))
