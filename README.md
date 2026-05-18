# VOLTS

**Validated Output through Logit Tree Search for Reliable PDDL Planning with Small Language Models**
Canadian AI 2026 · *Proceedings of Machine Learning Research*, vol. 318.

VOLTS lets a 4-bit Llama 3.1 8B Small Language Model generate **provably valid** PDDL
plans in a single inference pass, by coupling:
- **Action-token fine-tuning** — every token in a custom vocabulary encodes a complete grounded action;
- **A real-time symbolic validator** — checks each candidate token against the current state inside the decoding loop;
- **Parallel logit-guided tree search** — promising alternatives within a ratio β of the leader spawn new branches in the same forward pass, capped at k<sub>max</sub>.

Evaluated on 2,000 IPC problems across Blocksworld, Logistics, DriverLog and Rover, VOLTS returns valid plans for **76.4%** of tasks at **1.08×** the length of Fast Downward — vs 7.2% for GPT-4o and 0.13% for the same SLM without VOLTS.

## Repository contents
- [`VOLTS__Validated_Output_through_Logit_Tree_Search_for_Reliable_PDDL_Planning_with_Small_Language_Models.pdf`](VOLTS__Validated_Output_through_Logit_Tree_Search_for_Reliable_PDDL_Planning_with_Small_Language_Models.pdf) — full paper PDF.
- [`index.html`](index.html), [`assets/`](assets/) — the project landing page (GitHub Pages site).

## Website
A live landing page with animated explanations of the VOLTS inference loop is published via GitHub Pages: **https://r3ck0.github.io/Volts/**

The site is a single static `index.html` with p5.js sketches in `assets/sketches.js` that animate:
- the logit-guided tree search (hero),
- sub-word vs. custom-vocabulary tokenization,
- token-level symbolic validation,
- β-branch spawning under the k<sub>max</sub> cap.

## Citation
```bibtex
@inproceedings{volts2026,
  title     = {VOLTS: Validated Output through Logit Tree Search for Reliable PDDL Planning with Small Language Models},
  booktitle = {Proceedings of the 39th Canadian Conference on Artificial Intelligence},
  series    = {Proceedings of Machine Learning Research},
  volume    = {318},
  year      = {2026}
}
```
