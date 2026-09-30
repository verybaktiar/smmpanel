# Signal Braille

A tactile dot matrix encodes live system phases

Keywords: dots, matrix, status grid, phases, system state, encode, tactile, cells, blink, pattern, telemetry, indicator

## CSS

```css
.braille span { animation: cell 2.1s steps(1) infinite; }
.braille span:nth-child(2n) { animation-delay: -.7s; }
```

## Prompt guidance

Build a six-dot status matrix inspired by Braille. Different dots illuminate in discrete timed phases to encode changing machine state, with a quiet READY label beneath. Avoid spinner and equalizer conventions.
