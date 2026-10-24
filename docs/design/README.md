# FreeEdit visual design reference

Open `FreeEdit-Design.html` directly in a browser. This preserves the original polished preview: a stylized recording window, camera inset, task rail, inspector, and timeline. It is an interactive mockup, not a copy of the running editor. The editable fragment is `FreeEdit-Design-Source.html`.

The design now includes Videos, Captions, Edits, Audio, Pauses, Background, Reframe, Cut, Text, Hide area, and Export. Presenter controls include placement, source timing, background effect, sound source, and volumes. The unified edit list exposes selection, timing, removal, and representative text/mask/reframe properties. Separate timeline lanes show pauses, cuts, masks, text, and reframe portions.

Reframe has two sections collapsed initially, with only one expanded at a time. A dashed crop guide appears before adding a portion. Expanded controls scroll in the inspector. Processing examples expose progress, Cancel, Retry, and before/after selection. Project/help menus, import examples, light/dark/system appearance, and responsive layouts remain.

Media effects and processing are illustrative. Selecting files demonstrates control states; the mockup does not process or export actual edited recordings. Run the FreeEdit app for real media editing.

The repository and downloaded design folders contain matching source and standalone HTML files. The standalone wrapper embeds the editable fragment. Keep both copies synchronized when updating the design. Syntax checks cover the embedded scripts; the browser tool cannot open file URLs for visual verification.
