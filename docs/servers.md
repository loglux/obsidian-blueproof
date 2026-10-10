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
| No graphics card, but you accept the cloud | OpenAI or Anthropic | The paragraphs being checked leave your computer; you pay per use (cost not measured). |
| No graphics card, and no cloud | — | Spelling still works; grammar needs a model. A small model on the processor was not tried. |

Models, measured on the plugin's benchmark (25 errors in plain text, 13 with formulas, and
correct texts to count false findings; one run):

| Model | Size of the file | Plain: found / right fix | With formulas: found / right fix, false | Good for |
|---|---|---|---|---|
| Qwen3 14B | 9.0 GB | 23/25, 20/25 | 11/13, 11/13, 0 | the best balance, both languages |
| Gemma 3 12B | 7.3 GB | 22/25, 18/25 | 12/12, 12/12, 8 | English |
| YandexGPT 5 Lite 8B | 4.9 GB | 21/25, 19/25 | 13/13, 12/13, 20 | Russian, a smaller card |
| gpt-5.4-mini (OpenAI) | — | 25/25, 21/25 | 12/13, 12/13, 1 | no card, cloud accepted |

**The cloud models, on the larger benchmark of 2026-10-10** (207 known errors in 17 sets of short texts, sentence
pairs, long paragraphs and formulas, Russian and English; 67 correct texts to count false findings; one run each):

| Model | Errors found | With a right fix | Findings on correct texts | Other extra findings | A short text | A long paragraph |
|---|---|---|---|---|---|---|
| gpt-5.5 (OpenAI) | 199 | 199 | 4 | 10 | 1.3 s | 10.3 s |
| gpt-6-sol (OpenAI) | 198 | 198 | 1 | 5 | 1.4 s | 10.1 s |
| Claude Sonnet 5.5 (Anthropic) | 197 | 197 | 2 | 4 | 1.8 s | 12.5 s |
| gpt-5.6-luna (OpenAI) | 196 | 194 | 4 | 8 | 1.3 s | 11.1 s |
| gpt-5.4-mini (OpenAI) | 196 | 193 | 5 | 8 | 0.9 s | 6.6 s |
| Claude Haiku 4.5 (Anthropic) | 196 | 190 | 3 | 6 | 1.4 s | 13.5 s |
| Claude Haiku 5.5 (Anthropic) | 186 | 183 | 0 | 0 | 1.1 s | 7.6 s |
| gemma3:12b (Ollama, local) | 166 of 200 | 160 | 2 of 65 | 3 | 1.3 s | 22 s |

gpt-5.5, gpt-6-sol and Sonnet 5.5 find the most and fix all they find (gpt-6-sol with one false finding); Haiku 5.5
made no false finding at all and misses mostly errors seen only from another sentence; gpt-5.4-mini is the fastest. The
newer OpenAI models were run on the same day; prices were not compared.

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

The paragraphs being checked are sent to OpenAI.

## Anthropic (Claude)

Tried: yes, `claude-haiku-4-5`, `claude-haiku-5-5` and `claude-sonnet-5-5` (2026-10-10; results above).

1. Create an API key in the [Claude Console](https://console.anthropic.com/settings/keys).
2. In the settings: Server **Anthropic Claude**, the key under **API key** (kept in Obsidian's secret storage and sent only
   to Anthropic), then **choose a model** from the list the server gives.

The plugin asks Anthropic in its own API (Messages), not in OpenAI's form. A model that refuses a part of the request
(newer ones refuse `temperature`, Sonnet 5.5 refuses being made to use the answer's form) is asked again without it.
The paragraphs being checked are sent to Anthropic.

## A server on another computer

The address can be another computer of your network, for example `http://192.168.1.20:11434/v1`. The server must listen
on the network, not only on its own computer: llama-server with `--host 0.0.0.0`, Ollama with the `OLLAMA_HOST=0.0.0.0`
setting. Not tried here. Your text then goes over the network to that computer.
