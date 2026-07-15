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

Sources were downmixed to mono, leading silence trimmed, length-capped with a
short tail fade, and encoded to AAC (`.m4a`, ~96 kbps) for broad browser
`decodeAudioData` support (Safari can't decode Ogg/Opus). CC0 imposes no
attribution requirement; this credit is provided as good practice.
