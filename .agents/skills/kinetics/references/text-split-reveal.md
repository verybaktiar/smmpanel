# Text Split Reveal

Each letter springs up in sequence on hover — pure CSS

Keywords: letters, stagger, character animation, hover text, split text, wave, typography, spring letters, playful, heading, bounce, title

## CSS

```css
.split {
  display: flex;
  overflow: hidden;
}
.split span {
  display: inline-block;
  transform: translateY(110%);
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.split span:nth-child(1) { transition-delay: 0ms; }
.split span:nth-child(2) { transition-delay: 40ms; }
/* ...increment 40ms per letter... */
.split.in span { transform: translateY(0); }
```

## React

```jsx
function TextSplit({ text }) {
  const [in_, setIn] = useState(false);
  return (
    <div
      className={in_ ? 'split in' : 'split'}
      onMouseEnter={() => setIn(true)}
      onMouseLeave={() => setIn(false)}
    >
      {text.split('').map((c, i) => (
        <span
          key={i}
          style={{ transitionDelay: `${i * 40}ms` }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a text reveal where each letter springs up from below a hidden mask in sequence, pure CSS. Wrap each character in a span inside a flex container with overflow:hidden so letters start hidden below the baseline (translateY(110%)). On hover add an .in class that sets translateY(0) with a spring cubic-bezier(0.34,1.56,0.64,1) and stagger the transition-delay by ~40ms per letter so they cascade in.
