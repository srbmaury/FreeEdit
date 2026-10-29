# FreeEdit product roadmap

Updated: 29 October 2026. Completed features are listed below; remaining additions are proposals, not implementation commitments.

## Implemented

- **Speed adjustment for selected ranges** — 0.25×–4×, preserved audio pitch, source-time edits, undo/redo, project recovery, preview and export. Up to 20 non-overlapping speed ranges.
- **Multi-clip sequencing** — compatible clips with ordering and join-transition controls; advanced per-clip trimming and heterogeneous media remain future work.

- **Duplicate edits and copy/paste styles** — inspector actions and keyboard shortcuts; independent drawing-group copies; compatible style paste preserves content, placement and timing.
- **Canvas backgrounds and framing** — Reframe panel controls for padding, rounded corners, shadows, color/image backgrounds and aspect choices; persisted in projects and recovery with undo/redo, live preview and export support.

- **Cursor spotlight and click highlights** — manually placed timed annotations with size, color, dimming/opacity and Fade/None controls; timeline, project recovery, preview and export support.
- **Audio mute and volume regions** — timed mute/volume changes with boundary fades, editable timeline regions, project recovery, processed preview, presenter-mix support and export.

## Suggested implementation order

1. **Timing snapping** — snap edit boundaries to the playhead, cuts, and other edits; show the target and allow a temporary bypass.
2. **Freeze frame** — hold a moment for an explanation. Design its effects on audio, captions, other timed edits, preview seeking, and exported duration before implementation.

## Editing features

| Feature | User benefit | Estimated effort | Scope and considerations |
| --- | --- | --- | --- |
| Cursor spotlight and click highlights (implemented) | Direct attention to actions in tutorials | Medium | Manual placement with spotlight dimming and click-ring appearance/timing controls. Automatic pointer tracking and event metadata import remain future work. |
| Freeze frame | Hold a moment while displaying text, arrows, or explanations | Medium | Insert a configurable hold at a source timestamp. Define audio behavior and map all existing timed edits onto the extended output timeline. |
| Speed adjustment for selected ranges (implemented) | Accelerate waiting periods or slow down demonstrations | High | 0.25×–4× range controls with preserved audio pitch; cuts, captions and effects retain source timing, with speed-aware preview/export comparison. |
| Intro/outro cards | Add a title, context, or closing call to action | Low–medium | Start with configurable text, background, and duration. Define transitions and placement outside the original recording timeline. |
| Canvas backgrounds and framing (implemented) | Produce polished recordings with minimal setup | Medium | Add padding, rounded corners, shadows, background colors/images, and aspect-ratio choices. Keep framing consistent with Reframe, presenter overlays, and export. |
| Audio mute and volume regions (implemented) | Remove notification sounds or adjust specific passages | Medium | Add timed mute/volume changes with short fades. Applies to the selected main/presenter mix before cuts; overlapping gains multiply and boosts are limited to prevent clipping. |
| Automatic captions | Generate editable subtitles from speech | High | Generate existing timed text edits, with language and model controls. Evaluate local processing, model dependencies, resource use, and transcript correction. |
| Advanced multi-clip editing | Combine multiple recordings into one demo | Very high | Basic compatible-clip sequencing is implemented. Extend it with per-clip trimming and support for heterogeneous recordings as a separate architectural initiative. |

## Workflow improvements

- **Audio mute and volume regions (implemented):** support up to 50 original-source-time regions, individually editable from cards and the Volume track, with 0–200% volume, 0–0.25s fades, processed range preview and audio-only/video export.
- **Duplicate edits and copy/paste styles (implemented):** duplicate an edit with a new identity; copy compatible appearance settings without overwriting content, position, or timing unintentionally. Support drawing groups.
- **Timing snapping:** snap to the playhead, cut boundaries, and other edit boundaries. Show the snap target and provide a temporary bypass.
- **Lock and hide edits:** prevent accidental changes to overlapping objects. Explicitly distinguish editor-only visibility from whether an edit appears in export.
- **Names for drawings and groups:** show user-defined names in the inspector and timeline, and preserve them through project files, recovery, and history.
- **Searchable command palette:** expose editing actions and keyboard shortcuts through a compact searchable interface, with unavailable actions disabled appropriately.

## Delivery expectations

- Keep FreeEdit focused on screen-recording cleanup and explanation.
- Use the existing document mutation boundary and undo/redo system.
- Preserve features through project save/load and browser recovery.
- Keep source-time and output-time behavior explicit, especially for freeze frames, speed changes, and added cards.
- Verify preview/export agreement and cover affected workflows in browser and rendering tests.
- Apply existing resource limits, or define new bounds where a feature introduces additional media or model processing.
