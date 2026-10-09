# Using BlueProof

## Underlines and the popup

Red: spelling. Blue: grammar and punctuation. Click an underlined word for the popup: what is wrong, which checker says
so, the fixes as buttons, *Ignore* (this finding, until Obsidian restarts), *Add to dictionary*, *Never show this
rule*.

## The status bar

- The findings of the open note; click to go to the next one. An hourglass while answers are awaited (a local model
  loading on the first request can take a minute or more), a warning icon and *Check failed* when a server does not answer (the paragraph
  is asked again a minute later, then after 2, 4… up to 30 minutes while it keeps failing).
- The note's language: the one in its properties, or the one found in the text, marked "(auto)". Click to choose:
  *Automatic*, or a language from the note, your settings or your downloaded dictionaries. The choice is written into the
  note's `language` property. From the keyboard: the command *Choose the note's language*.

## Commands

None has a default hotkey, so nothing clashes with Latex Suite or other plugins; give them yours in Settings → Hotkeys.

- *Check the paragraph at the cursor*: what each checker found, in a window.
- *Show the finding at the cursor*, *Go to the next finding*, *Go to the previous finding*: the popup opens with its
  first button focused (Tab between buttons, Escape back to the text).
- *Suggest a better wording for this paragraph*: the model proposes rewordings, you tick the ones you want; one undo
  takes them all back.
- *Turn checking off or on for this note*: sets `blueproof: off` in its properties.
- *Choose the note's language*: the menu of the language item in the status bar.
- *Find unknown words in my notes*: lists the unknown words of your vault, most frequent first,
  marking likely typos.

## Your own dictionaries

Names and terms the spelling dictionary does not know go into notes in a folder, `Dictionaries` by default: a personal
one (*Add to dictionary* writes there) and any number by subject, each in the language set in its properties. One word
per line or separated by spaces; `Euler*` stands for the word with up to four more letters (Euler's, Eulerian); lines
starting with `#` are comments. Examples to copy: [dictionaries](dictionaries).

## What is not checked

Formulas (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`, the last over several lines too), code, front matter, comments, link
addresses (the visible text of a link is checked), and notes with `blueproof: off`. Code and link addresses can be
switched back on in the settings.

## Languages

Each paragraph is checked in one language: chosen among the languages in your settings by its alphabet (Latin,
Cyrillic, Greek…) and, for languages sharing one, by statistics; with *auto*, among all the languages LibreOffice has
dictionaries for. A note's `language` property (`de`, or `ru, en`) wins over the settings. A paragraph mixing two
languages is checked in the one most of it is written in. Listing your languages is more reliable than *auto*: in our
tests about 95–99% of texts got the right language, against about 90%.

## Settings

**Status** first: what checks grammar and spelling, the last problem, and **Check**, which asks the servers and says
what is missing. Then: whether to check while typing, your languages; **Spelling** (Windows' checker or Hunspell, the
dictionaries to download, your dictionaries and words); **Grammar** (the checker); **Model server** (the server, its
address, an API key for a cloud server, the model); **Style suggestions** (what to look for); **Skipped text**;
**Advanced** (the pause before checking, the dictionary folder, a debug log).

## Limits

- One language per paragraph.
- A language model can be wrong or miss errors. It is told to fix only spelling, grammar and punctuation; answers that
  rewrite the text, translate it or change numbers are dropped.
- A long paragraph goes to the model in pieces of whole sentences.
