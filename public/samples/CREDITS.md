# Sample Credits

The built-in sampled instruments are derived from open, clearly-licensed sources
and rebuilt by `scripts/build-samples.mjs`.

## Piano ("piano") & Violin ("violin")

- **Source:** VSCO-2 Community Edition (VS Chamber Orchestra: Community Edition)
- **License:** CC0 1.0 (public domain dedication)
- **Credit:** Versilian Studios — recorded by Sam Gossner & Simon Dalzell; sample
  cutting by Elan Hickler / Soundemote
- **URL:** https://github.com/sgossner/VSCO-2-CE
- Piano: "Upright Nr1"; Violin: "Solo Violin — Arco Vib" (sustained).

Sources were downmixed to mono, leading silence trimmed, and encoded to AAC
(`.m4a`, ~96 kbps) for broad browser `decodeAudioData` support (Safari can't
decode Ogg/Opus). Piano recordings are kept until they decay below -66 dBFS (at
most 20 s); violin recordings are capped at 3.5 s with a short tail fade. Each
zone's measured pitch (`tuneCents`) and the piano's measured decay
(`decayT60`) are added to the manifests by `scripts/tune-samples.mjs`. CC0
imposes no attribution requirement; this credit is provided as good practice.
