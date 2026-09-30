# Liquid Glass Press

Frosted glass liquefies under a specular press

Keywords: liquid glass, frosted, glassmorphism, specular, apple glass, refraction, backdrop filter, cta, press, blur, translucent, modern

## CSS

```css
.glass {
  backdrop-filter: blur(14px) saturate(1.4);
  border: 1px solid rgba(255,255,255,.12);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.18);
}
.glass::after { /* specular streak */
  background: linear-gradient(105deg, transparent, rgba(255,255,255,.35), transparent);
  transition: transform .65s cubic-bezier(0.16,1,0.3,1);
}
.glass:hover::after { transform: translateX(220%); }
.glass:active { transform: scale(0.97); }
```

## Prompt guidance

Build a modern liquid-glass CTA. Use a frosted translucent surface with backdrop-filter blur and saturation, an inset top highlight, and soft ambient shadow. On hover drift the inner colour pools and sweep a specular streak across the face; on press, scale slightly down so it feels tactile and refractive rather than flat material.
