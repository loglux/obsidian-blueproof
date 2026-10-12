# Setting up a checker: servers and models

BlueProof does not install or start servers (Obsidian's rules for plugins forbid installing dependencies, and a server you
run yourself can serve other programs too). This page says how to get each one running and which models to load. What was
tried on the author's machine (Windows 11, RTX 4070 with 12 GB, 2026-10-05 and 10-06) is marked as such; the rest is from
the programs' own documentation and was **not tried** here.

After any of these: **Settings → BlueProof → Status → Check** says whether the server answers and has the chosen model.

## Which to choose

| You have | Grammar by | Notes |
|---|---|---|
| A graphics card with 8–12 GB | a local model (llama.cpp or Ollama) | The text stays on your computer. |
| No graphics card, but you accept the cloud | OpenAI, Anthropic or Google Gemini | The paragraphs being checked leave your computer; you pay per use (cost not measured). |
| No graphics card, the cloud, and no payment | Google Gemini's free tier (Flash-Lite) | A few hundred paragraphs a day; Google may use what is sent on the free tier to improve its products. |
| No graphics card, and no cloud | — | Spelling still works; grammar needs a model. A small model on the processor was not tried. |

Models, measured on the plugin's benchmark (25 errors in plain text, 13 with formulas, and
correct texts to count false findings; one run):

| Model | Size of the file | Plain: found / right fix | With formulas: found / right fix, false | Good for |
|---|---|---|---|---|
| Qwen3 14B | 9.0 GB | 23/25, 20/25 | 11/13, 11/13, 0 | the best balance, both languages |
| Gemma 3 12B | 7.3 GB | 22/25, 18/25 | 12/12, 12/12, 8 | English |
| YandexGPT 5 Lite 8B | 4.9 GB | 21/25, 19/25 | 13/13, 12/13, 20 | Russian, a smaller card |
| gpt-5.4-mini (OpenAI) | — | 25/25, 21/25 | 12/13, 12/13, 1 | no card, cloud accepted |

**The cloud models, on the larger benchmark of 2026-10-10 and 11** (207 known errors in 16 sets of short texts, sentence
pairs, long paragraphs and formulas, Russian and English; 67 correct texts to count false findings; one run each):

| Model | Errors found | With a right fix | Findings on correct texts | Other extra findings | A short text | A long paragraph |
|---|---|---|---|---|---|---|
| Gemini 3.8 Flash (Google) | 201 | 201 | 6 | 5 | 3.8 s | 20.4 s |
| gpt-5.5 (OpenAI) | 199 | 199 | 4 | 10 | 1.3 s | 10.3 s |
| Claude Sonnet 5.5 (Anthropic) | 198 | 198 | 1 | 3 | 2.0 s | 15.7 s |
| gpt-6-sol (OpenAI) | 198 | 198 | 1 | 5 | 1.4 s | 10.1 s |
| Claude Haiku 5.5 (Anthropic) | 197 | 195 | 0 | 3 | 2.0 s | 16.8 s |
| gpt-5.6-luna (OpenAI) | 196 | 194 | 4 | 8 | 1.3 s | 11.1 s |
| Gemini 3.5 Flash-Lite (Google) | 191 | 186 | 4 | 9 | 0.6 s | 3.9 s |
| gpt-5.4-mini (OpenAI) | 196 | 193 | 5 | 8 | 0.9 s | 6.6 s |
| Claude Haiku 4.5 (Anthropic) | 196 | 190 | 3 | 6 | 1.4 s | 13.5 s |
| gemma3:12b (Ollama, local) | 166 of 200 | 160 | 2 of 65 | 3 | 1.3 s | 22 s |

Gemini 3.8 Flash finds the most and fixes all it finds, but is the slowest on a long paragraph: it thinks before it
answers, which cannot be turned off. gpt-5.5, Sonnet 5.5 and gpt-6-sol come next (one false finding on correct texts for
the last two), then Haiku 5.5 with none, at about a twentieth of Sonnet's price; Gemini 3.5 Flash-Lite is the fastest
and finds a little fewer than gpt-5.4-mini. The Gemini models were run on 2026-10-11 with a paid key; prices were not compared.
The 6 errors of one set (`en-labels`) are not counted in any row.

The Claude rows are of 2026-10-11, asked as the plugin asks them since: by Anthropic's own schema format, in which they
may think before answering. Asked the way before (a tool they were made to call), Haiku 5.5 found 186 (183 right, no
false finding) at 1.1 s a short text and 7.6 s a long paragraph, Sonnet 5.5 197; every Claude run that day was slower
than the day before, so part of the time is the server's. Since 2026-10-11 the plugin asks OpenAI for the schema in strict
mode (gpt-5.4-mini then found 194, as good as before). Run again several times on 2026-10-11: Haiku 5.5 found 197, 193
and 196; Gemini 3.5 Flash-Lite 180 to 191 in four runs through Google's OpenAI form (fewer than gpt-5.4-mini, mostly in
long Russian paragraphs), with 2 to 6 false findings, and 180 to 190 in six runs through Google's own API (2026-10-12), as
the plugin asks it since 0.4.12, with 1 to 3. The other rows are of one run each.

The false findings with formulas were measured before the plugin restored LaTeX that models break in their JSON answers
and took BlueEdit's later formula guards; they are probably fewer now, not measured again. All files are the `Q4_K_M`
quantisation. One model of 9 GB and the card's other work fill a 12 GB card: load one model at a time.

## llama.cpp (llama-server)

Tried: yes (the benchmark runs on it).

1. Download llama.cpp's release for your system from its GitHub releases (on Windows with an NVIDIA card, the CUDA build
   and its `cudart` archive).
2. Download a model file (`.gguf`, `Q4_K_M`) from Hugging Face, for example a Qwen3 14B one.
3. Start it: `llama-server -m Qwen_Qwen3-14B-Q4_K_M.gguf --port 8080 -ngl 99` (`-ngl 99` puts the whole model on the card).
4. In the settings: Server **llama.cpp**, the address `http://127.0.0.1:8080/v1`. The model list shows the one file it
   serves; to use another model, start it with that file.

## Ollama

Tried: yes, Ollama 0.35.1.

1. Install it from ollama.com; it runs as a background service and starts with the computer.
2. Get a model: `ollama pull gemma3:12b` (or `qwen3:14b`).
   **Or use a `.gguf` file you already have**, without downloading it again: write a file `Modelfile` with one line,
   `FROM C:\path\to\Qwen_Qwen3-14B-Q4_K_M.gguf`, and run `ollama create qwen3:14b -f Modelfile`. Done this way on
   2026-10-06 with Qwen3 14B and YandexGPT 5 Lite: both passed the plugin's live tests (Ollama copies the file, so it
   takes the disk space twice).
3. In the settings: Server **Ollama**, the address `http://127.0.0.1:11434/v1`, then the model from the list.

The first request after Ollama starts or changes model waits while it loads the model onto the card: 228 seconds for Gemma
3 12B once, 3 to 28 seconds other times. The status bar shows an hourglass and **Checking** meanwhile, and paragraphs whose request timed
out are asked again a minute later; meanwhile nothing else is sent to it, so requests do not pile up on a server
still loading (tried with a test server that answers after 150 s: the plugin gave up at 120 s and sent the next paragraph
when the server had finished the first, at 152 s). Ollama unloads a model after a few minutes without requests (its `OLLAMA_KEEP_ALIVE`
setting; not changed here).

## LM Studio

**Experimental: not tried yet.** It serves an OpenAI-compatible API at `http://127.0.0.1:1234/v1` once its local server is started in the app;
load a model there, then choose **LM Studio** and the model in the settings.

## OpenAI

Tried: yes, `gpt-5.4-mini`.

1. Create an API key in your OpenAI account.
2. In the settings: Server **OpenAI**, the key under **API key** (kept in Obsidian's secret storage, not in the plugin's
   settings file, and sent only to OpenAI: each server keeps a key of its own), then **choose a model**: OpenAI has no default and refuses a request without one.

The paragraphs being checked are sent to OpenAI. By its data controls page (read 2026-10-11) what the API is sent is not used to train its models unless you opt in, and is kept up to 30 days for abuse monitoring.

## Anthropic (Claude)

Tried: yes, `claude-haiku-4-5`, `claude-haiku-5-5` and `claude-sonnet-5-5` (2026-10-10; results above).

1. Create an API key in the [Claude Console](https://console.anthropic.com/settings/keys).
2. In the settings: Server **Anthropic Claude**, the key under **API key** (kept in Obsidian's secret storage and sent only
   to Anthropic), then **choose a model** from the list the server gives.

The plugin asks Anthropic in its own API (Messages), not in OpenAI's form. A model that refuses a part of the request
(newer ones refuse `temperature`) is asked again without it. Haiku 5.5 and Sonnet 5.5, and a newer model that refuses
being made to call a tool, are asked for the answer by Anthropic's own schema format.
The paragraphs being checked are sent to Anthropic. By its data retention page (read 2026-10-11) they are not used for training without your permission and not kept by default (a request its safety systems flag may be kept up to 2 years).

## Google (Gemini)

Tried: yes, on a free key (2026-10-10) and a paid one (2026-10-11). Measured: `gemini-3.8-flash` and
`gemini-3.5-flash-lite` (results above), `gemma-4-26b-a4b-it` (below).

1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey); no payment is needed for the free tier.
2. In the settings: Server **Google Gemini**, the key under **API key** (kept in Obsidian's secret storage and sent only
   to Google), then **choose a model** from the list the server gives.

The plugin asks Google through its own API (Interactions), from 0.4.12; settings with the earlier address are moved to it
once, with their key and model. Measured on gemini-3.5-flash-lite, 2026-10-12: through Google's OpenAI form the model
sometimes answered a piece of a long Russian paragraph with no change at all and lost its errors at once (2 runs of 3);
through its own API not once in 6 runs, and found about 6 errors more on average. The OpenAI form stays in the list as
**Google Gemini, OpenAI form (a fallback)**, should Google's own API stop answering. The plugin asks Google not to keep
what is sent (`store: false`).

Which model, as measured on 2026-10-11 (Google's models change; the newest Flash is worth trying when it comes):

- `gemini-3.8-flash`: found the most of all the cloud models; slower on a long paragraph.
- `gemini-3.5-flash-lite`: the fastest; a little behind gpt-5.4-mini; the cheapest, and the one a free key allows most of.
- The older Flash and Flash-Lite in the list (3, 3.1, 3.5, 3.6, 3.7) answered a test sentence right; not measured.
- Not worth choosing: the Pro models (a paid key at Google's first tier allows 250 requests a day, a note or two; they
  think before every answer and cost the most), and Gemma 4 (below). The 2.5 models answer "no longer available to new
  users" to a new key.

What a key allows is shown on AI Studio's
[rate limit page](https://aistudio.google.com/rate-limit) for your project. With billing set up (the first tier),
2026-10-11: 3.8 Flash 1,000 requests a minute and 10,000 a day, 3.5 Flash-Lite 4,000 and 150,000, Pro 25 and 250. On a
free key it was, per model:

| Model | Requests a minute | Requests a day |
|---|---|---|
| Gemini 3.x Flash, 2.5 Flash, 2.5 Flash-Lite | 5–10 | 20 |
| Gemini 3.5 Flash-Lite, 3.1 Flash-Lite | 15 | 500 |
| Gemma 4 (26B, 31B) | 30 | 14,400 |
| Gemini Pro | none on the free tier | |

A request goes for each paragraph changed, so 20 a day is enough to try the plugin, not to write with it. When a
limit is reached the plugin says so; where Google says how long to wait, it sends nothing until then and goes on by
itself (the status bar: *Limit · until 14:32*). On the free tier Google may use what is sent to improve its products (its terms);
a key with billing set up is not used so.

Gemma 4 through Google is not worth choosing: it loops in its answer (the same words up to the length limit), at any
temperature and in pieces of 600 characters too, and gave no answer for 43 of 274 texts, every long paragraph among
them. Google also blocks an answer now and then as "recitation" (copying a text): the answer holds the corrected text,
nearly the same as the text sent; the plugin shows nothing for that paragraph.
The paragraphs being checked are sent to Google.

## A server on another computer

The address can be another computer of your network, for example `http://192.168.1.20:11434/v1`. The server must listen
on the network, not only on its own computer: llama-server with `--host 0.0.0.0`, Ollama with the `OLLAMA_HOST=0.0.0.0`
setting. Not tried here. Your text then goes over the network to that computer.
