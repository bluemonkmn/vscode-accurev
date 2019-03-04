import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import { AccuRevFile } from './file';
import { AccuRevState } from './state';
import * as path from 'path';
import { configure } from 'vscode/lib/testrunner';

export class AccuRevRepo {
    outChannel: vscode.OutputChannel;
    workspaceRoot: string;
    workspaceName: string;
    basisName: string;
    disposables: Map<string, vscode.Disposable> = new Map<string, vscode.Disposable>();
    config: vscode.WorkspaceConfiguration;

    public constructor(out: vscode.OutputChannel, workspaceRoot: string, config: vscode.WorkspaceConfiguration) {
        this.outChannel = out;
        this.workspaceRoot = workspaceRoot;
        this.workspaceName = "";
        this.basisName = "";
        this.config = config;
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
        let originalText: string;
        try {
            originalText = await this.execute(`cat -v ${this.basisName} \"${uri.fsPath}\"`);
        }
        catch(err) {
            this.outChannel.appendLine(`Error retrieving original file: ${err}`);
            return null;
        }
        await this.makeTempParentExist();
        let tempDir = this.getTempDir();
        let tempExists = await new Promise<boolean>((resolve) => {
            fs.access(tempDir, (err) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
        if (!tempExists) {
            let mkdir = promisify(fs.mkdir);            
            await mkdir(tempDir, {recursive: true});
        }
        const filematch = /[\/\\]([^\/\\]+)$/.exec(uri.fsPath);
        if (filematch !== null) {
            const tempPath = `${tempDir}\\${filematch[1]}`;
            let writeFile = promisify(fs.writeFile);
            await writeFile(tempPath, originalText);
            if (!this.disposables.has(tempPath)) {
                this.disposables.set(tempPath, {dispose: async () => {
                    let unlink = promisify(fs.unlink);
                    try {
                        await unlink(tempPath);
                        try {
                            this.outChannel.appendLine(`Cleaning up ${tempPath}...`);
                        } catch(err2) { }
                    } catch (err) {
                        try {
                            this.outChannel.appendLine(`Failed - ${err}.`);
                        } catch(err3) { }
                    }
                }});
            }
            return vscode.Uri.file(tempPath);
        }
        return null;
    }

    public async getResourceStates(): Promise<vscode.SourceControlResourceState[]> {
        let resList: string;
        try {
            resList = await this.execute("stat -p -fx");
        }
        catch (err) {
            this.outChannel.appendLine(`Error retrieving pending file information: ${err}`);
            if (/session token/.test(err)) {
                if (!this.config.userid) {
                    this.outChannel.appendLine("AccuRev User ID setting is not specified. To allow automatic login, enter this setting.");
                    return [];
                }
                this.outChannel.appendLine("Attempting to login to resolve the problem...");
                try {
                   await this.execute(`login ${this.config.userid} ""`);
                   resList = await this.execute("stat -p -fx");
                } catch (err2) {
                    this.outChannel.appendLine(`Failed to login: ${err2}`);
                    return [];
                }
            } else {
                this.outChannel.appendLine("Cause of error does not appear login related, giving up.");
                return [];
            }
        }
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

    public dispose(): Promise<any> {

        return new Promise(async (err) => {
            this.disposables.forEach(disposable => {
                disposable.dispose();
            });
            this.disposables.clear();
            let rmdir = promisify(fs.rmdir);
            let tempDir = this.getTempDir();
            try {
                await rmdir(tempDir);
            } catch (err) {
                try {
                    this.outChannel.appendLine(`Error deleting ${tempDir}: ${err}.`);
                } catch (err2) { }
            }
        });
    }

    private getTempDir(): string {
        let tempDir = process.env["TEMP"];
        if (tempDir === undefined) {
            throw new Error("Unable to identify Temp directory.");
        }
        return path.join(tempDir, 'vscode-accurev', vscode.env.sessionId);
    }

    private async makeTempParentExist() {
        let temp = process.env["TEMP"];
        if (temp === undefined) {
            throw new Error("Unable to identify Temp directory.");
        }
        let tempParent = path.join(temp, 'vscode-accurev');
        let tempExists = await new Promise<boolean>((resolve) => {
            fs.access(tempParent, (err) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
        if (!tempExists) {
            let mkdir = promisify(fs.mkdir);
            try {
                await mkdir(tempParent);
            } catch (err) {
                this.outChannel.appendLine(`Failed to create ${tempParent}: ${err}`);
            }
        }
    }
}
