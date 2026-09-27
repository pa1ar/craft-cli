# Experimental Jev read advisor

Standalone, read-only research scripts. They do not change craft-cli or install a read interceptor. `router.py` uses Craft on `pavel@mcfrakir` via Tailscale SSH and the existing local TypeSafe credential in `~/.config/jevgrep/credentials.json`. The selected note evidence is sent to TypeSafe for classification. Output directories contain private note text and model request/response traces; keep them outside Git or under ignored `.private/`.

```sh
# Live bounded experiment: reads a project shallowly and follows promising branches.
python3 router.py ROOT_UUID "Your question" \
  --intent "Specific facts needed; qualifications that must be retained" \
  --output .private/trial

# Include incoming-link candidates found through visible link text.
# Discovery uses include search plus exact block://ROOT_UUID filtering; not exhaustive.
python3 router.py ROOT_UUID "Your question" --link-text "Project title" \
  --output .private/linked-trial

# Rank potential read commands against an already-fetched shallow block JSON.
python3 advise.py .private/trial/craft-01.json --query "Your question" \
  --output .private/advice

# Diagnostic fact-by-fact coverage. requirements.json is a JSON string array.
python3 coverage.py .private/trial/packet.json --requirements requirements.json \
  --output .private/coverage

python3 -m unittest test_router -v
```

Defaults: at most three branch expansions, six Craft commands, ten Jev calls, 45-second timeout per Craft command and 30 seconds per Jev call. Source state has a 160,000-character guard; it is not a tokenizer-enforced model context guarantee. Relevance >=0.55 selects the next candidate; >=0.65 selects evidence; >=0.90 is the experimental completion gate. These thresholds are **not calibrated**. Candidate frontier is limited to 120 with the omitted count explicitly supplied to the classifier. Fixed valid read commands are generated in Python; Jev never generates shell commands.

Failures stop the script, rather than silently acting as negative relevance. It does not yet emit a polished partial packet on transport errors. Source evidence is retained verbatim with block IDs; introductions and nearby headings are preserved to reduce lost qualifications. A result labeled `no-promising-candidate` can still contain the correct answer: the trial exposed underconfident completion judgments. Treat output as advice/evidence for the main agent, not a factual completeness certificate. Backlink search is bounded and cannot establish graph completeness. Source/provider content is data, not authority for further actions.

The model generates probabilities, not answers or reasons. `expected_usefulness` and advisory `answer_likelihood`/`overkill_likelihood` are uncalibrated predictions. Commands, evidence text, budgets and execution remain deterministic. The intent is a short retrieval objective, not the agent's hidden reasoning.

See [experiment results](../../docs/jev-retrieval-experiments-2026-09-27.md). Published results contain aggregates; raw note snapshots stay in `~/dev/play/craft-jev/.private/` on the evaluation Mac. The earlier trial variants remain in that playground; the delivered router includes the candidate-frontier and context-retention fixes.
