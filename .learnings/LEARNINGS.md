# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260518-001] correction

**Logged**: 2026-05-18T18:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
`margin: 0 auto` centers within remaining flex space, not the container. For toolbar filter chips that need to stay visually centered regardless of left/right column widths, `position: absolute; left: 50%; transform: translateX(-50%)` is the correct approach.

### Details
When a toolbar has left (title+count) and right (action buttons) columns of varying widths, placing filter chips in a center column with `margin: 0 auto` only centers them within the remaining gap between left and right. If left is 200px and right is 300px, the center shifts toward the narrower side.

The fix: make the center column `position: absolute; left: 50%; transform: translateX(-50%)`, anchored to the parent (`position: relative`).

### Suggested Action
For truly fixed-position filter bar in a toolbar where the title varies in length: use CSS grid with fixed-width left column. 
```css
grid-template-columns: 260px 1fr auto;
```
Title+count in column 1 (fixed), filter bar in column 2 with `justify-self: start`, actions in column 3 (auto). Filter bar always starts at exactly `260px + gap` from the left edge. No absolute positioning needed.

### Metadata
- Source: user_feedback
- Related Files: app/pages/index.vue
- Tags: css, grid, toolbar, fixed-position
- Pattern-Key: harden.grid_fixed_filter_bar
- Recurrence-Count: 3
- First-Seen: 2026-05-18
- Last-Seen: 2026-05-18

---
