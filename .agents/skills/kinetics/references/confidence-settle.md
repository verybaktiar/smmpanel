# Confidence Settle

A score overshoots, then settles on the true value

Keywords: confidence, score, ai certainty, meter, overshoot, settle, percentage, ranking, probability, gauge, metric, trust

## CSS

```css
.fill {
  background: linear-gradient(90deg, #5b8def, #4cd08a);
  animation: settle 2.8s cubic-bezier(0.34,1.56,0.64,1) infinite;
}
@keyframes settle {
  0% { width: 0; }
  55% { width: 96%; }
  72%, 100% { width: 87%; }
}
```

## Prompt guidance

Create a confidence meter for AI or ranking UIs. Animate a gradient fill that races past the target, then eases back to the final percentage with a spring. Update a tabular mono readout in lockstep so the number feels measured, not gimmicky.
