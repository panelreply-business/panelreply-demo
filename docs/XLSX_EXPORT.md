# Private panel project XLSX export

## Scope

The authenticated panel workspace can export the current **saved** project as an
XLSX workbook. CSV remains available. An XLSX download does not run OCR, save
edits, verify parts, contact a provider, or transmit data to a spreadsheet service.

The export contains two worksheets:

| Worksheet | Contents |
| --- | --- |
| Parts | Part number, manufacturer, description, quantity, source image filename, review status and notes |
| Project | Project name and ID, saved version, creation/save timestamps, notes, and the meaning of saved state and review status |

Project source image bytes, account details, credentials, intake records and
unrelated tenant data are excluded. Source filenames come only from the selected
project. `Reviewed` records a human check, not part authenticity, compatibility,
installation suitability or measured OCR accuracy.

## Runtime implementation

`workspace/xlsx.cjs` exports `exportProjectXlsx(savedProject)` and `XLSX_MIME`.
The exporter uses Node built-ins and the existing panel validation module. It
adds no runtime package, external download, network call, subprocess or service.

The deliberately bounded writer produces a small OOXML package with eight fixed
ZIP member paths. It writes stored entries, CRC32 values and a fixed ZIP timestamp.
It never parses uploaded ZIP files, accepts ZIP entry names from users, compresses
user input or writes temporary files. Exporting the same saved record produces
the same bytes. The existing limits of 200 rows, five source records and bounded
text fields apply. The final workbook cannot exceed 4 MiB.

This is not a general-purpose spreadsheet library. Adding charts, formulas,
arbitrary sheets or workbook import requires a separate design review. A maintained
library can replace this module later while preserving its independent reader
tests and route contract.

Both worksheets have a frozen header, explicit column widths, wrapped text and a
navy header. The Parts worksheet has a filter over its saved rows. Quantities use
numeric cells with an integer format. Every other field uses an explicit string
cell with text format, including saved version metadata. This preserves leading
zeros, long identifiers and number- or date-looking part numbers without numeric
coercion. Formula-like strings remain text. No formula, macro, external
relationship, hyperlink action or embedded image is generated.

## Route and session boundary

The private route is:

```text
GET /api/panel-projects/:id/export.xlsx
```

`workspace/api.cjs` is responsible for session authentication, workspace pinning
and the tenant-scoped store lookup. The exporter receives that saved project,
not a browser-supplied project payload. The response uses the XLSX MIME type,
no-store policy and a UUID-based attachment filename. Unknown or cross-tenant
project IDs must continue to return the same not-found response as CSV.

The UI enables export only for an open saved project. If edits have not been
saved, the feedback states that the download contains the saved version. It does
not silently save the draft. Both export buttons are disabled while a request is
in progress. A failed export can be retried.

Before creating the download URL, the client checks the response MIME type and
nonempty body, then rechecks the pinned session. A change of account between the
response and download must not expose stale workspace data. A failed browser
download action revokes its object URL. Success feedback says the file was
prepared, since the website cannot prove the operating system saved it.

## Text preservation and spreadsheet safety

XML delimiters are escaped. XML character references preserve carriage returns
in the generated file. Spaces, commas, quotes, tabs, Unicode, line feeds and
carriage returns are checked with independent readback. The workbook does not
prefix corrected values with an apostrophe to prevent formulas. Their explicit
string cell type provides the separation from executable formula cells.

Literal OOXML escape-looking text needs special handling. For example, a part
number can literally contain `_x0041_`. Ordinary shared strings escape those
tokens. The openpyxl 3.1.5 default shared-string reader also removes literal
`x005F_` sequences. Affected fields use inline rich-text cells with escape-looking
tokens split across text runs. The displayed text and formatting remain the
same. This preserves the saved text when the original file is read by openpyxl
and when imported by the tested LibreOffice build.

XML 1.0 cannot represent some characters. A saved U+FFFE or U+FFFF value causes a
typed HTTP 422 `xlsx_invalid_data` error with an instruction to review the text or
use CSV. The exporter does not strip or replace that value. Other invalid control
characters, malformed Unicode and invalid panel records remain subject to the
existing validation rules. CSV remains available when a field cannot be encoded
in XLSX.

## Verification performed on 2026-11-19

These are synthetic-data results from local checks and isolated CI. They are not
claims about Microsoft Excel, live customer data or a public deployment.

| Check | Result | Evidence |
| --- | --- | --- |
| Runtime writer component tests | PASS, 13 tests | `node --test tests/panel-xlsx.test.cjs` |
| Independent ZIP, XML and openpyxl readback of the original files | PASS, 9 fixtures | `python scripts/test-xlsx-reader.py`, openpyxl 3.1.5 |
| Existing client-state tests after export UI changes | PASS, 6 tests | `node --test tests/platform-client-state.test.cjs` |
| Browser tests for XLSX interactions | PASS, seven cases in each of three engines | [Run66](https://github.com/panelreply-business/panelreply-demo/actions/runs/44634698683), source 17223d6; Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5 |
| Session, tenant and actual browser/HTTP boundary | PASS for executed cases | Two focused in-process export cases and the real private-server browser suites in run66 |
| Microsoft Excel desktop/web opening and saving | NOT TESTED | No Excel instance was used |

The nine workbook fixtures cover an empty project, leading-zero and number-like
identifiers, Unicode and whitespace, formula-looking values, literal OOXML escape
syntax, source names/review states/quantity bounds, missing values, maximum saved
version, and all 200 rows at the field limits. Each original file is opened with
Python's ZIP reader and XML parser, then openpyxl. Every expected cell value and
type is compared. Tests also check headers, frozen panes, filtering, column width,
text formats, CRCs and the absence of formulas and external links.

The seven browser cases exercise saved corrected values after reopening, unsaved
draft exclusion, interrupted binary responses and retry, MIME/empty-body errors,
account changes during download, object URL cleanup after an anchor failure, and
the explicit XML-character error with a working CSV fallback. Run66 executed and passed all seven cases in Chromium, Firefox and WebKit.
Earlier runs exposed callback errors in the test harness before some assertions
ran. Those errors were corrected without removing assertions. See the
[progress record](DEVELOPMENT_PROGRESS.md) for exact source and CI provenance.

## Additional spreadsheet engine observations

The generated files were also opened and rewritten by the installed
`LibreOfficeDev 26.8.0.0.alpha0`, build
`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`. This is a development build, not a
claim of compatibility with a released LibreOffice version or Microsoft Excel.

All nine files opened and converted without a reported conversion error. On
reading LibreOffice's rewritten XLSX files with openpyxl, seven fixtures retained
every nonempty value and its text/numeric type. LibreOffice rewrote blank string
cells as empty cells. Two fixtures exposed additional consumer behavior:

- LibreOffice normalized CR and CRLF within cells to LF when importing the
  Unicode/whitespace fixture. The original generated XLSX retains all three line
  ending forms and passes exact openpyxl readback. An application that requires
  byte-exact text should retain the original export and saved project record.
- LibreOffice's subsequent XLSX save changed how literal escape-like strings were
  represented. The default openpyxl shared-string reader then changed several
  values. A direct CSV export from the original workbook through LibreOffice
  confirmed that initial import preserved every literal token, including
  `_x005F_`, `_x005F_x0041_` and bare `x005F_`. The separate
  LibreOffice-save/openpyxl-read chain does not pass exact token preservation.

The combined cross-application save/read round trip is therefore **not a universal
PASS**. These limits do not justify changing or truncating saved project text.
The application generates an exact typed export within the tested reader
boundary. It cannot guarantee that every spreadsheet editor preserves values
after editing or resaving them.

## Reproduce the checks

Use the repository's approved Node version and test-only openpyxl 3.1.5. No
spreadsheet package is required by the deployed Node application.

```sh
node --test tests/panel-xlsx.test.cjs tests/platform-client-state.test.cjs
python scripts/test-xlsx-reader.py
python tests/xlsx_browser_test.py
```

The browser command requires the existing local-server and Playwright test
environment. Do not work around an environment that blocks those capabilities.
Run it in the existing CI job instead. The fixtures are defined in
`tests/fixtures/xlsx-projects.cjs`, and the independent Python script demonstrates
how to generate the original bytes through Node without authoring a workbook in
Python. Optional native spreadsheet checks must record the application/version,
the imported original file and whether the result was measured before or after
that application resaved it.

## References and future gates

The package follows the fixed subset described by
[ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/).
Microsoft documents
[shared-string tables](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table)
and
[inline rich-text strings](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.inlinestring?view=openxml-3.0.1).
The independent reader checks actual exported bytes instead of relying solely on
the same code that generated them.

Before claiming wider compatibility, test representative exports in the supported
released spreadsheet applications, including literal tokens and multiline text.
Before customer use, complete the broader private-hosting, retention, backup,
account-recovery and deployment gates. This module does not authorize a merge,
public deployment, integration activation or a change to either suspended Render
service.
