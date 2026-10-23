# AI governance

**Scope:** Drift’s local assist features  
**Model provider:** none  
**Last updated:** 2026-10-23

## 1. What “AI” means in v1

Drift v1 ships **deterministic, explainable assistance**, not a generative model. There is no model SDK, no prompt, no external inference call, and no customer data sent to a third party.

| Feature | Mechanism | User-visible output |
|---|---|---|
| Quick-add parsing | Regex/grammar rules over the capture text | Parsed date, time, priority, labels, estimate, recurrence |
| Today plan | Weighted ranking over due date, priority, effort, focus date, and capacity | Ordered tasks with a short reason per task |
| Checklist suggestions | Small template library keyed by task verbs | Suggested subtasks, never auto-applied |
| Board health | Counts and aging thresholds | WIP/aging hints in Insights |

This is a deliberate product and governance choice: it is testable, works offline, has no per-token cost, and cannot leak data to a provider. It also means the product does **not** claim LLM-quality summarization or free-form generation.

## 2. Data boundary

- Input text is processed in the same Node.js process as the request.
- No task, comment, email, attachment, or user identifier is sent to an external AI service.
- No model weights are downloaded at runtime.
- Logs contain request metadata, not prompt/task bodies.
- The feature works with the network disconnected once the app shell is loaded.

If a future release adds an external provider, it must ship with: explicit opt-in per workspace, a data-processing addendum, a retention/zero-training configuration, a prompt/response logging policy, and a kill switch that does not require a deploy.

## 3. Human oversight

- Suggestions are **advisory**. The user must accept a checklist suggestion; the app never writes it silently.
- Today items show a reason (“Due today”, “High priority, fits your remaining 45 min”) so the ranking is contestable.
- “Not today” dismisses an item for that local date without changing its data.
- Automation is separate from assist and always requires a preview + explicit Apply; automation runs are audited and undoable for 60 seconds.
- The user can turn off assist per workspace (`aiEnabled`) or globally (`AI_KILL_SWITCH=true`).

## 4. Controls and flags

| Control | Location | Effect |
|---|---|---|
| `Workspace.aiEnabled` | Workspace settings / DB | Hides assist suggestions for that workspace |
| `AI_KILL_SWITCH=true` | Environment | Disables all assist suggestions process-wide |
| Capacity setting | Settings → Planning | Changes the minutes available to the Today planner |
| Dismissal | Today item menu | Removes an item from today’s plan only |
| Automation preview | Settings → Automations | Side-effect-free diff before apply |

The kill switch is read at request time, not build time, so it can be flipped without rebuilding. It does not delete historical suggestions because none are stored.

## 5. Evaluation

Two deterministic 20-case tables live in `tests/unit/ai-eval.test.ts`:

1. **Quick-add:** relative dates, weekdays, explicit dates, times, priorities, estimates, labels, recurrence, plural units, and ambiguous input.
2. **Today planning:** overdue, due today, focus date, high priority, effort vs remaining capacity, overbooking, completed/archived exclusion, and stable ordering.

The test asserts exact parses/order, so a rule change is visible in review. It is a regression suite, not a benchmark of model quality. There is no accuracy claim beyond “these 40 fixtures pass”.

## 6. Failure modes

| Failure | Behavior |
|---|---|
| Unparseable date | The text stays in the title; no date is guessed silently |
| Ambiguous priority | Defaults to `none`; the user can set it in the drawer |
| Invalid timezone | Falls back to UTC for date keys |
| Capacity zero | Today shows the real total and marks the plan overbooked; it does not divide by zero |
| Kill switch on | Suggestions are absent, not broken; core capture/planning still works |
| Recurrence edge (DST) | Next occurrence is computed in the user’s timezone; tests cover spring/fall transitions |

## 7. Limitations

- No semantic search, summarization, transcription, or image understanding.
- No learning from user behavior; ranking weights are fixed and reviewable.
- No multilingual NLQ beyond English date/number vocabulary.
- No confidence scores; the parser either extracts a field or leaves it alone.
- The evaluation set is small and authored by the implementer; it is not independently validated.

## 8. Future external-model checklist

Before shipping an external model:

- [ ] Choose a provider with a no-training/zero-retention contract.
- [ ] Add explicit workspace opt-in and a clear “AI” label.
- [ ] Minimize payloads; never send attachments by default.
- [ ] Log prompts/responses only with consent and a short retention window.
- [ ] Add a per-workspace budget and rate limit.
- [ ] Add a kill switch and a fallback to deterministic rules.
- [ ] Run a bias/quality evaluation with representative tasks.
- [ ] Update the privacy policy, DPA, subprocessor list, and VPAT.
- [ ] Provide a human review path for any automated action.

Until then, the honest description is **“local deterministic assist”**, not “AI-powered”.
