import { Plugin, Modal, Setting, App, Editor, MarkdownView, Menu, MenuItem } from 'obsidian';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType
} from "@codemirror/view";
import { Extension, RangeSetBuilder } from '@codemirror/state';

// --- Custom Widgets ---

class StartMarkerWidget extends WidgetType {
	constructor(readonly name: string) {
		super();
	}

	eq(other: StartMarkerWidget): boolean {
		return other.name === this.name;
	}

	toDOM(view: EditorView): HTMLElement {
		const line = document.createElement("span");
		line.className = "bulldozer-marker-line";

		const nameBox = document.createElement("span");
		nameBox.className = "bulldozer-name-box";
		nameBox.textContent = this.name;

		line.appendChild(nameBox);

		return line;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class EndMarkerWidget extends WidgetType {
	eq(other: EndMarkerWidget): boolean {
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		const line = document.createElement("span");
		line.className = "bulldozer-marker-line";
		return line;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

// --- CodeMirror Extension Logic ---

const bulldozerTextMark = Decoration.mark({
	class: "bulldozerTEXT"
});

const blockRegex = /\\begin{questionenv}\[([^\]]+)\](.*?)\\end{questionenv}/gs;

function findAndDecorateBulldozerBlocks(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		blockRegex.lastIndex = 0;
		let match;

		while ((match = blockRegex.exec(text))) {
			const name = match[1];
			const textContent = match[2];

			const blockStartIndex = from + match.index;
			const startMarkerEndIndex = blockStartIndex + "\\begin{questionenv}[".length + name.length + "]".length;
			const textStartIndex = startMarkerEndIndex;
			const textEndIndex = textStartIndex + textContent.length;
			const endMarkerStartIndex = textEndIndex;
			const blockEndIndex = endMarkerStartIndex + "\\end{questionenv}".length;

			builder.add(
				blockStartIndex,
				startMarkerEndIndex,
				Decoration.replace({
					widget: new StartMarkerWidget(name),
				})
			);

			if (textEndIndex > textStartIndex) {
				builder.add(textStartIndex, textEndIndex, bulldozerTextMark);
			}

			builder.add(
				endMarkerStartIndex,
				blockEndIndex,
				Decoration.replace({
					widget: new EndMarkerWidget(),
				})
			);
		}
	}

	return builder.finish();
}

// --- Modal for Input ---
class InputModal extends Modal {
    inputValue: string = '';
    onSubmit: (value: string) => void;

    constructor(app: App, onSubmit: (value: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "Enter new value:" });

        new Setting(contentEl)
            .setName("New Name")
            .addText((text) =>
                text.onChange((value) => {
                    this.inputValue = value;
                }).inputEl.focus());

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Submit")
                    .setCta()
                    .onClick(() => {
                        this.close();
                        this.onSubmit(this.inputValue);
                    }));

        contentEl.find('input[type="text"]')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.close();
                this.onSubmit(this.inputValue);
            }
        });
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

const bulldozerHighlightPlugin = (app: App) => ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = findAndDecorateBulldozerBlocks(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = findAndDecorateBulldozerBlocks(update.view);
			}
		}
	},
	{
		decorations: (value) => value.decorations,
		eventHandlers: {
			click: (event, view) => {
				const target = event.target as HTMLElement;

				if (target.classList.contains("bulldozer-name-box")) {
					console.log("Name clicked:", target.textContent);
					new InputModal(app, (newValue) => {
						console.log("New value submitted:", newValue);

						// Get the position of the name
						const name = target.textContent;
						const blockRegex = new RegExp(`\\\\begin{questionenv}\\[${name}\\](.*?)\\\\end{questionenv}`, 'gs');
						blockRegex.lastIndex = 0;
						const text = view.state.doc.toString();
						let match;
						if ((match = blockRegex.exec(text))) {
							const blockStartIndex = match.index;
							const startMarkerEndIndex = blockStartIndex + "\\begin{questionenv}[".length + name.length + "]".length;

							// Replace the content in the editor
							const transaction = view.state.update({
								changes: { from: blockStartIndex + "\\begin{questionenv}[".length, to: startMarkerEndIndex - "]".length, insert: newValue },
								selection: { anchor: blockStartIndex + "\\begin{questionenv}[".length + newValue.length }
							});
							view.dispatch(transaction);


						}

					}).open();
				}
			},
		},
	}
);

// --- Obsidian Plugin ---
export default class BulldozerHighlighterPlugin extends Plugin {

	async onload() {
		console.log('Loading Bulldozer Highlighter plugin');

		// Add the editor command and context menu
		this.addInsertQuestionBlockCommand();

		this.registerEditorExtension(bulldozerHighlightPlugin(this.app));
	}

	onunload() {
		console.log('Unloading Bulldozer Highlighter plugin');
	}

	// --- New Function for Command and Context Menu ---
	addInsertQuestionBlockCommand() {
		const START_DELIMITER = "\\begin{questionenv}[ ]";
		const END_DELIMITER = "\\end{questionenv}";

		// --- 1. Add the Command ---
		this.addCommand({
			id: 'insert-question-block',
			name: 'Insert Question Block',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log("Insert Question command triggered");
				const cursor = editor.getCursor();
				const lineContent = editor.getLine(cursor.line);

				// Prepare the text with delimiters and ensure newlines for block behavior
				// Place cursor between the delimiters on a new line
				const textToInsertStart = START_DELIMITER + "\n";
				const textToInsertEnd = "\n" + END_DELIMITER;

				// Insert the start delimiter at the cursor
				editor.replaceRange(textToInsertStart, cursor);

				// Calculate the position for the end delimiter (after the start + newline)
				const newCursorPosForEnd = { line: cursor.line + 1, ch: 0 };

				// Insert the end delimiter
				editor.replaceRange(textToInsertEnd, newCursorPosForEnd);

				// Set the cursor position *between* the delimiters
				editor.setCursor(newCursorPosForEnd); // Cursor is now at the start of the line where END_DELIMITER begins
				// Move cursor up one line to be inside the block
				const finalCursorPos = { line: cursor.line + 1, ch: 0 };
				editor.setCursor(finalCursorPos);


				console.log("Inserted delimiters");
			},

		});

		// --- 2. Add the Context Menu Item ---
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
				menu.addItem((item: MenuItem) => {
					item
						.setTitle("Insert Question")
						.setIcon("help-circle")
						.onClick(async () => {
							this.app.commands.executeCommandById(`${this.manifest.id}:insert-question-block`);
						});
				});
			})
		);
	}
}
