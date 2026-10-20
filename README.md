# STUDT-HUB-RESOURCES-2026

## Resource organization

Study resources are stored under `<mock body>/<year>/<filename>`. The organizer uses filename matches for the listed Ugandan mock bodies and explicit years. Files that cannot be confidently matched are kept under `General - Unclassified`; filenames without a year go under `Undated`. Files with both `sample` and `UNEB`, `UCE`, or `UACE` in the filename are placed under `Sample UNEB Papers/<year>`.

`resource-catalog.json` is the generated index of every resource, including its repository path, public URL, body, year, subject, and resource type. Study Hub uses this catalog for the **2026 trending** library tile; that tile includes only resources whose filenames identify 2026.

To organize new files and regenerate the catalog, run from the repository root:

```powershell
node scripts/organize-resources.mjs
```

To import files from a source folder without overwriting different files already in the archive:

```powershell
node scripts/organize-resources.mjs --import-dir "I:\phone doc\premium current\2026"
```

The importer uses each source subfolder to supply a year when a filename has no year, identifies mock bodies and class levels from filenames, skips empty files, and keeps distinct files with the same name by adding a `(2026 import)` suffix. Every catalog item includes `classKeys`; resources without a recognizable class are assigned to the `unsorted` library tile.

To validate the folders and catalog without moving or writing anything:

```powershell
node scripts/organize-resources.mjs --check
```

The organizer requires Node.js 20 or newer. On Windows it uses the built-in PowerShell file API so filenames containing emoji are handled correctly.