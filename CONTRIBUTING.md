# Contributing to Bandstand

> This file is being built out across Milestone 0. Setup instructions,
> the Definition of Done, and the "add a feature end-to-end" walkthrough
> land in a later step of this milestone.

## Working with long standard-license/policy texts

When a file needs to contain a long, standard, third-party legal or policy
document verbatim (an OSS license full text, the Contributor Covenant, a
CLA template, etc.), **fetch it from its canonical source instead of typing
it out by hand** — e.g.:

```bash
curl -sSLo LICENSE-APACHE https://www.apache.org/licenses/LICENSE-2.0.txt
curl -sSLo LICENSE-AGPL   https://www.gnu.org/licenses/agpl-3.0.txt
```

This avoids transcription mistakes in legally sensitive text and is simply
more reliable than reproducing a long standard document from memory.
Short, project-specific snippets (an SPDX header line, a short original CLA
clause) are fine to write directly.
