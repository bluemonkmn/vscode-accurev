import { SourceControlResourceDecorations } from "vscode";

export class AccuRevState implements SourceControlResourceDecorations {
    tooltip: string;

    private constructor(tooltip: string) {
        this.tooltip = tooltip;
    }

    public static kept = new AccuRevState("kept");
    public static modified = new AccuRevState("modified");
}