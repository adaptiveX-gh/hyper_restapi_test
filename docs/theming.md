# Theming

This project uses CSS custom properties to drive light and dark themes. Base variables are defined in `public/css/tokens.css` and overridden by adding the `theme-dark` class to `<body>`.

## Colour Mapping

| Literal Colours | Token |
| --- | --- |
| `#ffffff`, `#fff` | `var(--bg-0)` |
| `#f7f7f7`, `#fafafa`, `#f0f0f0` | `var(--bg-1)` |
| `#e9ebef`, `#ddd`, `#dcdcdc` | `var(--bg-2)` |
| `#28c76f` | `var(--up)` |
| `#ff5252`, `#ff4d4d` | `var(--down)` |
| `#d0d5da`, `#e5e7eb` | `var(--border)` |

Extend this table as new colours are tokenised.
