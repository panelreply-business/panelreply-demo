"""Read the runtime-generated XLSX using independent ZIP, XML and workbook readers.

No workbook is authored with Python. This runs only against synthetic fixtures
and launches the existing Node exporter with a bounded subprocess timeout.
"""

from pathlib import Path
import io
import json
import os
import subprocess
import unittest
import xml.etree.ElementTree as ET
import zipfile

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("PANELREPLY_TEST_NODE", "node")
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
HEADERS = ["Part number", "Manufacturer", "Description", "Quantity", "Source image", "Review status", "Notes"]
CASES = json.loads(subprocess.run(
    [NODE, "-e", "process.stdout.write(JSON.stringify(require('./tests/fixtures/xlsx-projects.cjs').cases))"],
    cwd=ROOT, capture_output=True, check=True, timeout=15,
).stdout)


def generated(project):
    return subprocess.run(
        [NODE, "-e", "const fs=require('node:fs');process.stdout.write(require('./workspace/xlsx.cjs').exportProjectXlsx(JSON.parse(fs.readFileSync(0,'utf8'))))"],
        input=json.dumps(project, ensure_ascii=False).encode("utf-8"),
        cwd=ROOT, capture_output=True, check=True, timeout=15,
    ).stdout


class XlsxReaderTests(unittest.TestCase):
    def check_fixture(self, fixture):
        project = fixture["project"]
        data = generated(project)
        self.assertLessEqual(len(data), 4 * 1024 * 1024)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertIsNone(archive.testzip(), "all ZIP CRCs must match")
            for name in archive.namelist():
                xml = ET.fromstring(archive.read(name))
                self.assertFalse(xml.findall(".//s:f", NS), "no formula elements")
                self.assertFalse(xml.findall(".//s:hyperlinks", NS), "no external hyperlink actions")
                if name.endswith(".rels"):
                    self.assertTrue(all(item.attrib.get("TargetMode") != "External" for item in xml))
        book = load_workbook(io.BytesIO(data), data_only=False, keep_links=False)
        self.addCleanup(book.close)
        self.assertEqual(book.sheetnames, ["Parts", "Project"])
        parts = book["Parts"]
        self.assertEqual([cell.value for cell in parts[1]], HEADERS)
        self.assertEqual(parts.freeze_panes, "A2")
        self.assertEqual(parts.auto_filter.ref, "A1:G" + str(len(project["rows"]) + 1))
        self.assertEqual(parts.max_row, len(project["rows"]) + 1)
        self.assertEqual(parts.max_column, 7)
        self.assertEqual(parts["A1"].fill.fgColor.rgb, "FF132236")
        self.assertTrue(parts["A1"].font.bold)
        self.assertEqual(parts.column_dimensions["C"].width, 52)
        source_names = {source["id"]: source["name"] for source in project["sources"]}
        for index, row in enumerate(project["rows"], 2):
            expected = [row["partNumber"], row["manufacturer"], row["description"], row["quantity"],
                        source_names.get(row["sourceImageId"], ""), row["reviewStatus"], row["notes"]]
            actual = [cell.value for cell in parts[index]]
            self.assertEqual(actual, expected, f"{fixture['id']} row {index}")
            for column, cell in enumerate(parts[index], 1):
                self.assertEqual(cell.data_type, "n" if column == 4 else "s")
                self.assertEqual(cell.number_format, "0" if column == 4 else "@")
        metadata = {row[0].value: row[1].value for row in book["Project"].iter_rows(min_row=2)}
        self.assertEqual(metadata["Project"], project["name"])
        self.assertEqual(metadata["Project ID"], project["id"])
        self.assertEqual(metadata["Saved version"], str(project["version"]))
        self.assertEqual(metadata["Project notes"], project["notes"])
        self.assertEqual(metadata["Saved (UTC)"], project["updatedAt"])


def fixture_test(fixture):
    def run(self):
        self.check_fixture(fixture)
    return run


for _fixture in CASES:
    setattr(XlsxReaderTests, "test_" + _fixture["id"].replace("-", "_"), fixture_test(_fixture))


if __name__ == "__main__":
    unittest.main(verbosity=2)
