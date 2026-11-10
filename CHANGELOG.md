# Changelog

## 0.1.0 — 2026-11-09

The first version. In short (the README tells the whole):

- **Tables and databases in.** CSV and TSV (separator and encoding recognised, so
  Excel's German CSV keeps its umlauts), Excel and OpenDocument workbooks (every
  sheet a table), JSON records; Access databases (`.accdb`, `.mdb`) and PostgreSQL
  dumps in plain SQL (COPY or `--inserts`, PostGIS geometries as WKT). Everything is
  read in the browser; nothing leaves the computer.
- **What a database declares is applied, what is guessed is suggested.** Primary
  keys, unique keys and relationships come along from Access and PostgreSQL and
  shape the graph at once. In plain tables, keys, labels and their languages,
  references between tables, shared values, link tables and lists in one cell are
  read from names and values and offered as suggestions, one by one or all at once.
  For the example excavation, accepting the suggestions is all it takes.
- **One gesture.** Drag a column onto a column: onto another table, and both name
  the same thing; within one table, and they become an edge. The inspector decides
  how each column is read; the resulting graph is drawn beside the tables. Undo and
  redo for every step.
- **The Harris matrix.** Stratigraphic relations from a relation table or from
  columns of the unit table ("liegt über", several units in one cell), phases and
  their order, objects and groups, unit types mapped onto those of the Harris Matrix
  Editor. They become the matrix the GraphExplorer draws and the OntoGraphNavigator
  edits.
- **Out.** A Graph JSON for the GraphExplorer and a project file for OntoCartographer
  Studio and the OntoGraphNavigator. The graph is built by the OntoGraphNavigator's
  own code (a copy in `src/core/`), so both tools always build the same graph.
- **Reusable.** The sketch is saved without the data and opens again on the same
  tables or a newer export of them; renamed tables are found by their columns. A
  copy of the last sketch stays in the browser.
- **A standalone file** (`npm run build:standalone`, about 1 MB) runs by
  double-click, without Node.js and without a network.

Not yet: password-protected `.accdb` files (remove the password in a copy),
columns that hold files (OLE objects, attachments, `bytea`; left out with a
message), archives from `pg_dump -Fc` or pgAdmin's backup (turned away with the
command that makes plain SQL of them).

Tested on the fictional excavation *Serpent's Meadow* in `0_exampleData/`: as CSV,
Excel, Access (`.accdb`, `.mdb`) and PostgreSQL dump, every cell, key and
relationship is read the same way; 8 test suites with about 470 checks, and the
standalone file driven in Chrome the way a person would use it.

Next: SQLite and GeoPackage; a handover package with the tables for the Studio.
