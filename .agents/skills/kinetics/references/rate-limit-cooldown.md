# Rate Limit Cooldown

A token bucket empties fast, then refills on a slow drip

Keywords: rate limit, throttle, 429, quota, api limit, token bucket, cooldown, backoff, credits, usage, retry after, budget, requests, capacity

## CSS

```css
.ratelimit-tokens i { animation: token-cycle 6.4s linear infinite; }
.ratelimit-tokens i:nth-child(2) { animation-delay: .16s; }  /* spend: fast */
.ratelimit-tokens i:nth-child(5) { animation-delay: .64s; }
@keyframes token-cycle {
  0%, 6%   { opacity: 1; transform: scale(1); }
  12%      { opacity: .1; transform: scale(.55); }  /* spent */
  55%      { opacity: .1; transform: scale(.55); }  /* throttled */
  70%      { opacity: 1; transform: scale(1.18); }  /* refilled */
  78%, 100%{ opacity: 1; transform: scale(1); }
}
```

## Prompt guidance

Show a token-bucket rate limiter as a state animation. Five pips are spent left to right in quick succession, the status flips from a calm 200 to a warning 429, and a cooldown arc sweeps once. Then the pips return one at a time on a slow, uneven drip with a small overshoot as each is credited. The asymmetry is the point: spending is instant, recovery is patient.
