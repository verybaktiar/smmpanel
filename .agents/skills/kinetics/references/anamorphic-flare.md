# Anamorphic Flare

A point source rakes the frame and blooms horizontal streaks

Keywords: anamorphic, lens flare, cinematic, streak, jj abrams, horizontal flare, film, optics, highlight, widescreen, artifact, bloom

## CSS

```css
.flare b { animation: flare-travel 6.4s cubic-bezier(.65,0,.35,1) infinite; }
.flare i,
.flare em { animation: flare-bloom 6.4s ease-in-out infinite; }
@keyframes flare-travel {
  0%   { translate: -80px 0; }
  100% { translate:  80px 0; }
}
@keyframes flare-bloom {
  0%, 100% { opacity: .15; transform: scaleX(.4); }
  50%      { opacity: 1;   transform: scaleX(1); }
}
```

## Prompt guidance

Build a cinematic anamorphic lens flare. A small white point travels across a black frame. As it crosses centre, a long horizontal streak blooms — cool blue one side, warm amber the other — plus two faint oval artifacts offset on the same axis. Soften with a 1px blur. This is a lens, not a shine sweep or a god-ray shaft.
