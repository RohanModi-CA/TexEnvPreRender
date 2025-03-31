/*
GOAL: Bulldozer Highlighter Plugin for Obsidian.
The primary aim of this plugin is to visually transform text sections enclosed
within custom markers, specifically `\\begin{questionenv}[name]` and `\\end{questionenv}`,
within the Obsidian editor's Live Preview mode.

BROAD OVERVIEW:
1.  **Leverage CodeMirror 6:** Utilize Obsidian's underlying editor engine, CodeMirror 6 (CM6), and its extension system.
2.  **Define Custom Widgets:** Create visual elements (CM6 Widgets) to *replace* the `\\begin{questionenv}[name]` and `\\end{questionenv}` markers entirely, providing a distinct visual representation (like lines or boxes).
3.  **Define Content Styling:** Create a CM6 Mark Decoration to apply specific CSS styling to the text content *between* the start and end markers.
4.  **Pattern Matching:** Use a Regular Expression to efficiently locate all instances of the `\\begin{questionenv}[name]...\\end{questionenv}` pattern within the visible portion of the editor document.
5.  **Dynamic Decoration Management:** Implement a CM6 ViewPlugin. This plugin will be responsible for:
    *   Running the pattern matching logic.
    *   Generating the appropriate Widget and Mark decorations based on the matches found.
    *   Keeping the decorations updated efficiently as the user types, scrolls, or changes the document content.
6.  **Obsidian Plugin Integration:** Create a standard Obsidian plugin class.
7.  **Register CM6 Extension:** Within the Obsidian plugin's `onload` method, register the custom CM6 ViewPlugin so that it becomes active in the editor.
8.  **CSS Styling:** Provide accompanying CSS rules (in `styles.css`) to define the appearance of the custom widgets and marked content.
*/

import { Plugin } from 'obsidian';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType // Import WidgetType
} from "@codemirror/view";
import { Extension, RangeSetBuilder } from '@codemirror/state';

// --- Custom Widgets ---

/**
 * @class StartMarkerWidget
 * GOAL: To create a custom visual representation that replaces the `\\begin{questionenv}[name]` text
 *       in the CodeMirror editor view. It displays a line with the extracted 'name' inside a box.
 * HOW:
 * 1. Extends `WidgetType` from CodeMirror.
 * 2. Constructor stores the `name` to be displayed.
 * 3. `eq` method compares names for efficient updates (CodeMirror avoids redrawing if the widget content is the same).
 * 4. `toDOM` method generates the actual HTMLElement structure:
 *    - Creates a main container `<span>` with the "bulldozer-marker-line" class.
 *    - Creates an inner `<span>` with the "bulldozer-name-box" class.
 *    - Sets the text content of the name box to the stored `name`.
 *    - Appends the name box to the main line span.
 *    - Returns the main line span to be inserted into the editor DOM.
 * 5. `ignoreEvent` returns `true` to prevent user interaction (like clicks or selection) with the widget itself.
 */
class StartMarkerWidget extends WidgetType {
	constructor(readonly name: string) {
		super();
	}

	eq(other: StartMarkerWidget): boolean {
		// Only redraw if the name itself has changed
		return other.name === this.name;
	}

	toDOM(view: EditorView): HTMLElement {
		// Create the main line element
		const line = document.createElement("span");
		line.className = "bulldozer-marker-line"; // Apply line style from styles.css

		// Create the name box element
		const nameBox = document.createElement("span");
		nameBox.className = "bulldozer-name-box"; // Apply name box style from styles.css
		nameBox.textContent = this.name; // Display the captured name

		// Append the name box to the line
		line.appendChild(nameBox);

		return line;
	}

	// Users typically shouldn't interact with these visual markers
	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * @class EndMarkerWidget
 * GOAL: To create a custom visual representation that replaces the `\\end{questionenv}` text.
 *       It displays a simple line.
 * HOW:
 * 1. Extends `WidgetType`.
 * 2. `eq` method always returns `true` because all end markers look identical, optimizing redraws.
 * 3. `toDOM` creates a simple `<span>` with the "bulldozer-marker-line" class.
 * 4. `ignoreEvent` returns `true` to prevent interaction.
 */
class EndMarkerWidget extends WidgetType {
	// All end markers are visually the same
	eq(other: EndMarkerWidget): boolean {
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		const line = document.createElement("span");
		line.className = "bulldozer-marker-line"; // Apply line style
		return line;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

// --- CodeMirror Extension Logic ---
// This section contains the core logic for the CodeMirror 6 extension itself.

/**
 * @const bulldozerTextMark
 * GOAL: Defines how the text *between* the bulldozer markers should be visually styled.
 * HOW: Creates a CodeMirror `Decoration.mark`. This type of decoration applies styling
 *      (in this case, the CSS class "bulldozerTEXT") to a range of existing text
 *      without replacing it. The actual styles are defined in `styles.css`.
 */
const bulldozerTextMark = Decoration.mark({
	class: "bulldozerTEXT"
});

/**
 * @const blockRegex
 * GOAL: Defines the pattern used to find the entire `\\begin{questionenv}[name]...\\end{questionenv}` block.
 * HOW: Uses a JavaScript Regular Expression:
 *      - `\\begin{questionenv}\[`: Matches the literal starting text and opening bracket.
 *      - `([^\]]+)`: Captures group 1. Matches one or more characters (`+`) that are *not* a closing square bracket (`[^\]]`). This captures the 'name'.
 *      - `\]`: Matches the literal closing square bracket.
 *      - `(.*?)`: Captures group 2. Matches any character (`.`) zero or more times (`*`), non-greedily (`?`). This captures the content between the markers.
 *      - `\\end{questionenv}`: Matches the literal ending text.
 *      - `gs` flags: `g` for global search (find all occurrences), `s` allows `.` to match newline characters (so blocks can span multiple lines).
 */
const blockRegex = /\\begin{questionenv}\[([^\]]+)\](.*?)\\end{questionenv}/gs;


/**
 * @function findAndDecorateBulldozerBlocks
 * GOAL: To scan the visible portion of the editor, find all bulldozer blocks matching
 *       the `blockRegex`, and generate a `DecorationSet` containing the necessary
 *       Widget and Mark decorations for rendering.
 * HOW:
 * 1. Initializes a `RangeSetBuilder` to efficiently collect decorations.
 * 2. Iterates through the `visibleRanges` provided by the `EditorView`. Processing only visible ranges is crucial for performance, especially in large documents.
 * 3. Extracts the text content (`text`) of the current visible slice.
 * 4. Resets `blockRegex.lastIndex = 0` before each slice iteration (required for global regex loops).
 * 5. Uses a `while` loop with `blockRegex.exec(text)` to find all matches within the slice.
 * 6. For each `match` found:
 *    a. Extracts the captured `name` (match[1]) and `textContent` (match[2]).
 *    b. Calculates the absolute start/end positions within the *full document* for the start marker (`\\begin{questionenv}[name]`), the content, and the end marker (`\\end{questionenv}`). This involves adding the `from` offset of the visible range slice to the relative `match.index`.
 *    c. Adds three decorations to the `builder`:
 *       i.   A `Decoration.replace` using `StartMarkerWidget` to replace the calculated range of `\\begin{questionenv}[name]`.
 *       ii.  A `Decoration.mark` using `bulldozerTextMark` applied to the calculated range of the `textContent` (only if content exists).
 *       iii. A `Decoration.replace` using `EndMarkerWidget` to replace the calculated range of `\\end{questionenv}`.
 * 7. Returns the final, efficiently structured `DecorationSet` by calling `builder.finish()`.
 */
function findAndDecorateBulldozerBlocks(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		blockRegex.lastIndex = 0; // Reset regex state for each slice
		let match;

		while ((match = blockRegex.exec(text))) {
			const name = match[1];
			const textContent = match[2];

			// Calculate absolute positions within the full document
			const blockStartIndex = from + match.index;
			// Calculate end of the start marker section including name and brackets
			const startMarkerEndIndex = blockStartIndex + "\\begin{questionenv}[".length + name.length + "]".length;
			// Text content starts immediately after the start marker section
			const textStartIndex = startMarkerEndIndex;
			// Text content ends before the end marker starts
			const textEndIndex = textStartIndex + textContent.length;
			// End marker starts immediately after the text content
			const endMarkerStartIndex = textEndIndex;
			// Calculate the full end position of the block
			const blockEndIndex = endMarkerStartIndex + "\\end{questionenv}".length; // == from + match.index + match[0].length

			// 1. Replace \\begin{questionenv}[name] with the StartMarkerWidget
			builder.add(
				blockStartIndex,
				startMarkerEndIndex,
				Decoration.replace({
					widget: new StartMarkerWidget(name),
					// block: true // Uncomment if widget should force a block layout
				})
			);

			// 2. Apply bulldozerTEXT mark to the content in between
			// Only add mark if there is actual content
			if (textEndIndex > textStartIndex) {
				builder.add(textStartIndex, textEndIndex, bulldozerTextMark);
			}

			// 3. Replace \\end{questionenv} with the EndMarkerWidget
			builder.add(
				endMarkerStartIndex,
				blockEndIndex,
				Decoration.replace({
					widget: new EndMarkerWidget(),
					// block: true // Uncomment if widget should force a block layout
				})
			);
		}
	}

	return builder.finish();
}


/**
 * @const bulldozerHighlightPlugin
 * GOAL: The main CodeMirror 6 ViewPlugin that orchestrates the decoration process.
 * HOW:
 * 1. Uses `ViewPlugin.fromClass` to define the plugin based on a class.
 * 2. The class instance holds the current `DecorationSet` in its `decorations` property.
 * 3. `constructor`: Called when the plugin is initialized for an editor view. It calls `findAndDecorateBulldozerBlocks` to generate the initial set of decorations.
 * 4. `update`: Called by CodeMirror whenever the view might have changed (document content, viewport scroll, selection, etc.).
 *    - It checks relevant `update` flags (`docChanged`, `viewportChanged`, `selectionSet`) to determine if decoration recalculation is necessary. This is an optimization to avoid expensive processing on every minor change.
 *    - If needed, it calls `findAndDecorateBulldozerBlocks` again to get the updated `DecorationSet` for the new view state.
 * 5. The configuration object `{ decorations: v => v.decorations }` tells CodeMirror that this plugin *provides* decorations and how to access them (from the `decorations` property of the plugin instance `v`).
 */
const bulldozerHighlightPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = findAndDecorateBulldozerBlocks(view);
		}

		update(update: ViewUpdate) {
			// Update decorations if document, viewport, or selection changes
			// Recalculating on viewport change ensures newly visible blocks are decorated.
			// Recalculating on doc change ensures decorations map correctly to new content.
			// Selection change is included as a safety measure, though not strictly needed by this specific logic.
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = findAndDecorateBulldozerBlocks(update.view);
			}
		}
	},
	{
		// Provide the decorations to the editor view system
		decorations: (value) => value.decorations,
	}
);

// --- Obsidian Plugin ---
// This section defines the actual Obsidian plugin that integrates the CodeMirror extension.

/**
 * @class BulldozerHighlighterPlugin
 * GOAL: The main entry point and lifecycle manager for the Obsidian plugin.
 * HOW:
 * 1. Extends `Plugin` from the `obsidian` API.
 * 2. Implements the required `onload` and `onunload` methods.
 */
export default class BulldozerHighlighterPlugin extends Plugin {

	/**
	 * @method onload
	 * GOAL: Called by Obsidian when the plugin is loaded or enabled. Used for setup.
	 * HOW:
	 * 1. Logs a message to the developer console indicating loading.
	 * 2. Registers the CodeMirror extension (`bulldozerHighlightPlugin`) using the
	 *    Obsidian API method `this.registerEditorExtension()`. This activates the
	 *    custom rendering logic within any Markdown editor views.
	 */
	async onload() {
		console.log('Loading Bulldozer Highlighter plugin');
		this.registerEditorExtension(bulldozerHighlightPlugin);
	}

	/**
	 * @method onunload
	 * GOAL: Called by Obsidian when the plugin is disabled or unloaded. Used for cleanup.
	 * HOW:
	 * 1. Logs a message to the developer console indicating unloading.
	 * 2. In this specific plugin, there are no complex resources (like intervals, global listeners)
	 *    to clean up manually. Obsidian automatically handles the deregistration of
	 *    editor extensions registered via `registerEditorExtension`.
	 */
	onunload() {
		console.log('Unloading Bulldozer Highlighter plugin');
	}
}
