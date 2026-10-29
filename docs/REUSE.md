# Reuse and conformance provenance

No application source is vendored. Crypto-PAn, HMAC pseudonyms and Feistel permutations are implemented locally from the algorithm descriptions. Crypto-PAn uses WebCrypto AES-CBC with a zero IV and retains only the first ciphertext block; PKCS#7's extra block is discarded.

The active conformance test transcribes the public yacryptopan README example: raw ASCII key `32-char-str-for-AES-key-and-pad.` and `192.0.2.1` → `192.0.125.244`. Source to verify at runtime admission: the yacryptopan package README <https://pypi.org/project/yacryptopan/>. Attribution records the planned reference; no upstream code was fetched or executed during source-only construction.

The second planned vector is Yawning's cryptopan sample `128.11.68.132` → `135.242.180.132`, with key prefix `21, 34, 23, 141`. The full 32-byte key MUST be copied from the pinned upstream source at validation, never reconstructed or invented. Its test remains skipped until that prerequisite is met. Reference: <https://github.com/Yawning/cryptopan>. Pin the exact source revision and record its hash with the validation receipt before enabling the vector.

The seeded PRNG/bootstrap design is an in-place implementation; S3/S8/S26/M7 contributed ideas only. No dependency, algorithm correctness, cryptographic claim, output safety or runtime performance has been validated in Dirty Mode. These transforms are synthetic experimental arms, not a promise that real configurations are safe to share.
