# Agent handoffs

Adapt these briefs to the user's focus and available tools. Supply the agreed audience, target, relevant product contract, output paths, and necessary access instructions. Do not supply prior diagnoses to a fresh UI evaluator. Keep each assignment bounded; source scouting must wait until initial observations are frozen.

## Infrastructure helper

Prepare access to the requested application version. Read applicable repository instructions and only the setup/package/configuration files needed to start it. Do not inspect feature implementation or select test scenarios. Verify browser access and report the URL, revision, browser mechanism, required instructions, and environment limitations. Keep the server alive across agent/tool lifetimes using an appropriate local process mechanism. Do not change product files or affect an existing unrelated server. Return no implementation explanations.

## Unseeded UI evaluator

Using only the supplied audience baseline and real browser UI, pursue the assigned user goal. Work out the route from visible controls rather than reading implementation or requesting expected behavior. Screenshots, visible DOM, accessibility information, and ordinary browser interactions are allowed; application source, tests, bundles, internal state and network payloads are not.

Capture initial expectations before learning controls. Record exact inputs, attempts, outcomes, recovery, and screenshots. Explain which parts of the goal you could accomplish and where evidence is inconclusive. Do not classify tooling failures as app defects. Freeze a report before receiving any source-selected scenarios or prior findings.

## Source scout

The initial UI report is frozen. Inspect relevant source and tests to identify overlooked user journeys and starting conditions within the requested scope. Keep your reasoning and expected outcomes in a separate private note. Hand off only scenario cards with:

- A concrete user goal.
- The user's situation and relevant constraints.
- Necessary inputs or fixture paths, with assumptions and limitations.

Do not include click sequences, implementation names, suspicious outcomes, reasons for scenario selection, or suggested findings. Apply this boundary to progress and final messages too: report sanitized handoff paths and input limitations, never summarize private diagnoses. Validate synthetic fixtures against both the accepted format and plausible domain constraints. Store them outside product code. Do not access real accounts or invent account IDs. Provide useful breadth, not an exhaustive catalog of implementation branches.

## Broader UI evaluator

Read only the sanitized scenario cards and the necessary audience/access brief. Upload supplied fixtures through the UI without inspecting their contents. Exercise assigned goals independently unless a card explicitly continues an earlier journey. Preserve exact settings and screenshot evidence, and distinguish observed behavior from hypotheses about the implementation. Report unmet goals rather than inventing hidden-state workarounds. Keep these findings separate from the frozen unseeded report.

## Independent retest

Give a fresh evaluator the goal and starting conditions needed to reproduce the journey, without the suspected problem or desired conclusion. Ask it to record actions and results independently. Compare evidence afterward; agreement between agents supports reproducibility, not prevalence among real users.
