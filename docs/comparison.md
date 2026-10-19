# What our tests found

We tested BlueProof's language models and LanguageTool on texts with known errors, in October 2026: short British
English sentences, pairs of sentences, long paragraphs, sentences with LaTeX formulas, and correct texts mixed in to
count false alarms. This page sums up what came out. The tests are small (a few hundred sentences, written by us, one
run each), so read the numbers as a direction, not a ranking.

## What a rule-based checker misses

LanguageTool compares each sentence with rules people wrote. It is fast and catches the common slips; on our plain
English sentences (October 6, the same on October 19) it found:

- typos: *commitee*, *recieved*, *coefficents*;
- *dont*, *it's work*, *never come*, *taller then his brother*;
- *Me and my friend went…*, *If I would have known…*, *He explained me the rule*;
- *The results was better…*, *The eigenvalues of the matrix is all positive*.

It missed errors that need the sentence to be understood, not only matched:

- **Agreement across a clause**: *The data shows that the method **are** effective*, *Each of the units **have** a
  quiz*. The simple *The results was* it caught.
- **A tense the rest of the sentence rules out**: *I **have seen** him yesterday*.
- ***Their*, *there*, *they're***: ***There** car is parked outside*, ***Their** going to arrive late*.
- **The same slip next to an unusual word**: *taller then his brother* was found, *the Cauchy–Schwarz bound is tighter
  **then** the triangle inequality* was not.
- **An article before an abbreviation**: *exported it as **an** PDF*.
- **Errors next to a formula**: *Since $f(x)$ **are** a continuous function*, *the $y$-intercept **represent** the
  height*, *the integral **are** $\frac{x^3}{3}$*. Of 7 such errors it found 1 to 3, depending on its settings.

The models found nearly all of these: on 25 errors in plain sentences, LanguageTool found 9, the models 21 to 25
(October 5).

**Errors you see only from the sentence before.** *Mary finished the report early. Then **he** sent it to the
manager*: the second sentence is correct on its own. So are *Yesterday we visited the museum. Tomorrow we **visited**
the gallery* and *We bought a new laptop for the lab. **They are** very fast.* BlueProof asks the model to check each
sentence against the ones before it (who did it, what *it* stands for, when). On 12 such pairs LanguageTool, which
checks a sentence by itself, found none (October 19); the cloud models found 9 to 12, and the local ones 4 to 10. In
long paragraphs written like course notes, with errors of both kinds, LanguageTool found 2 of 13.

## Formulas

A checker reads words, and `$\frac{a}{b}$` in the middle of a sentence looks like nonsense to it. Given formulas as
text, LanguageTool raised 17 false alarms on 6 correct English sentences with formulas (October 19), and read `0.02$`
as an amount of money; some models "corrected" `\frac` and the dollar signs. BlueProof keeps formulas out of the check
and drops any fix that would touch one: then LanguageTool raised 1, and not one error fewer was found.

The [LanguageTool plugin](https://github.com/wrenger/obsidian-languagetool) handles Markdown well (links and
formatting are not checked), but it has no notion of math: a formula goes to LanguageTool as words, and the underlines
that start inside it are hidden (read in its code, version 1.4.2, October 2026).
[Proofreader](https://github.com/chrisgrieser/obsidian-proofreader) uses a language model too, but on a command only,
and writes its suggested edits into the note until you accept or reject them; BlueProof underlines as you write and
changes nothing until you pick a fix.

## Which models did well

On our larger set (207 errors, English and Russian, October 10 to 16), every cloud model we tried found 191 to 201 of
them. The surprise was how little the expensive models add: **each company's cheap model came within 10 errors of its
best one**.

- **Google**: Gemini 3.8 Flash found the most of all (201), but it thinks before answering and was five times slower on a
  long paragraph. Gemini 3.5 Flash-Lite found 191 and was the fastest model we tried, at a lower price.
- **Anthropic**: Claude Haiku 5.5 found 197, one fewer than Sonnet 5.5 at a fraction of its price, and was the only model
  with no false alarm on a correct text.
- **OpenAI**: gpt-5.4-mini found 196, gpt-5.5 199.
- **DeepSeek**: DeepSeek Flash, the cheapest model here, found 196, a little more than DeepSeek's own V4 Pro (195),
  faster and with fewer false alarms than gpt-5.4-mini.

So for proofreading the small models are enough: BlueProof starts each cloud server with its cheap one. On your own
computer, Qwen3 14B was the best balance of the models that fit a 12 GB graphics card; local models found noticeably
fewer errors than the cloud ones. The models one by one, with times and false alarms:
[servers.md](servers.md).

## Why not Google's free tier

A Gemini key from Google AI Studio works without payment, but we do not recommend it for writing:

- **Too few requests.** BlueProof sends a request for each paragraph you change. A free key allowed, per model and per
  day, 20 requests for Gemini 3.8 Flash and the other Flash models, 500 for 3.5 Flash-Lite, and none for Pro (October
  11). 20 is enough to try the plugin, not to write with it.
- **Gemma 4, which the free tier allows most of** (14,400 a day), was no use: it repeated the same words up to the
  length limit and gave no answer for 43 of 274 texts, every long paragraph among them.
- **What you send.** On the free tier Google may use what is sent to improve its products, and its terms say human
  reviewers may read it. With billing set up, it does not.

With billing set up, the same key gets far higher limits (Flash-Lite 150,000 requests a day), and Flash-Lite is one of
the cheapest models we tried.

## What these tests do not show

- They are small and made by us: a difference of one or two errors means nothing.
- British English and Russian only; other languages were not tested.
- One run each; times depend on the computer and the connection.
- Prices change; those above were read in October 2026.
