# Tailwind Helpers

Custom classes used across the project are defined in `src/css/tailwind.css`.

## Components

### `.glass-card`
A reusable frosted card with subtle blur, border and rounded corners.

```
@apply backdrop-blur-sm bg-surface-1/40 border border-border/50 rounded-3xl;
```

## Utilities

### `.skeleton`
Creates a pulsing placeholder bar that inherits theme colours.

```
@apply animate-pulse bg-surface-2/50 text-transparent;
```
