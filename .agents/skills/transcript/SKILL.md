---
name: transcript
description: Transcription, captions, and edit by transcript. Use when changing speech to text, word timings, subtitle export, filler word and pause detection, or caption styling.
---

# Transcript

Speech to text, captions, and editing video by editing text.

- Transcribe on device by default with NVIDIA Parakeet v3, which keeps filler words and gives word-level timings.
  It covers 25 European languages; other languages need a fallback model.
  Overlap audio chunks, since Parakeet drops speech at chunk edges.
- The transcript lives in source time; SRT and VTT exports map it through cuts and speed changes.
- Deleting words from the transcript cuts them from the video.
- Filler words and long pauses are detected and offered as cuts the user confirms.
- Captions: font, color, position; line-by-line or word-by-word; appear, fade, or slide in; legible on vertical video.

Done when after any sequence of cuts and speed changes, every caption word lands on the frame where it is spoken.
