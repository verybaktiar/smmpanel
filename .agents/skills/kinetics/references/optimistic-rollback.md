# Optimistic Rollback

An instant local update gracefully retracts after rejection

Keywords: optimistic ui, rollback, server rejection, local first, toggle, syncing, restore, failure, revert, async state, latency, settings

## CSS

```css
.optimistic-toggle {
  animation: optimistic-toggle 4s cubic-bezier(.34,1.56,.64,1) infinite;
}
@keyframes optimistic-toggle {
  0%, 12% { transform: translateX(0); }
  24%, 62% { transform: translateX(26px); }
  76%, 100% { transform: translateX(0); }
}
```

## Prompt guidance

Visualize an optimistic UI update: a setting turns on immediately, reports APPLIED, waits in SYNCING, then softly rolls back to RESTORED when the server rejects it. Use restrained status colour, spring the toggle both ways, and avoid an aggressive error shake.
