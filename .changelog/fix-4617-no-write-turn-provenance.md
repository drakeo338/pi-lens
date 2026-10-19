---
section: Fixed
audience: user
---

- **Turn-end advisories no longer read as historical after a no-write turn (closes #4617)** — A turn that wrote no file, such as a bash-only turn, records provenance with an empty file list. The validator treated that as malformed or legacy provenance, so a same-turn advisory was labelled "Historical finding". An empty file list with a well-formed revision now validates as current, and the session check still applies.
