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

// --- Helper functions ---

function numberToLetter(n: number): string {
    let letters = '';
    while (n > 0) {
        let rem = (n - 1) % 26;
        letters = String.fromCharCode(97 + rem) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

function numberToRoman(num: number): string {
    if (num <= 0 || num >= 4000) {
        return num.toString();
    }
    const romanMap: { [key: number]: string } = {
        1000: 'm', 900: 'cm', 500: 'd', 400: 'cd', 100: 'c',
        90: 'xc', 50: 'l', 40: 'xl', 10: 'x', 9: 'ix', 5: 'v', 4: 'iv', 1: 'i'
    };
    let roman = '';
    const keys = Object.keys(romanMap).map(Number).sort((a, b) => b - a);

    for (const value of keys) {
        while (num >= value) {
            roman += romanMap[value];
            num -= value;
        }
    }
    return roman;
}

interface ParsedFormat {
    type: '1' | 'a' | 'A' | 'i' | 'I';
    decoratorStart: string;
    decoratorEnd: string;
}

function parseFormat(formatArg: string | undefined): ParsedFormat {
    const defaultFormat: ParsedFormat = { type: '1', decoratorStart: '', decoratorEnd: '.' };
    if (!formatArg) {
        return defaultFormat;
    }

    const format = formatArg.slice(1, -1).trim();
    if (!format) {
        return defaultFormat;
    }

    const regex = /^(\(?) *([1aAiI]) *([.)]?[\)]?)$/;
    const match = format.match(regex);

    if (match) {
        const type = match[2] as ParsedFormat['type'];
        const decoratorStart = match[1] || '';
        const decoratorEnd = match[3] || (type === '1' ? '.' : '');

        return { type, decoratorStart, decoratorEnd };
    } else {
        if (['1', 'a', 'A', 'i', 'I'].includes(format)) {
             return {
                type: format as ParsedFormat['type'],
                decoratorStart: '',
                decoratorEnd: (format === '1' ? '.' : '')
             };
        }
        console.warn(`Unrecognized enumerate format: "${format}". Using default.`);
        return defaultFormat;
    }
}

function generateIdentifier(counter: number, format: ParsedFormat): string {
    let value: string;
    switch (format.type) {
        case 'a': value = numberToLetter(counter); break;
        case 'A': value = numberToLetter(counter).toUpperCase(); break;
        case 'i': value = numberToRoman(counter); break;
        case 'I': value = numberToRoman(counter).toUpperCase(); break;
        case '1': default: value = counter.toString(); break;
    }
    return `${format.decoratorStart}${value}${format.decoratorEnd}`;
}

// --- Custom Widgets ---

class StartEnumerateWidget extends WidgetType {
    constructor(readonly format: string | undefined) {
        super();
    }

    eq(other: StartEnumerateWidget): boolean {
        return other.format === this.format;
    }

    toDOM(view: EditorView): HTMLElement {
        const line = document.createElement("span");
        line.className = "enumerate-marker-line";

        const formatBox = document.createElement("span");
        formatBox.className = "enumerate-format-box";
        formatBox.textContent = this.format ? this.format.slice(1, -1) : "(default)";
        formatBox.style.cursor = "pointer";
        if (this.format) {
            formatBox.dataset.format = this.format;
        }

        line.appendChild(formatBox);
        return line;
    }

    ignoreEvent(): boolean { return false; }
}

class EndEnumerateWidget extends WidgetType {
    eq(other: EndEnumerateWidget): boolean { return true; }
    toDOM(view: EditorView): HTMLElement {
        const line = document.createElement("span");
        line.className = "enumerate-marker-line";
        return line;
    }
    ignoreEvent(): boolean { return true; }
}

class ItemIdentifierWidget extends WidgetType {
    constructor(readonly identifier: string) { super(); }
    eq(other: ItemIdentifierWidget): boolean { return other.identifier === this.identifier; }
    toDOM(view: EditorView): HTMLElement {
        const span = document.createElement("span");
        span.className = "enumerate-item-identifier";
        span.textContent = this.identifier;
        return span;
    }
    ignoreEvent(): boolean { return true; }
}

// --- CodeMirror Logic ---

const enumerateBlockRegex = /\\begin{enumerate}(\[[^\]]*\])?(.*?)\\end{enumerate}/gs;
const itemRegex = /\\item/g;


function findAndDecorateEnumerateBlocks(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const text = view.state.doc.toString(); // Process entire document content
    enumerateBlockRegex.lastIndex = 0; // Reset regex state

    let match;
    while ((match = enumerateBlockRegex.exec(text))) {
        const formatArg = match[1];
        const content = match[2];
        const blockContentStartIndex = match.index + match[0].indexOf(content);

        const blockStartIndex = match.index;
        const startMarkerEndIndex = blockStartIndex + "\\begin{enumerate}".length + (formatArg ? formatArg.length : 0);
        const contentStartIndex = startMarkerEndIndex;
        const contentEndIndex = contentStartIndex + content.length;
        const endMarkerStartIndex = contentEndIndex;
        const blockEndIndex = endMarkerStartIndex + "\\end{enumerate}".length;

        const parsedFormat = parseFormat(formatArg);
        let itemCounter = 0;

        // Replace \begin{enumerate} with StartEnumerateWidget
        builder.add(
            blockStartIndex,
            startMarkerEndIndex,
            Decoration.replace({
                widget: new StartEnumerateWidget(formatArg),
                block: false
            })
        );

        // Process items within the enumerate block
        const blockContent = text.slice(contentStartIndex, contentEndIndex);
        itemRegex.lastIndex = 0;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(blockContent))) {
            itemCounter++;
            const identifierString = generateIdentifier(itemCounter, parsedFormat);
            const itemStart = contentStartIndex + itemMatch.index;
            const itemEnd = itemStart + itemMatch[0].length;
            
            // Replace each item with ItemIdentifierWidget
            builder.add(
                itemStart,
                itemEnd,
                Decoration.replace({
                    widget: new ItemIdentifierWidget(identifierString)
                })
            );
        }

        // Replace \end{enumerate} with EndEnumerateWidget
        builder.add(
            endMarkerStartIndex,
            blockEndIndex,
            Decoration.replace({
                widget: new EndEnumerateWidget(),
                block: false
            })
        );
    }

    return builder.finish();
}

// No more visibleRanges
/*
function findAndDecorateEnumerateBlocks(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        enumerateBlockRegex.lastIndex = 0;
        let match;

        while ((match = enumerateBlockRegex.exec(text))) {
            const formatArg = match[1];
            const content = match[2];
            const blockContentStartIndex = from + match.index + match[0].indexOf(content);

            const blockStartIndex = from + match.index;
            const startMarkerEndIndex = blockStartIndex + "\\begin{enumerate}".length + (formatArg ? formatArg.length : 0);
            const contentStartIndex = startMarkerEndIndex;
            const contentEndIndex = contentStartIndex + content.length;
            const endMarkerStartIndex = contentEndIndex;
            const blockEndIndex = endMarkerStartIndex + "\\end{enumerate}".length;

            const parsedFormat = parseFormat(formatArg);
            let itemCounter = 0;

            builder.add(blockStartIndex, startMarkerEndIndex, Decoration.replace({ widget: new StartEnumerateWidget(formatArg), block: false }));

            const blockContent = view.state.doc.sliceString(contentStartIndex, contentEndIndex);
            itemRegex.lastIndex = 0;
            let itemMatch;
            while ((itemMatch = itemRegex.exec(blockContent))) {
                itemCounter++;
                const identifierString = generateIdentifier(itemCounter, parsedFormat);
                const itemStart = contentStartIndex + itemMatch.index;
                const itemEnd = itemStart + itemMatch[0].length;
                builder.add(itemStart, itemEnd, Decoration.replace({ widget: new ItemIdentifierWidget(identifierString) }));
            }

            builder.add(endMarkerStartIndex, blockEndIndex, Decoration.replace({ widget: new EndEnumerateWidget(), block: false }));
        }
    }
    return builder.finish();
}
*/

// --- Modal for Format Input ---
class EnumerateFormatModal extends Modal {
    currentFormat: string;
    onSubmit: (value: string) => void;
    inputField: HTMLInputElement;

    constructor(app: App, currentFormat: string, onSubmit: (value: string) => void) {
        super(app);
        this.currentFormat = currentFormat;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Set Enumerate Format" });
        contentEl.createEl("p", { text: "Leave empty for default. Examples: a.), I, 1." });

        new Setting(contentEl)
            .setName("Format:")
            .addText((text) => {
                this.inputField = text.inputEl;
                text.setValue(this.currentFormat);
                setTimeout(() => this.inputField.focus(), 50);
            });

        this.inputField.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.submit();
            }
        });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText("Submit").setCta().onClick(this.submit.bind(this)));
    }

    submit() {
        this.close();
        this.onSubmit(this.inputField.value.trim());
    }

    onClose() { this.contentEl.empty(); }
}

// --- Factory function for the ViewPlugin ---
export function createEnumeratePlugin(app: App): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            constructor(view: EditorView) { this.decorations = findAndDecorateEnumerateBlocks(view); }
            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.selectionSet) {
                    this.decorations = findAndDecorateEnumerateBlocks(update.view);
                }
            }
        },
        {
            decorations: (value) => value.decorations,
            eventHandlers: {
                mousedown: (event, view) => {
                    const target = event.target as HTMLElement;
                    if (target.classList.contains("enumerate-format-box")) {
                        event.preventDefault();
                        event.stopPropagation();

                        const widgetPos = view.posAtDOM(target);
                        if (widgetPos === null) return;

                        const searchFrom = Math.max(0, widgetPos - 50);
                        const searchTo = Math.min(view.state.doc.length, widgetPos + 50);
                        const searchContext = view.state.doc.sliceString(searchFrom, searchTo);
                        const localBlockRegex = /\\begin{enumerate}(\[[^\]]*\])?/g;
                        let localMatch;
                        let blockStartOffset = -1, formatStartOffset = -1, formatEndOffset = -1;
                        let currentFullFormat: string | undefined = undefined;

                        while((localMatch = localBlockRegex.exec(searchContext))) {
                            const potentialBlockStart = searchFrom + localMatch.index;
                            if (potentialBlockStart <= widgetPos && potentialBlockStart + localMatch[0].length >= widgetPos) {
                                blockStartOffset = potentialBlockStart;
                                currentFullFormat = localMatch[1];
                                const beginLength = "\\begin{enumerate}".length;
                                if (currentFullFormat) {
                                    formatStartOffset = beginLength;
                                    formatEndOffset = beginLength + currentFullFormat.length;
                                } else {
                                    formatStartOffset = beginLength;
                                    formatEndOffset = beginLength;
                                }
                                break;
                            }
                        }

                        if (blockStartOffset === -1) { console.error("Could not reliably find enumerate block start near click."); return; }

                        const currentDisplayFormat = currentFullFormat ? currentFullFormat.slice(1, -1) : "";

                        new EnumerateFormatModal(app, currentDisplayFormat, (newValue) => {
                            let newFormatString = "";
                            if (newValue && newValue.trim() !== "") {
                                newFormatString = `[${newValue.trim()}]`;
                            }
                            const changeFrom = blockStartOffset + formatStartOffset;
                            const changeTo = blockStartOffset + formatEndOffset;
                            const transaction = view.state.update({
                                changes: { from: changeFrom, to: changeTo, insert: newFormatString },
                                selection: { anchor: changeFrom + newFormatString.length }
                            });
                            view.dispatch(transaction);
                        }).open();
                    }
                }
            }
        }
    );
}

// --- Function to add Command and Context Menu ---
export function addInsertEnumerateBlockCommand(plugin: Plugin) {
    const START_DELIMITER = "\\begin{enumerate}[]";
    const ITEM_MARKER = "\\item ";
    const END_DELIMITER = "\\end{enumerate}";

    plugin.addCommand({
        id: 'insert-enumerate-block',
        name: 'Insert Enumerated List',
        editorCallback: (editor: Editor, view: MarkdownView) => {
            const cursor = editor.getCursor();
            const textToInsertStart = START_DELIMITER + "\n";
            const textToInsertItem = ITEM_MARKER;
            const textToInsertEnd = "\n" + END_DELIMITER;

            editor.replaceRange(textToInsertStart, cursor);
            const itemLine = cursor.line + 1;
            const itemPos = { line: itemLine, ch: 0 };
            editor.replaceRange(textToInsertItem, itemPos);
            const endLine = itemLine + 1;
            const endPos = { line: endLine, ch: 0 };
            editor.replaceRange(textToInsertEnd, endPos);
            editor.setCursor({ line: itemLine, ch: ITEM_MARKER.length });
        },
    });

    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
            menu.addItem((item: MenuItem) => {
                item
                    .setTitle("Insert Enumerated List")
                    .setIcon("list-ordered")
                    .onClick(async () => {
                        plugin.app.commands.executeCommandById(`${plugin.manifest.id}:insert-enumerate-block`);
                    });
            });
        })
    );
}
