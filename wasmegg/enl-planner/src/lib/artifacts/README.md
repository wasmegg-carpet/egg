# Artifacts Module

Handles artifact and stone data, lookup, and modifier calculations.

## Structure

- `types.ts`: Internal interfaces for artifact/stone options and modifiers.
- `data.ts`: Parsing and metadata lookup (artifact/stone maps).
- `calculator.ts`: Core logic for `calculateArtifactModifiers`.
- `utils.ts`: Helper functions for backup parsing and loadout summarization.
- `virtue.ts`: Specialized calculations for Clothed TE and optimal sets.

## Calculation Logic

All artifact effects in Egg Inc. stack **multiplicatively**. 
The total multiplier for a target is the product of `(1 + effectDelta)` for all equipped items.
Refer to `calculator.ts` for the implementation.
