# Reconciliation Merge

Competing values converge into one authoritative state

Keywords: reconcile, local first, edge, conflict, merge, authoritative state, sync, offline data, values, resolution, distributed, database

## CSS

```css
.sources span { animation: reconcile-in 3.4s var(--spring) infinite; }
.reconcile strong { animation: authority-in 3.4s var(--spring) infinite; }
@keyframes authority-in {
  0%, 42% { opacity: 0; transform: scale(.82); }
  58%, 84% { opacity: 1; transform: scale(1); }
}
```

## Prompt guidance

Show local-first data reconciliation. Two compact value chips approach from opposite sides, pause while a bridge scans between them, then dissolve into one authoritative SYNCED value. Keep the merge spatial and calm so it reads as data resolution rather than a generic success state.
