# Activity Ledger

Fresh events arrive sharply while older entries compact

Keywords: activity, events, ledger, timeline, live updates, audit trail, freshness, compacting, event log, stream, realtime, history

## CSS

```css
.ledger div {
  animation: ledger-age 4.6s cubic-bezier(.16,1,.3,1) infinite;
}
.ledger div:nth-child(2) { animation-delay: -.9s; }
.ledger div:nth-child(3) { animation-delay: -1.8s; }
@keyframes ledger-age {
  0% { opacity: 0; transform: translateY(-10px) scale(1.03); }
  18%, 58% { opacity: 1; transform: none; }
  100% { opacity: .22; transform: translateY(5px) scale(.95); }
}
```

## Prompt guidance

Design a live activity ledger where each incoming event lands crisply at the top, holds, then becomes quieter and slightly denser as it ages. Stagger three rows in one continuous cycle and use a moving edge dot to distinguish event freshness from a normal static timeline.
