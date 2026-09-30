# Command Palette Bloom

A compact trigger unfolds into a staggered action lens

Keywords: command palette, actions, keyboard, shortcut, menu, stagger, clip reveal, launcher, spotlight, cmd k, quick access, popover

## CSS

```css
.command-panel {
  clip-path: inset(0 0 100% 0 round 14px);
  transition: clip-path .5s cubic-bezier(.16,1,.3,1);
}
.command.open .command-panel { clip-path: inset(0 round 14px); }
.command.open .command-panel button { opacity: 1; transform: translateY(0); }
```

## Prompt guidance

Build a miniature command palette that blooms downward from a compact keyboard-shortcut trigger. Reveal a frosted action lens with a rounded clip-path wipe, then stagger three rows upward by a few pixels. Let Escape and outside clicks close it, and expose the expanded state to assistive technology.
