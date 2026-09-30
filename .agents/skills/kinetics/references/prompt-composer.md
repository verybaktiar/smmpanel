# Prompt Composer

An AI input grows with the thought, then commits to a run

Keywords: ai, chat input, textarea, autogrow, auto resize, prompt, send button, chatbot, llm, message box, compose, assistant, submit, focus glow, copilot

## CSS

```css
.composer-field {
  transition: height .34s cubic-bezier(.16,1,.3,1), border-color .3s ease;
}
.composer-halo { opacity: 0; transition: opacity .45s ease; }
.composer.focused .composer-halo { opacity: 1; animation: halo-spin 4s linear infinite; }
.composer-send { transform: scale(.7); opacity: .35; }
.composer.ready .composer-send { transform: scale(1); opacity: 1; }
.composer.sending .composer-send::before { opacity: 0; }   /* arrow out */
.composer.sending .composer-send::after  { transform: scale(1); } /* stop square in */
```

## Prompt guidance

Build an AI prompt composer that feels alive as you type. The field auto-grows to its content with a glide easing instead of jumping line by line, a slow conic halo rotates behind the border only while focused, and the send button springs from a dim disabled dot to a full accent circle the moment there is text. On submit, morph the arrow into a stop square, run a determinate sweep across the field, then settle back to empty — no spinners, no layout shift.
