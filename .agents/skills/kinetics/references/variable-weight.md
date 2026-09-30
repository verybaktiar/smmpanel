# Variable Weight

Type densifies from thin to black on hover

Keywords: variable font, font weight, typography, morph, letter spacing, display type, hover text, headline, kinetic type, weight axis, editorial, type

## CSS

```css
.word {
  font-weight: 200;
  letter-spacing: .04em;
  transition: font-weight .55s cubic-bezier(0.16,1,0.3,1),
              letter-spacing .55s cubic-bezier(0.16,1,0.3,1);
}
.word:hover {
  font-weight: 800;
  letter-spacing: -.02em;
  color: var(--amber);
}
```

## Prompt guidance

Animate a display word using variable font weight. Idle at weight 200 with open tracking; on hover glide to weight 800 with tighter letter-spacing and a soft amber glow. Prefer a long ease-out curve so the densification feels typographic, not bouncy.
