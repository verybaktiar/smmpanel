# Circuit Breaker

A physical arm throws closed, open, then half-open to probe

Keywords: resilience, fault, trip, open closed, half open, probe, failure, hystrix, retry, outage, switch, protect

## CSS

```css
.breaker-arm {
  transform-origin: 8px 50%;
  animation: throw 6.8s cubic-bezier(.34,1.56,.64,1) infinite;
}
@keyframes throw {
  0%, 18%  { rotate: 0deg; }    /* closed */
  28%, 48% { rotate: 78deg; }   /* open */
  58%, 74% { rotate: 38deg; }   /* half-open probe */
  86%, 100%{ rotate: 0deg; }
}
```

## Prompt guidance

Visualise a circuit breaker as a physical throw switch, not a spinner. Three LEDs (closed / open / half-open) light in lockstep with a pivoted arm that slams open, rests at a half-open probe angle, then springs closed again. Status copy swaps CLOSED, OPEN, HALF. The overshoot on the throw is the point — it should feel like a breaker, not a toggle.
