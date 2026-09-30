# E-ink Refresh

A full inverse flash, then the type settles into the paper

Keywords: eink, e-ink, electrophoretic, kindle, paper, flash, ghosting, remarkable, daylight, reader, inverse, settle

## CSS

```css
.eink i { animation: eink-flash 5.2s steps(1) infinite; }
.eink span { animation: eink-settle 5.2s ease-out infinite; }
@keyframes eink-flash {
  0%, 8%   { opacity: 0; }
  10%, 18% { opacity: 1; }   /* black frame */
  20%, 100%{ opacity: 0; }
}
@keyframes eink-settle {
  0%, 18% { opacity: 0; letter-spacing: .22em; filter: contrast(3); }
  24%     { opacity: 1; transform: translate(1px,-1px); }
  36%,100%{ opacity: 1; transform: none; letter-spacing: .08em; }
}
```

## Prompt guidance

Simulate an electrophoretic e-ink refresh. The paper goes fully black for a beat (the classic inverse flash), then the word appears slightly offset and high-contrast before settling into the grain. Add a fine dither on the paper. This is not a fade-in — the flash is what makes it read as e-ink.
