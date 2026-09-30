# Token Stream

Tokens cascade in like a live model response

Keywords: ai, llm, streaming, tokens, generative, chatgpt, response, type out, cascade, chips, model output, agent

## CSS

```css
.token {
  opacity: 0;
  transform: translateY(10px) scale(.92);
  animation: token-in 3.6s cubic-bezier(0.34,1.56,0.64,1) infinite;
}
.token:nth-child(n) { animation-delay: calc((n - 1) * 0.22s); }
@keyframes token-in {
  12%, 72% { opacity: 1; transform: none; }
  88%, 100% { opacity: 0; }
}
```

## Prompt guidance

Design an AI token-stream indicator. Render monospaced chips that pop in one after another with a spring, hold briefly as a completed phrase, then fade upward before looping. Highlight a mid-stream token in accent colour so it reads as generative output, not a generic loader.
