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
        // Add data attribute to easily get name on click
        nameBox.dataset.questionName = this.name;

        line.appendChild(nameBox);

        return line;
    }

    ignoreEvent(): boolean {
        return false; // Allow clicks
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
        return true; // Ignore clicks
    }
}

// --- CodeMirror Extension Logic ---

const bulldozerTextMark = Decoration.mark({
    class: "bulldozerTEXT"
});

const blockRegex = /\\begin{questionenv}\[([^\]]+)\](.*?)\\end{questionenv}/gs;

function findAndDecorateQuestionEnvBlocks(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const text = view.state.doc.toString(); // Process entire document content
    blockRegex.lastIndex = 0; // Reset regex state

    let match;
    while ((match = blockRegex.exec(text))) {
        const name = match[1];
        const textContent = match[2];

        // Calculate absolute positions within the full document
        const blockStartIndex = match.index;
        const startMarkerEndIndex = blockStartIndex + "\\begin{questionenv}[".length + name.length + "]".length;
        const textStartIndex = startMarkerEndIndex;
        const textEndIndex = textStartIndex + textContent.length;
        const endMarkerStartIndex = textEndIndex;
        const blockEndIndex = endMarkerStartIndex + "\\end{questionenv}".length;

        // Replace \begin{questionenv}[name] with StartMarkerWidget
        builder.add(
            blockStartIndex,
            startMarkerEndIndex,
            Decoration.replace({
                widget: new StartMarkerWidget(name),
            })
        );

        // Apply styling to the inner text (if content exists)
        if (textEndIndex > textStartIndex) {
            builder.add(textStartIndex, textEndIndex, bulldozerTextMark);
        }

        // Replace \end{questionenv} with EndMarkerWidget
        builder.add(
            endMarkerStartIndex,
            blockEndIndex,
            Decoration.replace({
                widget: new EndMarkerWidget(),
            })
        );
    }

    return builder.finish();
}

// We don't do visibleRanges since images/tables interfere with this.
/*
function findAndDecorateQuestionEnvBlocks(view: EditorView): DecorationSet {
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

            // Replace \begin{...}[...]
            builder.add(
                blockStartIndex,
                startMarkerEndIndex,
                Decoration.replace({
                    widget: new StartMarkerWidget(name),
                })
            );

            // Mark the inner text
            if (textEndIndex > textStartIndex) {
                //builder.add(textStartIndex, textEndIndex, bulldozerTextMark);
            }

            // Replace \end{...}
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
*/

// --- Modal for Input ---
class InputModal extends Modal {
    inputValue: string = '';
    currentValue: string = '';
    onSubmit: (value: string) => void;
    inputField: HTMLInputElement;

    constructor(app: App, currentValue: string, onSubmit: (value: string) => void) {
        super(app);
        this.currentValue = currentValue;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "Title your Question" });

        new Setting(contentEl)
            .setName("Question Title: ")
            .addText((text) => {
                this.inputField = text.inputEl;
                text.setValue(this.currentValue)
                    .onChange((value) => {
                        this.inputValue = value;
                    });
                setTimeout(() => this.inputField.focus(), 50);
            });

        this.inputField.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.submit();
            }
        });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Submit")
                    .setCta()
                    .onClick(this.submit.bind(this)));
    }

    submit() {
        this.close();
        this.onSubmit(this.inputField.value.trim() || " "); // Use field value, fallback
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

// --- Factory function for the ViewPlugin ---
export function createQuestionEnvPlugin(app: App): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = findAndDecorateQuestionEnvBlocks(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.selectionSet) {
                    this.decorations = findAndDecorateQuestionEnvBlocks(update.view);
                }
            }
        },
        {
            decorations: (value) => value.decorations,
            eventHandlers: {
                mousedown: (event, view) => {
                    const target = event.target as HTMLElement;

                    if (target.classList.contains("bulldozer-name-box")) {
                        event.preventDefault();
                        event.stopPropagation();

                        const widgetPos = view.posAtDOM(target);
                        if (widgetPos === null) return;

                        const originalName = target.dataset.questionName || target.textContent || ""; // Get name from data attribute or text

                        // Find the block again to get accurate position for update
                        // Escape special regex characters in the name
                        const escapedName = originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const specificBlockRegex = new RegExp(`\\\\begin{questionenv}\\[${escapedName}\\]`, 'g');
                        const searchFrom = Math.max(0, widgetPos - 100); // Search nearby
                        const searchTo = Math.min(view.state.doc.length, widgetPos + 50);
                        const searchContext = view.state.doc.sliceString(searchFrom, searchTo);

                        let match;
                        let blockStartOffset = -1;

                        while((match = specificBlockRegex.exec(searchContext))) {
                           const potentialBlockStart = searchFrom + match.index;
                           // Rough check if widget is inside this matched area
                           if(potentialBlockStart <= widgetPos && potentialBlockStart + match[0].length >= widgetPos) {
                               blockStartOffset = potentialBlockStart;
                               break;
                           }
                        }

                        if (blockStartOffset === -1) {
                            console.error("Could not reliably find questionenv block start near click.");
                            return;
                        }

                        // Calculate the exact range of the name inside the brackets
                        const nameStartOffset = blockStartOffset + "\\begin{questionenv}[".length;
                        const nameEndOffset = nameStartOffset + originalName.length;

                        new InputModal(app, originalName, (newValue) => {
                            if (newValue && newValue !== originalName) {
                                // Replace the content in the editor
                                const transaction = view.state.update({
                                    changes: { from: nameStartOffset, to: nameEndOffset, insert: newValue },
                                    selection: { anchor: nameStartOffset + newValue.length }
                                });
                                view.dispatch(transaction);
                            }
                        }).open();
                    }
                },
            },
        }
    );
}


// --- Function to add Command and Context Menu ---
export function addInsertQuestionBlockCommand(plugin: Plugin) {
    const START_DELIMITER = "\\begin{questionenv}[ ]"; // Start with a default title
    const END_DELIMITER = "\\end{questionenv}";

    // --- 1. Add the Command ---
    plugin.addCommand({
        id: 'insert-question-block',
        name: 'Insert Question Block',
        editorCallback: (editor: Editor, view: MarkdownView) => {
            const cursor = editor.getCursor();

            const textToInsertStart = START_DELIMITER + "\n";
            const textToInsertEnd = "\n" + END_DELIMITER;

            // Insert the start delimiter at the cursor
            editor.replaceRange(textToInsertStart, cursor);

            // Calculate the position for the end delimiter (after the start + newline)
            const newCursorPosForEnd = { line: cursor.line + 1, ch: 0 };

            // Insert the end delimiter
            editor.replaceRange(textToInsertEnd, newCursorPosForEnd);

            // Set the cursor position *between* the delimiters on the empty line
            const finalCursorPos = { line: cursor.line + 1, ch: 0 };
            editor.setCursor(finalCursorPos);
        },
    });

    // --- 2. Add the Context Menu Item ---
    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
            menu.addItem((item: MenuItem) => {
                item
                    .setTitle("Insert Question")
                    .setIcon("help-circle")
                    .onClick(async () => {
                        // Use the command ID directly or construct from manifest if needed
                        plugin.app.commands.executeCommandById(`${plugin.manifest.id}:insert-question-block`);
                    });
            });
        })
    );
}
