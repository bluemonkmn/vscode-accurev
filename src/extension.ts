// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AccuRevRepo, AccuRevVersion } from './repository';
import { AccuRevFile } from './file';
import { AccuRevState } from './state';

let globalState: {context: vscode.ExtensionContext,
	config: vscode.WorkspaceConfiguration, 
	channel: vscode.OutputChannel,
	disposables: vscode.Disposable[],
	configListener: vscode.Disposable | null,
	dispose: () => void} | null;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

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

	globalState.configListener = vscode.workspace.onDidChangeConfiguration(async (section) => {
		if (section.affectsConfiguration("accurev.enabled")) {
			if (globalState === null) {
				return;
			}
			globalState.config = vscode.workspace.getConfiguration("accurev");
			if (globalState.disposables.length === 0) { // enabled setting isn't updated yet.
				await innerActivate(context);
			} else {
				innerDeactivate();
			}
		}
	});

	if (config.enabled) {
		await innerActivate(context);
	} else {
		globalState.channel.appendLine("AccuRev extension is inactive except to listen for activation via enabled setting.");
	}

	context.subscriptions.push(globalState);
}

async function innerActivate(context: vscode.ExtensionContext) {
	if (globalState === null) {
		return;
	}

	let folders: string[] = [vscode.env.appRoot];
	let scm: vscode.SourceControl | undefined;
	if (vscode.workspace.workspaceFolders) {
		if (vscode.workspace.workspaceFolders.length === 1) {
			let rootUri = vscode.workspace.workspaceFolders[0].uri;
			scm = vscode.scm.createSourceControl("accurev", "AccuRev", rootUri);
		} else {
			scm = vscode.scm.createSourceControl("accurev", "AccuRev");
		}
		folders = vscode.workspace.workspaceFolders.map(folder => {
			return folder.uri.fsPath;
		});
	}

	let kept: vscode.SourceControlResourceGroup;
	let modified: vscode.SourceControlResourceGroup;

	
	const repo = await AccuRevRepo.GetInstance(globalState.channel, folders, globalState.config);
	if (scm) {
		globalState.disposables.push(scm, repo);
		scm.quickDiffProvider = repo;
		kept = scm.createResourceGroup("kept", "Kept");
		modified = scm.createResourceGroup("modified", "Modified");
		globalState.disposables.push(modified);
		repo.getResourceStates().then((result) => {
			kept.resourceStates = result.filter((r) => {return r.isKept();});
			modified.resourceStates = result.filter((r) => {return r.isModified();});
		});
	}

	globalState.disposables.push(vscode.commands.registerCommand('accurev.refresh', () => {
		repo.getResourceStates().then((result) => {
			kept.resourceStates = result.filter((r) => {return r.isKept();});
			modified.resourceStates = result.filter((r) => {return r.isModified();});
		});
	}));

	globalState.disposables.push(vscode.commands.registerCommand('accurev.openDiffBasis', async (file: AccuRevFile) => {
		try {
			let original = await repo.provideOriginalResource(file.resourceUri);
			let wsInfo = repo.GetWorkspaceInfo(file.resourceUri);
			if (wsInfo === undefined) {
				return;
			}
			if (original !== null) {
				let filename = vscode.workspace.asRelativePath(file.resourceUri);
				await vscode.commands.executeCommand('vscode.diff', original, file.resourceUri,  `${wsInfo.basis} ↔ ${filename}`);
			}
		}
		catch(err) {
			if (globalState) {
				globalState.channel.appendLine(err);
			}
		}
	}));

	globalState.disposables.push(vscode.commands.registerCommand('accurev.openDiffKept', async (file: AccuRevFile) => {
		try {
			let original = await repo.provideOriginalResource(file.resourceUri,undefined,AccuRevVersion.Kept);
			let wsInfo = repo.GetWorkspaceInfo(file.resourceUri);
			if (wsInfo === undefined) {
				return;
			}
			if (original !== null) {
				let filename = vscode.workspace.asRelativePath(file.resourceUri);
				await vscode.commands.executeCommand('vscode.diff', original, file.resourceUri,  `${wsInfo.workspace} ↔ ${filename}`);
			}
		}
		catch(err) {
			if (globalState) {
				globalState.channel.appendLine(err);
			}
		}
	}));

	globalState.disposables.push(vscode.commands.registerCommand('accurev.openFile', async (file: AccuRevFile) => {
		try {
			await vscode.commands.executeCommand('vscode.open', file.resourceUri);
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
	innerDeactivate();
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