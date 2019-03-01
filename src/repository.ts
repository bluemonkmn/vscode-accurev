import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import { AccuRevFile } from './file';
import { AccuRevState } from './state';
import * as path from 'path';

export class AccuRevRepo {
    outChannel: vscode.OutputChannel;
    workspaceRoot: string;
    workspaceName: string;
    basisName: string;
    disposables: vscode.Disposable[] = [];

    public constructor(out: vscode.OutputChannel, workspaceRoot: string) {
        this.outChannel = out;
        this.workspaceRoot = workspaceRoot;
        this.workspaceName = "";
        this.basisName = "";
        this.getInfo();
    }

    public async execute(command: string): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            cp.exec(`cd \"${this.workspaceRoot}\" & accurev ${command}`, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                let result: string = stdout;
                if (stderr) {
                    result += stderr;
                }
                resolve(result);
            });
        });
    }

    public getPending() {
        this.execute("stat -p -fx").then((result) => {
            this.outChannel.appendLine(result);
        }, (reject) => {
            this.outChannel.appendLine(reject);
        });
    }

    public getInfo() {
        this.execute("info").then((result) => {
            const reWS = /^(Workspace\/ref|Basis):\s+(\S+)\s*$/gm;
            let match: RegExpExecArray | null = reWS.exec(result);
            while ((match = reWS.exec(result)) !== null) {
                if (match[1] === "Workspace/ref") {
                    this.workspaceName = match[2];
                } else if (match[1] === "Basis") {
                    this.basisName = match[2];
                }
            }
        }, (reject) => {
            this.outChannel.appendLine(reject);
        });
    }

    public async provideOriginalResource(uri: vscode.Uri): Promise<vscode.Uri | null> {
        let originalText = await this.execute(`cat -v ${this.basisName} \"${uri.fsPath}\"`);
        let tempDir = process.env["TEMP"];
        let tempExists = await new Promise<boolean>((resolve) => {
            fs.access(`${tempDir}\\vscode-accurev`, (err) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
        if (!tempExists) {
            let mkdir = promisify(fs.mkdir);
            await mkdir(`${tempDir}\\vscode-accurev`);
        }
        const filematch = /[\/\\]([^\/\\]+)$/.exec(uri.fsPath);
        if (filematch !== null) {
            const tempPath = `${tempDir}\\vscode-accurev\\${filematch[1]}`;
            let writeFile = promisify(fs.writeFile);
            await writeFile(tempPath, originalText);
            return vscode.Uri.file(tempPath);
        }
        return null;
    }

    public async getResourceStates(): Promise<vscode.SourceControlResourceState[]> {
        let resList = await this.execute("stat -p -fx");
        let match: RegExpExecArray | null;
        let result: vscode.SourceControlResourceState[] = [];
        let resourcePattern = /<element[^>]+\s+location=\"([^"\n]+)\"[^>]+\s+id=\"(\d+)\"[^>]+\s+status=\"([^"\n]+)\"/gm;
        while ((match = resourcePattern.exec(resList)) !== null) {
            let state: AccuRevState = AccuRevState.kept;
            if (match[3].indexOf("(modified)") >= 0) {
                state = AccuRevState.modified;
            }
            let filePath = path.join(this.workspaceRoot, match[1].substr(2));
            result.push(new AccuRevFile(vscode.Uri.file(filePath), Number.parseInt(match[2]), state));
        }
        return result;
    }

    public dispose(): void {
        this.disposables.forEach(disposable => {
            disposable.dispose();
        });
        this.disposables = [];
    }
}
