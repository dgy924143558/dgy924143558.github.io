# Multilingual homepage

- English: `index.html` (root homepage).
- Simplified Chinese: `zh/index.html`.
- Japanese: `ja/index.html`.
- Shared layout: `homepage.css`; publication filters and year sorting: `homepage.js`.
- Keep navigation, news, metrics and publication records synchronized across all three HTML files. Each page is fully readable without JavaScript; filters are enabled only when their script loads.
- Subdirectory pages use `../` for shared assets and the existing `pesa2026/` page. Language links work on both GitHub Pages and a local static server.
- The original 30 publication/MISC records and three patent records are retained. Six journal articles, 14 conference papers and 10 other works can be filtered independently. Undated publications sort last in both directions.
- Skills remain removed. Previous Research stays in a hidden container for future recovery.
- The profile photo remains `images/DONG1.png`; `images/favicon-transparent.png` is its transparent-background favicon variant.

## Dated data

Google Scholar metrics are a **manual snapshot**, not a live feed. Update the values, recent-period heading and observation date together in all three pages. Snapshot on 2026-11-21: 121 citations, h-index 6, i10-index 4; the same values in the profile's “Since 2021” column.

Sources:

- Scholar: https://scholar.google.com/citations?user=78R3cokAAAAJ&hl=en
- New patent application JP2026-121063A, filed 2025-01-10, published 2026-07-23: https://jglobal.jst.go.jp/detail?JGLOBAL_ID=202603000875945375
- Official X posts about PESA research, dated 2026-11-12 in Japan (2026-11-11 UTC): https://x.com/TOYOTA_FRC/status/2120654051348226447 and https://x.com/TOYOTA_FRC/status/2120654302628954167
- TPEL award month (2025-10): https://jglobal.jst.go.jp/detail?JGLOBAL_ID=202501003897972532
- ITEC-AP dates: https://www.itec-ap2025.com/?page_id=248
- IEEJ award years: https://www.iee.jp/ias/about/award/paper2023/ and https://www.iee.jp/ias/about/award/paper2022/

News is ordered newest first in the HTML. Retain date precision from the source; the IEEJ entries specify award years. Patent publication is not presented as a granted patent.

All homepage rendering assets are local. X and Scholar use summaries/snapshots with outbound links, with no remote embeds required to read the homepage. Outbound services may have their own regional availability limits.

## Preview

Run `python -m http.server 8765` from the repository root, then open `http://localhost:8765/`. Check all three language paths, publication checkbox combinations, ascending/descending sorting, and widths of 320, 375, 768 and 1440 pixels.
