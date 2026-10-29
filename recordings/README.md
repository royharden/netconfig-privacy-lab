# Offline recording bundles

No recordings exist and no comparator has run. Future validated bundles belong at `<tool>/<arm>/<split>/<caseId>.json`. They follow `schemas/recording.schema.json` and `docs/RECORDING.md`. Missing or rejected evidence is `not_run`, never zero. Recordings contain synthetic raw answers and synthetic config bytes; aggregate exports must exclude these bundles.
