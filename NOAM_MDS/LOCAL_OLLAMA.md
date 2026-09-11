# Local Ollama — the two instances, what they do, when, why, and how to keep them healthy

Founder document, written 2026-09-11 after the server-freeze night. Everything here was read off the
live server (`noam-live-server`, `100.85.231.17`) on that date. If a number below disagrees with the
box, the box is right and this file needs an update.

**Rule (founder, 2026-09-11): exactly two Ollama instances exist on this server. One on the GPU, one
on the CPU. Each holds one model at a time and answers one request at a time. Nobody starts a third.**

## 1. Why local models at all

The agent fleet runs on a single Claude subscription. Its 5-hour window burns in roughly two hours when
four agents work at once, and the fleet then sits in `error` until the window resets (the watchdog
holds them and revives them at the printed reset time). Local models exist to do the cheap, repetitive
work that should never cost Claude tokens, and to keep the studio producing during those dead hours:

- brainstorming feature leads all day long on an otherwise idle GPU,
- looking at the nightly QA screenshots and describing what is wrong,
- optional coding / question offload the agents can hand to the box.

They are never on the critical path of a decision. The CEO decides, engineers ship, the local models
draft and observe.

## 2. The two instances

| | GPU instance | CPU instance |
|---|---|---|
| systemd unit (user) | `ollama.service` | `ollama-cpu.service` |
| port | `127.0.0.1:11434` | `127.0.0.1:11435` |
| models folder | `/mnt/hdd/ollama-data` (5.5 GB) | `/mnt/hdd/ollama-cpu-data` (5.8 GB) |
| model | `hf.co/Qwen/Qwen3-8B-GGUF:Q5_K_M` (8.2B, text) | `qwen3-vl:8b` (8.8B, vision), served under the alias `lullwood-qa-tester` |
| where it runs | RTX 2070 SUPER, 8 GB VRAM, all 37 layers resident (100% GPU), ~65 tok/s | 10 CPU threads (`OLLAMA_NUM_GPU=0`, `cpu_avx2`), ~4-5 tok/s |
| memory while loaded | 6.7 GB VRAM, ~0.5-1.5 GB RAM | ~7.5 GB RAM (peaks near 11 GB) |
| unloads after idle | 10 min (`OLLAMA_KEEP_ALIVE=10m`) | 5 min unit default; triage asks for 20 min |
| concurrency | `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1` | same |
| memory ceiling (cgroup) | `MemoryMax=6G`, no swap | `MemoryHigh=9.2G`, `MemoryMax=10.5G`, no swap, `OOMScoreAdjust=600` (the kernel kills it before Paperclip) |
| who talks to it | the `local-code` dispatchers (section 3) | the local QA tester's `triage.py` (section 4) |

Both units are `enabled` under `default.target` and `Linger=yes` is set for `noam`, so they start at
boot without a login and `Restart=always` brings them back after a crash. `lullwood-boot-check`
(cron, `@reboot` and every 10 min) restarts either one if it is down and logs it.

The `lullwood-qa-tester` tag is not a second model: it is a Modelfile alias of the same `qwen3-vl:8b`
blob with `temperature 0.3`, `top_k 20`, `top_p 0.95`, `num_ctx 4096`, `num_gpu 0` baked in. Only one
of the two tags can be loaded at a time and the tester always loads the alias.

## 3. GPU instance — the `local-code` toolkit

Everything lives in `/home/noam/.paperclip/shared/local-code/` (founder-owned). Three dispatchers
share one model, one registry per dispatcher, and one rule: a real request preempts idle work.

### 3.1 Idle feature scout (runs all day)

- **Cron**: `*/2 * * * * bin/ollama-idle-feature-scout-cron` (logs to `idle-scout-cron.log`).
- **Purpose**: whenever nothing else is using the GPU, brainstorm 3-5 new feature ideas that are not
  already in `docs/ELEMENTS.md`, and append them to `feature-leads/leads.md`. The Feature Scout agent
  reads that file as raw leads for its proposals to the CEO (founder rule: the proposal never mentions
  where the lead came from).
- **How**: `bin/ollama-feature-scout-dispatch` starts a transient systemd unit
  `ollama-featurescout-<n>` running `bin/ollama-feature-scout-worker`, which truncates `ELEMENTS.md`
  to the context budget and makes ONE `/api/generate` call.
- **Budgets**: `FEATURESCOUT_NUM_CTX = 8192` (scout-only; the shared `NUM_CTX = 24576` does not fit
  this model in VRAM — it offloads only 27/37 layers and drops to 0.3-15 tok/s), `num_predict 1500`,
  `think: false`, HTTP deadline 18 min, unit hard stop 20 min, stale after 5 min of no log activity.
- **Output**: since the 2026-09-11 fix, roughly one job every 2-3 minutes (288 jobs between 03:00 and
  12:00 that day; before the fix the model spilled to the CPU and a job took 10-20 minutes).
  `feature-leads/leads.md` grows; prune it when the Feature Scout has consumed it.

### 3.2 Coding offload — `bin/ollama-code-dispatch <ticket> <spec-file>`

For the two coding agents. Hands a written spec to the local model to draft a diff and push a branch.
`NUM_CTX 24576`, `num_predict 8000`, 6 h unit cap, stale after 30 min. Used 7 times since 2026-09-04
(2 pushed a branch, 5 failed). Preempts a running scout job synchronously.

### 3.3 Ask offload — `bin/ollama-ask-dispatch <request-id> <prompt-file> [--websearch]`

For any agent: ticket triage, drafting, summarising, or a research question grounded by the local
SearXNG metasearch (`searxng.service`). `num_predict 3000`, stale after 5 min. Used 3 times so far.

### 3.4 Registry hygiene (the bug that idled the GPU for 3 days)

Each dispatcher keeps a JSON registry (`registry.json`, `ask-registry.json`,
`featurescout-registry.json`). A job that dies without writing its terminal state leaves
`"status": "running"` behind and blocks every later dispatch. Job 346 did exactly that on
2026-09-08 (Ollama hit its 20-min timeout, systemd SIGKILLed the unit, the failure handler never ran)
and the idle cron said "already running" for three days. Fixes in place since 2026-09-11: the cron
runs `reap_stale()` **before** its busy check, and the worker has a client-side HTTP deadline below
the unit cap so a hang becomes a normal exception that `finish("failed")` records.

## 4. CPU instance — the local QA tester's eyes

Everything lives in `/home/noam/.paperclip/shared/local-qa/` (founder-owned; change `QA_TESTER.md`
only with the founder).

- **When**: nightly at 00:30 (`local-qa-run`, cron, inside a `systemd-run` cgroup of 8 GB / no swap),
  and on demand from the PR watcher (`pr-e2e-watch`, systemd timer every 5 min) — but the watcher does
  not call the model, only the nightly does.
- **What it does**: the deterministic driver (`scenario-audit.mjs`) walks the game through gate,
  in-game, menu, pickup cinematic, win, hide, charge, death and second death on desktop and two
  landscape phones, snapshotting each state and running the HUD overlap rules. `triage.py` then
  files tickets. **The model is used only where a screenshot needs a judgement**: overlap findings
  (it writes the human sentence) and a few fixed vision questions ("is YOU WON readable?", "is a
  burst visible?"). Everything the DOM can prove is ticketed without the model.
- **Budget**: `LOCAL_QA_MAX_CASES` (default 12) model calls per night, `format: json`,
  `temperature 0.3`, `keep_alive 20m`, ~3-5 minutes per image (prompt eval ~25 tok/s, generation
  ~5 tok/s). Twelve images ≈ 45-60 minutes. `wait_for_memory()` refuses to load the 7.5 GB model
  unless ~7.5 GB is free (1.5 GB if already resident).
- **What it must never do**: judge feel, audio (`--mute-audio`), predator AI, or timing from a
  screenshot; weaken a test; touch the founder-owned rulebook.

## 5. Why the CPU model is on the CPU and not the GPU

The GPU has 8 GB. The scout model takes 6.7 GB of it and is meant to be resident all day. The vision
model would need the same GPU and would evict it; two models cannot share the card. Nightly QA is
one hour a day and can afford 4 tok/s on the CPU; the scout runs 600 times a day and cannot. If the
studio ever gets a second GPU or a 16 GB card, move the vision model there first.

## 6. Operating it

**Health, in one line each**

```
systemctl --user is-active ollama ollama-cpu
curl -s 127.0.0.1:11434/api/ps | jq '.models[] | {name, size_vram, size}'   # GPU: size_vram == size means 100% on the GPU
curl -s 127.0.0.1:11435/api/ps                                              # CPU: usually {"models":[]} between nights
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader
tail -3 ~/.paperclip/shared/local-code/idle-scout-cron.log
tail -3 ~/.paperclip/shared/watchdog/state/boot-check.log
```

**Symptoms and what they mean**

| symptom | cause | fix |
|---|---|---|
| `ollama ps` shows `size_vram` < `size` on the GPU model | context too big for VRAM (or Chromium held the GPU) | keep `FEATURESCOUT_NUM_CTX` at 8192; check nothing else is on the card |
| scout jobs failing with `HTTP Error 500` | the runner was OOM-killed inside its cgroup | `journalctl --user -u ollama | grep OOM`; the 6 GB cap is the floor, do not go lower |
| `idle-scout-cron: feature-scout job already running` for more than 25 min | a stale registry entry | should self-heal on the next tick (reap-first); if not, mark the entry `failed` under its lock |
| box has < 1 GB free with no QA running | the vision model was left resident after a manual test | `curl 127.0.0.1:11435/api/generate -d '{"model":"lullwood-qa-tester","keep_alive":0}'` |
| `ollama-cpu.service` restarting repeatedly | kernel OOM pressure from Chromium; it is deliberately the first victim | fix the memory pressure (QA cgroup, `memory-pressure-guard`), not the service |
| a third `ollama serve` process | someone started one by hand | kill it; only the two units may run |

**Never**

- run the nightly QA and a manual Playwright/QA run at the same time (one box, one lock);
- start Ollama by hand or on another port;
- raise `FEATURESCOUT_NUM_CTX` without re-checking `size_vram == size`;
- point the QA tester at the GPU instance (it evicts the scout model and takes VRAM the game's own
  ANGLE path may one day need).

## 7. Memory budget of the whole box (15 GB RAM, 4 GB swap, 8 GB VRAM)

| tenant | ceiling | notes |
|---|---|---|
| Paperclip + all agent subprocesses | 9 GB | `paperclip.service` drop-in |
| nightly QA / PR watcher (Chromium) | 8 GB each, never both | the game page alone is 3.5-9 GB under software WebGL until LUL-2249 / LUL-2324 land |
| CPU Ollama (vision) | 10.5 GB hard, 9.2 GB soft | resident ~1 h/night |
| GPU Ollama (scout) | 6 GB RAM, 6.7 GB VRAM | resident all day |
| `memory-pressure-guard` (cron, every minute) | kills the largest browser-automation process when MemAvailable < 1.2 GB | never touches Paperclip, Ollama, Postgres, Tailscale, the Gate |

The ceilings add up to more than 15 GB on purpose: the QA cgroup and the vision model are not meant
to be resident at the same time as a busy fleet. `vm.swappiness` and draining the swap file need root
and are still on the founder's list.

## 8. Related files

- `~/.paperclip/shared/local-code/ollama_code_common.py` — models, budgets, registries, preemption.
- `~/.paperclip/shared/local-qa/bin/triage.py`, `QA_TESTER.md` — how the vision model is asked and what it may claim.
- `~/.config/systemd/user/ollama.service`, `ollama-cpu.service` (+ `*.d/memory-guard.conf`).
- `~/.paperclip/shared/watchdog/bin/lullwood-boot-check` — brings everything back after a reboot.
- `NOAM_MDS/CSWAP_ACCOUNT_ROTATION_REVIEW.md` — why we did not solve the Claude quota with account rotation.
