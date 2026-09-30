# Presence Stack

Avatars fan out with a live online pulse

Keywords: avatars, online, collaborators, multiplayer, live, presence, stack, ping, users, team, status, realtime

## CSS

```css
.presence span { margin-left: -12px; border-radius: 50%; border: 2px solid #0e0e10; }
.presence span.live::after {
  content: "";
  position: absolute; right: 1px; bottom: 1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #4cd08a;
  animation: ping 1.8s ease-out infinite;
}
.presence:hover span { transform: translateY(-6px) scale(1.06); }
```

## Prompt guidance

Build a collaborative presence stack: overlapping circular avatars with a green online dot that soft-pings, plus a +N overflow chip. On hover the stack fans slightly apart with staggered lifts so the group feels alive and multiplayer.
