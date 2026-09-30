# Pulse Badge

Expanding ring draws the eye to new state

Keywords: notification dot, alert, new, unread, attention, ping, ring, indicator, live, online, presence, radar

## CSS

```css
.badge::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #ff8a00;
  animation: pulse 1.8s ease-out infinite;
}
@keyframes pulse {
  0%        { transform: scale(1);   opacity: 0.7; }
  70%, 100% { transform: scale(2.6); opacity: 0; }
}
```

## React

```jsx
function PulseBadge({ children }) {
  return (
    <span className="wrap">
      {children}
      <span className="dot" />
      <span className="dot pulse" />
    </span>
  );
  // .pulse animates scale(1 -> 2.6) + opacity(0.7 -> 0)
}
```

## Prompt guidance

Add a small accent notification dot to a bell icon, then layer a second copy behind it that pulses outward forever: scale(1) to scale(2.6) while fading opacity 0.7 to 0 on a 1.8s ease-out loop. The solid dot stays put while the ghost ring radiates, signalling an unread/new state without any interaction.
