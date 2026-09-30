# Stale While Revalidate

The old value ghosts as the fresh one springs into place

Keywords: swr, cache, stale, revalidate, fresh, react query, tanstack, next.js, local first, ghost value, fetch, http cache

## CSS

```css
.swr span { animation: stale-ghost 4.8s cubic-bezier(.16,1,.3,1) infinite; }
.swr strong { animation: fresh-in 4.8s cubic-bezier(.34,1.56,.64,1) infinite; }
@keyframes stale-ghost {
  0%, 18% { opacity: 1; filter: none; }
  38%, 72% { opacity: .22; filter: blur(1.5px); transform: translateX(-10px) scale(.92); }
  88%, 100% { opacity: 1; filter: none; }
}
@keyframes fresh-in {
  0%, 28% { opacity: 0; transform: translateX(14px) scale(.86); }
  46%, 78% { opacity: 1; transform: none; }
  92%, 100% { opacity: 0; }
}
```

## Prompt guidance

Show a stale-while-revalidate cycle. The current number stays on screen as STALE, then ghosts left and blurs while FETCH is active. The new number springs in from the right and a FRESH chip lights. Keep both values in the same slot so it reads as one datum being replaced, not two counters. Loop calmly — this is cache policy, not an error.
