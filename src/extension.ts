// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AccuRevRepo } from './repository';

let globalState: {context: vscode.ExtensionContext,
	config: vscode.WorkspaceConfiguration, 
	channel: vscode.OutputChannel,
	disposables: vscode.Disposable[],
	configListener: vscode.Disposable | null,
	dispose: () => void} | null;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('AccuRev extension is listening for configuration changes.');

	let config = vscode.workspace.getConfiguration("accurev");

	globalState = {context: context,
		config: config,
		channel: vscode.window.createOutputChannel("AccuRev Log"),
		disposables: [],
		configListener: null,
		dispose: () => {deactivate();}};

	globalState.configListener = vscode.workspace.onDidChangeConfiguration((section) => {
		if (section.affectsConfiguration("accurev.enabled")) {
			if (globalState === null) {
				return;
			}
			globalState.config = vscode.workspace.getConfiguration("accurev");
			if (globalState.disposables.length === 0) { // enabled setting isn't updated yet.
				innerActivate(context);
			} else {
				innerDeactivate();
			}
		}
	});

	if (config.enabled) {
		innerActivate(context);
	} else {
		globalState.channel.appendLine("AccuRev extension is inactive except to listen for activation via enabled setting.");
	}

	context.subscriptions.push(globalState);
}

function innerActivate(context: vscode.ExtensionContext) {
	if (globalState === null) {
		return;
	}

	let folder: string = vscode.env.appRoot;
	let scm: vscode.SourceControl | undefined;
	if (vscode.workspace.workspaceFolders) {
		let rootUri = vscode.workspace.workspaceFolders[0].uri;
		scm = vscode.scm.createSourceControl("accurev", "AccuRev", rootUri);
		folder = rootUri.fsPath;
	}

	const repo = new AccuRevRepo(globalState.channel, folder, globalState.config);
	if (scm) {
		globalState.disposables.push(scm, repo);
		scm.quickDiffProvider = repo;
		let modified = scm.createResourceGroup("modified", "Modified");
		globalState.disposables.push(modified);
		repo.getResourceStates().then((result) => {
			modified.resourceStates = result;
		});
	}

	globalState.disposables.push(vscode.commands.registerCommand('accurev.refresh', () => {
		if (globalState !== null) {
			globalState.channel.appendLine('Hello World!');
		}
		repo.getPending();
	}));

	globalState.disposables.push(vscode.commands.registerCommand('accurev.openDiffBasis', async (file: vscode.Uri) => {
		try {
			let original = await repo.provideOriginalResource(file);
			if (original !== null) {
				let filename = vscode.workspace.asRelativePath(file);
				vscode.commands.executeCommand('vscode.diff', original, file,  `${repo.basisName}\\${filename} ↔ ${filename}`);
			}
		}
		catch(err) {
			if (globalState) {
				globalState.channel.appendLine(err);
			}
		}
	}));

	globalState.channel.appendLine("AccuRev extension is now active.");
}

// this method is called when your extension is deactivated
export function deactivate() {
	if (globalState === null) {
		return;
	}
	if (globalState.configListener !== null) {
		globalState.configListener.dispose();
		globalState.configListener = null;
	}
}

function innerDeactivate() {
	if (globalState === null) {
		return;
	}
	globalState.disposables.forEach(disposable => {
		disposable.dispose();
	});
	globalState.disposables = [];
	globalState.channel.appendLine("AccuRev extension deactivated.");
}