# Trace Flame

A request paints as stacked spans filling left to right

Keywords: flamegraph, distributed trace, spans, observability, opentelemetry, jaeger, waterfall, latency, request, profiling, apm, timing

## CSS

```css
.flame-row { width: var(--w); }
.flame-row i {
  transform-origin: left center;
  animation: span-fill 5.4s cubic-bezier(.16,1,.3,1) infinite;
}
.flame-row:nth-child(2) i { animation-delay: .28s; }
.flame-row:nth-child(3) i { animation-delay: .56s; }
@keyframes span-fill {
  0%, 8%  { transform: scaleX(0); }
  28%, 72%{ transform: scaleX(1); }
  88%, 100%{ transform: scaleX(0); }
}
```

## Prompt guidance

Draw a tiny distributed-trace flamegraph. Three nested spans (gateway, worker, db) of decreasing width fill from the left in sequence, each a different heat colour. A monospaced duration ticks to 69ms when the last span lands. This is a waterfall of work, not a progress bar — keep the rows stacked and left-aligned so parent and child are obvious.
