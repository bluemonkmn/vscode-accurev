import * as vscode from 'vscode';
import { AccuRevState } from './state';

export class AccuRevFile implements vscode.SourceControlResourceState {
    readonly resourceUri: vscode.Uri;
	readonly command?: vscode.Command | undefined;
	readonly state: AccuRevState;
    readonly decorations?: vscode.SourceControlResourceDecorations | undefined;
    public readonly elementId: number;

    constructor(uri: vscode.Uri, elementId: number, state: AccuRevState) {
        this.resourceUri = uri;
        this.decorations = this.state = state;
        this.command = { title: "diff", command: "accurev.openDiffBasis", tooltip: "Diff against basis version", arguments: [this]};
        this.elementId = elementId;
	}
	
	public isModified(): boolean {
		return (this.state === AccuRevState.modified|| this.state === AccuRevState.keptmodified);
	}

	public isKept(): boolean {
		return (this.state === AccuRevState.kept);
	}

	public isOverlap(): boolean {
		return this.state === AccuRevState.overlap;
	}
}