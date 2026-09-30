# Typing Indicator

Three dots bounce in sequence, chat-style

Keywords: chat, messaging, dots, someone typing, conversation, bubble, whatsapp, imessage, live, presence, waiting, reply

## CSS

```css
.typing span {
  animation: bounce 1.2s ease-in-out infinite;
}
.typing span:nth-child(2) { animation-delay: 0.16s; }
.typing span:nth-child(3) { animation-delay: 0.32s; }
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0);    opacity: 0.4; }
  30%           { transform: translateY(-7px); opacity: 1; }
}
```

## React

```jsx
function TypingDots() {
  return (
    <div className="typing">
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a chat "typing…" indicator: a rounded bubble (with one squared corner) holding three dots. Animate each dot on an infinite 1.2s ease-in-out loop that lifts it ~7px and brightens opacity at the 30% mark, otherwise resting low and dim. Stagger the three dots by ~0.16s so the bounce travels left to right.
