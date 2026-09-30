# Rack Focus

Depth of field pulls between two planes, bokeh blooming

Keywords: depth of field, focus pull, rack focus, bokeh, blur, cinematic, camera, lens, layers, foreground background, film, aperture, defocus, photography

## CSS

```css
.rack-near { animation: pull-near 7.4s cubic-bezier(.65,0,.35,1) infinite; }
.rack-far  { animation: pull-far  7.4s cubic-bezier(.65,0,.35,1) infinite; }
@keyframes pull-near {
  0%, 34%   { filter: blur(0);   opacity: 1;   scale: 1; }
  50%, 84%  { filter: blur(6px); opacity: .42; scale: 1.03; }
  100%      { filter: blur(0);   opacity: 1;   scale: 1; }
}
@keyframes pull-far { /* exact inverse — only one plane is ever sharp */ }
```

## Prompt guidance

Simulate a cinematic focus pull between two depth planes. Only one plane is ever sharp: as the near label resolves, the far label blurs, dims and grows fractionally, then they trade with an in-out curve on a slow loop. Bokeh circles behind them should swell and brighten exactly when their plane goes soft. Use blur, opacity and scale together — a plain crossfade will not read as a lens.
