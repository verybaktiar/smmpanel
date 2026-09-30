# Scramble Reveal

Cycles random glyphs before settling left-to-right

Keywords: text effect, decode, matrix, hacker, glyphs, randomize, terminal, reveal, cipher, decrypt, headline, typing

## CSS

```css
/* Mostly JS-driven: interval swaps each character
   for a random glyph, then locks left-to-right
   once a per-character frame threshold is passed. */
.scramble {
  font-family: monospace;
  letter-spacing: 0.02em;
}
```

## React

```jsx
const CHARS = '!<>-_/[]{}=+*^?#';

function useScramble(text) {
  const [display, setDisplay] = useState(text);
  const play = () => {
    let frame = 0;
    const total = 24;
    const id = setInterval(() => {
      frame++;
      setDisplay(text.split('').map((c, i) => {
        if (c === ' ') return ' ';
        const progress = frame - i * 1.2;
        return progress > total * 0.6
          ? c
          : CHARS[Math.floor(Math.random() * CHARS.length)];
      }).join(''));
      if (frame > total + text.length) {
        clearInterval(id);
        setDisplay(text);
      }
    }, 35);
  };
  return [display, play];
}
```

## Prompt guidance

Build text that decodes from random glyphs into the final string, left to right. On trigger run an interval (~35ms) that swaps each not-yet-settled character for a random symbol, locking characters progressively based on frame count minus their index, then clear the interval and show the final text.
