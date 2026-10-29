# Frozen execution inputs

No experiment has run. G0, G1 and G2 are PENDING. The builder never opens the held-out vault.

After Roy closes Dirty Mode and appoints the independent author, `freeze-check --g1 VAULT` verifies all bytes against `gold/heldout/MANIFEST.sha256`. `--preflight` also checks non-label structure while hashing labels only. Receipts expose IDs, roles and hashes only. `preregister VAULT COMMIT TAG PUBLIC-CHOICES.json` creates immutable corpus/preregistration files; choices contain seeds, public probe pairs, frozen pool IDs, exact recorded argument arrays and normaliser version. No builder-authored choices are evidence of Roy admission.

`g0-admission.json` is supplied only after the G0 checklist is fulfilled: status pass, dated verbatim Roy R1/R2 approvals (`royR1`, `royR2`), independently appointed author callsign (`author`), and evidence SHA-256 array (`evidenceSha256`). No such record is supplied in construction. Candidate tag must be a lightweight tag resolving to the exact HEAD commit. CLI code uses filesystem reads only.

`heldout-opened.json` is reserved with exclusive creation before any held-out label read. A second confirmatory execution is refused; byte-identical re-rendering uses existing result bytes. New code, inputs, keys or tools require an exploratory run or a fresh independent set.
