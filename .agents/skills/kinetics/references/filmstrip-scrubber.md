# Filmstrip Scrubber

A playhead snaps to the frame nearest the pointer

Keywords: video, timeline, scrub, playhead, frames, seek, preview, editor, media player, trim, thumbnails, timecode, drag, audio

## CSS

```css
.filmstrip-head {
  translate: calc(var(--head) * 1px) 0;   /* --head is measured, not stepped */
  transition: translate .48s cubic-bezier(.34,1.56,.64,1);
}
.filmstrip.scrubbing .filmstrip-head { transition-duration: 90ms; }
.filmstrip-track button {
  transform: scaleY(calc(1 + var(--near) * .34));
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), background .25s ease;
}
```

## Prompt guidance

Create a video-style filmstrip scrubber. While the pointer moves across the strip, the playhead tracks it almost instantly and each frame swells based on how close it is to the cursor. On release or click, the playhead springs to the centre of the nearest frame and a monospaced timecode updates to that frame. Arrow keys should step frame by frame with the same spring, and the whole thing must stay one row with no reflow.
