import { SourceControlResourceDecorations, SourceControlResourceThemableDecorations } from "vscode";
import * as path from 'path';

export class AccuRevState implements SourceControlResourceDecorations {
	tooltip: string;
	dark?: SourceControlResourceThemableDecorations;
	light?: SourceControlResourceThemableDecorations;

    private constructor(tooltip: string, icon?: string) {
		this.tooltip = tooltip;
		if (icon) {
			this.dark = {iconPath: path.join(__dirname, `../icons/dark/${icon}`)};
			this.light = {iconPath: path.join(__dirname, `../icons/light/${icon}`)};
		}
    }

    public static kept = new AccuRevState("kept");
	public static modified = new AccuRevState("modified");
	public static keptmodified = new AccuRevState("kept/modified");
	public static overlapkept = new AccuRevState("overlap", "overlap.svg");
	public static overlapmodified = new AccuRevState("overlap", "overlap.svg");
}