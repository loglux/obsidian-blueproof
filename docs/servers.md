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
| No graphics card, but you accept the cloud | OpenAI | The paragraphs being checked leave your computer; you pay per use (cost not measured). |
| No graphics card, and no cloud | — | Spelling still works; grammar needs a model. A small model on the processor was not tried. |

Models, measured on the plugin's benchmark (25 errors in plain text, 13 with formulas, and
correct texts to count false findings; one run):

| Model | Size of the file | Plain: found / right fix | With formulas: found / right fix, false | Good for |
|---|---|---|---|---|
| Qwen3 14B | 9.0 GB | 23/25, 20/25 | 11/13, 11/13, 0 | the best balance, both languages |
| Gemma 3 12B | 7.3 GB | 22/25, 18/25 | 12/12, 12/12, 8 | English |
| YandexGPT 5 Lite 8B | 4.9 GB | 21/25, 19/25 | 13/13, 12/13, 20 | Russian, a smaller card |
| gpt-5.4-mini (OpenAI) | — | 25/25, 21/25 | 12/13, 12/13, 1 | no card, cloud accepted |

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

## A server on another computer

The address can be another computer of your network, for example `http://192.168.1.20:11434/v1`. The server must listen
on the network, not only on its own computer: llama-server with `--host 0.0.0.0`, Ollama with the `OLLAMA_HOST=0.0.0.0`
setting. Not tried here. Your text then goes over the network to that computer.
