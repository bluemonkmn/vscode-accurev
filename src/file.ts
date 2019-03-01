import * as vscode from 'vscode';
import { AccuRevState } from './state';

export class AccuRevFile implements vscode.SourceControlResourceState {
    readonly resourceUri: vscode.Uri;
    readonly command?: vscode.Command | undefined;
    readonly decorations?: vscode.SourceControlResourceDecorations | undefined;
    public readonly elementId: number;

    constructor(uri: vscode.Uri, elementId: number, state: AccuRevState) {
        this.resourceUri = uri;
        this.decorations = state;
        this.command = { title: "diff", command: "accurev.openDiffBasis", tooltip: "Diff against basis version", arguments: [uri]};
        this.elementId = elementId;
    }
}