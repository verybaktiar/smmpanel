# Hold to Talk

A live waveform blooms while you hold, then commits on release

Keywords: voice, microphone, waveform, hold, record, audio, speech, whisper, voice note, press and hold, talk, dictation, capture

## CSS

```css
.talk-wave i {
  transform: scaleY(0.12);
  transition: transform .4s cubic-bezier(.34,1.56,.64,1);
}
.talk.live .talk-wave i {
  animation: talk-bar .42s ease-in-out infinite alternate;
}
.talk.live .talk-wave i:nth-child(3) { animation-duration: .28s; }
@keyframes talk-bar {
  from { transform: scaleY(0.18); }
  to   { transform: scaleY(1); }
}
```

## Prompt guidance

Create a hold-to-talk control. Idle bars sit almost flat. On press they spring up into a staggered live waveform and a ring blooms around the button. On release the bars collapse with a spring, the button flashes SENT for a beat, then everything returns to rest. This is a voice capture, not a confirm-hold ring — the waveform is the state.
