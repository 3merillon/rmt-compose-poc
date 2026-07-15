# Third-Party Notices

RMT Compose is released under the [MIT License](LICENSE.md). The project's own
source code is MIT-licensed. It bundles or depends on the third-party components
listed below, each governed by its own license. Nothing here modifies the MIT
license that applies to this project's code.

## Runtime dependencies (application)

### fraction.js
- **License:** MIT
- **Copyright:** Copyright (c) Robert Eisele (https://raw.org/)
- **Project:** https://github.com/rawify/Fraction.js
- Exact-fraction arithmetic used throughout the expression evaluator.

## Bundled media assets

### Sampled instruments — piano, violin
- **License:** CC0 1.0 Universal (public domain dedication)
- **Source:** VSCO-2 Community Edition (VS Chamber Orchestra: Community Edition) —
  https://github.com/sgossner/VSCO-2-CE
- **Credit (not required by CC0, given as good practice):** Versilian Studios —
  recorded by Sam Gossner & Simon Dalzell; sample cutting by Elan Hickler /
  Soundemote.
- Files live in `public/samples/`; see `public/samples/CREDITS.md` for build
  details. The audio was downmixed to mono, trimmed, length-capped, and encoded
  to AAC by `scripts/build-samples.mjs`.

### Roboto Mono (application UI font)
- **License:** Apache License 2.0
- **Source:** Google Fonts — https://fonts.google.com/specimen/Roboto+Mono
- Loaded at runtime from the Google Fonts CDN (`public/styles.css`); not
  redistributed within this repository.

## Documentation site (docs.rmt.world)

The documentation site is built with [VitePress](https://vitepress.dev/)
(**MIT**) and its default theme ships the **Inter** typeface
(**SIL Open Font License 1.1**). These affect only the documentation build, not
the application.
