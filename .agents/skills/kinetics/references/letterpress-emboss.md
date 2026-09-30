# Letterpress Emboss

Type sits in the paper and reads by the light angle alone

Keywords: letterpress, emboss, deboss, paper, print, tactile, stamped, relief, skeuomorphic, texture, engraved, typography, craft, physical

## CSS

```css
.letterpress span {
  color: transparent;
  background: linear-gradient(#00000012, #00000004);
  -webkit-background-clip: text;
  text-shadow:
    calc(var(--lx) * 1px) calc(var(--ly) * 1px) 1px rgba(255,255,255,.85),
    calc(var(--lx) * -1px) calc(var(--ly) * -1px) 2px rgba(60,40,20,.42);
  animation: press-light 7s ease-in-out infinite alternate;
}
.letterpress:hover span { scale: .992; filter: contrast(1.15); }
```

## Prompt guidance

Make type look physically stamped into warm paper. The glyphs themselves are nearly transparent — legibility comes only from a pale highlight on one side and a warm shadow on the other. Rotate that light source slowly so the relief reverses direction, and on hover deepen the impression by pressing the letters a fraction smaller with stronger contrast. Add a fine paper grain, no drop shadows on the panel.
