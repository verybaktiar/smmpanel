# Typewriter

Types and deletes through a list with a blinking caret

Keywords: typing, text animation, hero, headline, terminal, caret, cursor, rotating words, delete, cycle, prompt, intro

## CSS

```css
.caret {
  display: inline-block; width: 2px; height: 1.1em;
  background: #FF8A00;
  animation: blink 1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
/* JS advances one character every ~55ms, pauses at the end
   of a phrase, then backspaces and moves to the next. */
```

## React

```jsx
function Typewriter({ phrases }) {
  const [text, setText] = useState('');
  const i = useRef(0), c = useRef(0), del = useRef(false);

  useEffect(() => {
    let id;
    const loop = () => {
      const word = phrases[i.current];
      setText(word.slice(0, c.current));
      let wait = 55;
      if (!del.current && c.current < word.length) c.current++;
      else if (!del.current) { del.current = true; wait = 1100; }
      else if (c.current > 0) { c.current--; wait = 30; }
      else { del.current = false; i.current = (i.current + 1) % phrases.length; wait = 320; }
      id = setTimeout(loop, wait);
    };
    loop();
    return () => clearTimeout(id);
  }, [phrases]);

  return <span>{text}<span className="caret" /></span>;
}
```

## Prompt guidance

Build a typewriter that types a phrase, pauses, deletes it, and advances to the next, looping forever. Type one character every ~55ms and delete every ~30ms, pause ~1.1s at the full phrase, and show a blinking caret via a CSS steps() animation.
