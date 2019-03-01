// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AccuRevRepo } from './repository';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Extension "AccuRev" is now active.');
	let folder: string = vscode.env.appRoot;
	let scm: vscode.SourceControl | undefined;
	if (vscode.workspace.workspaceFolders) {
		let rootUri = vscode.workspace.workspaceFolders[0].uri;
		scm = vscode.scm.createSourceControl("accurev", "AccuRev", rootUri);
		folder = rootUri.fsPath;
	}

	const repo = new AccuRevRepo(getOutputChannel(), folder);
	if (scm) {
		scm.quickDiffProvider = repo;
		let modified = scm.createResourceGroup("modified", "Modified");
		repo.getResourceStates().then((result) => {
			modified.resourceStates = result;
		});
		context.subscriptions.push(modified);
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('accurev.refresh', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		getOutputChannel().appendLine('Hello World!');
		repo.getPending();
	});

	let diff = vscode.commands.registerCommand('accurev.openDiffBasis', async (file: vscode.Uri) => {
		try {
			let original = await repo.provideOriginalResource(file);
			if (original !== null) {
				let filename = vscode.workspace.asRelativePath(file);
				vscode.commands.executeCommand('vscode.diff', original, file,  `${repo.basisName}\\${filename} ↔ ${filename}`);
			}
		}
		catch(err) {
			getOutputChannel().appendLine(err);
		}
	});

	context.subscriptions.push(disposable, repo, diff);
}

let channel: vscode.OutputChannel;
function getOutputChannel(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel("AccuRev Log");
	}	
	return channel;
}

// this method is called when your extension is deactivated
export function deactivate() {}
