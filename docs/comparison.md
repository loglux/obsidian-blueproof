# How BlueProof compares with other checkers

## Where other checkers stumble

**Rules instead of reading.** LanguageTool compares text against rules people wrote. That catches typos and common slips quickly, but not an error you see only by understanding the sentence,
or the one before it: "Mary opened the book. Then he wrote the answer." In our tests on plain text LanguageTool found 9
of 25 errors; language models found 21–25 of 25.

**Formulas.** A checker reads words. Give it `$\frac{a}{b}$` and it sees nonsense in the middle of a sentence. A plugin
can then either let the checker underline around the formula, or hide everything near it, which also hides real errors
next to it. The [LanguageTool plugin](https://github.com/wrenger/obsidian-languagetool) handles Markdown well: it parses
the note and tells LanguageTool which parts are markup, so links and formatting are not checked. But its parser has no
notion of math, so a formula goes to LanguageTool as ordinary words, and afterwards the underlines that start inside a
formula are hidden (read in its code, version 1.4.2). In our test with
13 errors in sentences with formulas, LanguageTool found 2 and raised 7 false alarms; a local model (Qwen3 14B) found 11
with none. BlueProof puts a placeholder word in place of each formula, so the sentence reads normally, and drops any fix
that would touch a formula.

**Nothing until you ask.** [Proofreader](https://github.com/chrisgrieser/obsidian-proofreader) uses a language model
too, but only on a command, and writes its suggested edits into the note as highlights and strikethroughs until you
accept or reject them. BlueProof underlines as you write and changes nothing until you pick a fix.

Our tests are small (a few dozen sentences, written by one person), so take the numbers as a direction, not a ranking.

## Obsidian's own spellcheck

Obsidian has a spellcheck of its own (**Settings → Editor → Spellcheck**), on in a new vault on Windows and on Linux. It
is the spellcheck of Chromium, the browser engine Obsidian is built on. While BlueProof checks spelling it keeps
Chromium's out of the note's text, so words do not get two underlines, and leaves the setting as it is; a note in a
language BlueProof has no dictionary for keeps Chromium's (seen on Windows and Linux on 8 October 2026). By Obsidian's code Chromium still checks the note's title and properties.

Two parts make a spellcheck: one that underlines (decides what to check, draws the lines, offers the fixes) and a
dictionary that knows the words. Chromium is the first part; for the second it asks the system on Windows and macOS,
and uses dictionaries of its own on Linux. BlueProof is a first part of its own, which asks Windows' checker on Windows
and Hunspell's dictionaries elsewhere.

| | Underlines | Knows the words on Windows | on Linux | on macOS |
|---|---|---|---|---|
| Obsidian's spellcheck | Chromium | Windows' checker | Chromium's `.bdic` | macOS's checker |
| BlueProof | BlueProof | Windows' checker | Hunspell (the system's or LibreOffice's) | Hunspell (LibreOffice's) |

Where the dictionary is the same (Windows), BlueProof finds the same misspelled words; what it adds is around them:

- formulas, code and link addresses are not checked (Chromium checks whatever text the editor holds; how it treats a
  formula was not tried);
- your words are notes in the vault: by subject and language, with stems (`Euler*`), synced with the vault. Chromium's
  "Add to Dictionary" writes to Windows' user dictionary, on that computer only, for every program; BlueProof's Windows
  checker knows those words too, at once (seen on 8 October 2026: a word added through Electron's
  `addWordToSpellCheckerDictionary` went to `%APPDATA%\Microsoft\Spelling
eutral\default.dic`, and the running checker
  took it as right);
- each paragraph is checked in its own language, or the note's (`language: en-GB`); Chromium takes a word as right if
  any of its languages knows it;
- the whole note is checked when it opens: on Linux, Chromium underlined text only once something was typed (not tried
  on Windows);
- "Find unknown words in my notes" lists the words of the whole vault the dictionary does not know;
- spelling and grammar in one popup with the fixes, the next finding from the keyboard, the count in the status bar.

What it cannot add: words the dictionary does not know. A language not installed in Windows is not checked by either;
BlueProof shows ⚠ for it.

- **On Windows** Chromium hands the words to Windows' own spell checker, which BlueProof asks directly (not through
  Chromium): the same dictionary, without BlueProof's handling of formulas, markup and your words. Electron's guide
  says Windows uses Hunspell dictionaries, but the code says otherwise: Chromium is built with the system's checker on
  Windows (`use_browser_spellchecker`) and uses it by default (`UseBrowserSpellChecker`), and Electron adds a word to
  it when you add one to the dictionary (read in their sources on 8 October 2026). Seen in Obsidian 1.14.4 (Electron
  43) on Windows 11: no `.bdic` dictionaries downloaded, and the languages it offers first are the ones installed in
  Windows. Not seen: its underlines themselves, which a screenshot through the developer tools did not show.
- **On Linux** it uses Chromium's own dictionaries (`.bdic` files it downloads, for the system's language at first;
  others are added in Settings → Editor). It does not use the system's Hunspell dictionaries (`/usr/share/hunspell`),
  which BlueProof uses.
- **On macOS** Chromium asks macOS's own checker (Electron's guide; `use_browser_spellchecker` includes macOS; Obsidian
  says on a Mac that "the native spellchecker will automatically detect the language"). BlueProof uses Hunspell there,
  so the two dictionaries differ. Not tried: we have no Mac.

Chromium's English dictionary is much smaller. Measured on 8 October 2026 in Ubuntu 26.04 with Obsidian 1.14.4, British
English: Chromium's `en-GB-10-1.bdic` against the system's `en_GB` (LibreOffice's, package `hunspell-en-gb` 25.2.3).

| | System Hunspell (LibreOffice) | Chromium |
|---|---|---|
| Unknown of 3000 random words of LibreOffice's dictionary | 0 | 1464 (49%) |
| Unknown of 56 terms of statistics, mathematics and computing | 11 | 37 |

Chromium did not know, for example, *quartile*, *skewness*, *kurtosis*, *orthonormal*, *Jacobian*, *Riemannian*,
*Kolmogorov*, *autocorrelation*, *codebase*, *frontend*, *JSON*, *LaTeX*, and everyday words such as *snigger*. It knew
common words (*house*, *colour*, *behaviour*, *variance*, *eigenvalue*) and caught every typo tried (*helo*, *teh*,
*recieve*, *diffrent*, *untill*, *occured*). Not measured: other languages, macOS.

## At a glance

| | Formulas | Grammar by | Runs |
|---|---|---|---|
| **BlueProof** | replaced before checking; never underlined | a language model | your own servers (or OpenAI if you choose) |
| [LanguageTool](https://github.com/wrenger/obsidian-languagetool) | sent as text; underlines starting inside a formula are hidden | LanguageTool | LanguageTool's cloud (`api.languagetool.org`) by default, or your server |
| [Proofreader](https://github.com/chrisgrieser/obsidian-proofreader) | not documented | a language model, on a command; edits shown in the text to accept or reject | OpenAI, Google, Mistral, OpenRouter or Ollama |

From each plugin's code or documentation, read in October 2026; tell us if something has changed.

BlueProof is for catching more than rules can, in many languages, with a model on your computer or OpenAI.
