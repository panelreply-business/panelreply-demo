"""Independent, bounded ZIP/XML reader for generated release export cases.

Uses Python's standard ZIP CRC validation and XML parser. It does not import the
application writer or infer expected cell content from the generated XML.
This verifies the original OOXML package, not Microsoft Excel or a resaved file.
"""
import base64
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_INPUT = 128 * 1024 * 1024
MAX_BOOK = 4 * 1024 * 1024
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
PATHS = {
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels", "xl/styles.xml",
    "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/sharedStrings.xml",
}
FORBIDDEN = {"f", "hyperlink", "externalLink", "oleObject", "vbaProject", "definedNames"}
HEADERS = ["Part number", "Manufacturer", "Description", "Quantity", "Source image", "Review status", "Notes"]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def text_runs(element):
    # OOXML escapes decode once per Text element. In particular an escaped
    # underscore must not cause a second decode of a literal _xNNNN_ value.
    values = []
    for text in element.findall(".//s:t", NS):
        value = text.text or ""
        values.append(re.sub(r"_x([0-9a-f]{4})_", lambda m: chr(int(m.group(1), 16)), value, flags=re.I))
    return "".join(values)


def worksheet(root, strings):
    result = {}
    for row in root.findall("s:sheetData/s:row", NS):
        for cell in row.findall("s:c", NS):
            reference = cell.attrib.get("r")
            require(reference and reference not in result, "duplicate or missing cell address")
            kind = cell.attrib.get("t")
            if kind == "s":
                raw = cell.findtext("s:v", namespaces=NS)
                require(raw is not None and raw.isdecimal(), "invalid shared-string reference")
                index = int(raw)
                require(index < len(strings), "shared-string reference out of range")
                value = strings[index]
                actual_type = "text"
            elif kind == "inlineStr":
                inline = cell.find("s:is", NS)
                require(inline is not None, "missing inline string")
                value = text_runs(inline)
                actual_type = "text"
            elif kind == "n":
                raw = cell.findtext("s:v", namespaces=NS)
                require(raw is not None and raw.isdecimal(), "quantity must be an integer number")
                value = int(raw)
                actual_type = "number"
            else:
                raise AssertionError("unexpected cell type")
            result[reference] = {"value": value, "type": actual_type}
    return result


def verify(case):
    raw = base64.b64decode(case["workbook"], validate=True)
    require(0 < len(raw) <= MAX_BOOK, "workbook exceeds its documented byte limit")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        require(len(infos) == len(PATHS), "unexpected member count")
        require({info.filename for info in infos} == PATHS, "unexpected package member")
        require(sum(info.file_size for info in infos) <= MAX_BOOK, "unbounded package expansion")
        require(all(info.compress_type == zipfile.ZIP_STORED for info in infos), "unexpected compression")
        require(all(not info.flag_bits & 1 for info in infos), "unexpected encrypted member")
        require(archive.testzip() is None, "invalid ZIP member CRC")
        xml = {}
        for info in infos:
            data = archive.read(info)
            require(b"<!DOCTYPE" not in data and b"<!ENTITY" not in data, "XML entity declaration is not allowed")
            root = ET.fromstring(data)
            xml[info.filename] = root
            for element in root.iter():
                local = element.tag.rsplit("}", 1)[-1]
                require(local not in FORBIDDEN, "executable or external workbook element")
                if local == "Relationship":
                    target = element.attrib.get("Target", "")
                    require(element.attrib.get("TargetMode") != "External", "external relationship")
                    require(target and not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:|^[/\\]", target), "nonrelative relationship")
                    require(".." not in target.split("/"), "relationship traversal")

        strings_root = xml["xl/sharedStrings.xml"]
        strings = [text_runs(item) for item in strings_root.findall("s:si", NS)]
        require(int(strings_root.attrib["uniqueCount"]) == len(strings), "incorrect shared-string count")
        parts_root = xml["xl/worksheets/sheet1.xml"]
        parts = worksheet(parts_root, strings)
        rows = [HEADERS] + case["parts"]
        expected = {}
        for row_number, row in enumerate(rows, 1):
            require(len(row) == 7, "invalid expected row")
            for column, value in enumerate(row):
                reference = chr(65 + column) + str(row_number)
                expected[reference] = {"value": value, "type": "number" if row_number > 1 and column == 3 else "text"}
        require(parts == expected, "exact parts cell values, addresses, or types changed")
        dimension = "A1:G" + str(len(rows))
        require(parts_root.find("s:dimension", NS).attrib["ref"] == dimension, "incorrect worksheet dimension")
        require(parts_root.find("s:autoFilter", NS).attrib["ref"] == dimension, "incorrect saved-row filter")
        pane = parts_root.find("s:sheetViews/s:sheetView/s:pane", NS)
        require(pane is not None and pane.attrib.get("state") == "frozen" and pane.attrib.get("ySplit") == "1", "missing frozen header")

        project = worksheet(xml["xl/worksheets/sheet2.xml"], strings)
        expected_metadata = [["Project detail", "Saved value"]] + case["metadata"]
        metadata_cells = {}
        for number, row in enumerate(expected_metadata, 1):
            for column, value in enumerate(row):
                metadata_cells[chr(65 + column) + str(number)] = {"value": value, "type": "text"}
        require(project == metadata_cells, "saved project metadata changed or leaked extra fields")
        require([sheet.attrib["name"] for sheet in xml["xl/workbook.xml"].findall("s:sheets/s:sheet", NS)] == ["Parts", "Project"], "unexpected worksheets")
    return {"id": case["id"], "status": "PASS", "reader": "python-stdlib-zipfile-elementtree", "cells": len(parts) + len(project)}


def main():
    source = sys.stdin.buffer.read(MAX_INPUT + 1)
    require(len(source) <= MAX_INPUT, "reader input limit exceeded")
    cases = json.loads(source)
    require(isinstance(cases, list) and 0 < len(cases) <= 5000, "invalid reader case list")
    require(len({case["id"] for case in cases}) == len(cases), "duplicate reader ID")
    output = []
    for case in cases:
        try:
            output.append(verify(case))
        except Exception as error:
            output.append({"id": case.get("id"), "status": "FAIL", "error": type(error).__name__ + ": " + str(error)})
    json.dump({"format": "panelreply-independent-xlsx-results-v1", "results": output}, sys.stdout, ensure_ascii=True)


if __name__ == "__main__":
    main()
