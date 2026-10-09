# Test results

How well each checker finds errors, measured on texts with known errors. Read the limits at the end before drawing
conclusions: the tests are small. LanguageTool is here as the point of comparison: the plugin itself checks grammar with
a language model only.

## How we test

- **Our own sentences** with known errors: British English and Russian, plain text and text with LaTeX formulas, pairs
  of sentences where the error is only visible from the first one ("Mary opened the book. Then he wrote the answer."),
  and long paragraphs. Correct texts are mixed in to count false alarms.
- Each checker gets the same texts through the plugin's own code. A finding counts when it lands on a known error; a
  finding on a correct text counts as a false alarm.
- One run per checker, temperature 0. Local models ran on one computer with an RTX 4070 (12 GB), quantised to `Q4_K_M`.

## Short sentences (October 5, 2026)

25 errors in plain text, 13 in text with formulas, 24 correct texts.

| Checker | Plain text: found / right fix | With formulas: found, false alarms | Time per text |
|---|---|---|---|
| LanguageTool 6.6 | 9 / 6 of 25 | 2 of 13, 1 | 0.15–0.3 s |
| YandexGPT 5 Lite 8B | 21 / 19 of 25 | 13 of 13, 0 | 0.6–0.9 s |
| Gemma 3 12B | 22 / 18 of 25 | 12 of 12*, 0 | 0.6–1.2 s |
| Qwen3 14B | 23 / 20 of 25 | 11 of 13, 0 | 0.7–1.2 s |
| gpt-5.4-mini (OpenAI) | 25 / 21 of 25 | 12 of 13, 1 | 0.8–1.1 s |

\* one text got no usable answer.

"Right fix": the suggested replacement gives the correct text. LanguageTool often names a problem without offering a fix.

## A larger set, with the current instructions (October 7, 2026)

127 errors: the short sentences above, the sentence pairs and long paragraphs. Some texts got no answer from some local
models, so their totals are out of fewer errors.

| Checker | Found | False alarms |
|---|---|---|
| gpt-5.4-mini (OpenAI) | 122 of 127 | 10 |
| YandexGPT 5 Lite 8B | 107 of 126 | 3 |
| Qwen3 14B | 99 of 121 | 1 |
| Gemma 3 12B | 98 of 120 | 4 |

Two things raised these numbers. The model is asked to check each sentence against the ones before it: pronouns,
gender, number, tenses. That found more with every model, for example 111 → 116–119 with gpt-5.4-mini. And answers that
translate a word or change a number are thrown away, which cut false alarms: with YandexGPT from 6 to 3, with Gemma
from 6 to 4.

## Long paragraphs

A paragraph longer than about 1,200 characters goes to the model in pieces of whole sentences, about 600 characters
each, with the sentence before each piece for context. It finds about as many errors as sending the whole paragraph at
once, and answers sooner. Time for a long text: gpt-5.4-mini about 1.3 s, YandexGPT 3 s, Gemma 3 12B 5 s, Qwen3 14B 9 s.

## Formulas

A formula is sent as it is, and any finding that touches it is dropped. Without that, checkers "corrected" the formulas
themselves. LanguageTool read `0.02$` as an amount of money, and some models changed `\frac` and the dollar signs.
False alarms on correct texts with formulas: LanguageTool 7, YandexGPT 20, Gemma 3 12B 8. With it: 1, 0 and 0, and not
one error fewer found.

## What these tests do not show

- **They are small.** Five to a few dozen errors per kind of text, written by one person, one run each. A difference of
  one or two errors means nothing.
- **Only British English and Russian** were tested. Other languages, and American English, were not.
- **A correct fix worded differently** from what we expected counts as wrong, so the "right fix" numbers are a lower
  bound.
- **Times depend on the computer and vary** by up to a factor of two between runs. OpenAI's times are from one internet
  connection.
- **Not measured:** OpenAI's cost, other OpenAI models, LM Studio, models other than those above, and how the style
  suggestions do.
