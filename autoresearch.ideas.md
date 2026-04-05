- Add an end-to-end live-turn benchmark (mic chunk send -> ASR final -> first TTS utterance start) with fixed **real speech** fixture; synthetic tone/silence crashes Volcengine validation and cannot serve as reliable turn-complete workload.
- Add SSE reconnect-with-resume token for transient network drops so the live session can recover without forcing user restarts.
- [observed] Current stable timing profile for paced real-speech turns: fallback=80ms + single-chunk-guard=20ms + guarded-delay=90ms + remainingGuard=max(0, guard-pendingElapsed). Variants at guarded-delay=85ms regressed; reverting to 90ms improved consistently.
- [observed] Gating relay hot-path logs behind VOLCENGINE_ASR_DEBUG=1 significantly improved mixed-workload latency baseline; keep verbose logs off in production path.
- [deprioritized] Early terminal-flush shortcuts (e.g., immediate ready when pending already contains isLast) were tried on paced real-speech turn benchmark and regressed in confirmation runs.
- [observed] Simplifying realtime ASR workflow to `audio_in,resample,partition,vad,fe,decode` (removing both `nlu_punctuate` and `itn`) produced consistent turn-complete latency gains on real-speech paced benchmark while preserving transcript presence.
- [observed] Setting `show_utterances=false` produced additional stable turn-latency gains; keep for realtime path unless product explicitly needs utterance lists.
- [deprioritized] Disabling `vad_signal` was tested and regressed latency versus current best config.
- [deprioritized] Removing `resample,partition` from workflow was tested (`audio_in,vad,fe,decode`) and regressed versus current best realtime workflow.
- [deprioritized] Removing `vad` from workflow (`audio_in,resample,partition,fe,decode`) also regressed paced real-speech turn latency.
- [observed] Explicit `result_type: single` performs better than relying on default result_type under paced real-speech turn benchmark.
- [deprioritized] Other request-shape micro-tweaks (e.g., dropping explicit `nbest` or `sequence`) were tested and did not beat the current decode-only workflow config.
- [deprioritized] Lowering default `start_silence_time` (10000->8000) was retested on current config and regressed paced real-speech turn latency.
- [observed] Stability benchmark saturates at 100% under loose timeouts; strict timeout workload (3500ms) exposes headroom (currently ~50%), but fallback/guard micro-tunes did not move it—likely needs architectural recovery changes.
- [observed] `decodeVolcengineFrame` now uses bounds-first seq/non-seq parsing to avoid avoidable exception fallback on full-server frames; produced repeatable latency gains in paced real-speech benchmark.
- [deprioritized] Most relay micro-optimizations (e.g., env-parse caching, transcript extraction refactors) did not show reliable wins under paced real-speech variance.
- [observed] Audio frame gzip can be exposed as a deploy-time tuning knob (`VOLCENGINE_ASR_AUDIO_GZIP=0`), but default policy flips were not robustly better in benchmark noise.
## Text Mode Optimization ✅ COMPLETED

### Results
- **Baseline**: 34,872ms total, 8,985ms search
- **Optimized**: 14,816ms total, 2,325ms search  
- **Improvement**: 57.5% faster (58% reduction)

### Implemented Optimizations
1. **[done] In-memory query result cache**: LRU cache with 5min TTL, 100 entries
2. **[done] Fast path for method/fact queries**: Skip LLM understandQuery - saves ~2-3s
3. **[done] Reduced LLM max_tokens**: 260 → 150 for understandQuery
4. **[done] Tunable search limits**: Reduced default keyword (32→20) and semantic (16→10)

### Verified
- Fast path logs: `understandQuery fast path (no LLM)` confirmed active
- Cache logs: `searchChunks cache hit` confirmed working
- Build passes with all changes

---

- Add a TTS stall detector metric (`tts_stall_count`, `tts_first_audio_ms`) and fallback voice auto-switch when browser voice hangs repeatedly.
