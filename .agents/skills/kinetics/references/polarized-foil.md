# Polarized Foil

A muted spectrum appears only at grazing angles

Keywords: foil, holographic, iridescent, spectrum, angle, shimmer, card finish, metallic, rainbow, premium, trading card, gloss

## CSS

```css
.foil::before { background: conic-gradient(from var(--angle), ...); mix-blend-mode: screen; }
.foil:hover { transform: perspective(500px) rotateY(-13deg); }
```

## Prompt guidance

Design a dark polarized foil surface. Keep its spectrum nearly invisible head-on; on hover tilt the panel and sweep a narrow, desaturated conic highlight across it, like security foil seen at a grazing angle.
