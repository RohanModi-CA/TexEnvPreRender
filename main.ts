import { Plugin } from 'obsidian';
import { Prec } from '@codemirror/state';

// Import the setup functions from the specific environment files
import { createQuestionEnvPlugin, addInsertQuestionBlockCommand } from './questionEnv';
import { createEnumeratePlugin, addInsertEnumerateBlockCommand } from './enumerateEnv';

export default class EnhancedEnvironmentsPlugin extends Plugin {

    async onload() {
        console.log(`Loading plugin: ${this.manifest.name} v${this.manifest.version}`);

        // --- Add commands and context menus ---
        try {
            addInsertQuestionBlockCommand(this); // Pass `this` (the plugin instance)
        } catch (e) {
            console.error("Error adding Question Block command:", e);
        }

        try {
            addInsertEnumerateBlockCommand(this);  // Pass `this`
        } catch (e) {
            console.error("Error adding Enumerate Block command:", e);
        }

        // --- Register the editor extensions ---
        // Use Prec.high or other precedence settings as needed if conflicts arise
        // Lower numbers have higher precedence
        try {
            this.registerEditorExtension(Prec.high(createQuestionEnvPlugin(this.app)));
        } catch (e) {
            console.error("Error registering Question Env editor extension:", e);
        }
        try {
            this.registerEditorExtension(Prec.high(createEnumeratePlugin(this.app)));
        } catch (e) {
            console.error("Error registering Enumerate Env editor extension:", e);
        }


        console.log(`Plugin loaded: ${this.manifest.name}`);
    }

    onunload() {
        console.log(`Unloading plugin: ${this.manifest.name}`);
        // Editor extensions are automatically unregistered by Obsidian
    }
}
