# Change Log - lsbranch

This log was last generated on Mon, 09 Nov 2026 02:17:09 GMT and should not be manually modified.

## 0.5.0
Mon, 09 Nov 2026 02:17:09 GMT

### Minor changes

- Default to listing branches when no action is specified.
- Read local branches from Git metadata without subprocesses.
- Add `find --branch` to locate clones containing local branches matching a name or shell-style glob, including branches that are not checked out.
- Add remove `--path` or `--alias` to unregister a clone without deleting its files.
- Group clones by common Git directory or matching remote URLs, sort aliases alphabetically, and warn about ambiguous grouping.

### Patches

- Require non-empty, absolute repository paths in configuration. Paths passed to `lsbranch add` are resolved automatically.

## 0.4.2
Tue, 30 Sep 2025 15:52:42 GMT

### Patches

- Update dependencies.

