---
name: ux-evaluation
description: Evaluate a feature's end-to-end user experience through source-blind browser journeys, isolated source scouting, and evidence-backed product arbitration. Use for a deliberate UX evaluation or reevaluation, not ordinary UI implementation or code review.
---

# UX evaluation

Evaluate whether a feature and its surrounding transitions form a coherent experience for its intended users. Separate observed behavior, inferred consequences, intended product constraints, and recommendations. Evaluate only; product changes require a separate user instruction.

## Establish the run

Before inspecting implementation or researching the product, critique the proposed evaluation approach and state the assumptions that affect it. Establish the target checkout or URL, audience, focus, intended outcomes, and known constraints from the user's request and any supplied brief. Ask only about consequential missing information. If the approach was already agreed in the current conversation, summarize the changes for this run and proceed; do not restart approval.

Use a supplied project brief when relevant, or establish the audience and product contract for this run. Do not borrow assumptions from unrelated features. Treat a brief as revisable context: newer user instructions take precedence.

Keep prior findings and design rationale out of the initial UI evaluators' context. A regression-focused request can explicitly supply known failures, but distinguish those checks from a fresh discovery pass. Do not call an evaluator blind if it has already read implementation or previous diagnoses; use a fresh agent or disclose the limitation.

## Preserve information boundaries

Use separate agents when available and authorized. The intended roles are moderator, infrastructure helper, UI evaluator, and source scout. Adapt the [agent briefs](references/agent-briefs.md) to the run. Delegate bounded goals and pass only the context each role needs; do not fork a source-aware or diagnosis-heavy history into a blind evaluator.

- **Moderator:** remains blind to implementation while evaluating UI evidence, challenging conclusions, and checking assumptions with the owner.
- **Infrastructure helper:** may inspect instructions and necessary setup/configuration files to serve the requested version. Returns access instructions and limitations, not implementation details.
- **UI evaluator:** uses a real browser and only rendered UI, screenshots, accessibility information, and ordinary interactions. No source, tests, bundles, internal application state, or network payloads to learn how to complete a goal.
- **Source scout:** starts only after the initial unseeded report is frozen. May inspect implementation and tests, but hands off only user goals, starting conditions, and necessary inputs. Keep reasons for choosing scenarios, expected outcomes, and suspected defects in a separate private note that the moderator and UI evaluators do not read. The same restriction applies to progress and final agent messages, which reach the moderator automatically.

If delegation is unavailable, keep the moderator source-blind and run UI journeys sequentially. Omit source scouting rather than silently compromising blindness. If a usable browser or required test data is unavailable, report that coverage limit; do not substitute code review for UI exploration.

Synthetic fixtures may be prepared by the scout and uploaded through ordinary UI controls without evaluators reading their contents. Have the scout check both format and domain plausibility, and state fixture assumptions. An impossible synthetic starting state cannot establish a product calculation defect. Use supplied appropriate accounts; do not guess account identifiers.

## Run the evaluation

1. **Unseeded pass.** Give an evaluator one or two realistic user goals and the audience baseline, not click scripts. Capture first impressions and expectations before learning the controls. Follow natural paths into and out of the requested feature. Freeze this report before source scouting or reading prior findings. Give each phase a distinct output path; preserve the frozen report and record later corrections separately rather than overwriting its observations.
2. **First checkpoint.** Review concrete evidence, strengths, difficulties, and assumptions weakened or supported. Ask the owner to arbitrate consequential product intent that the UI cannot settle. Continue independent coverage while an answer is pending; silence is not confirmation.
3. **Broader pass.** Use sanitized scout goals and gaps from a coverage ledger. Choose breadth proportionate to the requested focus: setup, editing, alternatives, explanations, applying results, saving/sharing, returning, and recovery. Include relevant resource restrictions, multiple targets, and exceptional states. Do not force an arbitrary scenario count or repeat unchanged areas merely to fill a checklist.
4. **Independent checks.** Use a fresh evaluator for selected uncertain findings when useful. Include relevant phone/touch and keyboard checks. Clearly label emulation, accessibility-tree inspection, inherited knowledge, and moderator follow-ups; none substitutes for actual user observation or a full assistive-technology audit.
5. **Broader checkpoint.** Challenge apparent defects and look for patterns across journeys. Resolve product tradeoffs with the owner where needed. Do not promote an unsupported feature expectation into a requirement.
6. **Synthesis.** Prioritize consequences and confidence, preserve strengths, and recommend proportionate changes. Explain how clarified assumptions change priority. Update the consolidated review while leaving frozen observations intact as history.

A source-derived scenario is still a goal, not an answer key. An evaluator may conclude that the UI cannot support it. Judge whether that matters against the product's actual contract. Deliberate approximation, a narrowly defined target, or a non-goal may call for clearer communication rather than additional functionality.

## Evidence and verification

For each journey, record the goal, starting conditions, exact consequential inputs, attempted actions, expectations formed from the UI, observed outcome, recovery, screenshots, and whether the goal was achieved, partial, or blocked. Record tested revision/environment and changes in assumptions. An agent's confusion is evidence of a potential problem, not a measure of prevalence among users.

Before calling an interaction a product failure:

- Inspect the relevant screenshot and visible state; confirm the interaction was completed, including menus, confirmation steps, and closing animations.
- Distinguish browser permissions, automation errors, session loss, and local-server lifecycle problems from application behavior. Preserve useful state across tool calls, and exclude waits caused by reloading or restarting tooling from product latency.
- Report actual timings only when measured; polling intervals give upper bounds.
- Test shared links in a fresh profile when assessing what they preserve. Distinguish a target link from saved settings or a full result. Keep local and deployed versions separate; if substituting a local origin, disclose what that does and does not verify.
- Use normal UI routes to investigate persistence or exports. Do not infer data loss, stale exported contents, infeasibility, or numerical correctness solely from a label, changed result, or inaccessible payload.

If the user's scope includes implementation diagnosis, finish and freeze the UI evaluation first. Obtain diagnosis from a separate role and label any subsequent moderator synthesis as source-informed. This ends the moderator's blind phase; do not claim continued blindness or feed that context into fresh UI evaluators. Ordinary UX evaluation does not require this diagnostic phase.

## Deliverables

Maintain a coverage ledger and an assumptions/arbitration log during the run. Save durable review artifacts in the user-specified location, or choose and report a repository-local output directory. Keep supporting screenshots and journey notes linked from the review. Keep source-scout private notes separate from review inputs. Do not commit evaluation artifacts unless requested.

Use [the review template](assets/review-template.md) as a starting structure; scale it to the task. Include:

- A coherent assessment of the user journey and transitions, not just a collection of control-level complaints.
- Findings supported by reproduction evidence, their likely impact and confidence, alternatives to the interpretation, and recommendations proportionate to what was established.
- Strengths to preserve, resolved product constraints, and any remaining questions.
- Coverage and explicit limits, including untested accounts, integrations, devices, or calculation correctness. Distinguish an exercised scenario from a fully verified outcome.

Before final prioritization, state what owner clarifications changed. Link the review in a concise final response, name material limits, and say whether product files changed. Do not claim exhaustive coverage or actual-user validation.

## Example invocation

```text
$ux-evaluation
Evaluate the new saved-report workflow in the local checkout.
Focus on first-time saving, revising a report, and returning later.
The audience is experienced analysts. Capture fresh observations
before consulting previous findings. Subagent delegation is authorized.
```
