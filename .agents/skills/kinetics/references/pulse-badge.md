# Pulse Badge

A notification dot emits expanding rings forever — pure CSS

Keywords: notification dot, alert, new, unread, attention, ping, ring, indicator, live, online, presence, radar

## CSS

```css
.badge { position: relative; }
.badge::before, .badge::after {
  content: '';
  position: absolute; inset: 0;
  border-radius: 50%;
  border: 2px solid #FF8A00;
  animation: pulse-ring 1.8s ease-out infinite;
}
.badge::after { animation-delay: 0.9s; }
@keyframes pulse-ring {
  0%   { transform: scale(1); opacity: 0.7; }
  100% { transform: scale(2.4); opacity: 0; }
}
```

## React

```jsx
function PulseBadge({ count }) {
  // Pure CSS: two ::before/::after rings scale out and fade,
  // offset by half the duration so a ring is always traveling.
  return (
    <span className="badge">{count}</span>
  );
}
/* pair with the .badge ::before / ::after rules in the CSS tab */
```

## Prompt guidance

Build a notification badge that radiates expanding rings, pure CSS. Put two ::before/::after rings on the badge that animate from scale(1)/opacity 0.7 to scale(2.4)/opacity 0 on an ease-out infinite loop (~1.8s), offsetting the second by half the duration so a ring is always traveling outward.
